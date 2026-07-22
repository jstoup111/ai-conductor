import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

vi.mock('execa', () => ({ execa: vi.fn() }));
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState, readState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { parsePlanTaskPaths } from '../../src/engine/autoheal.js';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';
import { currentCommitSha } from '../../src/engine/project-prelude.js';

// Drives the gate-driven tail (build…finish) with verifyArtifacts on. The front
// half is pre-marked done and the loop is started at `build` (fromStep), so each
// test exercises the selector-driven tail directly. Medium (M) tier so
// manual_test still runs (S-tier now legitimately skips manual_test per D5;
// see steps.ts skippableForTiers) — the tail is build → manual_test →
// (retro tier-skipped only at S, so it runs at M too) → finish.

const FRONT_DONE: ConductState = {
  complexity_tier: 'M',
  feature_desc: 'add foo',
  worktree: 'done',
  memory: 'done',
  explore: 'done',
  prd: 'done',
  complexity: 'done',
  stories: 'done',
  conflict_check: 'skipped',
  plan: 'done',
  architecture_diagram: 'skipped',
  architecture_review: 'skipped',
  acceptance_specs: 'skipped',
};

describe('integration/gate-loop', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gate-loop-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function conductorWith(runner: StepRunner): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
    });
  }

  // Per-step artifact creation so each gate's objective verdict passes.
  async function satisfy(step: string): Promise<StepRunResult> {
    if (step === 'build') {
      // The build gate now recomputes completion from the engine-only
      // evidence sidecar (H6/H7) rather than trusting raw task-status.json
      // rows. execa is mocked module-wide in this file (to keep the rest of
      // the tail hermetic), so the git-trailer path in deriveCompletion
      // can't run here — stamp the sidecar directly for whatever task ids
      // the test's plan actually declares (falling back to a single
      // placeholder id for tests that never seed a plan, where the
      // completion context has no planPath and the gate falls back to
      // trusting the raw file rows unchanged).
      let taskIds: string[] = ['t1'];
      try {
        const planText = await readFile(join(dir, '.docs/plans/p.md'), 'utf-8');
        const planned = Array.from(parsePlanTaskPaths(planText).keys());
        if (planned.length > 0) taskIds = planned;
      } catch {
        // No plan seeded — keep the legacy placeholder id.
      }
      const evidence = await createTaskEvidence(dir);
      for (const id of taskIds) {
        evidence.evidenceStamps.set(id, { sha: '0'.repeat(40), form: 'test-stub' });
      }
      await evidence.write();
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: taskIds.map((id) => ({ id, status: 'completed' })) }),
      );
    } else if (step === 'build_review') {
      // The build_review judgement gate's completion predicate requires a
      // fresh, valid PASS verdict at .pipeline/build-review.json (see
      // artifacts.ts BUILD_REVIEW_VERDICT). Tests that enable build_review
      // and don't care about its grader behavior (only its topology/ordering
      // in the tail) satisfy it here, same as every other gate's artifact.
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/build-review.json'),
        JSON.stringify({
          verdict: 'PASS',
          rubric: { tautology: false, scope: false, rootCause: false },
        }),
      );
    } else if (step === 'wiring_check') {
      // The wiring-reachability gate (Task 9) requires a fresh, valid,
      // zero-gap evidence artifact at .pipeline/wiring-evidence.json (see
      // WIRING_EVIDENCE/validateWiringEvidence in artifacts.ts). The
      // predicate compares evidence.head against ctx.getHeadSha(), which
      // shells out to `git rev-parse HEAD` in `dir` — null (no comparison)
      // when `dir` isn't a real git repo, a real sha for the suites below
      // that do `initRepo()`. Resolve it dynamically so both cases match.
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const head = (await currentCommitSha(dir)) ?? '2'.repeat(40);
      await writeFile(
        join(dir, '.pipeline/wiring-evidence.json'),
        JSON.stringify({
          schema: 1,
          base: '1'.repeat(40),
          head,
          layer2: { applicable: false },
          waivers: [],
          tasks: [],
        }),
      );
    } else if (step === 'manual_test') {
      await writeFile(
        join(dir, '.pipeline/manual-test-results.md'),
        '| Story | Result |\n|---|---|\n| foo | PASS |\n',
      );
    } else if (step === 'prd_audit') {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/prd-audit.md'),
        '| FR | Verdict | Evidence |\n|---|---|---|\n| FR-1 | ALIGNED | foo.ts:1 |\n',
      );
    } else if (step === 'architecture_review_as_built') {
      await mkdir(join(dir, '.docs/decisions'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/architecture-review-as-built.md'),
        '# As-Built Review\n\nVerdict: APPROVED\n',
      );
    } else if (step === 'finish') {
      await writeFile(join(dir, '.pipeline/finish-choice'), 'keep');
    }
    return { success: true };
  }

  it('drives build → manual_test → finish via the selector and writes DONE', async () => {
    await writeState(statePath, { ...FRONT_DONE });
    const ran: string[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        ran.push(step);
        return satisfy(step);
      },
    };
    let completed = false;
    let converged = false;
    events.on('feature_complete', () => {
      completed = true;
    });
    events.on('loop_converged', () => {
      converged = true;
    });

    await conductorWith(runner).run();

    expect(ran).toContain('build');
    expect(ran).toContain('manual_test');
    expect(ran).toContain('finish');
    expect(ran).toContain('retro'); // M tier: retro is not tier-skipped
    expect(completed).toBe(true);
    expect(converged).toBe(true); // loop_converged event emitted
    await expect(access(join(dir, '.pipeline/DONE'))).resolves.toBeUndefined();
  });

  it('re-opens plan on a kickback, re-runs build, then converges', async () => {
    // Real stories + covering plan so the plan predicate passes on recompute.
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
    await writeFile(
      join(dir, '.docs/stories/s.md'),
      '**Status:** Accepted\n\n## Story 1-1: foo\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then err\n',
    );
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await writeFile(
      join(dir, '.docs/plans/p.md'),
      '### Task 1\n**Story:** 1-1 (happy path)\n**Dependencies:** none\n\n### Task 2\n**Story:** 1-1 (negative path)\n**Dependencies:** Task 1\n',
    );
    await writeState(statePath, { ...FRONT_DONE });

    let buildRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          buildRuns++;
          await satisfy('build');
          if (buildRuns === 1) {
            // Simulate the build agent re-opening plan (kickback).
            await writeVerdict(dir, 'plan', {
              satisfied: false,
              checkedAt: 1,
              kickback: { from: 'build', evidence: 'AC negative path missing' },
            });
          }
          return { success: true };
        }
        return satisfy(step);
      },
    };
    let completed = false;
    const kicks: Array<{ from: string; to: string }> = [];
    events.on('feature_complete', () => {
      completed = true;
    });
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
    });

    await conductorWith(runner).run();

    expect(buildRuns).toBe(2); // built → kicked back to plan → rebuilt
    expect(completed).toBe(true);
    expect(kicks).toContainEqual({ from: 'build', to: 'plan' }); // kickback event
  });

  it('HALTs (no completion) when a kickback target never satisfies', async () => {
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
    await writeFile(
      join(dir, '.docs/stories/s.md'),
      '**Status:** Accepted\n\n## Story 1-1: foo\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then err\n',
    );
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    // Plan covers ONLY the happy path → plan verdict stays unsatisfied.
    await writeFile(
      join(dir, '.docs/plans/p.md'),
      '### Task 1\n**Story:** 1-1 (happy path)\n',
    );
    await writeState(statePath, { ...FRONT_DONE });

    let buildRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          buildRuns++;
          await satisfy('build');
          if (buildRuns === 1) {
            await writeVerdict(dir, 'plan', {
              satisfied: false,
              checkedAt: 1,
              kickback: { from: 'build', evidence: 'negative path missing' },
            });
          }
          return { success: true };
        }
        return satisfy(step);
      },
    };
    let completed = false;
    let halted = false;
    events.on('feature_complete', () => {
      completed = true;
    });
    events.on('loop_halt', () => {
      halted = true;
    });

    await conductorWith(runner).run();

    expect(completed).toBe(false);
    expect(halted).toBe(true); // loop_halt event emitted
    await expect(access(join(dir, '.pipeline/HALT'))).resolves.toBeUndefined();
  });

  it('runs a custom config step inserted via `after` (config compatibility)', async () => {
    // The conductor now drives the resolved registry (buildStepRegistry), so a
    // custom step from .ai-conductor/config.yml is dispatched and indexed.
    const config = {
      steps: { lint: { after: 'memory', skill: 'lint-skill' } },
    };
    const allDone: Record<string, string> = {};
    for (const s of ALL_STEPS) allDone[s.name] = 'done';
    await writeState(statePath, {
      ...(allDone as unknown as ConductState),
      complexity_tier: 'M',
    });

    const ran: string[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        ran.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      config,
      fromStep: 'lint',
    });
    await conductor.run();

    expect(ran).toContain('lint'); // the custom step was dispatched
    const finalState = JSON.parse(await readFile(statePath, 'utf-8'));
    expect(finalState.lint).toBe('done');
  });

  // ── Front-half amendment kickback (Story: "Front-half amendment kickback
  // emits one event at detection time") ─────────────────────────────────────
  // conflict_check is a front-half step (before `build`, the first loopGate)
  // that is not itself a kickbackTarget. It can still detect — and write, as
  // an artifact — that it has re-opened an upstream gate (architecture_review
  // here). advanceTail must emit the `kickback` event for that detection even
  // though the front half stays linear (no navigateBack, i++ unchanged).
  describe('front-half amendment kickback (conflict_check → architecture_review)', () => {
    // Tier 'M' (not 'S'): `conflict_check` is skippableForTiers: ['S'], so an
    // 'S' tier would tier-skip it before the runner ever ran it — the runner
    // callback (and this whole scenario) needs conflict_check to actually
    // execute so it can write the kickback-shaped verdict onto
    // architecture_review. `acceptance_specs` is pre-marked 'done' (rather
    // than left pending) so it isn't re-dispatched under tier 'M' — this
    // scenario is about the front-half conflict_check → architecture_review
    // kickback, not acceptance-spec generation.
    const FRONT_TO_CONFLICT: ConductState = {
      complexity_tier: 'M',
      feature_desc: 'add foo',
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      prd: 'done',
      complexity: 'done',
      architecture_diagram: 'skipped',
      architecture_review: 'done',
      stories: 'done',
      acceptance_specs: 'done',
    };

    function conductorFromConflictCheck(runner: StepRunner): Conductor {
      return new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        fromStep: 'conflict_check',
        maxRetries: 1,
      });
    }

    async function seedStoriesAndPlan(): Promise<void> {
      await mkdir(join(dir, '.docs/stories'), { recursive: true });
      await writeFile(
        join(dir, '.docs/stories/s.md'),
        '**Status:** Accepted\n\n## Story 1-1: foo\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then err\n',
      );
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
        join(dir, '.docs/plans/p.md'),
        '### Task 1\n**Story:** 1-1 (happy path)\n**Dependencies:** none\n\n### Task 2\n**Story:** 1-1 (negative path)\n**Dependencies:** Task 1\n',
      );
    }

    async function seedApprovedAdr(): Promise<void> {
      await mkdir(join(dir, '.docs/decisions'), { recursive: true });
      await writeFile(
        join(dir, '.docs/decisions/adr-1.md'),
        '# ADR 1\n\nStatus: APPROVED\n',
      );
    }

    // A downstream architecture_review kickback cascade-stales acceptance_specs
    // (pre-marked 'done' in FRONT_TO_CONFLICT). When the tail re-verifies a
    // 'stale' step it re-checks the real completion predicate, so a scenario
    // that re-opens architecture_review twice needs real spec + RED-evidence
    // artifacts on disk for acceptance_specs to still pass on recheck.
    async function seedAcceptanceSpecsRed(): Promise<void> {
      await mkdir(join(dir, 'test/acceptance'), { recursive: true });
      await writeFile(
        join(dir, 'test/acceptance/foo.test.ts'),
        "it('fails until implemented', () => { expect(true).toBe(false); });\n",
      );
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/acceptance-specs-red.json'),
        JSON.stringify({
          command: 'vitest run test/acceptance',
          targetSpecs: ['test/acceptance/foo.test.ts'],
          executed: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          errors: 0,
        }),
      );
    }

    function trackKickbacks(): Array<{ from: string; to: string; count: number }> {
      const kicks: Array<{ from: string; to: string; count: number }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to, count: e.count });
      });
      return kicks;
    }

    it('emits a kickback event when conflict_check re-opens architecture_review, without invoking navigateBack', async () => {
      await seedStoriesAndPlan();
      await seedApprovedAdr();
      await writeState(statePath, { ...FRONT_TO_CONFLICT });

      const ran: string[] = [];
      let conflictRuns = 0;
      const runner: StepRunner = {
        run: async (step) => {
          ran.push(step);
          if (step === 'conflict_check') {
            conflictRuns++;
            await mkdir(join(dir, '.docs/conflicts'), { recursive: true });
            await writeFile(
              join(dir, '.docs/conflicts/report.md'),
              '# Conflict Check\n\nNo blocking conflicts.\n',
            );
            // Only the FIRST run detects the amendment kickback — `fromStep:
            // 'conflict_check'` means this step re-executes every time the
            // (front-half-linear) loop index reaches it again, e.g. right
            // after the tail's selector re-opens and re-satisfies
            // architecture_review. A real conflict-check skill wouldn't
            // re-flag a gate it already amended and that's since resolved.
            if (conflictRuns === 1) {
              await writeVerdict(dir, 'architecture_review', {
                satisfied: false,
                checkedAt: 1,
                kickback: { from: 'conflict_check', evidence: 'incompatible ADR seam' },
              });
            }
          }
          return satisfy(step);
        },
      };
      const kicks = trackKickbacks();
      let completed = false;
      events.on('feature_complete', () => {
        completed = true;
      });
      await conductorFromConflictCheck(runner).run();

      expect(kicks).toEqual([
        { from: 'conflict_check', to: 'architecture_review', count: 1 },
      ]);
      // Linear advance unaffected at detection time: plan ran immediately
      // next (no navigateBack jump). The gate-driven tail's own selector
      // — independently of the front-half detection — later re-opens
      // architecture_review because its verdict is still unsatisfied on
      // disk, exactly once, and the loop still converges.
      const conflictIdx = ran.indexOf('conflict_check');
      expect(ran[conflictIdx + 1]).toBe('plan');
      expect(ran.filter((s) => s === 'architecture_review')).toHaveLength(1);
      expect(completed).toBe(true);

      const finalState = JSON.parse(await readFile(statePath, 'utf-8'));
      // Step statuses untouched by the front-half scan: architecture_review is
      // still whatever it was before (never restaged to pending/stale).
      expect(finalState.architecture_review).toBe('done');
    });

    it('emits no kickback event when the unsatisfied verdict carries no kickback provenance', async () => {
      await seedStoriesAndPlan();
      await writeState(statePath, { ...FRONT_TO_CONFLICT });

      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'conflict_check') {
            await writeVerdict(dir, 'architecture_review', {
              satisfied: false,
              checkedAt: 1,
              // No `kickback` field — plain unsatisfied, not a re-open.
            });
          }
          return satisfy(step);
        },
      };
      const kicks = trackKickbacks();

      await conductorFromConflictCheck(runner).run();

      expect(kicks).toEqual([]);
    });

    it('emits no kickback event when kickback.from does not match the completing step', async () => {
      await seedStoriesAndPlan();
      await writeState(statePath, { ...FRONT_TO_CONFLICT });

      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'conflict_check') {
            await writeVerdict(dir, 'architecture_review', {
              satisfied: false,
              checkedAt: 1,
              // Attributed to a different step than the one completing now.
              kickback: { from: 'stories', evidence: 'unrelated re-open' },
            });
          }
          return satisfy(step);
        },
      };
      const kicks = trackKickbacks();

      await conductorFromConflictCheck(runner).run();

      expect(kicks).toEqual([]);
    });

    it('emits exactly one kickback event for a front-half-origin verdict (no duplicate once the tail runs)', async () => {
      await seedStoriesAndPlan();
      await seedApprovedAdr();
      await writeState(statePath, { ...FRONT_TO_CONFLICT });

      let conflictRuns = 0;
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'conflict_check') {
            conflictRuns++;
            await mkdir(join(dir, '.docs/conflicts'), { recursive: true });
            await writeFile(
              join(dir, '.docs/conflicts/report.md'),
              '# Conflict Check\n\nNo blocking conflicts.\n',
            );
            // Only the FIRST run detects the amendment kickback — see the
            // comment on the earlier "emits a kickback event..." test: a real
            // conflict-check skill wouldn't re-flag a gate it already amended
            // and that's since resolved by the front-half-linear re-walk.
            if (conflictRuns === 1) {
              await writeVerdict(dir, 'architecture_review', {
                satisfied: false,
                checkedAt: 1,
                kickback: { from: 'conflict_check', evidence: 'incompatible ADR seam' },
              });
            }
          }
          return satisfy(step);
        },
      };
      const kicks = trackKickbacks();
      let completed = false;
      events.on('feature_complete', () => {
        completed = true;
      });

      await conductorFromConflictCheck(runner).run();

      // build/manual_test/finish all complete afterward and each re-run
      // advanceTail's tail scan; the stale architecture_review verdict
      // (kickback.from: 'conflict_check') must never be re-attributed to a
      // later step and re-emitted.
      expect(kicks).toHaveLength(1);
      expect(completed).toBe(true);
    });

    it('shares the per-gate kickback counter between a front-half detection and a later tail re-open', async () => {
      await seedStoriesAndPlan();
      await seedApprovedAdr();
      await seedAcceptanceSpecsRed();
      await writeState(statePath, { ...FRONT_TO_CONFLICT });

      let conflictRuns = 0;
      let buildRuns = 0;
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'conflict_check') {
            conflictRuns++;
            await mkdir(join(dir, '.docs/conflicts'), { recursive: true });
            await writeFile(
              join(dir, '.docs/conflicts/report.md'),
              '# Conflict Check\n\nNo blocking conflicts.\n',
            );
            if (conflictRuns === 1) {
              await writeVerdict(dir, 'architecture_review', {
                satisfied: false,
                checkedAt: 1,
                kickback: { from: 'conflict_check', evidence: 'incompatible ADR seam' },
              });
            }
            return satisfy(step);
          }
          if (step === 'build') {
            buildRuns++;
            await satisfy('build');
            // build independently detects the same gate needs re-opening —
            // the tail scan's own kickback-target loop picks this up. Only
            // the FIRST build run re-flags it; once architecture_review is
            // re-satisfied and build re-runs, it must not loop forever.
            if (buildRuns === 1) {
              await writeVerdict(dir, 'architecture_review', {
                satisfied: false,
                checkedAt: 2,
                kickback: { from: 'build', evidence: 'architecture drift found' },
              });
            }
            return { success: true };
          }
          return satisfy(step);
        },
      };
      const kicks = trackKickbacks();
      let completed = false;
      events.on('feature_complete', () => {
        completed = true;
      });

      await conductorFromConflictCheck(runner).run();

      expect(kicks).toEqual([
        { from: 'conflict_check', to: 'architecture_review', count: 1 },
        { from: 'build', to: 'architecture_review', count: 2 }, // shared counter, not a fresh 1
      ]);
      expect(completed).toBe(true);
    });

    it('HALTs via the tail scan\'s exact sequence when a front-half re-open pushes a shared gate count past the cap', async () => {
      await seedStoriesAndPlan();
      await seedApprovedAdr();
      await writeState(statePath, { ...FRONT_TO_CONFLICT });

      let conflictRuns = 0;
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'conflict_check') {
            conflictRuns++;
            await mkdir(join(dir, '.docs/conflicts'), { recursive: true });
            await writeFile(
              join(dir, '.docs/conflicts/report.md'),
              '# Conflict Check\n\nNo blocking conflicts.\n',
            );
            if (conflictRuns === 1) {
              await writeVerdict(dir, 'architecture_review', {
                satisfied: false,
                checkedAt: 1,
                kickback: { from: 'conflict_check', evidence: 'incompatible ADR seam #1' },
              });
            } else {
              // Second amendment re-open of the SAME gate — combined with the
              // build-triggered tail re-open below, this is the 3rd re-open
              // of architecture_review (cap is 2).
              await writeVerdict(dir, 'architecture_review', {
                satisfied: false,
                checkedAt: 3,
                kickback: { from: 'conflict_check', evidence: 'incompatible ADR seam #2' },
              });
            }
            return satisfy(step);
          }
          if (step === 'build') {
            await satisfy('build');
            await writeVerdict(dir, 'architecture_review', {
              satisfied: false,
              checkedAt: 2,
              kickback: { from: 'build', evidence: 'architecture drift found' },
            });
            return { success: true };
          }
          return satisfy(step);
        },
      };
      const kicks = trackKickbacks();
      let halted = false;
      let haltReason = '';
      let completed = false;
      events.on('loop_halt', (e) => {
        if (e.type === 'loop_halt') {
          halted = true;
          haltReason = e.reason;
        }
      });
      events.on('feature_complete', () => {
        completed = true;
      });

      await conductorFromConflictCheck(runner).run();

      expect(kicks.map((k) => k.count)).toEqual([1, 2, 3]);
      expect(halted).toBe(true);
      expect(completed).toBe(false);
      expect(haltReason).toContain('architecture_review');
      expect(haltReason).toContain('3');
      await expect(access(join(dir, '.pipeline/HALT'))).resolves.toBeUndefined();
    });
  });

  it('resets the session before each tail step (unconditional fresh-per-step)', async () => {
    // All front-half steps done; tail steps pending so they run. Start at build.
    const state: Record<string, string> = {};
    for (const s of ALL_STEPS) state[s.name] = 'done';
    for (const name of ['build', 'manual_test', 'retro', 'finish']) delete state[name];
    await writeState(statePath, {
      ...(state as unknown as ConductState),
      // M tier: S-tier now skips manual_test too (D5), which would collapse
      // the tail to just build/finish and defeat this test's purpose of
      // proving every tail step gets a fresh session. M tier keeps
      // build, manual_test, retro, and finish all running.
      complexity_tier: 'M',
    });

    const resetSession = vi.fn(async () => {});
    const runner: StepRunner & { resetSession: typeof resetSession } = {
      run: async () => ({ success: true }),
      resetSession,
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      fromStep: 'build',
    });
    await conductor.run();

    // build, manual_test, retro, finish all ran (M tier, nothing skipped in
    // the tail) → one reset each.
    expect(resetSession).toHaveBeenCalledTimes(4);
  });

  describe('manual-test FAIL routing end-to-end with a real repo (#367)', () => {
    const execFileP = promisify(execFile);
    const FAIL_RESULTS = '| Story | Result |\n|---|---|\n| s1 | FAIL |\n';
    const PASS_RESULTS = '| Story | Result |\n|---|---|\n| s1 | PASS |\n';

    async function git(...args: string[]): Promise<void> {
      await execFileP(
        'git',
        ['-c', 'user.email=t@test', '-c', 'user.name=t', ...args],
        { cwd: dir },
      );
    }

    async function initRepo(): Promise<void> {
      await git('init', '-q', '-b', 'main');
      await git('commit', '--allow-empty', '-q', '-m', 'init');
    }

    function daemonConductor(runner: StepRunner): Conductor {
      const fakeGit: GitRunner = async (args) =>
        args.includes('--symbolic-full-name')
          ? { stdout: 'refs/remotes/origin/feature/x\n' }
          : { stdout: '' };
      return new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        daemon: true,
        maxRetries: 1,
        fromStep: 'build',
        git: fakeGit,
      });
    }

    it('FAIL → kickback → build commits a fix → manual_test passes and the run converges', async () => {
      await initRepo();
      // rebase seeded skipped: the engine-native rebase step needs an origin
      // this fixture doesn't have; skipping it keeps the tail converging.
      await writeState(statePath, { ...FRONT_DONE, rebase: 'skipped' } as ConductState);

      let fixed = false;
      const ran: string[] = [];
      const runner: StepRunner = {
        run: async (step, _artifacts?: unknown, opts?: { retryReason?: string }) => {
          ran.push(step);
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
            );
            if (opts?.retryReason) {
              // The kickback dispatch: implement the fix AS COMMITS (moves HEAD),
              // which is exactly what the whitewash guard requires.
              await writeFile(join(dir, 'src.txt'), 'fixed');
              await git('add', '.');
              await git('commit', '-q', '-m', 'fix manual-test bug');
              fixed = true;
            }
            return { success: true };
          }
          if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              fixed ? PASS_RESULTS : FAIL_RESULTS,
            );
            return { success: true };
          }
          if (step === 'finish') {
            await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
            const stateResult = await readState(statePath);
            const state = stateResult.ok ? stateResult.value : {};
            state.pr_url = 'https://github.com/org/repo/pull/1';
            await writeState(statePath, state);
            // Also write to the path the gate reads from
            await writeState(join(dir, '.pipeline/conduct-state.json'), state);
            return { success: true };
          }
          return satisfy(step);
        },
      };
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });

      await daemonConductor(runner).run();

      // One kickback, one fix build, convergence — no HALT.
      expect(kickbacks).toEqual([{ from: 'manual_test', to: 'build' }]);
      expect(ran.filter((s) => s === 'build')).toHaveLength(2);
      expect(halted).toBe(false);
      await expect(access(join(dir, '.pipeline/DONE'))).resolves.toBeUndefined();
      // #302-hazard guard: the kickback + re-entered build left task-status
      // intact and parseable (the loop converged rather than HALT-looping).
      const ts = JSON.parse(await readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'));
      expect(ts.tasks[0].status).toBe('completed');
      // Whitewash-guard marker was cleared on the legitimate pass.
      await expect(
        access(join(dir, '.pipeline/manual-test-fail-evidence.json')),
      ).rejects.toThrow();
    });

    it('FAIL → kickback → build commits nothing → PASS rewrite is refused (whitewash) and the run HALTs', async () => {
      await initRepo();
      await writeState(statePath, { ...FRONT_DONE, rebase: 'skipped' } as ConductState);

      let kicked = false;
      const runner: StepRunner = {
        run: async (step, _artifacts?: unknown, opts?: { retryReason?: string }) => {
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
            );
            if (opts?.retryReason) kicked = true; // "fixes" the bug without committing
            return { success: true };
          }
          if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              kicked ? PASS_RESULTS : FAIL_RESULTS, // whitewash: PASS with no commits
            );
            return { success: true };
          }
          return satisfy(step);
        },
      };
      const stepErrors: string[] = [];
      events.on('step_failed', (e) => {
        if (e.type === 'step_failed' && e.step === 'manual_test') stepErrors.push(e.error);
      });
      let halted = false;
      let haltReason = '';
      events.on('loop_halt', (e) => {
        halted = true;
        if (e.type === 'loop_halt') haltReason = e.reason;
      });
      let completed = false;
      events.on('feature_complete', () => {
        completed = true;
      });

      await daemonConductor(runner).run();

      // The guard refused the no-commit PASS rewrite and the run HALTed. As
      // of #367's whitewash-guard-marker fallback in readManualTestFailRows,
      // the group-join's manual_test FAIL detector sees the stale marker's
      // FAIL rows (the current attempt is a laundered PASS with zero fix
      // commits) and routes through the D2 no-op re-entry guard rather than
      // the raw predicate rejection — the HALT reason text changed, but the
      // outcome (HALT, never completes, evidence marker preserved) is the
      // same safety property this test asserts. stepErrors stays empty here
      // because the D2 path halts directly via loop_halt without emitting a
      // step_failed for manual_test.
      expect(halted).toBe(true);
      expect(completed).toBe(false);
      expect(haltReason).toMatch(/whitewash|no new commits|no head or resolved-count movement/i);
      // The FAIL evidence survives for the human who inspects the HALT.
      await expect(
        access(join(dir, '.pipeline/manual-test-fail-evidence.json')),
      ).resolves.toBeUndefined();
    });
  });

  // ── build_review judgement gate (jstoup111/ai-conductor#324) ─────────────
  // `build_review` does not exist yet (no StepName entry, no ALL_STEPS row, no
  // config resolver, no kickback wiring) — every test below pins observable
  // end-to-end behavior of the FUTURE gate-loop seam between `build` and
  // `manual_test`. Pre-implementation, `build_review` is never dispatched and
  // never appears in state, so these fail on their behavioral assertions
  // (RED), not on setup — exactly like the `rebase` step's pre-implementation
  // specs in rebase-loop.test.ts.
  //
  // TS-1 (registry/topology ordering) is intentionally NOT duplicated here —
  // it's unit-covered by `test/engine/selector.test.ts`, which drives
  // `selectNextGate`/`gateSatisfied` directly against `ALL_STEPS` + verdicts
  // without needing a full Conductor run (Task 3 of the plan owns it there).

  describe('build_review flag topology (TS-2)', () => {
    it('flag off: build_review is skipped, manual_test follows build directly, zero grader dispatches', async () => {
      await writeState(statePath, { ...FRONT_DONE });
      const ran: string[] = [];
      const runner: StepRunner = {
        run: async (step) => {
          ran.push(step);
          return satisfy(step);
        },
      };

      // build_review is default-on (#773 Task 4) — "flag off" now requires
      // an explicit opt-out rather than relying on the (former) default.
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        fromStep: 'build',
        maxRetries: 1,
        config: { build_review: { enabled: false } },
      } as never);

      await conductor.run();

      expect(ran.filter((s) => s === 'build_review')).toHaveLength(0);
      const finalState = JSON.parse(await readFile(statePath, 'utf-8'));
      // Task 5: the flag-off resolver must mark the step `skipped` (with a
      // skip event) at startup — today `build_review` is not a registry
      // member at all, so this key is absent (undefined), not 'skipped'.
      expect(finalState.build_review).toBe('skipped');
    });

    it('flag off: a stale build-review.json from a previous enabled run is ignored', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/build-review.json'),
        JSON.stringify({ verdict: 'FAIL', reasons: ['stale from a prior run'] }),
      );
      await writeState(statePath, { ...FRONT_DONE });
      const runner: StepRunner = {
        run: async (step) => satisfy(step),
      };

      // build_review is default-on (#773 Task 4) — "flag off" now requires
      // an explicit opt-out rather than relying on the (former) default.
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        fromStep: 'build',
        maxRetries: 1,
        config: { build_review: { enabled: false } },
      } as never);

      await conductor.run();

      const finalState = JSON.parse(await readFile(statePath, 'utf-8'));
      expect(finalState.build_review).toBe('skipped');
      await expect(access(join(dir, '.pipeline/DONE'))).resolves.toBeUndefined();
    });

    it('flag on: build_review is dispatched between build and manual_test', async () => {
      await writeState(statePath, { ...FRONT_DONE });
      // Not inlined as a literal in the ConductorOptions call (which would
      // trip an excess-property compile error against today's HarnessConfig)
      // — assigned to a variable first, matching the existing custom-step
      // config test's convention in this file.
      const config = { build_review: { enabled: true } };
      const ran: string[] = [];
      const runner: StepRunner = {
        run: async (step) => {
          ran.push(step);
          return satisfy(step);
        },
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        fromStep: 'build',
        maxRetries: 1,
        config,
      });

      await conductor.run();

      const buildIdx = ran.indexOf('build');
      const reviewIdx = ran.indexOf('build_review');
      const manualIdx = ran.indexOf('manual_test');
      expect(reviewIdx).toBeGreaterThan(-1); // build_review must dispatch at all
      expect(reviewIdx).toBeGreaterThan(buildIdx);
      expect(manualIdx).toBeGreaterThan(reviewIdx);
    });
  });

  describe('build_review FAIL kickback end-to-end (TS-5)', () => {
    // Drives the real gate-loop call site: the fake runner stands in for the
    // grader, writing `.pipeline/build-review.json` exactly as the real
    // one-shot grader session will (Task 9-12), when the loop actually
    // dispatches `build_review`. The kickback machinery (counter, retry
    // hints, navigateBack, stale cascade — Task 13) is what's under test.
    function reviewFailConfig() {
      return { build_review: { enabled: true } };
    }

    async function runWithGraderVerdicts(
      verdicts: Array<{ verdict: 'FAIL' | 'PASS'; reasons: string[] }>,
    ): Promise<{
      buildRuns: number;
      retryReasons: string[];
      kicks: Array<{ from: string; to: string }>;
      completed: boolean;
      ran: string[];
    }> {
      await writeState(statePath, { ...FRONT_DONE });
      let buildRuns = 0;
      let reviewRuns = 0;
      const retryReasons: string[] = [];
      const ran: string[] = [];
      const runner: StepRunner = {
        run: async (step, _artifacts?: unknown, opts?: { retryReason?: string }) => {
          ran.push(step);
          if (step === 'build') {
            buildRuns++;
            if (opts?.retryReason) retryReasons.push(opts.retryReason);
            return satisfy('build');
          }
          if (step === 'build_review') {
            const v = verdicts[Math.min(reviewRuns, verdicts.length - 1)];
            reviewRuns++;
            await writeFile(
              join(dir, '.pipeline/build-review.json'),
              JSON.stringify({
                verdict: v.verdict,
                reasons: v.reasons,
                rubric: { tautology: false, scope: false, rootCause: false },
              }),
            );
            return { success: true };
          }
          if (step === 'finish') {
            // Daemon mode only converges finish on choice='pr' (see
            // artifacts.ts finish predicate) — record that plus the pr_url
            // it requires so the tail can actually reach feature_complete.
            await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
            const state = JSON.parse(await readFile(statePath, 'utf-8'));
            state.pr_url = 'https://example.com/pr/1';
            await writeFile(statePath, JSON.stringify(state));
            // The finish predicate reads pr_url from .pipeline/conduct-state.json
            // specifically (not the top-level state file the conductor itself
            // uses in this test fixture) — mirror it there too.
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify(state));
            return { success: true };
          }
          return satisfy(step);
        },
      };
      const kicks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
      });
      let completed = false;
      events.on('feature_complete', () => {
        completed = true;
      });
      // The finish predicate's daemon false-ship guard needs push evidence
      // (isHeadPushed → headPushedToUpstream(this.git, ...)); a fake git
      // runner that reports HEAD as pushed lets these fixtures (which never
      // touch a real remote) converge on the recorded pr_url.
      const fakeGit: GitRunner = async (args) =>
        args.includes('--symbolic-full-name')
          ? { stdout: 'refs/remotes/origin/feature/x\n' }
          : { stdout: '' };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        daemon: true,
        fromStep: 'build',
        maxRetries: 1,
        config: reviewFailConfig(),
        git: fakeGit,
      });
      await conductor.run();
      return { buildRuns, retryReasons, kicks, completed, ran };
    }

    it('FAIL-tautological kicks back to build with the grader evidence, then PASS converges', async () => {
      const result = await runWithGraderVerdicts([
        { verdict: 'FAIL', reasons: ['tautological test padding, no real assertion'] },
        { verdict: 'PASS', reasons: [] },
      ]);

      expect(result.kicks).toContainEqual({ from: 'build_review', to: 'build' });
      expect(result.buildRuns).toBe(2); // initial + one kickback rebuild
      expect(result.retryReasons.join('\n')).toContain('tautological test padding');
      expect(result.completed).toBe(true);
    });

    it('FAIL-scope kicks back with a distinct evidence string end-to-end', async () => {
      const result = await runWithGraderVerdicts([
        { verdict: 'FAIL', reasons: ['change exceeds the approved plan scope'] },
        { verdict: 'PASS', reasons: [] },
      ]);

      expect(result.kicks).toContainEqual({ from: 'build_review', to: 'build' });
      expect(result.retryReasons.join('\n')).toContain('exceeds the approved plan scope');
      expect(result.completed).toBe(true);
    });

    it('an empty reasons[] on FAIL still writes placeholder kickback evidence (never a silent kickback)', async () => {
      const result = await runWithGraderVerdicts([
        { verdict: 'FAIL', reasons: [] },
        { verdict: 'PASS', reasons: [] },
      ]);

      expect(result.kicks).toContainEqual({ from: 'build_review', to: 'build' });
      expect(result.retryReasons.join('\n')).toMatch(
        /grader returned FAIL without reasons/,
      );
    });
  });

  describe('build_review retry cap HALTs (TS-6)', () => {
    it('exactly MAX_KICKBACKS_PER_GATE (2) kickbacks then LOOP_HALT_MARKER + loop_halt, no further dispatch', async () => {
      await writeState(statePath, { ...FRONT_DONE });
      let buildRuns = 0;
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build') {
            buildRuns++;
            return satisfy('build');
          }
          if (step === 'build_review') {
            await writeFile(
              join(dir, '.pipeline/build-review.json'),
              JSON.stringify({
                verdict: 'FAIL',
                reasons: [`always fails (attempt ${buildRuns})`],
                rubric: { tautology: true, scope: false, rootCause: false },
              }),
            );
            return { success: true };
          }
          return satisfy(step);
        },
      };
      const kicks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      let completed = false;
      events.on('feature_complete', () => {
        completed = true;
      });
      const config = { build_review: { enabled: true }, kickback_escalation: { enabled: false } };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        daemon: true,
        fromStep: 'build',
        maxRetries: 1,
        config,
      });

      await conductor.run();

      expect(kicks.filter((k) => k.from === 'build_review')).toHaveLength(2);
      expect(halted).toBe(true);
      expect(completed).toBe(false);
      expect(buildRuns).toBe(3); // initial + 2 kickback rebuilds, capped there
      await expect(access(join(dir, '.pipeline/HALT'))).resolves.toBeUndefined();
      const haltContents = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      // The HALT marker must carry the grader's evidence, not a generic message,
      // so the surfaced blocker tells the human what the grader actually flagged.
      expect(haltContents).toContain('always fails');
    });

    it('the build_review counter is independent of manualTestSelfHeals', async () => {
      await writeState(statePath, { ...FRONT_DONE, rebase: 'skipped' } as ConductState);
      let buildRuns = 0;
      let manualTestRuns = 0;
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build') {
            buildRuns++;
            return satisfy('build');
          }
          if (step === 'build_review') {
            // Fails exactly once (counter → 1), then passes for good.
            const verdict = buildRuns <= 1 ? 'FAIL' : 'PASS';
            await writeFile(
              join(dir, '.pipeline/build-review.json'),
              JSON.stringify({
                verdict,
                reasons: verdict === 'FAIL' ? ['one-time grader nit'] : [],
                rubric: { tautology: false, scope: false, rootCause: false },
              }),
            );
            return { success: true };
          }
          if (step === 'manual_test') {
            manualTestRuns++;
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              manualTestRuns === 1
                ? '| Story | Result |\n|---|---|\n| s1 | FAIL |\n'
                : '| Story | Result |\n|---|---|\n| s1 | PASS |\n',
            );
            return { success: true };
          }
          if (step === 'finish') {
            // Daemon mode only converges finish on choice='pr' with push
            // evidence (see artifacts.ts finish predicate + fakeGit below).
            await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
            const st = JSON.parse(await readFile(statePath, 'utf-8'));
            st.pr_url = 'https://example.com/pr/1';
            await writeFile(statePath, JSON.stringify(st));
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify(st));
            return { success: true };
          }
          return satisfy(step);
        },
      };
      const kicks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      const config = { build_review: { enabled: true } };
      const fakeGit: GitRunner = async (args) =>
        args.includes('--symbolic-full-name')
          ? { stdout: 'refs/remotes/origin/feature/x\n' }
          : { stdout: '' };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        daemon: true,
        fromStep: 'build',
        maxRetries: 1,
        config,
        git: fakeGit,
      });

      await conductor.run();

      // One build_review-origin kickback and, independently, one
      // manual_test-origin kickback — neither cap trips the other's HALT.
      expect(kicks.filter((k) => k.from === 'build_review')).toHaveLength(1);
      expect(kicks.filter((k) => k.from === 'manual_test')).toHaveLength(1);
      expect(halted).toBe(false);
    });

    it('a simulated conductor restart mid-cycle does not unbound the loop (Task 17)', async () => {
      // kickbackCounts (line ~998) and stuckGate are local Maps created fresh
      // inside Conductor#run — there is no persistence layer for them. A real
      // process restart (new Conductor instance from the same on-disk state)
      // therefore starts both counters back at zero. This test pins that
      // behavior: it drives one Conductor instance ("session A") to its
      // MAX_KICKBACKS_PER_GATE HALT, then simulates an operator restart by
      // clearing the HALT marker and constructing a brand-new Conductor
      // ("session B") against the same state/dir with a runner that keeps
      // failing build_review forever. Because the backstop is re-armed per
      // session (not cumulative across restarts), session B independently
      // HALTs again after exactly MAX_KICKBACKS_PER_GATE more kickbacks — the
      // combined run across both sessions never exceeds a small, bounded
      // number of dispatches, i.e. no unbounded loop survives a restart.
      await writeState(statePath, { ...FRONT_DONE });
      let buildRuns = 0;
      const alwaysFailReviewRunner: StepRunner = {
        run: async (step) => {
          if (step === 'build') {
            buildRuns++;
            return satisfy('build');
          }
          if (step === 'build_review') {
            await writeFile(
              join(dir, '.pipeline/build-review.json'),
              JSON.stringify({
                verdict: 'FAIL',
                reasons: [`always fails (attempt ${buildRuns})`],
                rubric: { tautology: true, scope: false, rootCause: false },
              }),
            );
            return { success: true };
          }
          return satisfy(step);
        },
      };
      const config = { build_review: { enabled: true }, kickback_escalation: { enabled: false } };

      const kicksA: Array<{ from: string; to: string }> = [];
      const eventsA = new ConductorEventEmitter();
      eventsA.on('kickback', (e) => {
        if (e.type === 'kickback') kicksA.push({ from: e.from, to: e.to });
      });
      let haltedA = false;
      eventsA.on('loop_halt', () => {
        haltedA = true;
      });
      const conductorA = new Conductor({
        stateFilePath: statePath,
        stepRunner: alwaysFailReviewRunner,
        events: eventsA,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        daemon: true,
        fromStep: 'build',
        maxRetries: 1,
        config,
      });
      await conductorA.run();

      expect(kicksA.filter((k) => k.from === 'build_review')).toHaveLength(2);
      expect(haltedA).toBe(true);
      await expect(access(join(dir, '.pipeline/HALT'))).resolves.toBeUndefined();

      // Simulate the restart: clear the HALT marker (an operator re-queuing
      // the feature would do this) and stand up a *new* Conductor instance —
      // a fresh process would allocate fresh kickbackCounts/stuckGate Maps,
      // which this new instance mirrors exactly.
      await rm(join(dir, '.pipeline/HALT'), { force: true });

      const kicksB: Array<{ from: string; to: string }> = [];
      const eventsB = new ConductorEventEmitter();
      eventsB.on('kickback', (e) => {
        if (e.type === 'kickback') kicksB.push({ from: e.from, to: e.to });
      });
      let haltedB = false;
      eventsB.on('loop_halt', () => {
        haltedB = true;
      });
      const conductorB = new Conductor({
        stateFilePath: statePath,
        stepRunner: alwaysFailReviewRunner,
        events: eventsB,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        daemon: true,
        fromStep: 'build',
        maxRetries: 1,
        config,
      });
      await conductorB.run();

      // Session B's counters started over at zero (no persistence survived
      // the restart) yet still HALT after its own MAX_KICKBACKS_PER_GATE cap
      // — proving the backstop, not accumulated history, is what terminates
      // the loop, so no restart can produce an unbounded kickback loop.
      expect(kicksB.filter((k) => k.from === 'build_review')).toHaveLength(2);
      expect(haltedB).toBe(true);
      await expect(access(join(dir, '.pipeline/HALT'))).resolves.toBeUndefined();
    });
  });

  // ── Task completion survives build_review kickback (Task 15) ────────────
  // task-status.json is engine-internal cache (Task 1 ADR, #384) — real
  // completion is derived from git evidence (Task: <id> trailers), not
  // trusted from the JSON rows. This drives a real repo through a
  // build_review FAIL kickback where the fake build agent wipes
  // .pipeline/task-status.json entirely between the initial build and the
  // re-grade, proving the build gate still recognizes the already-completed
  // task (via the engine-only evidence sidecar, H6/H7) and that the re-grade
  // diff still contains both the original completion commit and the fix
  // commit landed during the kickback.
  describe('task completion survives build_review kickback + task-status.json wipe (Task 15)', () => {
    const execFileP = promisify(execFile);

    async function git(...args: string[]): Promise<void> {
      await execFileP(
        'git',
        ['-c', 'user.email=t@test', '-c', 'user.name=t', ...args],
        { cwd: dir },
      );
    }

    async function initRepo(): Promise<void> {
      await git('init', '-q', '-b', 'main');
      await git('commit', '--allow-empty', '-q', '-m', 'init');
    }

    async function gitLog(): Promise<string> {
      const { stdout } = await execFileP('git', ['log', '--format=%B'], { cwd: dir });
      return stdout;
    }

    it('derives completed tasks from git log after task-status.json is wiped mid-kickback, and the re-grade diff keeps the fix commit', async () => {
      await initRepo();
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      // A single task, no path list — a bare `Task: t1` trailer is enough
      // for deriveCompletion / the evidence-sidecar stamp to resolve it.
      await writeFile(join(dir, '.docs/plans/p.md'), '### Task t1\n**Story:** 1-1 (happy path)\n');
      await writeState(statePath, { ...FRONT_DONE, rebase: 'skipped' } as ConductState);

      const config = { build_review: { enabled: true } };
      let buildRuns = 0;
      let reviewRuns = 0;
      const runner: StepRunner = {
        run: async (step, _artifacts?: unknown, opts?: { retryReason?: string }) => {
          if (step === 'build') {
            buildRuns++;
            // Real commit carrying the `Task: <id>` trailer — this is the
            // completion evidence a real build agent would leave behind.
            const msg = opts?.retryReason
              ? 'fix: address build_review feedback\n\nTask: t1'
              : 'feat: implement task t1\n\nTask: t1';
            await writeFile(join(dir, `src-${buildRuns}.txt`), `work ${buildRuns}`);
            await git('add', '.');
            await git('commit', '-q', '-m', msg);
            // Mirrors the existing `satisfy('build')` helper: stamp the
            // engine-only evidence sidecar directly (execa is mocked
            // module-wide in this file, so the real git-log-parsing path
            // inside deriveCompletion can't run here) and write the
            // task-status.json cache the same way a real run would.
            const evidence = await createTaskEvidence(dir);
            evidence.evidenceStamps.set('t1', { sha: '0'.repeat(40), form: 'test-stub' });
            await evidence.write();
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
            );
            return { success: true };
          }
          if (step === 'build_review') {
            reviewRuns++;
            if (reviewRuns === 1) {
              // The fake build/review agent wipes task-status.json
              // completely — simulating total loss of the on-disk cache
              // between the initial build and the kickback re-grade.
              await rm(join(dir, '.pipeline/task-status.json'), { force: true });
              await writeFile(
                join(dir, '.pipeline/build-review.json'),
                JSON.stringify({
                  verdict: 'FAIL',
                  reasons: ['tighten the assertion, it currently tautologizes'],
                  rubric: { tautology: true, scope: false, rootCause: false },
                }),
              );
              return { success: true };
            }
            await writeFile(
              join(dir, '.pipeline/build-review.json'),
              JSON.stringify({
                verdict: 'PASS',
                rubric: { tautology: false, scope: false, rootCause: false },
              }),
            );
            return { success: true };
          }
          if (step === 'finish') {
            // Daemon mode only converges finish on choice='pr' with push
            // evidence (see artifacts.ts finish predicate + fakeGit below).
            await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
            const stateResult = await readState(statePath);
            const state = stateResult.ok ? stateResult.value : {};
            state.pr_url = 'https://example.com/pr/1';
            await writeState(statePath, state);
            await writeState(join(dir, '.pipeline/conduct-state.json'), state);
            return { success: true };
          }
          return satisfy(step);
        },
      };

      const kicks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
      });
      let completed = false;
      events.on('feature_complete', () => {
        completed = true;
      });
      const fakeGit: GitRunner = async (args) =>
        args.includes('--symbolic-full-name')
          ? { stdout: 'refs/remotes/origin/feature/x\n' }
          : { stdout: '' };

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        daemon: true,
        fromStep: 'build',
        maxRetries: 1,
        config,
        git: fakeGit,
      });
      await conductor.run();

      // The kickback fired and the loop still converged despite the wipe —
      // the build gate never treated the missing task-status.json as a
      // reason to re-do already-completed work or to HALT.
      expect(kicks).toContainEqual({ from: 'build_review', to: 'build' });
      expect(buildRuns).toBe(2);
      expect(completed).toBe(true);
      await expect(access(join(dir, '.pipeline/DONE'))).resolves.toBeUndefined();

      // The re-grade diff (git log) still contains BOTH the original
      // completion commit and the fix commit landed during the kickback —
      // nothing about the wipe rewrote or dropped history.
      const log = await gitLog();
      expect(log).toContain('feat: implement task t1');
      expect(log).toContain('fix: address build_review feedback');
      expect((log.match(/Task: t1/g) || []).length).toBe(2);
    });
  });
});

// ── Task 12: gate and post-rebase pre-verify share one verdict basis ────────
//
// `checkStepCompletion(dir, 'build', ctx)` is the SAME function both the
// build gate (during normal step evaluation) and the daemon's post-rebase
// preVerify closure (conductor.ts's `runRebaseStep`, line ~3213) call — no
// reimplementation, no parallel logic to drift. This suite exercises that
// function directly against a REAL git repository so the merge-base-scoped
// evidence range (deriveCompletion / #456, #463) is genuinely exercised,
// rather than the hermetic sidecar-stamping used by the rest of this file.
//
// gate-loop.test.ts mocks the `execa` module at file scope (see the
// `vi.mock('execa', …)` at the top) so the rest of the tail stays hermetic.
// That mock would also swallow the real git-trailer scan this suite needs,
// so each test here unmocks `execa` and resets the module registry before
// dynamically importing `checkStepCompletion`, then restores the mock
// afterward so it doesn't leak into any other test in this file.
describe('build gate and post-rebase pre-verify share one verdict basis (Task 12)', () => {
  const execFileP = promisify(execFile);
  let repoDir: string;

  async function git(...args: string[]): Promise<{ stdout: string }> {
    const { stdout } = await execFileP(
      'git',
      ['-c', 'user.email=t@test', '-c', 'user.name=t', ...args],
      { cwd: repoDir },
    );
    return { stdout };
  }

  async function headSha(): Promise<string> {
    return (await git('rev-parse', 'HEAD')).stdout.trim();
  }

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'gate-preverify-'));
    await git('init', '-q', '-b', 'main');
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
    // Restore the file-scoped execa mock and drop the fresh (unmocked)
    // module instances so later tests in this file get the hermetic mock
    // back, unpolluted by this suite's real-execa import.
    vi.doMock('execa', () => ({ execa: vi.fn() }));
    vi.resetModules();
  });

  it('all tasks commit-evidenced → build gate passes → file-changing rebase → pre-verify(build) still passes (no kickback)', async () => {
    vi.doUnmock('execa');
    vi.resetModules();
    const { checkStepCompletion } = await import('../../src/engine/artifacts.js');

    const planPath = join(repoDir, '.docs/plans/p.md');
    await writeFile(
      planPath,
      [
        '# Implementation Plan',
        '',
        '### Task 1: add foo',
        '**Files:**',
        '- src/foo.ts',
        '',
        '### Task 2: add bar',
        '**Files:**',
        '- src/bar.ts',
        '',
      ].join('\n'),
    );

    // Establish the default-branch anchor BEFORE any feature work — this is
    // the merge-base the evidence range is scoped against.
    await writeFile(join(repoDir, 'README.md'), 'init');
    await git('add', '.');
    await git('commit', '-q', '-m', 'chore: init');
    const mergeBaseBefore = await headSha();
    // A local ref standing in for the origin default branch (no real remote
    // needed — resolveOriginRef probes origin/main directly).
    await git('update-ref', 'refs/remotes/origin/main', mergeBaseBefore);

    // Feature-branch commits: real `Task: N` trailers touching the plan's
    // declared paths — the evidence the build gate is supposed to accept.
    await mkdir(join(repoDir, 'src'), { recursive: true });
    await writeFile(join(repoDir, 'src/foo.ts'), 'export const foo = 1;\n');
    await git('add', '.');
    await git('commit', '-q', '-m', 'feat: implement task 1\n\nTask: 1');

    await writeFile(join(repoDir, 'src/bar.ts'), 'export const bar = 1;\n');
    await git('add', '.');
    await git('commit', '-q', '-m', 'feat: implement task 2\n\nTask: 2');
    const featureHead = await headSha();

    const ctx = { projectRoot: repoDir, planPath };

    // (a) Build gate: all tasks commit-evidenced within «merge-base»..HEAD.
    const gateVerdict = await checkStepCompletion(repoDir, 'build', ctx);
    expect(gateVerdict.done).toBe(true);

    // File-changing rebase: the default branch advances with unrelated
    // upstream work, and the feature branch is rebased onto it — a genuinely
    // new merge-base, with the feature's own evidence commits replayed
    // (new SHAs) on top. deriveCompletion must still resolve them from the
    // replayed commits' trailers, not the (now-gone) original SHAs.
    await git('checkout', '-q', '-b', 'feature', featureHead);
    await git('checkout', '-q', '-b', 'origin-main', mergeBaseBefore);
    await writeFile(join(repoDir, 'UPSTREAM.md'), 'unrelated upstream change\n');
    await git('add', '.');
    await git('commit', '-q', '-m', 'chore: unrelated upstream commit');
    const newUpstreamHead = await headSha();
    await git('update-ref', 'refs/remotes/origin/main', newUpstreamHead);

    await git('checkout', '-q', 'feature');
    await execFileP(
      'git',
      ['-c', 'user.email=t@test', '-c', 'user.name=t', 'rebase', 'origin-main'],
      { cwd: repoDir },
    );

    // (b) Post-rebase pre-verify: the SAME checkStepCompletion('build', ctx)
    // call the daemon's preVerify closure makes — must still pass. This is
    // the load-bearing assertion: gate and pre-verify are one code path, so
    // there is no logic to drift between them.
    const preVerifyVerdict = await checkStepCompletion(repoDir, 'build', ctx);
    expect(preVerifyVerdict.done).toBe(true);
  });

  it('upstream commits carrying coincidental Task: N trailers with overlapping paths are outside «merge-base»..HEAD and are never accepted as evidence', async () => {
    vi.doUnmock('execa');
    vi.resetModules();
    const { checkStepCompletion } = await import('../../src/engine/artifacts.js');

    const planPath = join(repoDir, '.docs/plans/p.md');
    await writeFile(
      planPath,
      ['# Implementation Plan', '', '### Task 1: add foo', '**Files:**', '- src/foo.ts', ''].join(
        '\n',
      ),
    );

    await writeFile(join(repoDir, 'README.md'), 'init');
    await git('add', '.');
    await git('commit', '-q', '-m', 'chore: init');

    // The default branch's own history carries a commit that coincidentally
    // matches the feature's `Task: 1` trailer AND touches an overlapping
    // path — but it predates the feature branch's divergence, so it must
    // never satisfy the feature's Task 1.
    await mkdir(join(repoDir, 'src'), { recursive: true });
    await writeFile(join(repoDir, 'src/foo.ts'), 'export const foo = 0; // upstream\n');
    await git('add', '.');
    await git('commit', '-q', '-m', 'chore: unrelated upstream churn\n\nTask: 1');
    const mergeBase = await headSha();
    await git('update-ref', 'refs/remotes/origin/main', mergeBase);

    // The feature branch itself never lands its own Task: 1 evidence.
    await writeFile(join(repoDir, 'src/other.ts'), 'export const other = 1;\n');
    await git('add', '.');
    await git('commit', '-q', '-m', 'feat: unrelated feature work (no Task trailer)');

    const ctx = { projectRoot: repoDir, planPath };
    const verdict = await checkStepCompletion(repoDir, 'build', ctx);

    // The upstream commit is outside «merge-base»..HEAD (it IS the merge
    // base), so it can never be accepted as this branch's Task 1 evidence —
    // the gate must report the task unresolved rather than pass.
    expect(verdict.done).toBe(false);
    expect(verdict.reason).toMatch(/pending|not completed/i);
  });
});
