/**
 * RED acceptance specs for TS-1 (issue #358): the daemon merged-PR guard on
 * kickback re-entry.
 *
 * Drives a real daemon-mode Conductor.run() through each of the five
 * gate-failure kickback routes (manual_test, build_review, prd_audit,
 * generic remediation, finish/as-built remediation) with a fake GhRunner and
 * asserts the guard's observable side effects: no build re-dispatch,
 * synthetic ship markers, unchanged pr_url, and a log/event line naming the
 * out-of-band merge.
 *
 * `src/engine/merged-pr-guard.ts` does not exist yet (ADR
 * adr-2026-07-09-mid-run-merged-pr-guard.md, plan
 * .docs/plans/2026-07-09-daemon-merged-pr-guard-on-retry.md, Tasks 4-7, 13).
 * These tests are expected to FAIL: the MERGED verdict currently has zero
 * effect on conductor.ts, so the "no re-dispatch" / marker assertions fail
 * because today's behavior re-dispatches build exactly as it always has.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepName } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

const PR_URL = 'https://github.com/jstoup111/ai-conductor/pull/358';
const AUDIT_HEADER = '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n';

// ── Fake GhRunner (adapted from test/engine/daemon-runner-mergeable.test.ts's
// makeGhFake — this variant returns the `state` field prMergeState.ts:277
// actually parses, not PR labels). ──────────────────────────────────────────
function makeGhFake(
  opts: { state?: string; throws?: boolean } = {},
): { runGh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runGh: GhRunner = async (args) => {
    calls.push([...args]);
    if (opts.throws) throw new Error('gh runner failed');
    return {
      stdout: JSON.stringify({
        state: opts.state ?? 'OPEN',
        mergeable: 'MERGEABLE',
        statusCheckRollup: [],
        labels: [],
      }),
    };
  };
  return { runGh, calls };
}

async function markerExists(dir: string, rel: string): Promise<boolean> {
  return access(join(dir, rel)).then(
    () => true,
    () => false,
  );
}

/** Snapshot every emitted event (any type) so we can grep the future guard's
 * log line without depending on a specific ConductorEvent variant name. */
function captureEvents(events: ConductorEventEmitter): { all: unknown[] } {
  const all: unknown[] = [];
  const spy = vi.spyOn(events, 'emit');
  spy.mockImplementation(async (e: unknown) => {
    all.push(e);
    return undefined;
  });
  return { all };
}

describe('engine/merged-pr-guard — kickback re-entry (#358, TS-1)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'merged-pr-guard-kickback-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── Route 1 (primary): finish/as-built remediation (~2046) ────────────────

  describe('finish remediation route', () => {
    async function seedShipTail(overrides: Record<string, unknown> = {}): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'finish') break;
        state[s.name] = 'done';
      }
      Object.assign(
        state,
        {
          complexity_tier: 'L',
          feature_desc: 'feat',
          build_review: 'skipped',
          manual_test: 'skipped',
          prd_audit: 'skipped',
          retro: 'skipped',
          architecture_review_as_built: 'skipped',
          rebase: 'skipped',
          pr_url: PR_URL,
        },
        overrides,
      );
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );
    }

    // A finish that always fails verification (no finish-choice written) and a
    // /remediate dispatch that routes the gap back to build — the shape that
    // triggers navigateBack(state, 'build'|target, steps) at conductor.ts:2046.
    function remediateToBuildRunner(): { runner: StepRunner; calls: StepName[] } {
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'remediate') {
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: 'test:finish-gap',
                    disposition: 'build',
                    category: null,
                    rationale: 'stale finish evidence',
                    tasks: [{ id: 'rem-1', title: 'fix stale finish evidence' }],
                  },
                ],
              }),
            );
          } else if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          }
          return { success: true };
        }),
      };
      return { runner, calls };
    }

    it('happy: MERGED verdict — no build re-dispatch, synthetic markers, pr_url unchanged, log names the out-of-band merge', async () => {
      await seedShipTail();
      const { runner, calls } = remediateToBuildRunner();
      const { runGh, calls: ghCalls } = makeGhFake({ state: 'MERGED' });
      const { all: emitted } = captureEvents(events);

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'finish',
        maxRetries: 1,
        escalateBuildFailure: async () => ({}),
        // Not yet a declared ConductorOptions field (Task 3) — the guard is
        // expected to read this once implemented.
        runGh,
      } as never);

      await conductor.run();

      // Guard queried the recorded PR at least once.
      expect(ghCalls.length).toBeGreaterThan(0);

      // No further build dispatch after the guard observes MERGED.
      expect(calls.filter((s) => s === 'build')).toHaveLength(0);

      // Synthetic verified-ship markers.
      expect(await markerExists(dir, '.pipeline/finish-choice')).toBe(true);
      expect((await readFile(join(dir, '.pipeline/finish-choice'), 'utf-8')).trim()).toBe('pr');
      expect(await markerExists(dir, '.pipeline/DONE')).toBe(true);

      // pr_url is untouched.
      const result = await readState(statePath);
      expect(result.ok && result.value.pr_url).toBe(PR_URL);

      // A log/event line names the out-of-band merge with the retained SHA.
      const found = emitted.find((e) => {
        const s = JSON.stringify(e);
        return /already shipped out-of-band/.test(s) && /[0-9a-f]{40}/.test(s);
      });
      expect(found).toBeTruthy();
    });

    it.each([
      ['OPEN', { state: 'OPEN' }],
      ['CLOSED', { state: 'CLOSED' }],
      ['NOTFOUND', { state: 'NOTFOUND' }],
      ['UNKNOWN', { state: 'UNKNOWN' }],
      ['gh throws', { throws: true }],
    ] as const)('negative: %s verdict — rewind proceeds, no synthetic markers written', async (_label, ghOpts) => {
      await seedShipTail();
      const { runner, calls } = remediateToBuildRunner();
      const { runGh } = makeGhFake(ghOpts);

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'finish',
        maxRetries: 1,
        escalateBuildFailure: async () => ({}),
        runGh,
      } as never);

      await conductor.run();

      // Build WAS re-dispatched (rewind proceeded unchanged).
      expect(calls.filter((s) => s === 'build').length).toBeGreaterThan(0);
      // The guard must never write the synthetic markers on a non-MERGED verdict.
      expect(await markerExists(dir, '.pipeline/finish-choice')).toBe(false);
    });

    it('negative: no pr_url recorded — zero gh invocations, rewind proceeds', async () => {
      await seedShipTail({ pr_url: undefined });
      const { runner, calls } = remediateToBuildRunner();
      const { runGh, calls: ghCalls } = makeGhFake({ state: 'MERGED' });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'finish',
        maxRetries: 1,
        escalateBuildFailure: async () => ({}),
        runGh,
      } as never);

      await conductor.run();

      expect(ghCalls).toHaveLength(0);
      expect(calls.filter((s) => s === 'build').length).toBeGreaterThan(0);
    });

    it('negative: interactive (daemon:false) run with pr_url set — zero gh calls, behavior identical to today', async () => {
      await seedShipTail();
      const { runner, calls } = remediateToBuildRunner();
      const { runGh, calls: ghCalls } = makeGhFake({ state: 'MERGED' });
      const onRecovery = vi.fn().mockResolvedValue('quit');

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'default',
        daemon: false,
        verifyArtifacts: true,
        fromStep: 'finish',
        maxRetries: 1,
        onRecovery,
        runGh,
      } as never);

      await conductor.run();

      expect(ghCalls).toHaveLength(0);
    });
  });

  // ── Remaining four routes, parameterized: MERGED short-circuits each ──────

  describe('the other four kickback routes', () => {
    async function seedToManualTest(): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'manual_test') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'L';
      state.feature_desc = 'feat';
      state.build_review = 'skipped';
      state.pr_url = PR_URL;
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );
    }

    function failingManualTestRunner(): { runner: StepRunner; calls: StepName[] } {
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n',
            );
          }
          return { success: true };
        }),
      };
      return { runner, calls };
    }

    it('manual_test route (~1786): MERGED → no build re-dispatch', async () => {
      await seedToManualTest();
      const { runner, calls } = failingManualTestRunner();
      const { runGh } = makeGhFake({ state: 'MERGED' });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'manual_test',
        runGh,
      } as never);

      await conductor.run();

      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
      expect(await markerExists(dir, '.pipeline/DONE')).toBe(true);
    });

    it('manual_test route (~1786): OPEN → build IS re-dispatched (pass-through proof)', async () => {
      await seedToManualTest();
      const { runner, calls } = failingManualTestRunner();
      const { runGh } = makeGhFake({ state: 'OPEN' });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'manual_test',
        runGh,
      } as never);

      await conductor.run();

      expect(calls.filter((s) => s === 'build').length).toBeGreaterThan(0);
    });

    async function seedToPrdAudit(): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'prd_audit') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'L';
      state.feature_desc = 'feat';
      state.build_review = 'skipped';
      state.pr_url = PR_URL;
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );
    }

    function perpetualImplGapRunner(): { runner: StepRunner; calls: StepName[] } {
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
            );
          } else if (step === 'prd_audit') {
            await writeFile(
              join(dir, '.pipeline/prd-audit.md'),
              '# PRD Audit\n\n' + AUDIT_HEADER + '| FR-2 | MISSING | impl-gap | x | no |\n',
            );
          }
          return { success: true };
        }),
      };
      return { runner, calls };
    }

    it('prd_audit route (~1975): MERGED → no build re-dispatch', async () => {
      await seedToPrdAudit();
      const { runner, calls } = perpetualImplGapRunner();
      const { runGh } = makeGhFake({ state: 'MERGED' });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
        runGh,
      } as never);

      await conductor.run();

      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
    });

    it('prd_audit route (~1975): OPEN → build IS re-dispatched (pass-through proof)', async () => {
      await seedToPrdAudit();
      const { runner, calls } = perpetualImplGapRunner();
      const { runGh } = makeGhFake({ state: 'OPEN' });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
        runGh,
      } as never);

      await conductor.run();

      expect(calls.filter((s) => s === 'build').length).toBeGreaterThan(0);
    });

    // Generic remediation route (~1917): the /remediate-driven prd_audit
    // dispatch whose disposition targets something OTHER than the fallback
    // classifier — same navigateBack(state, outcome.target, steps) call site
    // as the finish-remediation route, but reached from prd_audit.
    function remediateGenericRunner(): { runner: StepRunner; calls: StepName[] } {
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'remediate') {
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: 'FR-2',
                    disposition: 'build',
                    category: null,
                    rationale: 'read path wrong at x.ts:10',
                    tasks: [{ id: 'r1', title: 'fix x.ts:10 read path' }],
                  },
                ],
              }),
            );
          } else if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'prd_audit') {
            await writeFile(
              join(dir, '.pipeline/prd-audit.md'),
              '# PRD Audit\n\n' + AUDIT_HEADER + '| FR-2 | MISSING | impl-gap | x | no |\n',
            );
          } else if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
            );
          }
          return { success: true };
        }),
      };
      return { runner, calls };
    }

    it('generic remediation route (~1917): MERGED → no build re-dispatch', async () => {
      await seedToPrdAudit();
      const { runner, calls } = remediateGenericRunner();
      const { runGh } = makeGhFake({ state: 'MERGED' });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
        runGh,
      } as never);

      await conductor.run();

      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
    });

    it('generic remediation route (~1917): OPEN → build IS re-dispatched (pass-through proof)', async () => {
      await seedToPrdAudit();
      const { runner, calls } = remediateGenericRunner();
      const { runGh } = makeGhFake({ state: 'OPEN' });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
        runGh,
      } as never);

      await conductor.run();

      expect(calls.filter((s) => s === 'build').length).toBeGreaterThan(0);
    });

    async function seedToBuildReview(): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'build_review') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'L';
      state.feature_desc = 'feat';
      state.pr_url = PR_URL;
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );
    }

    function failingBuildReviewRunner(): { runner: StepRunner; calls: StepName[] } {
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'build_review') {
            await writeFile(
              join(dir, '.pipeline/build-review.json'),
              JSON.stringify({
                verdict: 'FAIL',
                reasons: ['tautological assertion at x.ts:10'],
                rubric: {},
              }),
            );
          } else if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
            );
          }
          return { success: true };
        }),
      };
      return { runner, calls };
    }

    it('build_review route (~1856): MERGED → no build re-dispatch', async () => {
      await seedToBuildReview();
      const { runner, calls } = failingBuildReviewRunner();
      const { runGh } = makeGhFake({ state: 'MERGED' });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'build_review',
        runGh,
      } as never);

      await conductor.run();

      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
    });

    it('build_review route (~1856): OPEN → build IS re-dispatched (pass-through proof)', async () => {
      await seedToBuildReview();
      const { runner, calls } = failingBuildReviewRunner();
      const { runGh } = makeGhFake({ state: 'OPEN' });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'build_review',
        runGh,
      } as never);

      await conductor.run();

      expect(calls.filter((s) => s === 'build').length).toBeGreaterThan(0);
    });
  });

  // ── TS-4: cost bound — exactly one guard query at kickback re-entry ───────

  describe('guard cost (TS-4, kickback half of the chain)', () => {
    it('one kickback over a non-MERGED PR performs exactly one guard query', async () => {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'manual_test') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'L';
      state.feature_desc = 'feat';
      state.build_review = 'skipped';
      state.pr_url = PR_URL;
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );

      const calls: StepName[] = [];
      let manualTestRunCount = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            manualTestRunCount++;
            // FAIL on first run, PASS on second run (to avoid multiple kickbacks)
            if (manualTestRunCount === 1) {
              await writeFile(
                join(dir, '.pipeline/manual-test-results.md'),
                '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n',
              );
            } else {
              await writeFile(
                join(dir, '.pipeline/manual-test-results.md'),
                '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n',
              );
            }
          }
          return { success: true };
        }),
      };
      const { runGh, calls: ghCalls } = makeGhFake({ state: 'OPEN' });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'manual_test',
        runGh,
      } as never);

      await conductor.run();

      // Exactly one guard query for this single kickback re-entry (the
      // companion rebase-entry query is exercised in
      // merged-pr-guard-rebase.test.ts; TS-4 is satisfied jointly).
      expect(ghCalls.length).toBe(1);
    });
  });
});
