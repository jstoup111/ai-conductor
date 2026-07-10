import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for `.docs/stories/daemon-mode-route-halt-user-input-
// required-through.md` (#459, ADR `adr-2026-07-10-daemon-stall-remediation.md`,
// TR-2/TR-3/TR-4/TR-5/TR-6).
//
// Per §3a of writing-system-tests, per-call-site / single-helper behavior
// (TR-1's capture-before-clear ordering, empty/whitespace/ENOENT marker
// handling, hostile-character HALT robustness, and TR-7's skill-doc contract)
// is unit-level and belongs to `test/engine/task-progress.test.ts` and
// `test/engine/conductor.test.ts`, written task-by-task during `/pipeline`
// per plan Tasks 1-3/10/12/13-15 — it is NOT duplicated here.
//
// This file covers only the MULTI-STEP flows the story's Done-When sections
// name across 2+ real dispatches of the run loop's own entry point
// (`Conductor.run()` with a fake `StepRunner`, exactly the existing
// `conductor.test.ts` fake-step-runner + tmp-repo pattern) — the flows that
// cannot be proven by a single helper's unit test because the bug class this
// feature targets lives in the WIRING between the stall branch, `/remediate`
// dispatch, and the retry loop, not in any one function's return value:
//
//   A. answerable stall → /remediate dispatched → resumes the SAME build
//      retry loop with the answer, no HALT (TR-2 happy, TR-3 happy)
//   B. remediation misroutes the stall to a non-build step → fail-closed HALT
//      carrying the question (TR-3 negative)
//   C. remediation returns a human-scoped halt disposition → HALT carries the
//      question first, then the disposition detail (TR-4 happy)
//   D. every degraded remediation exit (throw / malformed JSON / stale file /
//      all-dropped dispositions) still HALTs with the question, never the
//      generic retries-exhausted message (TR-5)
//   E. a third stall in one run has no budget left → immediate fail-safe HALT
//      with the third question, zero third dispatch (TR-6 happy)
//   F. a build-stall-exhausted budget carries over and blocks a LATER
//      prd_audit remediation attempt — the counter is genuinely shared, not
//      per-trigger (TR-6 negative)
//
// Pre-implementation, the daemon build-stall branch does not dispatch
// /remediate at all (it only opens an interactive REPL, skipped in auto
// mode) — every test below is RED because `runner.run` is never called with
// 'remediate' from the build-stall branch, not because of an import error.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_KICKBACKS_PER_GATE = 2;
const AUDIT_HEADER = '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n';
const QUESTION_1 = 'Need user decision: which auth provider — Auth0 or Cognito?';
const QUESTION_2 = 'Need user decision: which retry backoff — linear or exponential?';
const QUESTION_3 = 'Need user decision: which cache TTL — 60s or 300s?';

describe('daemon stall remediation — cross-module acceptance flows', () => {
  async function seedRepo(dir: string, statePath: string): Promise<void> {
    // Every step BEFORE `build` seeded done so the loop starts at the build
    // gate directly (mirrors the existing `seedToPrdAudit` convention).
    const res = await readState(statePath);
    const state = (res.ok ? res.value : {}) as Record<string, unknown>;
    for (const s of ALL_STEPS) {
      if (s.name === 'build') break;
      state[s.name] = 'done';
    }
    state.complexity_tier = 'M';
    state.feature_desc = 'daemon-mode-route-halt-user-input-required-through';
    state.build_review = 'skipped';
    await writeState(statePath, state as unknown as ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    // Single plan file (Task 1..5 headings) so `resolveFeaturePlanPath`
    // resolves it unambiguously (the singleton-file shortcut) and the daemon
    // auto-park empty-plan guard never fires — this suite is about the stall
    // branch, not the auto-park layer.
    const planLines: string[] = ['# Plan', ''];
    for (let i = 1; i <= 5; i++) planLines.push(`### Task ${i}: Step ${i}`, '');
    await writeFile(
      join(dir, '.docs/plans/daemon-mode-route-halt-user-input-required-through.md'),
      planLines.join('\n'),
    );
  }

  // Writes task-status.json AND the evidence sidecar stamp for every
  // completed id — under the engine-owned contract (ADR H6) a 'completed' row
  // with no evidence stamp is demoted back to 'pending' on every gate
  // evaluation, so "progress" here must be evidence-backed (mirrors the
  // existing `conductor.test.ts` build-stall-circuit-breaker convention).
  async function writeTaskStatus(dir: string, completed: number, total: number): Promise<void> {
    const tasks: Array<{ id: number; status: string }> = [];
    const stamps: Record<string, { sha: string; form: string }> = {};
    for (let i = 1; i <= total; i++) {
      const done = i <= completed;
      tasks.push({ id: i, status: done ? 'completed' : 'pending' });
      if (done) stamps[String(i)] = { sha: `${'0'.repeat(38)}${String(i).padStart(2, '0')}`, form: 'trailer' };
    }
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
    await writeFile(
      join(dir, '.pipeline/task-evidence.json'),
      JSON.stringify({ evidenceStamps: stamps, noEvidenceAttempts: 0, migrationGrandfather: [] }),
    );
  }

  async function writeHaltMarker(dir: string, question: string): Promise<void> {
    await writeFile(join(dir, '.pipeline/halt-user-input-required'), question);
  }

  async function readHaltFile(dir: string): Promise<string | null> {
    try {
      return await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    } catch {
      return null;
    }
  }

  function makeConductor(
    dir: string,
    statePath: string,
    runner: StepRunner,
    events: ConductorEventEmitter,
  ): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
    });
  }

  // ── A. answerable stall resumes the SAME retry loop without burning a retry ──
  it('dispatches /remediate on a daemon build stall and resumes in-loop with the answer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stall-resume-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedRepo(dir, statePath);

      const calls: Array<{ step: StepName; retryReason?: string }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, opts?: { retryReason?: string }) => {
          calls.push({ step, retryReason: opts?.retryReason });
          if (step === 'build') {
            const buildCalls = calls.filter((c) => c.step === 'build').length;
            if (buildCalls === 1) {
              // First attempt: agent can't decide, stalls with a question.
              await writeTaskStatus(dir, 2, 5);
              await writeHaltMarker(dir, QUESTION_1);
            } else {
              // Resumed attempt: the answer let the agent finish the work.
              await writeTaskStatus(dir, 5, 5);
            }
          } else if (step === 'remediate') {
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: 'stall:auth-provider',
                    disposition: 'build',
                    category: null,
                    rationale: 'Use Auth0 — matches the existing SSO integration.',
                    tasks: [],
                  },
                ],
              }),
            );
          } else if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
            ).catch(async () => {
              await mkdir(join(dir, '.docs'), { recursive: true });
              await writeFile(
                join(dir, '.pipeline/manual-test-results.md'),
                '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
              );
            });
          }
          return { success: true } as StepRunResult;
        }),
      };

      const kickbacks: unknown[] = [];
      const events = new ConductorEventEmitter();
      events.on('kickback', (e) => kickbacks.push(e));

      const conductor = makeConductor(dir, statePath, runner, events);
      await conductor.run();

      const buildCalls = calls.filter((c) => c.step === 'build');
      const remediateCalls = calls.filter((c) => c.step === 'remediate');

      // Exactly one stall, one remediation dispatch, one resumed build — no
      // interactive REPL (daemon/auto mode), no HALT.
      expect(remediateCalls).toHaveLength(1);
      expect(buildCalls).toHaveLength(2);
      expect(await readHaltFile(dir)).toBeNull();

      // The /remediate dispatch names the stall question.
      expect(remediateCalls[0].retryReason).toContain(QUESTION_1);

      // The resumed build attempt receives the answer, not a generic retry hint.
      expect(buildCalls[1].retryReason).toContain('Use Auth0');

      // A kickback-class event recorded the round (TR-2 happy).
      expect(kickbacks.length).toBeGreaterThan(0);

      // Run completed successfully (no halted event).
      const finalState = await readState(statePath);
      expect(finalState.ok && finalState.value.build).toBe('done');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── B. remediation misroutes the stall answer → fail-closed HALT ──
  it('fail-closes to a question-carrying HALT when remediation routes the stall to a non-build step', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stall-misroute-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedRepo(dir, statePath);

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            await writeTaskStatus(dir, 2, 5);
            await writeHaltMarker(dir, QUESTION_1);
          } else if (step === 'remediate') {
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: 'stall:auth-provider',
                    disposition: 'plan',
                    category: null,
                    rationale: 'Needs a re-plan, not a build answer.',
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
      const halt = await readHaltFile(dir);
      expect(halt).not.toBeNull();
      expect(halt).toContain(QUESTION_1);

      // No navigateBack to `plan` from inside the build loop — build was
      // never re-dispatched with a resume hint.
      const runnerMock = vi.mocked(runner.run);
      expect(runnerMock.mock.calls.filter((c) => c[0] === 'build')).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── C. human-scoped halt disposition → HALT carries the question, then detail ──
  it('writes the question first, then the disposition detail, when remediation halts the stall', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stall-halt-disposition-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedRepo(dir, statePath);

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            await writeTaskStatus(dir, 2, 5);
            await writeHaltMarker(dir, QUESTION_1);
          } else if (step === 'remediate') {
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: 'stall:auth-provider',
                    disposition: 'halt',
                    category: 'product-scope',
                    rationale: 'Choice of auth provider is a product decision.',
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
      const halt = await readHaltFile(dir);
      expect(halt).not.toBeNull();
      const nonEmptyLines = (halt as string).split('\n').filter((l) => l.trim().length > 0);
      expect(nonEmptyLines[0]).toBe(QUESTION_1);
      expect(halt).toContain('product-scope');
      expect(halt).toContain('Choice of auth provider is a product decision.');
      // Not the generic retries-exhausted writer.
      expect(halt).not.toMatch(/retries exhausted/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── D. every degraded remediation exit still HALTs with the question ──
  const degradedCases: Array<{
    name: string;
    setupRemediate: (dir: string) => Promise<void> | void;
    remediateThrows?: boolean;
  }> = [
    {
      name: 'the /remediate dispatch throws',
      setupRemediate: () => {
        /* handled via remediateThrows */
      },
      remediateThrows: true,
    },
    {
      name: '.pipeline/remediation.json is malformed JSON',
      setupRemediate: async (dir: string) => {
        await writeFile(join(dir, '.pipeline/remediation.json'), '{ not valid json');
      },
    },
    {
      name: 'every disposition is dropped by engine validation (halt without category)',
      setupRemediate: async (dir: string) => {
        await writeFile(
          join(dir, '.pipeline/remediation.json'),
          JSON.stringify({
            dispositions: [{ id: 'stall:x', disposition: 'halt', rationale: 'no category' }],
          }),
        );
      },
    },
  ];

  for (const c of degradedCases) {
    it(`HALTs carrying the question when ${c.name}`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'stall-degraded-'));
      const statePath = join(dir, 'conduct-state.json');
      try {
        await seedRepo(dir, statePath);

        const runner: StepRunner = {
          run: vi.fn(async (step: StepName) => {
            if (step === 'build') {
              await writeTaskStatus(dir, 2, 5);
              await writeHaltMarker(dir, QUESTION_1);
            } else if (step === 'remediate') {
              if (c.remediateThrows) {
                throw new Error('remediate planner crashed');
              }
              await c.setupRemediate(dir);
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
        const halt = await readHaltFile(dir);
        expect(halt).not.toBeNull();
        expect(halt).toContain(QUESTION_1);
        expect(halt).not.toMatch(/^\s*$/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  it('HALTs carrying the question when .pipeline/remediation.json predates this session (stale)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stall-stale-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedRepo(dir, statePath);
      // Written BEFORE conductor.run() stamps session_started_at — this file
      // is stale under `fileIsFreshSinceSession` the moment the run starts.
      await writeFile(
        join(dir, '.pipeline/remediation.json'),
        JSON.stringify({
          dispositions: [
            { id: 'stall:x', disposition: 'build', category: null, rationale: 'stale answer', tasks: [] },
          ],
        }),
      );

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            await writeTaskStatus(dir, 2, 5);
            await writeHaltMarker(dir, QUESTION_1);
          }
          // 'remediate' step runs but does NOT rewrite remediation.json —
          // the pre-existing stale file is what the engine must reject.
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
      const halt = await readHaltFile(dir);
      expect(halt).not.toBeNull();
      expect(halt).toContain(QUESTION_1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── E. third stall in one run has no budget left ──
  it('exhausts the shared remediation budget on the third stall and fail-safe HALTs with the third question', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stall-budget-exhausted-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedRepo(dir, statePath);

      const questions = [QUESTION_1, QUESTION_2, QUESTION_3];
      let stallIndex = 0; // which of the 3 stalls we're currently on (0-based)
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            if (stallIndex < questions.length) {
              await writeTaskStatus(dir, 2, 5);
              await writeHaltMarker(dir, questions[stallIndex]);
              stallIndex++;
            } else {
              await writeTaskStatus(dir, 5, 5);
            }
          } else if (step === 'remediate') {
            // Answer every dispatched round (rounds 1 and 2 only — round 3 is
            // never dispatched because the budget is exhausted).
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: `stall:round-${stallIndex}`,
                    disposition: 'build',
                    category: null,
                    rationale: `answered round ${stallIndex}`,
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

      const runnerMock = vi.mocked(runner.run);
      const remediateCalls = runnerMock.mock.calls.filter((c) => c[0] === 'remediate');
      // Cap is 2 — only the first two stalls got a remediation round.
      expect(remediateCalls).toHaveLength(MAX_KICKBACKS_PER_GATE);

      expect(halted).toBe(true);
      const halt = await readHaltFile(dir);
      expect(halt).not.toBeNull();
      expect(halt).toContain(QUESTION_3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ── F. a build-stall-exhausted budget blocks a LATER prd_audit remediation attempt ──
  it('shares the remediation budget across gates — a budget exhausted by build stalls blocks a later prd_audit remediation attempt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stall-shared-budget-'));
    const statePath = join(dir, 'conduct-state.json');
    try {
      await seedRepo(dir, statePath);

      const questions = [QUESTION_1, QUESTION_2];
      let stallIndex = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            if (stallIndex < questions.length) {
              await writeTaskStatus(dir, 2, 5);
              await writeHaltMarker(dir, questions[stallIndex]);
              stallIndex++;
            } else {
              await writeTaskStatus(dir, 5, 5);
            }
          } else if (step === 'remediate') {
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: `stall:round-${stallIndex}`,
                    disposition: 'build',
                    category: null,
                    rationale: `answered round ${stallIndex}`,
                    tasks: [],
                  },
                ],
              }),
            );
          } else if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
            );
          } else if (step === 'prd_audit') {
            // Every audit reports the same unresolved gap — if a remediation
            // round were available, the engine would dispatch /remediate for
            // it. It must NOT, because both rounds were already spent on the
            // build stalls above.
            await writeFile(
              join(dir, '.pipeline/prd-audit.md'),
              '# PRD Audit\n\n' + AUDIT_HEADER + '| FR-1 | MISSING | impl-gap | x.ts:1 | no |\n',
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      const events = new ConductorEventEmitter();
      const conductor = makeConductor(dir, statePath, runner, events);
      await conductor.run();

      const runnerMock = vi.mocked(runner.run);
      const remediateCalls = runnerMock.mock.calls.filter((c) => c[0] === 'remediate');
      // Exactly 2 remediation dispatches total (both from the build stalls) —
      // the prd_audit gate never got a third round, proving the counter is
      // shared across trigger types rather than reset per-gate.
      expect(remediateCalls).toHaveLength(MAX_KICKBACKS_PER_GATE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
