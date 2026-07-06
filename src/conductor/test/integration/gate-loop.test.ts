import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';

// Drives the gate-driven tail (build…finish) with verifyArtifacts on. The front
// half is pre-marked done and the loop is started at `build` (fromStep), so each
// test exercises the selector-driven tail directly. Small (S) tier so the tail
// is build → manual_test → (retro tier-skipped) → finish.

const FRONT_DONE: ConductState = {
  complexity_tier: 'S',
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
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
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
    expect(ran).not.toContain('retro'); // tier-skipped for Small
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
      complexity_tier: 'S', // retro tier-skipped → tail is build, manual_test, finish
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

    // build, manual_test, finish ran (retro tier-skipped) → one reset each.
    expect(resetSession).toHaveBeenCalledTimes(3);
  });
});
