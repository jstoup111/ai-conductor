import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

vi.mock('execa', () => ({ execa: vi.fn(async () => ({ stdout: '' })) }));

import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState, readState } from '../../src/engine/state.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { Conductor } from '../test-conductor.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { parsePlanTaskPaths } from '../../src/engine/plan-task-parse.js';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';
import { currentCommitSha } from '../../src/engine/project-prelude.js';
import {
  HALT_MARKER,
  HALT_CLASS_MARKER,
  readHaltClass,
} from '../../src/engine/halt-marker.js';
import {
  readKickbackLedger,
  writeKickbackLedger,
  MAX_KICKBACKS_PER_GATE,
} from '../../src/engine/kickback-ledger.js';
import {
  rekickSweep,
  clearMarker,
  HALT_CLEARED_MARKER,
  REKICK_SENTINEL,
  type RekickSweepDeps,
} from '../../src/engine/daemon-rekick.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for `.docs/stories/daemon-mode-kickbacks-route-human-
// judgment-gaps-in.md` (#551, ADR `adr-2026-07-27-daemon-decide-kickback-halt`,
// plan `.docs/plans/daemon-mode-kickbacks-route-human-judgment-gaps-in.md`).
//
// SCOPE (writing-system-tests §3a/§3b/§3d). Every case below drives the REAL
// production entry point — `Conductor.run()` with a fake `StepRunner` over a
// tmp project root — across 2+ dispatches, because the defect class this
// feature closes lives in the WIRING between `scanKickbackVerdicts`, the halt
// emit pair, and the HALT-class sidecar the daemon's re-kick sweep reads. A
// unit test of `decideEntryDisposition` in isolation can pass while the loop
// still calls `navigateBack` — exactly the shared-policy wiring failure §3b
// names. The two enforcement call sites of that policy are therefore driven
// separately here (§3d — every call site, real input):
//
//   • tail scan        — conductor.ts:6795 (`advanceTail`, `navigate: true`)
//   • front-half scan  — conductor.ts:6731 (`navigate: false`)
//
// DELIBERATELY NOT HERE (single-unit or already-covered, per §2/§3a):
//   • The pure `decideEntryDisposition` table over ALL_STEPS (S2 Done-When),
//     unknown-target/empty-table fail-closed and `daemon: false` interactive
//     entry — single-function policy behavior; belongs to
//     `test/engine/decide-entry-policy.test.ts`, written under plan Tasks 1-2.
//   • `rekickSweep`'s needs-human skip in the abstract — already asserted with
//     injected deps at `test/engine/daemon-rekick.test.ts:157` and `:176`. What
//     is NOT covered there, and IS covered here, is the composition: the class
//     sidecar this feature's halt actually writes to disk, fed to the sweep
//     through the REAL `readHaltClass`/`clearMarker`.
//   • Interactive `plan` re-open (S3 happy) — `test/integration/gate-loop.
//     test.ts:224`; interactive front-half amendment (S3 negative 1) — `:570`;
//     interactive cap HALT (S4 negative) — `:1599`; BUILD-phase deterministic
//     kickback under `daemon: true` (S2 happy) — `:981` (manual_test→build) and
//     `:1379` (build_review→build). Those files must pass UNMODIFIED (S3
//     Done-When); one non-duplicative over-broadness fence is added here
//     because none of them assert the absence of the NEW `HALT.class` artifact.
//   • S6 (`planRemediation` refactor, behavior-preserving) — proved by
//     `test/engine/conductor-remediation-noop-guard.test.ts` and
//     `test/acceptance/kickback-build-noop-escalation.acceptance.test.ts`
//     passing unmodified.
//   • S7 (docs + changelog) — prose artifacts; enforced by
//     `test/test_harness_integrity.sh` and the maintain-documentation step,
//     not by an acceptance flow.
//
// Pre-implementation every DECIDE-guard case below is RED because
// `scanKickbackVerdicts` has no reference to `this.daemon` and no reference to
// phase: it calls `navigateBack` and the DECIDE step is re-dispatched. The
// failures are missing-behavior failures (no HALT written, DECIDE step ran),
// not import or collection errors.
// ─────────────────────────────────────────────────────────────────────────────

const execFileP = promisify(execFile);

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
  coherence_check: 'done',
  architecture_diagram: 'skipped',
  architecture_review: 'skipped',
  acceptance_specs: 'skipped',
};

const KICKBACK_EVIDENCE =
  'architectural gap: the approved plan has no task for the retry-budget seam';

const validShipmentEvidence = async () => ({
  kind: 'valid' as const,
  slug: 'test-feature',
  pr: 'https://example.com/pr/1',
  recordPath: '.docs/shipped/test-feature.md',
  hash: 'verified',
  commit: 'verified',
});

const fakeGit: GitRunner = async (args) =>
  args.includes('--symbolic-full-name')
    ? { stdout: 'refs/remotes/origin/feature/x\n' }
    : { stdout: '' };

describe('acceptance: daemon-mode DECIDE kickbacks HALT instead of re-running (#551)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'decide-kickback-halt-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Per-step artifact creation so each gate's objective verdict passes —
  // same convention as `test/integration/gate-loop.test.ts`'s `satisfy`.
  async function satisfy(step: string): Promise<StepRunResult> {
    if (step === 'build') {
      let taskIds: string[] = ['t1'];
      try {
        const planText = await readFile(join(dir, '.docs/plans/p.md'), 'utf-8');
        const planned = Array.from(parsePlanTaskPaths(planText).keys());
        if (planned.length > 0) taskIds = planned;
      } catch {
        // No plan seeded — keep the placeholder id.
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
      await writeFile(
        join(dir, '.pipeline/build-review.json'),
        JSON.stringify({
          verdict: 'PASS',
          rubric: { tautology: false, scope: false, rootCause: false, completeness: false, wiring: false },
        }),
      );
    } else if (step === 'manual_test') {
      await writeFile(
        join(dir, '.pipeline/manual-test-results.md'),
        '| Story | Result |\n|---|---|\n| foo | PASS |\n',
      );
    } else if (step === 'prd_audit') {
      await writeFile(
        join(dir, '.pipeline/prd-audit.md'),
        '| FR | Verdict | Evidence |\n|---|---|---|\n| FR-1 | ALIGNED | foo.ts:1 |\n',
      );
    } else if (step === 'architecture_review_as_built') {
      await writeFile(
        join(dir, '.pipeline/architecture-review-as-built.md'),
        '# As-Built Review\n\nVerdict: APPROVED\n',
      );
    } else if (step === 'finish') {
      // Daemon-shaped finish (the mode every case below runs in): record the
      // PR choice AND the pr_url the ship gate reads, so a run that is NOT
      // refused by the guard genuinely converges. Without this the tail dies
      // at `finish` with "retries exhausted" and every negative-path case
      // would HALT for a reason that has nothing to do with this feature.
      await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
      const res = await readState(statePath);
      const state = res.ok ? res.value : ({} as ConductState);
      state.pr_url = 'https://github.com/org/repo/pull/1';
      await writeState(statePath, state);
      await writeState(join(dir, '.pipeline/conduct-state.json'), state);
    } else if (step === 'coherence_check') {
      await mkdir(join(dir, '.docs/coherence'), { recursive: true });
      await writeFile(join(dir, '.docs/coherence/p.md'), '| Row |\n|---|\n| x |\n');
    }
    return { success: true };
  }

  // Real stories + a covering plan, so the `plan` gate's own predicate can
  // recompute if the run ever DOES reach it — a re-dispatch must be refused
  // by the guard, never merely by an unsatisfiable artifact.
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

  function conductorAtBuild(
    runner: StepRunner,
    opts: { daemon: boolean; disablePrdAudit?: boolean },
  ): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      mode: 'auto',
      daemon: opts.daemon,
      fromStep: 'build',
      maxRetries: 1,
      git: fakeGit,
      shipmentEvidence: validShipmentEvidence,
      config: opts.disablePrdAudit ? { steps: { prd_audit: { disable: true } } } : undefined,
    });
  }

  /**
   * A build that re-opens `plan` (a DECIDE-phase kickbackTarget) exactly once
   * on its first pass — the shape `test/integration/gate-loop.test.ts:224`
   * proves re-opens the gate interactively.
   */
  function buildKicksBackToPlan(
    ran: StepName[],
    kickFrom: StepName = 'build',
  ): StepRunner {
    let buildRuns = 0;
    return {
      run: async (step: StepName) => {
        ran.push(step);
        if (step === 'build') {
          buildRuns++;
          await satisfy('build');
          if (buildRuns === 1) {
            await writeVerdict(dir, 'plan', {
              satisfied: false,
              checkedAt: 1,
              kickback: { from: kickFrom, evidence: KICKBACK_EVIDENCE },
            });
          }
          return { success: true };
        }
        return satisfy(step);
      },
    };
  }

  async function readHaltBody(): Promise<string | null> {
    try {
      return await readFile(join(dir, HALT_MARKER), 'utf-8');
    } catch {
      return null;
    }
  }

  async function exists(rel: string): Promise<boolean> {
    return access(join(dir, rel)).then(() => true).catch(() => false);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // S1 — A daemon-mode kickback aimed at a DECIDE step HALTs instead of
  //      re-opening it.
  // ───────────────────────────────────────────────────────────────────────────
  describe('S1: the tail scan refuses an autonomous DECIDE re-open', () => {
    it('HALTs the run and never dispatches the DECIDE step (happy path 1)', async () => {
      await seedStoriesAndPlan();
      await writeState(statePath, { ...FRONT_DONE });

      const ran: StepName[] = [];
      let halted = false;
      let completed = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      events.on('feature_complete', () => {
        completed = true;
      });

      await conductorAtBuild(buildKicksBackToPlan(ran), { daemon: true }).run();

      expect(halted).toBe(true);
      expect(completed).toBe(false);
      // The refusal is what stops the run — `plan` is never re-authored.
      expect(ran).not.toContain('plan');
      expect(await exists(HALT_MARKER)).toBe(true);
    });

    it('the HALT marker uses the canonical DECIDE refusal and carries the target and verdict evidence (happy path 2)', async () => {
      await seedStoriesAndPlan();
      await writeState(statePath, { ...FRONT_DONE });

      const ran: StepName[] = [];
      await conductorAtBuild(buildKicksBackToPlan(ran), { daemon: true }).run();

      const body = await readHaltBody();
      expect(body).not.toBeNull();
      const firstLine = (body as string)
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      expect(firstLine).toBeDefined();
      expect(firstLine).toBe(
        'DECIDE entry refused — autonomous run may not enter DECIDE without operator direction.',
      );
      // The structured body names the requested target separately from the
      // canonical first-line refusal.
      expect(body).toMatch(/Requested target:\s*plan/i);
      // Body carries the kickback evidence text from the verdict, so the
      // operator sees WHY the gate was re-opened without reading the verdict.
      expect(body).toContain(KICKBACK_EVIDENCE);
    });

    it('emits a loop_halt event carrying that reason (happy path 3)', async () => {
      await seedStoriesAndPlan();
      await writeState(statePath, { ...FRONT_DONE });

      const reasons: string[] = [];
      events.on('loop_halt', (e) => {
        if (e.type === 'loop_halt') reasons.push(e.reason);
      });

      const ran: StepName[] = [];
      await conductorAtBuild(buildKicksBackToPlan(ran), { daemon: true }).run();

      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain('plan');
      expect(reasons[0]).toMatch(/DECIDE/);
    });

    it('does not attribute a later-step verdict to build (negative path 2)', async () => {
      await seedStoriesAndPlan();
      await writeState(statePath, { ...FRONT_DONE });

      const ran: StepName[] = [];
      let halted = false;
      const kicks: Array<{ from: StepName; to: StepName }> = [];
      events.on('loop_halt', () => {
        halted = true;
      });
      events.on('kickback', (event) => {
        if (event.type === 'kickback') kicks.push({ from: event.from, to: event.to });
      });

      // `kickback.from` names `build_review`, not the completing `build` step.
      // The build scan must not attribute it to build. The normal loop later
      // reaches build_review, whose matching verdict re-opens plan until the
      // existing selection cap halts the unresolved gate.
      await conductorAtBuild(
        buildKicksBackToPlan(ran, 'build_review' as StepName),
        { daemon: true },
      ).run();

      expect(kicks).not.toContainEqual({ from: 'build', to: 'plan' });
      expect(halted).toBe(true);
      // This is deliberately the selector's ordinary forward-walk halt, not
      // the matching `build_review` scan. Keep it as the negative proof that
      // build did not misattribute another gate's verdict to itself.
      const body = await readHaltBody();
      expect(body).toMatch(/gate 'plan' selected .* without satisfying/);
    });

    it('the later matching build_review verdict fails closed as a DECIDE entry', async () => {
      await seedStoriesAndPlan();
      // build_review's BUILD-verification prerequisites are already satisfied,
      // so the loop reaches the gate that carries the kickback rather than
      // stopping short on an unsatisfied upstream member.
      await writeState(statePath, {
        ...FRONT_DONE,
        build: 'done',
        wiring_check: 'done',
        test_suite: 'done',
      } as ConductState);
      await writeVerdict(dir, 'plan', {
        satisfied: false,
        checkedAt: 1,
        kickback: { from: 'build_review', evidence: KICKBACK_EVIDENCE },
      });

      const ran: StepName[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          ran.push(step);
          return satisfy(step);
        },
      };

      await new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        // Default mode keeps this deterministic verifier gate on the serial
        // path, making the matching build_review scan itself observable.
        mode: 'default',
        daemon: true,
        fromStep: 'build_review',
        maxRetries: 1,
        config: { build_review: { enabled: true } },
        git: fakeGit,
        shipmentEvidence: validShipmentEvidence,
      }).run();

      expect(ran).toEqual(['build_review']);
      expect(await readHaltClass(dir)).toBe('needs-human');
      const body = await readHaltBody();
      expect(body).toMatch(/Source gate:\s*build_review/i);
      expect(body).toMatch(/Requested target:\s*plan/i);
      expect(body).toContain(KICKBACK_EVIDENCE);
      expect(body).toMatch(/DECIDE entry refused/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S2 — BUILD-phase kickback targets stay fully autonomous.
  // The daemon:true build kickback flows themselves are already covered
  // end-to-end by gate-loop.test.ts:981 / :1379; this fence adds the one
  // assertion those predate — that the NEW guard's artifact never appears.
  // ───────────────────────────────────────────────────────────────────────────
  describe('S2: a BUILD-phase kickback target still routes under daemon: true', () => {
    async function git(...args: string[]): Promise<void> {
      await execFileP('git', ['-c', 'user.email=t@test', '-c', 'user.name=t', ...args], {
        cwd: dir,
      });
    }

    it('manual_test FAIL kicks back to build, re-dispatches it, and writes no HALT/HALT.class', async () => {
      await git('init', '-q', '-b', 'main');
      await git('commit', '--allow-empty', '-q', '-m', 'init');
      await writeState(statePath, { ...FRONT_DONE, rebase: 'skipped' } as ConductState);

      let fixed = false;
      const ran: StepName[] = [];
      const runner: StepRunner = {
        run: async (step: StepName, _artifacts?: unknown, opts?: { retryReason?: string }) => {
          ran.push(step);
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
            );
            if (opts?.retryReason) {
              // The kickback dispatch must land real commits (whitewash guard).
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
              fixed
                ? '| Story | Result |\n|---|---|\n| s1 | PASS |\n'
                : '| Story | Result |\n|---|---|\n| s1 | FAIL |\n',
            );
            return { success: true };
          }
          if (step === 'finish') {
            await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
            const res = await readState(statePath);
            const state = res.ok ? res.value : ({} as ConductState);
            state.pr_url = 'https://github.com/org/repo/pull/1';
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
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });

      await conductorAtBuild(runner, { daemon: true, disablePrdAudit: true }).run();

      expect(kicks).toContainEqual({ from: 'manual_test', to: 'build' });
      expect(ran.filter((s) => s === 'build')).toHaveLength(2);
      expect(halted).toBe(false);
      // The guard is scoped to DECIDE: its artifacts never appear on a
      // BUILD-phase route. An over-broad predicate fails here.
      expect(await exists(HALT_MARKER)).toBe(false);
      expect(await exists(HALT_CLASS_MARKER)).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S3 — Interactive `/conduct` kickbacks are provably unchanged, and the
  //      front-half call site is NOT exempted under daemon (review F6).
  // ───────────────────────────────────────────────────────────────────────────
  describe('S3: the daemon flag is the discriminator, at both call sites', () => {
    it('interactive (daemon: false): a DECIDE kickback re-opens plan and dispatches it (happy path)', async () => {
      await seedStoriesAndPlan();
      await writeState(statePath, { ...FRONT_DONE });

      const ran: StepName[] = [];
      const kicks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });

      await conductorAtBuild(buildKicksBackToPlan(ran), { daemon: false, disablePrdAudit: true }).run();

      expect(kicks).toContainEqual({ from: 'build', to: 'plan' });
      expect(ran).toContain('plan'); // the amendment pass actually ran
      expect(halted).toBe(false);
      expect(await exists(HALT_MARKER)).toBe(false);
    });

    it('front-half scan under daemon: true is NOT exempted — a conflict_check amendment kickback onto architecture_review HALTs (negative path 2)', async () => {
      // conflict_check runs BEFORE the first loop gate, so its kickback is
      // detected by the `navigate: false` call site (conductor.ts:6731). That
      // site is a separate production caller of the predicate (§3d) and must
      // enforce the same refusal.
      await seedStoriesAndPlan();
      await mkdir(join(dir, '.docs/decisions'), { recursive: true });
      await writeFile(join(dir, '.docs/decisions/adr-1.md'), '# ADR 1\n\nStatus: APPROVED\n');
      await writeState(statePath, {
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
      } as ConductState);
      // DECIDE is human-only under the daemon, so a grant no longer buys the
      // one entry this test used to rely on. Seeding it anyway proves the
      // stronger guarantee: the front-half scan refuses conflict_check itself,
      // and the grant is neither honored nor consumed.
      await writeFile(
        join(dir, '.pipeline/decide-grant.json'),
        JSON.stringify({ version: 1, step: 'conflict_check', grantedBy: 'operator' }),
      );

      const ran: StepName[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          ran.push(step);
          if (step === 'conflict_check') {
            await mkdir(join(dir, '.docs/conflicts'), { recursive: true });
            await writeFile(
              join(dir, '.docs/conflicts/report.md'),
              '# Conflict Check\n\nNo blocking conflicts.\n',
            );
            await writeVerdict(dir, 'architecture_review', {
              satisfied: false,
              checkedAt: 1,
              kickback: { from: 'conflict_check', evidence: KICKBACK_EVIDENCE },
            });
          }
          return satisfy(step);
        },
      };

      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });

      await new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        daemon: true,
        fromStep: 'conflict_check',
        maxRetries: 1,
        git: fakeGit,
        shipmentEvidence: validShipmentEvidence,
      }).run();

      expect(halted).toBe(true);
      const body = await readHaltBody();
      expect(body).not.toBeNull();
      expect(body).toMatch(/DECIDE/);
      // The front-half scan refuses at conflict_check — the first live DECIDE
      // target — so architecture_review is never even reached.
      expect(body).toContain('conflict_check');
      expect(ran).toEqual([]);
      expect(ran).not.toContain('architecture_review');
      // Nothing was authorized, so the grant is left unspent.
      expect(await exists('.pipeline/decide-grant.json')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S4 — The anti-ping-pong cap keeps precedence; its behavior is unchanged.
  // ───────────────────────────────────────────────────────────────────────────
  describe('S4: cap precedence over the new phase check', () => {
    /**
     * Seed the durable ledger at the cap for `plan` with no observable
     * progress since (`treeHash: null` matches `currentTreeHash` in a
     * non-repo root; `resolvedBefore` above any resolvable count), and set
     * `run_started_at` so the fresh-session reset (conductor.ts:2339) does
     * not wipe it.
     */
    async function seedExhaustedPlanLedger(): Promise<void> {
      await writeKickbackLedger(dir, {
        version: 1,
        gates: {
          plan: {
            count: MAX_KICKBACKS_PER_GATE,
            treeHash: null,
            lastReason: 'prior ping-pong round',
            priorVerdict: true,
            resolvedBefore: 1_000,
          },
        },
      });

      expect((await readKickbackLedger(dir)).gates.plan?.cumulative).toBe(0);
    }

    it('an exhausted DECIDE kickback HALTs with the ping-pong reason, not the phase reason (happy path 1)', async () => {
      await seedStoriesAndPlan();
      await seedExhaustedPlanLedger();
      await writeState(statePath, {
        ...FRONT_DONE,
        run_started_at: 1_753_574_400_000,
      } as ConductState);

      const reasons: string[] = [];
      events.on('loop_halt', (e) => {
        if (e.type === 'loop_halt') reasons.push(e.reason);
      });

      const ran: StepName[] = [];
      await conductorAtBuild(buildKicksBackToPlan(ran), { daemon: true }).run();

      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain('kickback ping-pong: plan re-opened');
      expect(reasons[0]).toContain(`cap ${MAX_KICKBACKS_PER_GATE}`);
      // The cap is checked BEFORE the phase check, so the phase reason must
      // not be what the operator sees for an already-capped gate.
      expect(reasons[0]).not.toMatch(/operator-only/i);
      expect(ran).not.toContain('plan');
    });

    it('below the cap, the counter is still bumped and the kickback event still emitted before the phase HALT (happy path 2)', async () => {
      await seedStoriesAndPlan();
      await writeState(statePath, { ...FRONT_DONE });

      const order: string[] = [];
      const kicks: Array<{ from: string; to: string; count: number }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') {
          order.push('kickback');
          kicks.push({ from: e.from, to: e.to, count: e.count });
        }
      });
      events.on('loop_halt', () => {
        order.push('loop_halt');
      });

      const ran: StepName[] = [];
      await conductorAtBuild(buildKicksBackToPlan(ran), { daemon: true }).run();

      // The attempt is on the audit trail: event emitted, counter bumped …
      expect(kicks).toContainEqual({ from: 'build', to: 'plan', count: 1 });
      // … and only THEN does the phase guard halt the run.
      expect(order).toEqual(['kickback', 'loop_halt']);

      // The durable per-gate counter was persisted, not skipped.
      const ledger = JSON.parse(
        await readFile(join(dir, '.pipeline/kickback-ledger.json'), 'utf-8'),
      );
      expect(ledger.gates.plan.count).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S5 — The HALT is `needs-human`, so no sweep ever auto-clears it.
  // ───────────────────────────────────────────────────────────────────────────
  describe('S5: needs-human classification survives the re-kick sweep', () => {
    async function runToDecideHalt(): Promise<void> {
      await seedStoriesAndPlan();
      await writeState(statePath, { ...FRONT_DONE });
      const ran: StepName[] = [];
      await conductorAtBuild(buildKicksBackToPlan(ran), { daemon: true }).run();
    }

    it('writes .pipeline/HALT.class containing exactly `needs-human` (happy path 1 / negative path)', async () => {
      await runToDecideHalt();

      // Asserted on the SIDECAR CONTENT, not on HALT existing — an
      // implementation that writes the marker with a bare `writeFile`
      // (the defect this story guards) leaves no sidecar and fails here,
      // so the assertion cannot pass vacuously.
      expect(await exists(HALT_CLASS_MARKER)).toBe(true);
      const cls = await readFile(join(dir, HALT_CLASS_MARKER), 'utf-8');
      expect(cls.trim()).toBe('needs-human');
      // …and the same value through the production reader the sweep uses.
      await expect(readHaltClass(dir)).resolves.toBe('needs-human');
    });

    it('rekickSweep skips the halted worktree at two different HEAD shas and creates neither HALT.cleared nor REKICK (happy path 2+3)', async () => {
      await runToDecideHalt();

      // Real `readHaltClass` and real `clearMarker` over the REAL worktree
      // this run just halted — the composition the injected-deps unit cases
      // at daemon-rekick.test.ts:157/:176 cannot reach (§3d).
      const slug = 'decide-kickback-feature';
      const cleared: string[] = [];
      const lastRekickSha = new Map<string, string>();
      const deps: RekickSweepDeps = {
        listHaltedWorktrees: async () => [slug],
        readHaltReason: async () => (await readHaltBody()) ?? '',
        hasRebaseInProgress: async () => false,
        abortRebase: async () => {},
        clearMarker: async (s: string) => {
          cleared.push(s);
          await clearMarker(dir);
        },
        readHaltClass: async () => readHaltClass(dir),
        lastRekickSha,
        log: () => {},
        hasWarned: async () => false,
        markWarned: async () => {},
      };

      const first = await rekickSweep(deps, 'a'.repeat(40));
      expect(first.skipped).toEqual([slug]);
      expect(first.cleared).toEqual([]);

      // A NEW HEAD sha must not re-open the guard — the skip is not SHA-bounded.
      const second = await rekickSweep(deps, 'b'.repeat(40));
      expect(second.skipped).toEqual([slug]);
      expect(second.cleared).toEqual([]);

      expect(cleared).toEqual([]);
      expect(lastRekickSha.has(slug)).toBe(false);
      expect(await exists(HALT_CLEARED_MARKER)).toBe(false);
      expect(await exists(REKICK_SENTINEL)).toBe(false);
      // The guard is still standing after both sweeps.
      expect(await exists(HALT_MARKER)).toBe(true);
    });

    it('after a human resolves the DECIDE gap and clears the HALT, a resumed daemon run re-enters at the earliest unsatisfied gate and never re-dispatches plan (resume path)', async () => {
      await runToDecideHalt();
      // Precondition — the run is parked by THIS feature's guard, not by some
      // unrelated tail failure. Without this the resume assertions below could
      // pass vacuously against a run that never refused the DECIDE re-open.
      const haltBody = await readHaltBody();
      expect(haltBody).not.toBeNull();
      expect(haltBody).toMatch(/DECIDE/);
      expect(haltBody).toContain('plan');

      // The operator amends the DECIDE artifacts, satisfies the gate, and
      // clears the park — exactly the documented recovery.
      await writeVerdict(dir, 'plan', { satisfied: true, checkedAt: 2 });
      await rm(join(dir, HALT_MARKER), { force: true });
      await rm(join(dir, HALT_CLASS_MARKER), { force: true });

      const ran: StepName[] = [];
      const resumeRunner: StepRunner = {
        run: async (step: StepName) => {
          ran.push(step);
          return satisfy(step);
        },
      };

      await new Conductor({
        stateFilePath: statePath,
        stepRunner: resumeRunner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        resume: true,
        daemon: true,
        maxRetries: 1,
        git: fakeGit,
        shipmentEvidence: validShipmentEvidence,
      }).run();

      // #532's verdict-aware resume clamp: re-entry at the earliest
      // unsatisfied gate, NOT a re-walk of the whole sequence from the front,
      // and the resolved DECIDE step is not re-authored.
      expect(ran).not.toContain('plan');
      expect(ran).not.toContain('stories');
      expect(ran).not.toContain('explore');
      expect(ran).not.toContain('architecture_review');
      // The guard halted immediately after `build` satisfied its gate, so the
      // earliest unsatisfied gate under the current ALL_STEPS order is the
      // first declared BUILD gate that still dispatches — `wiring_check`
      // precedes it but is a deprecated no-op that settles in-process —
      // never a re-dispatch of `build` or a walk back into DECIDE.
      expect(ran.length).toBeGreaterThan(0);
      expect(ran[0]).toBe('build_review');
    });
  });
});
