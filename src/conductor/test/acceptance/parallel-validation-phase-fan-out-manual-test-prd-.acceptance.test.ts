// Covers: task:14
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for `.docs/stories/parallel-validation-phase-fan-out-
// manual-test-prd-.md` (ai-conductor#469), governed by the APPROVED
// `adr-2026-07-10-concurrent-group-core.md` (TS-CORE) and
// `adr-2026-07-10-validation-group-join.md` (TS-JOIN).
//
// Pre-implementation: `src/conductor/src/engine/group-core.ts` does not exist,
// there is no `validation_concurrency` config key, and the built-in SHIP-tail
// validation group (manual_test / prd_audit / architecture_review_as_built)
// does not exist — those three run one at a time through today's ordinary
// serial `ALL_STEPS` loop, exactly like any other step. This file therefore
// never imports `group-core.ts` (a static import of a nonexistent module
// would fail the WHOLE file at collection time, which is not RED — see
// writing-system-tests §6). Every test below drives the real
// `Conductor.run()` entry point with a fake `StepRunner`, a tmp-repo
// `seedRepo`-style helper, and `ConductorEventEmitter` capture — exactly the
// `daemon-mode-route-halt-user-input-required-through.acceptance.test.ts` /
// `conductor.test.ts` fake-step-runner + tmp-repo convention — and fails
// because today's loop dispatches the three validators strictly one at a
// time (never concurrently, never as a "group" with its own events), not
// because of a typo or a bad import.
//
// Per §3a of writing-system-tests, single-helper / per-call-site unit
// behavior is OUT of scope here — that is `/pipeline`'s job, task-by-task, in
// `test/engine/group-core.test.ts` and `test/engine/conductor.test.ts` per the
// plan's Tasks 1-30. This file covers ONLY the multi-step flows that cross 2+
// real dispatches of `Conductor.run()` where the bug class lives in the
// WIRING (today's total absence of concurrent/group dispatch), not in any one
// function's return value:
//
//   A. manual_test and prd_audit dispatch with overlapping execution windows
//      under a cap, and the group's wall-clock beats the serial sum (Story 1
//      happy path 1, negative 1)
//   B. a validator that throws before writing any completion marker still
//      lets its siblings dispatch, and produces no remediation.json for that
//      branch (Story 1 negative 2)
//   C. a FAILing manual_test does not cancel/skip its siblings — prd_audit and
//      architecture_review_as_built still run to completion before any
//      rewind (Story 3 happy path 1)
//   D. manual_test FAIL + a prd_audit gap together dispatch exactly one
//      `/remediate` session, not two independent per-gate rounds (Story 4
//      happy path 2, Story 5 happy path 1 — the union dispatch)
//   E. a rate-limited manual_test does not block prd_audit from dispatching
//      while manual_test is still waiting out its episode (Story 6 happy
//      path 1, concurrency-crossing slice)
//   F. the ADR-004 config-DSL `parallel:` group dispatches each branch's OWN
//      step, not the group's step name — the verified bug this feature kills
//      (Story 7 happy path 2)
//   G. reaching the built-in SHIP validators emits a `parallel_started`
//      event, which today never fires for them (Story 9 happy path 1)
//
// Deliberately left to unit-level `/pipeline` TDD (`test/engine/group-core.test.ts`
// / `test/engine/conductor.test.ts`), not duplicated here:
//   - Story 1 negative 3 (SIGINT mid-group persists synthetic `«group»__«member»`
//     keys) and Story 1 happy-path's "group state key is done" — the group's
//     exact synthetic-key naming and AbortSignal wiring are internal shapes
//     (plan Task 8) not pinned by any story/ADR text; asserting a guessed key
//     name would freeze an unconfirmed implementation detail into a spec.
//   - Story 1 negative 4 (interactive mode does not fan out) — trivially true
//     today too (nothing ever fans out in ANY mode yet), so it would pass by
//     accident and prove nothing; real coverage needs the group to exist
//     first (plan Task 14).
//   - Story 2 (fan-out width 0/1/2/3 membership matrices) — single-helper
//     membership-resolution edge cases over the existing skip cascade (plan
//     Task 15), explicitly the "single config-clamping function" class §3a
//     calls out; width-1 event-stream-equivalence (Task 16) needs a recorded
//     serial fixture that only the implementing pass can produce.
//   - Story 3 negatives (two-FAIL earliest-target selection; no-verdict
//     sibling → halt, no partial join) — depend on the join's merge/target
//     logic (plan Tasks 22-23) that doesn't exist in any form yet; no
//     observable-today behavior to assert against without inventing it.
//   - Story 4 happy path 1 and both negatives, Story 5 negatives — MT-only
//     deterministic-kickback parity and the exhausted-budget wording are
//     ALREADY covered byte-for-byte by the pre-existing adr-2026-07-06
//     baseline tests in `conductor.test.ts` (e.g. "routes a FAILing
//     manual_test back to build..."); generating a duplicate here would pass
//     by accident against unchanged code, not prove anything new. Halt/
//     partial-plan/budget-cap dispositions (plan Tasks 23-24) need the merge
//     logic that doesn't exist yet.
//   - Story 6 negatives (abort-during-wait, inherited-episode block,
//     authFailure/sessionExpired parity) — per-branch internal mechanics
//     inside the branch executor (plan Tasks 7-8), unit-level by nature.
//   - Story 7 happy path 1 and negatives (distinct per-branch session ids,
//     retry-resumes-own-session, shared `this.sessionId` untouched) — the
//     `StepRunner` interface has no session-id parameter today; session
//     minting is an internal shape of the not-yet-written branch executor
//     (plan Task 5), only observable via a runner-spy once it exists.
//   - Story 8 (validation_concurrency config key + clamp) — pure
//     config-parsing/clamp-helper edge cases in isolation (plan Tasks 1-2),
//     the canonical §3a exclusion example.
//   - Story 9 negatives (phantom-member absence, per-event branch
//     attribution under interleaving) — depend on the group's member-
//     resolution and branch-labeled event payload shapes (plan Task 25) that
//     don't exist yet; the happy-path "does `parallel_started` fire at all"
//     slice (test G below) is the only piece observable against today's code.
// ─────────────────────────────────────────────────────────────────────────────

const MT_PASS = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n';
const MT_FAIL = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n';
const AUDIT_HEADER = '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n';
const PRD_PASS = AUDIT_HEADER + '| FR-1 | ALIGNED | | evidence.ts:1 | yes |\n';
const PRD_GAP = AUDIT_HEADER + '| FR-2 | MISSING | impl-gap | x.ts:10 | no |\n';

describe('parallel validation phase — cross-module acceptance flows (#469)', () => {
  /**
   * Seeds a tmp repo with every step BEFORE `manual_test` marked `done`
   * (including `build_review`, matching the stories' "whose build_review is
   * done" precondition), on a product-track, M-tier feature so all three
   * validators (manual_test, prd_audit, architecture_review_as_built) are
   * applicable — mirrors `conductor.test.ts`'s `seedToManualTest` /
   * `seedShipTail` convention.
   */
  async function seedToValidators(
    dir: string,
    statePath: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    const res = await readState(statePath);
    const state = (res.ok ? res.value : {}) as Record<string, unknown>;
    for (const s of ALL_STEPS) {
      if (s.name === 'manual_test') break;
      state[s.name] = 'done';
    }
    state.complexity_tier = 'M';
    state.track = 'product';
    state.feature_desc = 'parallel-validation-phase-fan-out-manual-test-prd-';
    state.build_review = 'done';
    Object.assign(state, overrides);
    await writeState(statePath, state as unknown as ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );
  }

  function makeConductor(
    dir: string,
    statePath: string,
    runner: StepRunner,
    events: ConductorEventEmitter,
    extra: Partial<ConstructorParameters<typeof Conductor>[0]> = {},
  ): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      // This fixture observes the SHIP validation join. Start at its first
      // member so the test does not re-verify the unrelated tree-attesting
      // BUILD test_suite proof that precedes it.
      fromStep: 'manual_test',
      ...extra,
    });
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function seedPendingNoOpKickback(dir: string, gate: StepName): Promise<void> {
    await writeFile(
      join(dir, '.pipeline/kickback-ledger.json'),
      JSON.stringify({
        version: 1,
        gates: {
          [gate]: {
            count: 1,
            treeHash: null,
            lastReason: 'prior validation kickback',
            priorVerdict: false,
            resolvedBefore: 1,
          },
        },
      }),
    );
  }

  // ── A. concurrent dispatch under cap + wall-clock proof ──────────────────
  it('dispatches manual_test and prd_audit with overlapping execution windows instead of strictly serially (cap 2)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-overlap-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath, {
        architecture_review_as_built: 'done',
        retro: 'done',
        rebase: 'done',
        finish: 'done',
      });

      const timeline: Array<{ step: string; phase: 'start' | 'end'; t: number }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          timeline.push({ step, phase: 'start', t: Date.now() });
          if (step === 'manual_test') {
            await delay(40);
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_PASS);
          }
          timeline.push({ step, phase: 'end', t: Date.now() });
          return { success: true } as StepRunResult;
        }),
      };

      const events = new ConductorEventEmitter();
      const conductor = makeConductor(dir, statePath, runner, events);
      await conductor.run();

      const manualTestEnd = timeline.find((e) => e.step === 'manual_test' && e.phase === 'end');
      const prdAuditStart = timeline.find((e) => e.step === 'prd_audit' && e.phase === 'start');
      expect(manualTestEnd).toBeDefined();
      expect(prdAuditStart).toBeDefined();

      // Today's serial loop always fully awaits manual_test before prd_audit
      // is ever dispatched — prd_audit's start can never precede manual_test's
      // end. Once the group core fans them out under cap 2, this overlap is
      // real. RED today: prd_audit starts strictly AFTER manual_test ends.
      expect((prdAuditStart as { t: number }).t).toBeLessThan((manualTestEnd as { t: number }).t);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('the group wall-clock beats the serial sum for three stub validators of durations 3t/2t/t under cap 2', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-wallclock-'));
    const statePath = join(dir, 'conduct-state.json');
    const t = 50;
    try {
      await seedToValidators(dir, statePath, {
        retro: 'done',
        rebase: 'done',
        finish: 'done',
      });

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') {
            await delay(3 * t);
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await delay(2 * t);
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_PASS);
          } else if (step === 'architecture_review_as_built') {
            await delay(t);
          }
          return { success: true } as StepRunResult;
        }),
      };

      const events = new ConductorEventEmitter();
      const conductor = makeConductor(dir, statePath, runner, events);

      const startedAt = Date.now();
      await conductor.run();
      const totalMs = Date.now() - startedAt;

      // Serial sum is 6t (300ms); a real cap-2 fan-out finishes in ~3t
      // (150ms, the longest single branch). Assert comfortably below the
      // serial sum (5t) so this is not a hair-trigger timing flake, while
      // still failing today's genuinely-serial ~6t execution.
      expect(totalMs).toBeLessThan(5 * t);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── B. no-verdict branch fails the group loudly, siblings still dispatch ──
  it('a validator that throws before any completion marker still lets its siblings dispatch, and synthesizes no remediation.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-crash-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath);

      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'manual_test') {
            throw new Error('agent crashed mid-session — no .pipeline marker written');
          }
          if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_PASS);
          }
          return { success: true } as StepRunResult;
        }),
      };

      let halted = false;
      const events = new ConductorEventEmitter();
      events.on('loop_halt', () => {
        halted = true;
      });
      const conductor = makeConductor(dir, statePath, runner, events);
      await conductor.run();

      expect(halted).toBe(true);

      // Siblings should still have been dispatched (verdicts join, infra
      // fails fast — but only manual_test's own branch fails; prd_audit and
      // architecture_review_as_built are independent branches that should
      // still run). Today, a throw from ANY step aborts the whole loop
      // immediately — siblings are never reached. RED: zero calls to either.
      expect(calls).toContain('prd_audit');
      expect(calls).toContain('architecture_review_as_built');

      // No remediation.json should ever be synthesized for an infra crash —
      // this is deliberately never written by the fake runner, so proving
      // it's absent proves the crash never got routed through /remediate.
      expect(calls).not.toContain('remediate');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('classifies a validation-group no-verdict as needs-human', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-no-verdict-class-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath, {
        architecture_review_as_built: 'done',
        run_started_at: Date.now() - 1_000,
      });
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') {
            throw new Error('agent crashed before producing a verdict');
          }
          if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_PASS);
          }
          return { success: true } as StepRunResult;
        }),
      };

      await makeConductor(dir, statePath, runner, new ConductorEventEmitter()).run();

      expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('classifies a manual-test kickback-to-build no-op as needs-human', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-mt-noop-class-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath, {
        architecture_review_as_built: 'done',
        run_started_at: Date.now() - 1_000,
      });
      await seedPendingNoOpKickback(dir, 'manual_test');
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_FAIL);
          } else if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_PASS);
          }
          return { success: true } as StepRunResult;
        }),
      };

      await makeConductor(dir, statePath, runner, new ConductorEventEmitter()).run();

      expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('classifies a validation-member kickback-to-build no-op as needs-human', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-member-noop-class-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath, {
        architecture_review_as_built: 'done',
        run_started_at: Date.now() - 1_000,
      });
      await seedPendingNoOpKickback(dir, 'prd_audit');
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_GAP);
          } else if (step === 'remediate') {
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: 'FR-2',
                    disposition: 'build',
                    category: null,
                    rationale: 'repair the implementation gap',
                    tasks: [{ id: 'r1', title: 'repair FR-2' }],
                  },
                ],
              }),
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      await makeConductor(dir, statePath, runner, new ConductorEventEmitter()).run();

      expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generic non-green fallback preserves an existing specific marker and class', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-fallback-preserve-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath, { architecture_review_as_built: 'done' });
      await writeFile(join(dir, '.pipeline/HALT'), 'specific preflight halt');
      await writeFile(join(dir, '.pipeline/HALT.class'), 'mechanical');
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_GAP);
          }
          return { success: true } as StepRunResult;
        }),
      };

      await makeConductor(dir, statePath, runner, new ConductorEventEmitter()).run();

      expect(
        await Promise.all([
          readFile(join(dir, '.pipeline/HALT'), 'utf-8'),
          readFile(join(dir, '.pipeline/HALT.class'), 'utf-8'),
        ]),
      ).toEqual(['specific preflight halt', 'mechanical']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── C. FAIL verdict does not cancel siblings — both markers exist at join ──
  it('a FAILing manual_test does not cancel prd_audit or architecture_review_as_built — both still run to completion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-nocancel-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath);

      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_FAIL);
          } else if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_PASS);
          } else if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      const events = new ConductorEventEmitter();
      const conductor = makeConductor(dir, statePath, runner, events);
      await conductor.run();

      // Today, manual_test's FAIL immediately navigates back to `build`
      // before prd_audit or architecture_review_as_built are ever reached —
      // first-failure-wins. RED: neither sibling is ever dispatched.
      expect(calls).toContain('prd_audit');
      expect(calls).toContain('architecture_review_as_built');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── D. consolidated remediate dispatch over the prd-audit + as-built union ──
  it('a manual_test FAIL alongside a prd_audit gap dispatches exactly one /remediate session, not one per gate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-consolidated-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath);

      const remediateReasons: string[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state, opts) => {
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_PASS);
          } else if (step === 'remediate') {
            remediateReasons.push(opts?.retryReason ?? '');
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: 'FR-2',
                    disposition: 'build',
                    category: null,
                    rationale: 'fix the impl gap',
                    tasks: [{ id: 'r1', title: 'fix FR-2' }],
                  },
                ],
              }),
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      const events = new ConductorEventEmitter();
      const conductor = makeConductor(dir, statePath, runner, events, {
        fromStep: 'manual_test',
      });

      // First manual_test call FAILs, first prd_audit call reports a gap;
      // subsequent calls (post build-fix) pass.
      let manualTestCalls = 0;
      let prdAuditCalls = 0;
      const originalRun = runner.run.bind(runner);
      runner.run = vi.fn(async (step: StepName, state, opts) => {
        if (step === 'manual_test') {
          manualTestCalls++;
          if (manualTestCalls === 1) {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_FAIL);
            return { success: true } as StepRunResult;
          }
        }
        if (step === 'prd_audit') {
          prdAuditCalls++;
          if (prdAuditCalls === 1) {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_GAP);
            return { success: true } as StepRunResult;
          }
        }
        return originalRun(step, state, opts);
      });

      await conductor.run();

      // Union join: ONE consolidated /remediate dispatch should plan the
      // prd-audit gap (manual_test's own FAIL is classified deterministically,
      // never offered to remediate). Today, prd_audit is never even reached in
      // the same pass as manual_test's FAIL (first-failure-wins), so
      // /remediate is never dispatched for the prd-audit gap in this run.
      // RED: zero remediate dispatches instead of exactly one.
      expect(remediateReasons.length).toBe(1);
      // Manual-test FAIL rows must never be offered to remediate for
      // re-classification (adr-2026-07-06 preserved).
      expect(remediateReasons.some((r) => r.includes('| s1 | FAIL |'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('routes a remediable as-built group gap through one consolidated remediation dispatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-as-built-remediation-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath);
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(
        join(dir, '.docs', 'plans', 'parallel-validation-phase-fan-out-manual-test-prd-.md'),
        [1, 2, 3, 4].map((id) => `### Task ${id}: Existing work ${id}`).join('\n'),
      );

      const remediateReasons: string[] = [];
      let asBuiltRestagedBeforeBuild = false;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state, opts) => {
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), [
              '# PRD Audit',
              '',
              '**PRD:** none',
              '',
              '## Verdict Table',
              '| Criterion | Grade | Plan task | PRD: | Evidence |',
              '| --- | --- | --- | --- | --- |',
              '| S1.1 | PASS | — | FR-1 | evidence.ts:1 |',
              '',
              PRD_PASS,
            ].join('\n'));
          } else if (step === 'architecture_review_as_built') {
            await writeFile(
              join(dir, '.pipeline/architecture-review-as-built.md'),
              [
                'Verdict: BLOCKED',
                '',
                '## Blocking Findings',
                '| Finding | Class | Governing clause | Summary |',
                '| --- | --- | --- | --- |',
                '| ARCH-1 | REMEDIABLE | Task 1 | Add the missing guard |',
              ].join('\n'),
            );
          } else if (step === 'remediate') {
            remediateReasons.push(opts?.retryReason ?? '');
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [{
                  id: 'ARCH-1',
                  disposition: 'build',
                  category: null,
                  rationale: 'Add the missing guard.',
                  tasks: [{ id: 'missing-guard', title: 'Add the missing guard' }],
                }],
              }),
            );
          } else if (step === 'build') {
            const current = await readState(statePath);
            asBuiltRestagedBeforeBuild =
              current.ok && current.value.architecture_review_as_built === 'stale';
            return { success: false, error: 'stop after observing group reroute' } as StepRunResult;
          }
          return { success: true } as StepRunResult;
        }),
      };

      const kickbacks: Array<{ from: string; to: string }> = [];
      const events = new ConductorEventEmitter();
      events.on('kickback', (event) => {
        if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
      });
      const conductor = makeConductor(dir, statePath, runner, events, {
        config: { architecture_review_as_built: { remediation: { enabled: true } } } as never,
      });

      await conductor.run();

      expect(remediateReasons).toHaveLength(1);
      expect(remediateReasons[0]).toContain('.pipeline/architecture-review-as-built.md');
      expect(kickbacks).toContainEqual({ from: 'manual_test', to: 'build' });
      expect(asBuiltRestagedBeforeBuild).toBe(true);
      const ledger = JSON.parse(await readFile(join(dir, '.pipeline/kickback-ledger.json'), 'utf8'));
      expect(ledger.gates.architecture_review_as_built.laps).toBe(1);
      expect(ledger.gates.prd_audit).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('consumes the as-built lap for a shared PRD/as-built repair without double-counting plan growth', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-mixed-remediation-'));
    const statePath = join(dir, 'conduct-state.json');
    const slug = 'parallel-validation-phase-fan-out-manual-test-prd-';
    const planPath = join(dir, '.docs', 'plans', `${slug}.md`);
    try {
      await seedToValidators(dir, statePath);
      await Promise.all([
        mkdir(join(dir, '.docs', 'plans'), { recursive: true }),
        mkdir(join(dir, '.docs', 'stories'), { recursive: true }),
        mkdir(join(dir, '.docs', 'specs'), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(planPath, [
          '# Plan',
          '',
          '### Task 1: Existing work',
          '',
          '**Files:** src/feature.ts',
          '',
          '**Criterion:** S1.1',
          '',
          ...Array.from({ length: 7 }, (_, index) => `### Task ${index + 2}: Existing work`),
        ].join('\n')),
        writeFile(join(dir, '.docs', 'stories', `${slug}.md`), [
          '# Stories',
          '',
          '## Story 1',
          '',
          '### Happy Path',
          '',
          '- Given a request, when it succeeds, then the result is returned.',
        ].join('\n')),
        writeFile(join(dir, '.docs', 'specs', `${slug}.md`), [
          '# PRD',
          '',
          '## Functional Requirements',
          '',
          '- **FR-1:** The requested result exists.',
        ].join('\n')),
        writeFile(
          join(dir, '.pipeline', 'engine-state.json'),
          JSON.stringify({ activePlanPath: planPath }),
        ),
      ]);

      const remediationReasons: string[] = [];
      const events = new ConductorEventEmitter();
      const growthEvents: Array<Extract<ConductorEvent, { type: 'plan_growth' }>> = [];
      events.on('plan_growth', (event) => {
        if (event.type === 'plan_growth') growthEvents.push(event);
      });
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state, opts) => {
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), [
              '**PRD:** present',
              '',
              '## Verdict Table',
              '| Criterion | Grade | Plan task | PRD: | Evidence |',
              '|---|---|---|---|---|',
              '| S1.1 | FIXABLE | 1 | FR-1 | Missing implementation |',
              '',
              '## FR Evidence',
              '| FR | Verdict | Gap-class | Evidence | Accepted? |',
              '|---|---|---|---|---|',
              '| FR-1 | MISSING | impl-gap | src/feature.ts:1 | no |',
            ].join('\n'));
          } else if (step === 'architecture_review_as_built') {
            await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), [
              'Verdict: BLOCKED',
              '',
              '## Blocking Findings',
              '| Finding | Class | Governing clause | Summary |',
              '| --- | --- | --- | --- |',
              '| FR-1 | REMEDIABLE | Task 1 | Repair the same approved behavior |',
            ].join('\n'));
          } else if (step === 'remediate') {
            remediationReasons.push(opts?.retryReason ?? '');
            await writeFile(join(dir, '.pipeline/remediation.json'), JSON.stringify({
              dispositions: [
                {
                  id: 'FR-1',
                  disposition: 'build',
                  category: null,
                  rationale: 'Implement the existing PRD criterion.',
                  tasks: [{ id: 'shared-fix', title: 'Implement S1.1' }],
                },
              ],
            }));
          } else if (step === 'build') {
            return { success: false, error: 'stop after observing mixed remediation route' } as StepRunResult;
          }
          return { success: true } as StepRunResult;
        }),
      };

      const conductor = makeConductor(dir, statePath, runner, events, {
        config: {
          // This case isolates the independent as-built lap cap; the no-op
          // kickback guard has its own acceptance coverage below.
          kickback_escalation: { enabled: false },
          prd_audit: {
            max_appended_tasks: 5,
            max_appended_ratio: 1,
            max_remediation_laps: 2,
          },
          architecture_review_as_built: { remediation: { enabled: true } },
        } as never,
      });
      await conductor.run();

      expect(remediationReasons).toHaveLength(1);
      expect(remediationReasons[0]).toContain('.pipeline/prd-audit.md');
      expect(remediationReasons[0]).toContain('.pipeline/architecture-review-as-built.md');

      const plan = await readFile(planPath, 'utf8');
      expect(plan).toContain('### Task rem-prd-audit-shared-fix: Implement S1.1');
      expect(plan).toContain('**Criterion:** S1.1');
      expect(plan).toContain('**Governing clause:** Task 1');

      const ledger = JSON.parse(await readFile(join(dir, '.pipeline/kickback-ledger.json'), 'utf8'));
      expect(ledger.gates.prd_audit.laps).toBe(1);
      expect(ledger.gates.architecture_review_as_built.laps).toBe(1);
      expect(ledger.growth).toEqual({
        authored: 8,
        added: 1,
        byGate: {
          prd_audit: 1,
        },
      });
      expect(growthEvents).toEqual([
        expect.objectContaining({
          type: 'plan_growth',
          added: 1,
          byGate: { prd_audit: 1 },
        }),
      ]);

      await rm(join(dir, '.pipeline', 'HALT'), { force: true });
      await rm(join(dir, '.pipeline', 'HALT.class'), { force: true });
      await seedToValidators(dir, statePath);
      await makeConductor(dir, statePath, runner, events, {
        config: {
          kickback_escalation: { enabled: false },
          prd_audit: {
            max_appended_tasks: 5,
            max_appended_ratio: 1,
            max_remediation_laps: 2,
          },
          architecture_review_as_built: { remediation: { enabled: true } },
        } as never,
      }).run();

      expect(remediationReasons).toHaveLength(2);
      await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
        'architecture_review_as_built remediation lap cap reached (1/1)',
      );
      await expect(readFile(join(dir, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('kickback-cap');
      const afterSecondBlocked = JSON.parse(
        await readFile(join(dir, '.pipeline', 'kickback-ledger.json'), 'utf8'),
      );
      expect(afterSecondBlocked.gates.architecture_review_as_built.laps).toBe(1);
      expect(afterSecondBlocked.growth).toEqual(ledger.growth);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('halts a mixed valid group before appending when its shared growth allowance has one task left', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-mixed-remediation-cap-'));
    const statePath = join(dir, 'conduct-state.json');
    const slug = 'parallel-validation-phase-fan-out-manual-test-prd-';
    const planPath = join(dir, '.docs', 'plans', `${slug}.md`);
    try {
      await seedToValidators(dir, statePath);
      await Promise.all([
        mkdir(join(dir, '.docs', 'plans'), { recursive: true }),
        mkdir(join(dir, '.docs', 'stories'), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(planPath, '### Task 1: Existing work\n'),
        writeFile(join(dir, '.docs', 'stories', `${slug}.md`), [
          '## Story 1: remediation', '', '### Happy Path',
          '- Given a request, when repaired, then it succeeds.',
        ].join('\n')),
        writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath })),
      ]);

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), [
              '**PRD:** none', '', '## Verdict Table',
              '| Criterion | Grade | Plan task | PRD: | Evidence |',
              '|---|---|---|---|---|',
              '| S1.1 | FIXABLE | 1 | FR-1 | Missing implementation |',
            ].join('\n'));
          } else if (step === 'architecture_review_as_built') {
            await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), [
              'Verdict: BLOCKED', '', '## Blocking Findings',
              '| Finding | Class | Governing clause | Summary |',
              '| --- | --- | --- | --- |',
              '| ARCH-1 | REMEDIABLE | Task 1 | Add the missing guard |',
            ].join('\n'));
          } else if (step === 'remediate') {
            await writeFile(join(dir, '.pipeline/remediation.json'), JSON.stringify({
              dispositions: [
                { id: 'FR-1', disposition: 'build', category: null, rationale: 'Implement criterion.', tasks: [{ id: 'prd-fix', title: 'Implement S1.1' }] },
                { id: 'ARCH-1', disposition: 'build', category: null, rationale: 'Add guard.', tasks: [{ id: 'as-built-fix', title: 'Add the missing guard' }] },
              ],
            }));
          }
          return { success: true } as StepRunResult;
        }),
      };

      const conductor = makeConductor(dir, statePath, runner, new ConductorEventEmitter(), {
        config: {
          prd_audit: { max_appended_tasks: 1, max_appended_ratio: 1 },
          architecture_review_as_built: { remediation: { enabled: true } },
        } as never,
      });
      await conductor.run();

      expect(await readFile(planPath, 'utf8')).not.toContain('rem-prd-audit-prd-fix');
      expect(await readFile(planPath, 'utf8')).not.toContain('rem-as-built-as-built-fix');
      await expect(readFile(join(dir, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('kickback-cap');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('halts an unchanged remediable as-built group verdict after a no-op build kickback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-as-built-no-op-escalation-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath);
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(
        join(dir, '.docs', 'plans', 'parallel-validation-phase-fan-out-manual-test-prd-.md'),
        [1, 2, 3, 4].map((id) => `### Task ${id}: Existing work ${id}`).join('\n'),
      );

      let remediateCalls = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), [
              '# PRD Audit',
              '',
              '**PRD:** none',
              '',
              '## Verdict Table',
              '| Criterion | Grade | Plan task | PRD: | Evidence |',
              '| --- | --- | --- | --- | --- |',
              '| S1.1 | PASS | — | FR-1 | evidence.ts:1 |',
            ].join('\n'));
          } else if (step === 'architecture_review_as_built') {
            await writeFile(join(dir, '.pipeline/architecture-review-as-built.md'), [
              'Verdict: BLOCKED',
              '',
              '## Blocking Findings',
              '| Finding | Class | Governing clause | Summary |',
              '| --- | --- | --- | --- |',
              '| ARCH-1 | REMEDIABLE | Task 1 | Add the missing guard |',
            ].join('\n'));
          } else if (step === 'remediate') {
            remediateCalls++;
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [{
                  id: 'ARCH-1',
                  disposition: 'build',
                  category: null,
                  rationale: 'Add the missing guard.',
                  tasks: [{ id: 'missing-guard', title: 'Add the missing guard' }],
                }],
              }),
            );
          } else if (step === 'build') {
            // Stop after the rerouted build with neither a tree nor a
            // resolved-task movement. The second validator evaluation below
            // is a fresh daemon dispatch over that same no-op baseline.
            return { success: false, error: 'no work after as-built kickback' };
          }
          return { success: true } as StepRunResult;
        }),
      };
      const events = new ConductorEventEmitter();
      const conductor = makeConductor(dir, statePath, runner, events, {
        config: {
          architecture_review_as_built: {
            remediation: { enabled: true },
            max_remediation_laps: 2,
          },
        } as never,
      });

      await conductor.run();

      const captured = JSON.parse(await readFile(join(dir, '.pipeline/kickback-ledger.json'), 'utf8'));
      expect(captured.gates.architecture_review_as_built.priorVerdict).toBe(false);
      await rm(join(dir, '.pipeline/HALT'), { force: true });
      await rm(join(dir, '.pipeline/HALT.class'), { force: true });
      await seedToValidators(dir, statePath);
      await makeConductor(dir, statePath, runner, events, {
        config: {
          architecture_review_as_built: {
            remediation: { enabled: true },
            max_remediation_laps: 2,
          },
        } as never,
      }).run();

      expect(remediateCalls).toBe(1);
      await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
        'as-built architecture review kickback-to-build no-op',
      );
      await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('needs-human');
      const ledger = JSON.parse(await readFile(join(dir, '.pipeline/kickback-ledger.json'), 'utf8'));
      expect(ledger.gates.architecture_review_as_built.priorVerdict).toBe(true);
      expect(ledger.gates.prd_audit).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── D2. validation-group remediation halt is classified needs-human ─────
  it('a validation-group /remediate "halt" disposition HALTs with a needs-human HALT.class sidecar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-halt-class-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath);

      let manualTestCalls = 0;
      let prdAuditCalls = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') {
            manualTestCalls++;
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_FAIL);
          } else if (step === 'prd_audit') {
            prdAuditCalls++;
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_GAP);
          } else if (step === 'architecture_review_as_built') {
            await writeFile(
              join(dir, '.pipeline/architecture-review-as-built.md'),
              '# As-Built Architecture Review\n\n**Verdict:** APPROVED\n',
            );
          } else if (step === 'remediate') {
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: 'FR-2',
                    disposition: 'halt',
                    category: 'architectural-clarity',
                    rationale: 'ambiguous aggregate boundary',
                    tasks: [],
                  },
                ],
              }),
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      let halted = false;
      const events = new ConductorEventEmitter();
      events.on('loop_halt', () => {
        halted = true;
      });
      const conductor = makeConductor(dir, statePath, runner, events);
      await conductor.run();

      expect(halted).toBe(true);
      expect(manualTestCalls).toBeGreaterThanOrEqual(1);
      expect(prdAuditCalls).toBeGreaterThanOrEqual(1);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/needs human DECIDE/);
      // A validation-group remediation halt disposition is an operator-only
      // DECIDE-phase gap — the re-kick sweep must never auto-resume it.
      const haltClass = await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8');
      expect(haltClass).toBe('needs-human');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── E. rate-limited manual_test does not block prd_audit's dispatch ──────
  it('a rate-limited manual_test does not prevent prd_audit from dispatching while manual_test is still waiting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-ratelimit-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath, {
        architecture_review_as_built: 'done',
        retro: 'done',
        rebase: 'done',
        finish: 'done',
      });

      let manualTestCalls = 0;
      let prdAuditCalls = 0;
      // Snapshot how many times prd_audit has been dispatched at the exact
      // moment manual_test's rate-limit wait begins (before it's resolved).
      // In today's serial loop, manual_test's whole retry attempt — including
      // this wait — must complete before prd_audit is EVER dispatched, so
      // this snapshot is deterministically 0. Once branches run concurrently,
      // prd_audit should already be in flight. RED: snapshot stays 0.
      let prdAuditCountWhenManualTestWaiting = -1;
      const fakeEpisode = {
        enter: (_untilMs: number) => {
          if (prdAuditCountWhenManualTestWaiting === -1) {
            prdAuditCountWhenManualTestWaiting = prdAuditCalls;
          }
        },
        active: (_nowMs?: number) => true,
        clear: (_signal?: AbortSignal) =>
          new Promise<void>((resolve) => {
            setImmediate(resolve);
          }),
        nextWaitSeconds: (_baseSeconds?: number) => 60,
      };

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') {
            manualTestCalls++;
            if (manualTestCalls === 1) {
              return { success: false, rateLimited: true, deadline: Date.now() + 2000 } as StepRunResult;
            }
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            prdAuditCalls++;
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_PASS);
          }
          return { success: true } as StepRunResult;
        }),
      };

      const events = new ConductorEventEmitter();
      const conductor = makeConductor(dir, statePath, runner, events, {
        rateLimitEpisode: fakeEpisode,
      });
      await conductor.run();

      expect(prdAuditCountWhenManualTestWaiting).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── F. DSL parallel: group dispatches each branch's OWN step (ADR-004 bug) ──
  it('a config-DSL parallel: group dispatches each branch by its own step name, not the group step name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-dsl-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name !== 'explore') state[s.name] = 'done';
      }
      await writeState(statePath, state as unknown as ConductState);

      const calls: string[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          return { success: true } as StepRunResult;
        }),
      };

      const events = new ConductorEventEmitter();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        config: {
          steps: {
            explore: {
              parallel: [
                { name: 'frontend', skill: 'skills/frontend-explore/SKILL.md' },
                { name: 'backend', skill: 'skills/backend-explore/SKILL.md' },
              ],
            },
          },
        },
        mode: 'auto',
      });

      await conductor.run();

      // The ADR-004 dispatch bug: today EVERY branch calls
      // `stepRunner.run(groupName, ...)` — the group's own step name
      // ('explore'), never the branch's skill/step. RED: every call is
      // 'explore'; none carries a distinct per-branch step.
      expect(calls.some((c) => c !== 'explore')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── G. reaching the built-in validators emits parallel_started ───────────
  it('reaching the SHIP-tail validators in auto mode emits a parallel_started event', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-events-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath, {
        retro: 'done',
        rebase: 'done',
        finish: 'done',
      });

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'manual_test') {
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), MT_PASS);
          } else if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_PASS);
          }
          return { success: true } as StepRunResult;
        }),
      };

      const emitted: ConductorEvent[] = [];
      const events = new ConductorEventEmitter();
      events.on('parallel_started', (e) => {
        emitted.push(e);
      });

      const conductor = makeConductor(dir, statePath, runner, events);
      await conductor.run();

      // Today, manual_test/prd_audit/architecture_review_as_built run through
      // the ordinary per-step loop — `parallel_started` is emitted ONLY from
      // inside `runParallelGroup`, which built-in steps never call. RED: zero
      // events.
      expect(emitted.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── H. group engages at the first DISPATCHABLE member (entry-skip fix) ────
  // Regression for the entry-member-skip bug: with `steps.manual_test.disable:
  // true` (this harness repo's own self-host config), the loop's config-skip
  // branch `continue`d at manual_test BEFORE the group-engagement code, and
  // engagement was keyed to `members[0] === step.name` — so the group never
  // engaged and prd_audit/architecture_review_as_built ran strictly serially
  // (zero `parallel_started` events in the entire daemon log). The fix keys
  // engagement to the first member that survives the skip cascade.
  it('fans out prd_audit ∥ architecture_review_as_built when manual_test (the nominal entry) is config-disabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parvalid-entryskip-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedToValidators(dir, statePath, {
        retro: 'done',
        rebase: 'done',
        finish: 'done',
      });

      const dispatched: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          dispatched.push(step);
          if (step === 'prd_audit') {
            await writeFile(join(dir, '.pipeline/prd-audit.md'), '# PRD Audit\n\n' + PRD_PASS);
          } else if (step === 'architecture_review_as_built') {
            await writeFile(
              join(dir, '.pipeline/architecture-review-as-built.md'),
              '# As-Built Architecture Review\n\n**Verdict:** APPROVED\n',
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      const emitted: ConductorEvent[] = [];
      const events = new ConductorEventEmitter();
      events.on('parallel_started', (e) => {
        emitted.push(e);
      });

      const conductor = makeConductor(dir, statePath, runner, events, {
        config: { steps: { manual_test: { disable: true } } },
      });
      await conductor.run();

      // The disabled nominal entry never dispatches…
      expect(dispatched).not.toContain('manual_test');
      // …and the two surviving members still fan out as a width-2 group:
      // exactly one parallel_started naming both, and only both.
      expect(emitted.length).toBe(1);
      const branches = (emitted[0] as { branches?: string[] }).branches ?? [];
      expect(branches).toContain('prd_audit');
      expect(branches).toContain('architecture_review_as_built');
      expect(branches).not.toContain('manual_test');
      expect(dispatched).toContain('prd_audit');
      expect(dispatched).toContain('architecture_review_as_built');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
