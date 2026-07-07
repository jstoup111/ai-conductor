import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('../../src/engine/self-host/operator-credentials.js', () => ({
  readOperatorCredentialsState: vi.fn().mockResolvedValue('fresh'),
  waitForCredentialsChange: vi.fn(),
}));
vi.mock('../../src/engine/self-host/sandbox-build-env.js', () => ({
  refreshSandboxCredentials: vi.fn(),
  provisionSandboxBuildEnv: vi.fn(),
  realSandboxFs: {},
  SandboxProvisionError: class SandboxProvisionError extends Error {},
}));
import { execa } from 'execa';
import type { ConductState } from '../../src/types/index.js';
import type { StepName, RecoveryOption } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import {
  Conductor,
  getNavigableSteps,
  navigateBack,
  filterUnapprovedArtifacts,
  recordApprovals,
  approvalKey,
  buildRetryHint,
} from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { readState, writeState } from '../../src/engine/state.js';
import { createHash } from 'crypto';

function createMockStepRunner(result: StepRunResult = { success: true }): StepRunner {
  return {
    run: vi.fn().mockResolvedValue(result),
  };
}

// Valid RED execution-evidence for the acceptance_specs gate: the feature's own
// specs ran and failed (not skipped/errored). Fixtures that pre-satisfy
// acceptance_specs to reach a later step must seed this alongside the spec file.
const RED_EVIDENCE_JSON = JSON.stringify({
  command: 'bundle exec rspec spec/acceptance',
  targetSpecs: ['spec/acceptance/feature_spec.rb'],
  executed: 1,
  passed: 0,
  failed: 1,
  skipped: 0,
  errors: 0,
});

describe('engine/conductor', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-test-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('track resolution from the committed marker (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location, interactive)', () => {
    it('technical marker → prd is skipped even when state.track is unset', async () => {
      // /explore wrote the marker; state has no `track` (interactive path).
      await mkdir(join(dir, '.docs', 'track'), { recursive: true });
      await writeFile(join(dir, '.docs', 'track', 'feat.md'), '# Track\n\nTrack: technical\n');
      await writeState(statePath, {
        worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
        complexity_tier: 'M',
      } as ConductState);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = { run: async (s) => { stepsRun.push(s); return { success: true }; } };
      const conductor = new Conductor({
        stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir, fromStep: 'prd',
      });
      await conductor.run();

      expect(stepsRun).not.toContain('prd');
      const r = await readState(statePath);
      if (r.ok) {
        expect(r.value.prd).toBe('skipped');
        expect(r.value.track).toBe('technical'); // resolved from marker + persisted
      }
    });

    it('product marker → prd runs', async () => {
      await mkdir(join(dir, '.docs', 'track'), { recursive: true });
      await writeFile(join(dir, '.docs', 'track', 'feat.md'), '# Track\n\nTrack: product\n');
      await writeState(statePath, {
        worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
        complexity_tier: 'M',
      } as ConductState);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = { run: async (s) => { stepsRun.push(s); return { success: true }; } };
      const conductor = new Conductor({
        stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir, fromStep: 'prd',
      });
      await conductor.run();

      expect(stepsRun).toContain('prd');
    });
  });

  it('starts at step index 0 for new feature', async () => {
    const runner = createMockStepRunner();
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // `complexity`, `worktree`, and `rebase` are engine-managed
    // (runComplexityStep / runWorktreeStep / runRebaseStep, not runner.run), so
    // the runner is called for every step EXCEPT those, and the first runner
    // dispatch is `memory`.
    const dispatchedSteps = ALL_STEPS.filter(
      (s) => s.name !== 'complexity' && s.name !== 'worktree' && s.name !== 'rebase',
    ).length;
    expect(runner.run).toHaveBeenCalledTimes(dispatchedSteps);
    expect((runner.run as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('memory');
  });

  it('marks step in_progress before running', async () => {
    const statusesDuringRun: Record<string, string | undefined> = {};
    const runner: StepRunner = {
      run: async (step: StepName, state: ConductState) => {
        // Capture the state at the time the runner is called
        const stateResult = await readState(statePath);
        if (stateResult.ok) {
          statusesDuringRun[step] = stateResult.value[step] as string | undefined;
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // Every runner-dispatched step should have been in_progress when called
    // (worktree is engine-managed, so check memory as the first dispatched step).
    expect(statusesDuringRun['memory']).toBe('in_progress');
    expect(statusesDuringRun['explore']).toBe('in_progress');
    expect(statusesDuringRun['finish']).toBe('in_progress');
  });

  it('marks step done after success', async () => {
    const runner = createMockStepRunner();
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // After run completes, all steps should be 'done' in state file
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['worktree']).toBe('done');
      expect(result.value['explore']).toBe('done');
      expect(result.value['finish']).toBe('done');
    }
  });

  it('advances to next step after success', async () => {
    const callOrder: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        callOrder.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // Steps should be called in exact ALL_STEPS order, minus the engine-managed
    // steps (complexity / worktree / rebase, not dispatched to runner.run).
    const expectedOrder = ALL_STEPS.filter(
      (s) => s.name !== 'complexity' && s.name !== 'worktree' && s.name !== 'rebase',
    ).map((s) => s.name);
    expect(callOrder).toEqual(expectedOrder);
  });

  it('sets feature_status=complete when all steps done', async () => {
    const runner = createMockStepRunner();
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feature_status).toBe('complete');
    }
  });

  it('emits step_started and step_completed events', async () => {
    const runner = createMockStepRunner();
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    const emitted: Array<{ type: string; step: string }> = [];
    events.on('step_started', (e) => {
      if (e.type === 'step_started') emitted.push({ type: e.type, step: e.step });
    });
    events.on('step_completed', (e) => {
      if (e.type === 'step_completed') emitted.push({ type: e.type, step: e.step });
    });

    await conductor.run();

    // Should have started + completed events for every step (complexity
    // dispatches via the engine path but still emits the same event pair).
    expect(emitted.length).toBe(ALL_STEPS.length * 2);

    // Check first step events are in correct order
    expect(emitted[0]).toEqual({ type: 'step_started', step: 'worktree' });
    expect(emitted[1]).toEqual({ type: 'step_completed', step: 'worktree' });

    // Check last step
    const lastIdx = (ALL_STEPS.length - 1) * 2;
    expect(emitted[lastIdx]).toEqual({ type: 'step_started', step: 'finish' });
    expect(emitted[lastIdx + 1]).toEqual({ type: 'step_completed', step: 'finish' });
  });

  it('enters recovery flow when step returns failure', async () => {
    // explore (3rd step) permanently fails; maxRetries=0 so the first
    // miss escalates immediately — the retry budget isn't the subject here.
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'explore') return { success: false, output: 'explore failed' };
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      maxRetries: 1,
    });

    const failedEvents: Array<{ step: string; error: string; retryCount: number }> = [];
    events.on('step_failed', (e) => {
      if (e.type === 'step_failed') failedEvents.push({ step: e.step, error: e.error, retryCount: e.retryCount });
    });

    await conductor.run();

    // step_failed should have been emitted
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].step).toBe('explore');

    // Should NOT have advanced past the failed step. worktree is engine-managed
    // (not runner-dispatched), so the runner saw memory + explore = 2 calls.
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it('does NOT advance to next step on failure', async () => {
    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        if (step === 'explore') return { success: false, output: 'error' };
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      maxRetries: 1,
    });

    await conductor.run();

    // worktree is engine-managed, so the runner sees memory → explore, then stops.
    expect(stepsRun).toEqual(['memory', 'explore']);
    // complexity (the step after explore) should NOT have been called
    expect(stepsRun).not.toContain('complexity');
  });

  it('auto mode never prompts: gating-step failure stops without recovery', async () => {
    // `stories` is gating; it permanently fails. In auto mode the conductor must
    // NOT open the recovery menu / a REPL — it stops for a human to inspect.
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const runner: StepRunner = {
      run: async (step: StepName) =>
        step === 'stories' ? { success: false, output: 'boom' } : { success: true },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      maxRetries: 1,
      onRecovery,
    });

    await conductor.run();

    expect(onRecovery).not.toHaveBeenCalled();
    const result = await readState(statePath);
    expect(result.ok && result.value.stories).toBe('failed');
    expect(result.ok && result.value.feature_status).toBeUndefined();
  });

  it('auto mode writes a HALT marker on a gating-step failure (daemon-classifiable)', async () => {
    // A supervising daemon reads .pipeline/DONE / .pipeline/HALT to classify the
    // outcome. Before this, an auto hard-failure returned with NO marker, so the
    // daemon reported the opaque "loop ended without DONE or HALT marker" error
    // and couldn't tell halt (retryable) from a crash. Now it writes HALT.
    const runner: StepRunner = {
      run: async (step: StepName) =>
        step === 'stories' ? { success: false, output: 'boom' } : { success: true },
    };
    let halted = false;
    events.on('loop_halt', () => {
      halted = true;
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      maxRetries: 1,
    });

    await conductor.run();

    expect(halted).toBe(true); // loop_halt event emitted
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toMatch(/stories/);
    // It HALTed, so it did not also mark the feature complete.
    const result = await readState(statePath);
    expect(result.ok && result.value.feature_status).toBeUndefined();
  });

  describe('fresh session per step (unconditional)', () => {
    // A runner that logs every session reset and every dispatch, so we can
    // assert the interleaving (reset-then-run for every executed step).
    function trackingRunner(): { runner: StepRunner; log: string[] } {
      const log: string[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          log.push(`run:${step}`);
          return { success: true };
        },
        resetSession: async () => {
          log.push('reset');
        },
      };
      return { runner, log };
    }

    it('resets the session before every dispatched step', async () => {
      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
      });

      await conductor.run();

      // Every runner dispatch is immediately preceded by a session reset, so no
      // context is carried across the loop. (Engine-managed steps add extra
      // resets with no dispatch — harmless; we only assert each run's predecessor.)
      const runIdxs = log
        .map((e, i) => (e.startsWith('run:') ? i : -1))
        .filter((i) => i >= 0);
      expect(runIdxs.length).toBeGreaterThan(0);
      for (const i of runIdxs) expect(log[i - 1]).toBe('reset');
    });

    it('resets in interactive/default mode too — fresh-per-step is not opt-in', async () => {
      // Regression for ai-conductor#325: the reset used to be gated behind a
      // daemon-only freshContextPerStep flag, so interactive `/conduct` (and
      // the daemon front half) shared one persistent session across steps.
      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
      });

      await conductor.run();

      expect(log.includes('reset')).toBe(true);
      const runIdxs = log
        .map((e, i) => (e.startsWith('run:') ? i : -1))
        .filter((i) => i >= 0);
      for (const i of runIdxs) expect(log[i - 1]).toBe('reset');
    });

    it('a step retry resumes the same session — no reset between attempts', async () => {
      // Load-bearing invariant: the reset happens once BEFORE the retry loop;
      // a step's own retries resume the session it started with.
      const log: string[] = [];
      let storiesAttempts = 0;
      const runner: StepRunner = {
        run: async (step: StepName) => {
          log.push(`run:${step}`);
          if (step === 'stories' && storiesAttempts++ === 0) {
            return { success: false, error: 'flaky first attempt' };
          }
          return { success: true };
        },
        resetSession: async () => {
          log.push('reset');
        },
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        mode: 'auto',
        maxRetries: 2,
      });

      await conductor.run();

      const first = log.indexOf('run:stories');
      const second = log.indexOf('run:stories', first + 1);
      expect(first).toBeGreaterThan(0); // ran, and something precedes it
      expect(second).toBeGreaterThan(first); // retried
      expect(log[first - 1]).toBe('reset'); // fresh session for the step
      expect(log.slice(first + 1, second)).not.toContain('reset'); // retry resumes
    });

    it('resets before the FIRST executed step — the daemon worktree-reuse fix', async () => {
      // Mirror the daemon: front half pre-seeded done, loop starts at
      // acceptance_specs. The reset BEFORE that first step is what discards a
      // stale session inherited from a reused worktree.
      const seed = (await readState(statePath)).ok
        ? (await readState(statePath)).value
        : ({} as ConductState);
      for (const s of ALL_STEPS) {
        if (s.name === 'acceptance_specs') break;
        (seed as Record<string, unknown>)[s.name] = 'done';
      }
      await writeState(statePath, seed);

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'acceptance_specs',
      });

      await conductor.run();

      expect(log[0]).toBe('reset'); // first action is a reset, before any dispatch
      expect(log.find((e) => e.startsWith('run:'))).toBe('run:acceptance_specs');
    });

    it('daemon resume: a FRESH feature (DECIDE pre-seeded done) starts at acceptance_specs', async () => {
      // The daemon stamps DECIDE done and uses `resume: true` (not a hardcoded
      // fromStep). With only DECIDE done, findResumeIndex returns the first
      // pending step — acceptance_specs — so a fresh feature still begins BUILD.
      const seed = (await readState(statePath)).ok
        ? (await readState(statePath)).value
        : ({} as ConductState);
      (seed as Record<string, unknown>).complexity_tier = 'M';
      for (const s of ALL_STEPS) {
        if (s.name === 'acceptance_specs') break;
        (seed as Record<string, unknown>)[s.name] = 'done';
      }
      await writeState(statePath, seed);

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        resume: true,
      });

      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:acceptance_specs');
    });

    it('daemon resume: a feature with BUILD/SHIP progress resumes at its next step, not acceptance_specs', async () => {
      // Regression: the daemon used `fromStep: 'acceptance_specs'`, which re-ran
      // acceptance_specs on EVERY re-dispatch even when the feature was far past
      // BUILD. With `resume: true`, a re-dispatch picks up at the real next
      // pending step (here prd_audit), never re-entering at acceptance_specs.
      const seed = (await readState(statePath)).ok
        ? (await readState(statePath)).value
        : ({} as ConductState);
      (seed as Record<string, unknown>).complexity_tier = 'M';
      for (const s of ALL_STEPS) {
        if (s.name === 'prd_audit') break;
        (seed as Record<string, unknown>)[s.name] = 'done';
      }
      await writeState(statePath, seed);

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        resume: true,
      });

      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:prd_audit');
      expect(log).not.toContain('run:acceptance_specs');
    });
  });

  it('an unexpected throw inside the loop HALTs (state flushed) instead of crashing', async () => {
    // A throw in the loop (e.g. a verdict-I/O failure in the SHIP tail) must not
    // escape run() with no marker — that produced the daemon's opaque "loop
    // ended without DONE or HALT" error and left state with SHIP entries
    // missing. It must become a recoverable HALT with state flushed.
    const runner: StepRunner = {
      run: async (step: StepName) => {
        if (step === 'stories') throw new Error('kaboom in stories');
        return { success: true };
      },
    };
    let halted = false;
    events.on('loop_halt', () => {
      halted = true;
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
    });

    // Must NOT throw — the loop converts the error into a recoverable HALT.
    await expect(conductor.run()).resolves.toBeUndefined();

    expect(halted).toBe(true);
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toMatch(/kaboom in stories|conductor error/);

    // State flushed: a step before the throw is recorded, feature NOT complete.
    const result = await readState(statePath);
    expect(result.ok && result.value.explore).toBe('done');
    expect(result.ok && result.value.feature_status).toBeUndefined();
  });

  describe('daemon prd-audit gap-aware halting', () => {
    const AUDIT_HEADER =
      '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n';

    // Seed every step before prd_audit as done so the loop can start at the
    // SHIP tail; write the build + manual-test fixtures the predicates need.
    async function seedToPrdAudit(): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'prd_audit') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'L';
      state.feature_desc = 'feat';
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );
    }

    // Runner that re-satisfies build + manual_test on re-run and writes the
    // given prd-audit table body every time prd_audit runs.
    function shipRunner(auditBody: string): { runner: StepRunner; calls: StepName[] } {
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'build') {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
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
          } else if (step === 'prd_audit') {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(
              join(dir, '.pipeline/prd-audit.md'),
              '# PRD Audit\n\n' + AUDIT_HEADER + auditBody,
            );
          }
          return { success: true };
        }),
      };
      return { runner, calls };
    }

    // Like shipRunner, but also writes .pipeline/remediation.json when the
    // `remediate` step runs, so the conductor's /remediate routing engages.
    function remediateRunner(
      auditBody: string,
      plan: unknown,
    ): { runner: StepRunner; calls: StepName[] } {
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'build' || step === 'prd_audit') {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            if (step === 'build') {
              await writeFile(
                join(dir, '.pipeline/task-status.json'),
                JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
              );
            } else {
              await writeFile(
                join(dir, '.pipeline/prd-audit.md'),
                '# PRD Audit\n\n' + AUDIT_HEADER + auditBody,
              );
            }
          } else if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
            );
          } else if (step === 'remediate') {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(join(dir, '.pipeline/remediation.json'), JSON.stringify(plan));
          }
          return { success: true };
        }),
      };
      return { runner, calls };
    }

    it('self-heals an impl-gap audit back to BUILD, then HALTs at the cap', async () => {
      await seedToPrdAudit();
      // Perpetual impl-gap: every audit reports the same un-closed impl-gap, so
      // the daemon routes back to BUILD until the self-heal cap, then HALTs.
      const { runner, calls } = shipRunner('| FR-2 | MISSING | impl-gap | x | no |\n');
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
      });

      await conductor.run();

      // Routed back to BUILD (kickback prd_audit→build) and rebuilt.
      expect(kickbacks.filter((k) => k.from === 'prd_audit' && k.to === 'build').length).toBe(2);
      expect(calls.filter((s) => s === 'build').length).toBe(2);
      // Exhausted the self-heal budget → HALT (not an opaque crash).
      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/impl-gap unresolved after 2 build attempt/);
    });

    it('hands the BUILD agent the failing FRs (kickback retryReason) — self-heal is not blind', async () => {
      await seedToPrdAudit();
      // Same perpetual impl-gap; we assert the handoff CONTENT, not just that a
      // kickback happened. Each BUILD dispatch driven by the prd_audit kickback
      // must carry the gap (the FR id + a pointer to .pipeline/prd-audit.md) in
      // its retryReason — the bug was that BUILD was dispatched blind, saw a
      // complete task list, and changed nothing (a no-op self-heal loop).
      const { runner } = shipRunner('| FR-2 | MISSING | impl-gap | x | no |\n');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
      });

      await conductor.run();

      const buildReasons = vi
        .mocked(runner.run)
        .mock.calls.filter((c) => c[0] === 'build')
        .map((c) => (c[2] as { retryReason?: string } | undefined)?.retryReason ?? '');
      expect(buildReasons.length).toBeGreaterThan(0);
      for (const r of buildReasons) {
        expect(r).toContain('FR-2 (impl-gap)');
        expect(r).toContain('.pipeline/prd-audit.md');
      }
    });

    it('HALTs immediately on a product/plan gap (intended-drift) without rebuilding', async () => {
      await seedToPrdAudit();
      const { runner, calls } = shipRunner(
        '| FR-3 | DIVERGED | intended-drift | baz.ts:88 | no |\n',
      );
      const kickbacks: string[] = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push(e.to);
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
      });

      await conductor.run();

      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/product\/plan gap needs human DECIDE/);
      expect(halt).toMatch(/FR-3 \(intended-drift\)/);
      // No self-heal: never kicked back to build, never rebuilt.
      expect(kickbacks).toHaveLength(0);
      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
    });

    it('/remediate: routes an autonomous gap to its target step with the gap in the hint', async () => {
      await seedToPrdAudit();
      const { runner } = remediateRunner('| FR-2 | MISSING | impl-gap | x | no |\n', {
        dispositions: [
          {
            id: 'FR-2',
            disposition: 'build',
            category: null,
            rationale: 'read path wrong at x.ts:10',
            tasks: [{ id: 'r1', title: 'fix x.ts:10 read path' }],
          },
        ],
      });
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
      });

      await conductor.run();

      // The planner ran and routed prd_audit → build (the disposition's target).
      expect(kickbacks.some((k) => k.from === 'prd_audit' && k.to === 'build')).toBe(true);
      // BUILD received the gap (FR id + concrete task) in its retryReason.
      const buildReasons = vi
        .mocked(runner.run)
        .mock.calls.filter((c) => c[0] === 'build')
        .map((c) => (c[2] as { retryReason?: string } | undefined)?.retryReason ?? '');
      expect(
        buildReasons.some((r) => r.includes('FR-2') && r.includes('fix x.ts:10 read path')),
      ).toBe(true);
    });

    it('/remediate: HALTs for an architectural-clarity gap (human DECIDE) without rebuilding', async () => {
      await seedToPrdAudit();
      const { runner, calls } = remediateRunner(
        '| FR-3 | DIVERGED | intended-drift | y | no |\n',
        {
          dispositions: [
            {
              id: 'FR-3',
              disposition: 'halt',
              category: 'architectural-clarity',
              rationale: 'ambiguous aggregate boundary',
              tasks: [],
            },
          ],
        },
      );
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
      });

      await conductor.run();

      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/needs human DECIDE/);
      expect(halt).toMatch(/FR-3 \(architectural-clarity/);
      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
    });

    it('does NOT auto-route in interactive (non-daemon) mode — uses the recovery menu', async () => {
      await seedToPrdAudit();
      const { runner, calls } = shipRunner('| FR-2 | MISSING | impl-gap | x | no |\n');
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      const onRecovery = vi
        .fn<[StepName, boolean], Promise<RecoveryOption>>()
        .mockResolvedValue('quit');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'default', // interactive — a human is present
        daemon: false,
        verifyArtifacts: true,
        fromStep: 'prd_audit',
        maxRetries: 1,
        onRecovery,
      });

      await conductor.run();

      // Human-driven path: recovery menu fires for prd_audit; no daemon HALT,
      // no automatic kickback to build.
      expect(onRecovery).toHaveBeenCalledWith('prd_audit', true, expect.anything());
      expect(halted).toBe(false);
      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
    });
  });

  describe('daemon manual-test FAIL routing (#367)', () => {
    const FAIL_RESULTS = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n';

    // Seed every step before manual_test as done so the loop enters at the
    // SHIP tail's first gate; build's own gate needs task-status.json.
    async function seedToManualTest(): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'manual_test') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'L';
      state.feature_desc = 'feat';
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
      );
    }

    // Runner where manual_test always records FAIL rows; build re-satisfies
    // its own gate. Perpetual bug → exercises kickback + cap behavior.
    function failingManualTestRunner(): { runner: StepRunner; calls: StepName[] } {
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'build') {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'manual_test') {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(join(dir, '.pipeline/manual-test-results.md'), FAIL_RESULTS);
          }
          return { success: true };
        }),
      };
      return { runner, calls };
    }

    it('routes a FAILing manual_test back to build with the FAIL rows, then HALTs at the cap', async () => {
      await seedToManualTest();
      const { runner, calls } = failingManualTestRunner();
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
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
      });

      await conductor.run();

      // Kicked back to build twice (the cap), rebuilt each time, then HALTed
      // with a reason naming the exhausted budget and the surviving FAIL row.
      expect(kickbacks.filter((k) => k.from === 'manual_test' && k.to === 'build').length).toBe(2);
      expect(calls.filter((s) => s === 'build').length).toBe(2);
      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/manual-test FAIL unresolved after 2 build kickback/);
      expect(halt).toMatch(/s1/);
    });

    it('hands BUILD the FAIL rows + the no-whitewash contract in its retryReason', async () => {
      await seedToManualTest();
      const { runner } = failingManualTestRunner();
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
      });

      await conductor.run();

      const buildReasons = vi
        .mocked(runner.run)
        .mock.calls.filter((c) => c[0] === 'build')
        .map((c) => (c[2] as { retryReason?: string } | undefined)?.retryReason ?? '');
      expect(buildReasons.length).toBeGreaterThan(0);
      for (const r of buildReasons) {
        expect(r).toContain('| s1 | FAIL |');
        expect(r).toContain('.pipeline/manual-test-results.md');
        expect(r).toMatch(/COMMIT/i);
      }
    });

    it('does NOT kick back on a non-FAIL gate miss (skill never recorded results) — HALTs with the gate reason', async () => {
      await seedToManualTest();
      // manual_test runner writes NOTHING → gate miss is "file missing", which
      // carries no bug evidence for build. Must HALT, not loop.
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          return { success: true };
        }),
      };
      const kickbacks: string[] = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push(e.to);
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
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
      });

      await conductor.run();

      expect(halted).toBe(true);
      expect(kickbacks).toHaveLength(0);
      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/step 'manual_test' failed/);
    });

    it('auto mode non-daemon: a failing manual_test HALTs — never silently auto-skipped (#367 gating flip)', async () => {
      await seedToManualTest();
      const { runner, calls } = failingManualTestRunner();
      const kickbacks: string[] = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push(e.to);
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: false,
        verifyArtifacts: true,
        maxRetries: 1,
        fromStep: 'manual_test',
      });

      await conductor.run();

      // Gating now: HALT, no advisory auto-skip, no daemon kickback either.
      expect(halted).toBe(true);
      expect(kickbacks).toHaveLength(0);
      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
      const result = await readState(statePath);
      expect(result.ok && result.value.manual_test).not.toBe('skipped');
    });
  });

  describe('daemon finish/as-built remediation', () => {
    // Seed the SHIP tail in the technical-track shape (prd_audit skipped) —
    // exactly the shape that had NO remediation entry point before the
    // finish/as-built hook, because the /remediate dispatch lived only inside
    // the prd_audit blocking handler. `rebase` is seeded skipped so the tail
    // never invokes real git against the temp dir (rebase is engine-managed
    // and daemon-gated).
    async function seedShipTail(overrides: Record<string, string> = {}): Promise<void> {
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
          manual_test: 'skipped',
          prd_audit: 'skipped',
          retro: 'skipped',
          architecture_review_as_built: 'skipped',
          rebase: 'skipped',
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

    function remediationPlanFile(plan: unknown): Promise<void> {
      return writeFile(join(dir, '.pipeline/remediation.json'), JSON.stringify(plan));
    }

    it('finish verification failure routes to build via /remediate, then ships on the healed re-run', async () => {
      await seedShipTail();
      // First finish refuses (no finish-choice — the skill found real test
      // failures). /remediate plans a build fix; after build re-runs, finish
      // writes its choice and the feature ships without a HALT.
      let buildFixed = false;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            buildFixed = true;
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'remediate') {
            await remediationPlanFile({
              dispositions: [
                {
                  id: 'test:loop-intake',
                  disposition: 'build',
                  category: null,
                  rationale: 'tests lag the fail-closed identity contract',
                  tasks: [{ id: 'rem-1', title: 'update loop-intake.test.ts to inject ownerConfig' }],
                },
              ],
            });
          } else if (step === 'finish' && buildFixed) {
            await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
            const stateResult = await readState(statePath);
            const state = stateResult.ok ? stateResult.value : {};
            state.pr_url = 'https://github.com/org/repo/pull/1';
            await writeState(statePath, state);
            // Also write to the path the gate reads from
            await writeState(join(dir, '.pipeline/conduct-state.json'), state);
          }
          return { success: true };
        }),
      };
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
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
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'finish',
        maxRetries: 1,
        escalateBuildFailure: async () => ({}),
        git: fakeGit,
      });

      await conductor.run();

      expect(kickbacks).toEqual([{ from: 'finish', to: 'build' }]);
      // The remediate dispatch names the finish gap artifact.
      const remediateReasons = vi
        .mocked(runner.run)
        .mock.calls.filter((c) => c[0] === 'remediate')
        .map((c) => (c[2] as { retryReason?: string } | undefined)?.retryReason ?? '');
      expect(remediateReasons.some((r) => r.includes('.pipeline/test-failures.md'))).toBe(true);
      // BUILD received the concrete task + the finish-verification hint source.
      const buildReasons = vi
        .mocked(runner.run)
        .mock.calls.filter((c) => c[0] === 'build')
        .map((c) => (c[2] as { retryReason?: string } | undefined)?.retryReason ?? '');
      expect(
        buildReasons.some(
          (r) =>
            r.includes('update loop-intake.test.ts to inject ownerConfig') &&
            r.includes('finish-verification') &&
            r.includes('.pipeline/test-failures.md'),
        ),
      ).toBe(true);
      expect(halted).toBe(false);
      const result = await readState(statePath);
      expect(result.ok && result.value.finish).toBe('done');
    });

    it('finish remediation HALTs for a human category without rebuilding', async () => {
      await seedShipTail();
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          if (step === 'remediate') {
            await remediationPlanFile({
              dispositions: [
                {
                  id: 'test:wallet-flows',
                  disposition: 'halt',
                  category: 'architectural-clarity',
                  rationale: 'failure exposes an ambiguous aggregate boundary',
                  tasks: [],
                },
              ],
            });
          }
          return { success: true }; // finish never writes finish-choice
        }),
      };
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
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
      });

      await conductor.run();

      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/finish halted: needs human DECIDE/);
      expect(halt).toMatch(/test:wallet-flows \(architectural-clarity/);
      expect(calls.filter((s) => s === 'build')).toHaveLength(0);
    });

    it('as-built review failure routes via /remediate and HALTs at the remediation cap', async () => {
      // A perpetually-BLOCKED as-built review: routed to build twice (the
      // remediation budget), then the generic HALT — never an unbounded loop.
      await seedShipTail({ architecture_review_as_built: 'pending' });
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'architecture_review_as_built') {
            return { success: false, error: 'as-built review BLOCKED: ADR violated' };
          }
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
            );
          } else if (step === 'remediate') {
            await remediationPlanFile({
              dispositions: [
                {
                  id: 'adr-2026-07-03-example',
                  disposition: 'build',
                  category: null,
                  rationale: 'record written to the wrong branch',
                  tasks: [{ id: 'rem-1', title: 'move the write into the finish flow' }],
                },
              ],
            });
          }
          return { success: true };
        }),
      };
      const kickbacks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
      });
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        fromStep: 'architecture_review_as_built',
        maxRetries: 1,
        escalateBuildFailure: async () => ({}),
      });

      await conductor.run();

      expect(
        kickbacks.filter((k) => k.from === 'architecture_review_as_built' && k.to === 'build')
          .length,
      ).toBe(2);
      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/failed in auto mode \(retries exhausted\)/);
    });

    it('non-daemon auto mode does NOT dispatch /remediate on a finish failure', async () => {
      await seedShipTail();
      const calls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          calls.push(step);
          return { success: true }; // finish never writes finish-choice
        }),
      };
      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: false,
        verifyArtifacts: true,
        fromStep: 'finish',
        maxRetries: 1,
      });

      await conductor.run();

      expect(calls).not.toContain('remediate');
      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(halt).toMatch(/step 'finish' failed in auto mode/);
    });
  });

  it('auto mode auto-skips an advisory-step failure and continues', async () => {
    // `memory` is advisory; it fails. In auto mode it auto-skips so the run isn't
    // blocked, and no recovery prompt is shown.
    const onRecovery = vi.fn();
    const runner: StepRunner = {
      run: async (step: StepName) =>
        step === 'memory' ? { success: false } : { success: true },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      maxRetries: 1,
      onRecovery,
    });

    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });
    await conductor.run();

    expect(onRecovery).not.toHaveBeenCalled();
    expect(completed).toBe(true);
    const result = await readState(statePath);
    expect(result.ok && result.value.memory).toBe('skipped');
  });

  it('does NOT set feature_status=complete on failure', async () => {
    // Permanently-failing 2nd step + maxRetries=1 → step escalates to failure.
    let callCount = 0;
    const runner: StepRunner = {
      run: async () => {
        callCount++;
        if (callCount >= 2) return { success: false };
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      maxRetries: 1,
    });

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feature_status).toBeUndefined();
    }
  });

  it('marks failed step as failed in state', async () => {
    const runner: StepRunner = {
      run: async (step: StepName) => {
        if (step === 'explore') return { success: false };
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      maxRetries: 1,
    });

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['explore']).toBe('failed');
    }
  });

  it('with resume option starts at last in_progress step', async () => {
    // Pre-populate state: worktree=done, memory=done, explore=in_progress
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'in_progress',
    } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true });

    await conductor.run();

    // Should start at explore (the in_progress step), not worktree
    expect(stepsRun[0]).toBe('explore');
    expect(stepsRun).not.toContain('worktree');
    expect(stepsRun).not.toContain('memory');
  });

  it('with resume option starts at first pending after last done when no in_progress', async () => {
    // Pre-populate state: worktree=done, memory=done, explore=pending
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
    } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true });

    await conductor.run();

    // Should start at explore (first pending after last done)
    expect(stepsRun[0]).toBe('explore');
    expect(stepsRun).not.toContain('worktree');
    expect(stepsRun).not.toContain('memory');
  });

  it('with fromStep option starts at specified step', async () => {
    // Pre-populate prerequisites so gate passes
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      architecture_review: 'done', // stories' direct prerequisite under the new order
    } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, fromStep: 'stories' });

    await conductor.run();

    // Should start at stories
    expect(stepsRun[0]).toBe('stories');
    expect(stepsRun).not.toContain('worktree');
    expect(stepsRun).not.toContain('explore');
  });

  it('emits step_failed event with correct payload on failure', async () => {
    // Always-failing 2nd step. maxRetries=1 so we escalate after one try.
    let callCount = 0;
    const runner: StepRunner = {
      run: async (step: StepName) => {
        callCount++;
        if (callCount >= 2) return { success: false, output: `${step} check failed` };
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      maxRetries: 1,
    });

    const failedEvents: Array<{ type: string; step: string; error: string; retryCount: number }> = [];
    events.on('step_failed', (e) => {
      if (e.type === 'step_failed') {
        failedEvents.push({ type: e.type, step: e.step, error: e.error, retryCount: e.retryCount });
      }
    });

    await conductor.run();

    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].type).toBe('step_failed');
    expect(failedEvents[0].error).toMatch(/check failed/);
    // retryCount is now "attempts made" (>=1) rather than 0
    expect(failedEvents[0].retryCount).toBeGreaterThanOrEqual(1);
  });

  it('skips conflict_check when tier is S', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    expect(stepsRun).not.toContain('conflict_check');
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['conflict_check']).toBe('skipped');
    }
  });

  it('skips architecture_diagram when tier is S', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    expect(stepsRun).not.toContain('architecture_diagram');
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['architecture_diagram']).toBe('skipped');
    }
  });

  it('runs all steps when tier is M', async () => {
    await writeState(statePath, { complexity_tier: 'M' } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // `complexity`, `worktree`, and `rebase` are engine-managed, not dispatched
    // to runner.run. Every OTHER step should fire, in order.
    const expectedOrder = ALL_STEPS.filter(
      (s) => s.name !== 'complexity' && s.name !== 'worktree' && s.name !== 'rebase',
    ).map((s) => s.name);
    expect(stepsRun).toEqual(expectedOrder);
  });

  it('marks all skipped steps as skipped in state for tier S', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const runner = createMockStepRunner();
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // All S-tier skippable steps should be 'skipped'
      expect(result.value['conflict_check']).toBe('skipped');
      expect(result.value['architecture_diagram']).toBe('skipped');
      expect(result.value['architecture_review']).toBe('skipped');
      expect(result.value['acceptance_specs']).toBe('skipped');
      expect(result.value['retro']).toBe('skipped');
      // Non-skippable steps should be 'done'
      expect(result.value['worktree']).toBe('done');
      expect(result.value['build']).toBe('done');
      expect(result.value['finish']).toBe('done');
    }
  });

  it('emits tier_skip event for skipped steps', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const runner = createMockStepRunner();
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    const tierSkipEvents: Array<{ step: string; tier: string }> = [];
    events.on('tier_skip', (e) => {
      if (e.type === 'tier_skip') tierSkipEvents.push({ step: e.step, tier: e.tier });
    });

    await conductor.run();

    expect(tierSkipEvents.length).toBe(6);
    expect(tierSkipEvents.map((e) => e.step)).toContain('conflict_check');
    expect(tierSkipEvents.map((e) => e.step)).toContain('architecture_diagram');
    expect(tierSkipEvents.map((e) => e.step)).toContain('architecture_review');
    expect(tierSkipEvents.map((e) => e.step)).toContain('acceptance_specs');
    expect(tierSkipEvents.map((e) => e.step)).toContain('architecture_review_as_built');
    expect(tierSkipEvents.map((e) => e.step)).toContain('retro');
    // All events should have tier 'S'
    expect(tierSkipEvents.every((e) => e.tier === 'S')).toBe(true);
  });

  it('runs all steps when complexity_tier is not set (defaults to L)', async () => {
    // No complexity_tier in state
    await writeState(statePath, {} as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // L tier has no skips; complexity/worktree/rebase are engine-managed (not
    // dispatched to stepRunner).
    const expectedOrder = ALL_STEPS.map((s) => s.name).filter(
      (n) => n !== 'complexity' && n !== 'worktree' && n !== 'rebase',
    );
    expect(stepsRun).toEqual(expectedOrder);

    // No tier_skip events should be emitted
    const tierSkipEvents: Array<{ step: string }> = [];
    events.on('tier_skip', (e) => {
      if (e.type === 'tier_skip') tierSkipEvents.push({ step: e.step });
    });
    expect(tierSkipEvents.length).toBe(0);
  });

  it('checks gate before running each step', async () => {
    // stories requires explore — set explore='pending', start from stories
    await writeState(statePath, {} as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'stories',
    });

    await conductor.run();

    // stories should NOT have been run because explore is pending
    expect(stepsRun).not.toContain('stories');
  });

  it('blocks and emits gate_blocked event when gate fails', async () => {
    // stories requires architecture_review — leave it pending
    await writeState(statePath, {} as ConductState);

    const runner = createMockStepRunner();
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'stories',
    });

    const blockedEvents: Array<{ type: string; step: string; reason: string }> = [];
    events.on('gate_blocked', (e) => {
      if (e.type === 'gate_blocked') {
        blockedEvents.push({ type: e.type, step: e.step, reason: e.reason });
      }
    });

    await conductor.run();

    expect(blockedEvents.length).toBe(1);
    expect(blockedEvents[0].type).toBe('gate_blocked');
    expect(blockedEvents[0].step).toBe('stories');
    expect(blockedEvents[0].reason).toContain('architecture_review');
  });

  it('passes gate when prerequisite is done', async () => {
    // architecture_review=done satisfies the stories prerequisite
    await writeState(statePath, { architecture_review: 'done' } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'stories',
    });

    const blockedEvents: Array<{ step: string }> = [];
    events.on('gate_blocked', (e) => {
      if (e.type === 'gate_blocked') blockedEvents.push({ step: e.step });
    });

    await conductor.run();

    // stories should have been run
    expect(stepsRun).toContain('stories');
    // No gate_blocked events
    expect(blockedEvents.length).toBe(0);
  });

  it('passes gate when prerequisite is stale', async () => {
    // architecture_review=stale should still satisfy the stories gate
    await writeState(statePath, { architecture_review: 'stale' } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'stories',
    });

    const blockedEvents: Array<{ step: string }> = [];
    events.on('gate_blocked', (e) => {
      if (e.type === 'gate_blocked') blockedEvents.push({ step: e.step });
    });

    await conductor.run();

    // stories should have been run — stale satisfies gates
    expect(stepsRun).toContain('stories');
    expect(blockedEvents.length).toBe(0);
  });

  it('fires checkpoint_reached event after build step', async () => {
    // Set up prerequisites so build gate passes
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
    } as ConductState);

    const runner = createMockStepRunner();
    const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      onCheckpoint,
    });

    const checkpointEvents: Array<{ step: string }> = [];
    events.on('checkpoint_reached', (e) => {
      if (e.type === 'checkpoint_reached') checkpointEvents.push({ step: e.step });
    });

    await conductor.run();

    // checkpoint_reached should have been emitted for build
    expect(checkpointEvents.some((e) => e.step === 'build')).toBe(true);
    expect(onCheckpoint).toHaveBeenCalledWith('build');
  });

  it('fires checkpoint_reached event after manual_test step', async () => {
    // Set up prerequisites so manual_test gate passes
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
    } as ConductState);

    const runner = createMockStepRunner();
    const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'manual_test',
      onCheckpoint,
    });

    const checkpointEvents: Array<{ step: string }> = [];
    events.on('checkpoint_reached', (e) => {
      if (e.type === 'checkpoint_reached') checkpointEvents.push({ step: e.step });
    });

    await conductor.run();

    expect(checkpointEvents.some((e) => e.step === 'manual_test')).toBe(true);
    expect(onCheckpoint).toHaveBeenCalledWith('manual_test');
  });

  it('does NOT fire checkpoint for non-checkpoint steps', async () => {
    // Run only explore (non-checkpoint step)
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
    } as ConductState);

    const runner = createMockStepRunner();
    const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'explore',
      onCheckpoint,
    });

    const checkpointEvents: Array<{ step: string }> = [];
    events.on('checkpoint_reached', (e) => {
      if (e.type === 'checkpoint_reached') checkpointEvents.push({ step: e.step });
    });

    await conductor.run();

    // explore, stories, plan etc. are not checkpoint steps
    expect(checkpointEvents.filter((e) =>
      e.step === 'explore' || e.step === 'stories' || e.step === 'plan'
    )).toHaveLength(0);
    // onCheckpoint should only have been called for build and manual_test
    for (const call of onCheckpoint.mock.calls) {
      expect(['build', 'manual_test']).toContain(call[0]);
    }
  });

  it('skips checkpoint when mode is auto', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
    } as ConductState);

    const runner = createMockStepRunner();
    const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      mode: 'auto',
      onCheckpoint,
    });

    const checkpointEvents: Array<{ step: string }> = [];
    events.on('checkpoint_reached', (e) => {
      if (e.type === 'checkpoint_reached') checkpointEvents.push({ step: e.step });
    });

    await conductor.run();

    // In auto mode, no checkpoint events should be emitted
    expect(checkpointEvents).toHaveLength(0);
    // onCheckpoint should never be called
    expect(onCheckpoint).not.toHaveBeenCalled();
  });

  it('advances when checkpoint response is continue', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
    } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      onCheckpoint,
    });

    await conductor.run();

    // After 'continue' at build checkpoint, conductor should proceed to manual_test and beyond
    expect(stepsRun).toContain('build');
    expect(stepsRun).toContain('manual_test');
    expect(stepsRun).toContain('retro');
    expect(stepsRun).toContain('finish');
  });

  it('stops and saves state when checkpoint response is quit', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
    } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const onCheckpoint = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      onCheckpoint,
    });

    await conductor.run();

    // Should have run build but stopped after checkpoint
    expect(stepsRun).toContain('build');
    expect(stepsRun).not.toContain('manual_test');

    // State should be saved with build=done
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['build']).toBe('done');
      // feature_status should NOT be complete
      expect(result.value.feature_status).toBeUndefined();
    }
  });

  it('saves state on SIGINT before exit', async () => {
    let sigintHandler: (() => void) | undefined;
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGINT') {
        sigintHandler = handler as () => void;
      }
      return process;
    }) as typeof process.on);

    // The SIGINT handler calls process.exit(130); stub it so the real exit
    // doesn't surface as an unhandled rejection that fails the vitest run.
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    // Create a runner that blocks on the 3rd step so we can trigger SIGINT
    let stepCount = 0;
    let resolveBlock: (() => void) | undefined;
    const blockPromise = new Promise<void>((resolve) => {
      resolveBlock = resolve;
    });

    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepCount++;
        if (stepCount === 3) {
          // Trigger SIGINT while we're "running" step 3
          if (sigintHandler) sigintHandler();
          // Let the step finish after SIGINT handler runs
          resolveBlock!();
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    // SIGINT handler should have been registered
    expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));

    // State should have been saved (handler calls writeState)
    const result = await readState(statePath);
    expect(result.ok).toBe(true);

    processOnSpy.mockRestore();
    exitSpy.mockRestore();
  });

  describe('backward navigation', () => {
    it('getNavigableSteps returns only done and stale steps', () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        explore: 'in_progress',
        complexity: 'pending',
        stories: 'stale',
      };

      const navigable = getNavigableSteps(state);

      const names = navigable.map((s) => s.name);
      expect(names).toContain('worktree');
      expect(names).toContain('memory');
      expect(names).toContain('stories');
      expect(names).not.toContain('explore');
      expect(names).not.toContain('complexity');
      // Each entry should have name, label, status, phase
      for (const step of navigable) {
        expect(step).toHaveProperty('name');
        expect(step).toHaveProperty('label');
        expect(step).toHaveProperty('status');
        expect(step).toHaveProperty('phase');
      }
    });
    it('navigateBack sets target step to pending', () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        stories: 'done',
      };

      const result = navigateBack(state, 'explore');

      expect(result.state['explore']).toBe('pending');
    });

    it('navigateBack marks all downstream done steps as stale', () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'skipped',
        plan: 'done',
      };

      const result = navigateBack(state, 'explore');

      // explore itself is pending (not stale)
      expect(result.state['explore']).toBe('pending');
      // Upstream steps remain done
      expect(result.state['worktree']).toBe('done');
      expect(result.state['memory']).toBe('done');
      // Downstream done steps become stale
      expect(result.state['complexity']).toBe('stale');
      expect(result.state['stories']).toBe('stale');
      expect(result.state['plan']).toBe('stale');
      // Skipped steps stay skipped (markDownstreamStale only touches done)
      expect(result.state['conflict_check']).toBe('skipped');
    });

    it('navigateBack returns new loop index at target step', () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
      };

      const result = navigateBack(state, 'explore');

      // explore is index 2 in ALL_STEPS
      const expectedIndex = ALL_STEPS.findIndex((s) => s.name === 'explore');
      expect(result.index).toBe(expectedIndex);
    });

    it('Conductor jumps to target index after back navigation', async () => {
      // Set up all prerequisites done through build (a checkpoint step)
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'done',
        plan: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        acceptance_specs: 'done',
      } as ConductState);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          stepsRun.push(step);
          return { success: true };
        },
      };

      // First checkpoint (build) returns 'back', subsequent ones return 'continue'
      let checkpointCallCount = 0;
      const onCheckpoint = vi.fn(async () => {
        checkpointCallCount++;
        if (checkpointCallCount === 1) return 'back' as const;
        return 'continue' as const;
      });

      const onNavigate = vi.fn(async () => 'stories' as StepName);

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'build',
        onCheckpoint,
        onNavigate,
      });

      const navEvents: Array<{ from: string; to: string }> = [];
      events.on('navigation_back', (e) => {
        if (e.type === 'navigation_back') navEvents.push({ from: e.from, to: e.to });
      });

      await conductor.run();

      // onNavigate should have been called
      expect(onNavigate).toHaveBeenCalled();
      // navigation_back event should have been emitted
      expect(navEvents.length).toBe(1);
      expect(navEvents[0].from).toBe('build');
      expect(navEvents[0].to).toBe('stories');
      // After navigating back to stories, conductor should re-run from stories onward
      // stepsRun should contain: build (first run), then stories, conflict_check, plan, ...
      expect(stepsRun[0]).toBe('build');
      const storiesIdx = stepsRun.indexOf('stories');
      expect(storiesIdx).toBeGreaterThan(0);
    });

    it('Stale steps re-run when conductor reaches them', async () => {
      // Set up state where stories is stale (downstream of a back navigation)
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        stories: 'stale',
      } as ConductState);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          stepsRun.push(step);
          return { success: true };
        },
      };
      const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'stories',
        onCheckpoint,
      });

      await conductor.run();

      // stories (stale) should have been run, not skipped
      expect(stepsRun).toContain('stories');
      // After running, stories should be done
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['stories']).toBe('done');
      }
    });

    it('Cancel navigation (no target) returns to checkpoint without state changes', async () => {
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'done',
        plan: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        acceptance_specs: 'done',
      } as ConductState);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          stepsRun.push(step);
          return { success: true };
        },
      };

      // First checkpoint: back then cancel (null), second checkpoint: continue
      let checkpointCallCount = 0;
      const onCheckpoint = vi.fn(async () => {
        checkpointCallCount++;
        if (checkpointCallCount === 1) return 'back' as const;
        return 'continue' as const;
      });

      // onNavigate returns null (user cancels)
      const onNavigate = vi.fn(async () => null);

      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'build',
        onCheckpoint,
        onNavigate,
      });

      const navEvents: Array<{ from: string; to: string }> = [];
      events.on('navigation_back', (e) => {
        if (e.type === 'navigation_back') navEvents.push({ from: e.from, to: e.to });
      });

      await conductor.run();

      // onNavigate was called but returned null
      expect(onNavigate).toHaveBeenCalled();
      // No navigation_back events
      expect(navEvents).toHaveLength(0);
      // Conductor should have continued forward (build, manual_test, retro, finish)
      expect(stepsRun).toContain('build');
      expect(stepsRun).toContain('manual_test');
      expect(stepsRun).toContain('finish');
      // State should not have been mutated by navigation
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['stories']).toBe('done');
      }
    });

  });

  describe('feature completion', () => {
    it('emits feature_complete event when all steps done', async () => {
      const runner = createMockStepRunner();
      const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

      const completeEvents: Array<{ type: string; prUrl?: string }> = [];
      events.on('feature_complete', (e) => {
        if (e.type === 'feature_complete') completeEvents.push({ type: e.type, prUrl: (e as { type: string; prUrl?: string }).prUrl });
      });

      await conductor.run();

      expect(completeEvents.length).toBe(1);
      expect(completeEvents[0].type).toBe('feature_complete');
    });

    it('stores prUrl in state when finish step returns a URL', async () => {
      const runner: StepRunner = {
        run: async (step: StepName) => {
          if (step === 'finish') return { success: true, output: 'https://github.com/org/repo/pull/42' };
          return { success: true };
        },
      };
      const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });

      const completeEvents: Array<{ prUrl?: string }> = [];
      events.on('feature_complete', (e) => {
        if (e.type === 'feature_complete') completeEvents.push({ prUrl: (e as { type: string; prUrl?: string }).prUrl });
      });

      await conductor.run();

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pr_url).toBe('https://github.com/org/repo/pull/42');
      }
      // feature_complete event should include the prUrl
      expect(completeEvents[0].prUrl).toBe('https://github.com/org/repo/pull/42');
    });

    it('feature with feature_status=complete is excluded from resume', async () => {
      // Pre-populate state as a completed feature
      const completedState: ConductState = {
        feature_status: 'complete',
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        prd: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'done',
        plan: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        acceptance_specs: 'done',
        build: 'done',
        manual_test: 'done',
        prd_audit: 'done',
        architecture_review_as_built: 'done',
        retro: 'done',
        rebase: 'done',
        finish: 'done',
      };
      await writeState(statePath, completedState);

      const stepsRun: StepName[] = [];
      const runner: StepRunner = {
        run: async (step: StepName) => {
          stepsRun.push(step);
          return { success: true };
        },
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        resume: true,
      });

      await conductor.run();

      // When every step is already `done` (feature_status=complete), the
      // conductor's skip-already-resolved gate (src/engine/conductor.ts:264)
      // no-ops every iteration — nothing gets re-dispatched. Starting a NEW
      // feature creates a fresh state file elsewhere; resume against a
      // completed state does not re-run work.
      expect(stepsRun).toEqual([]);
    });

    it('does not set feature_status=complete if any step failed', async () => {
      // Permanently-failing 2nd step + maxRetries=1 → step escalates to failure.
      let callCount = 0;
      const runner: StepRunner = {
        run: async () => {
          callCount++;
          if (callCount >= 2) return { success: false };
          return { success: true };
        },
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        maxRetries: 1,
      });

      const completeEvents: Array<{ type: string }> = [];
      events.on('feature_complete', (e) => {
        if (e.type === 'feature_complete') completeEvents.push({ type: e.type });
      });

      await conductor.run();

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.feature_status).toBeUndefined();
      }
      // feature_complete event should NOT have been emitted
      expect(completeEvents.length).toBe(0);
    });

    it('getNavigableSteps returns empty array when no steps completed', () => {
      const state: ConductState = {
        worktree: 'pending',
        memory: 'in_progress',
      };

      const navigable = getNavigableSteps(state);

      expect(navigable).toEqual([]);
    });
  });

  describe('recovery menu', () => {
    it('calls onRecovery on step failure', async () => {
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'explore') return { success: false, output: 'explore failed' };
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onRecovery,
        maxRetries: 1,
      });

      await conductor.run();

      // onRecovery(step, isGating, context). explore is advisory.
      expect(onRecovery).toHaveBeenCalledWith('explore', false, expect.any(Object));
    });

    it('retries step when recovery returns retry', async () => {
      let exploreCalls = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'explore') {
            exploreCalls++;
            if (exploreCalls === 1) return { success: false, output: 'failed first time' };
            return { success: true };
          }
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValueOnce('retry' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onRecovery,
      });

      await conductor.run();

      // explore should have been called twice (fail + retry)
      expect(exploreCalls).toBe(2);
      // All steps should have completed
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.feature_status).toBe('complete');
      }
    });

    it('skips step when recovery returns skip (non-gating)', async () => {
      // explore is advisory (non-gating), so skip should work
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'explore') return { success: false, output: 'explore failed' };
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('skip' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onRecovery,
        maxRetries: 1,
      });

      await conductor.run();

      // explore should be marked skipped
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['explore']).toBe('skipped');
        // Should have continued past explore
        expect(result.value.feature_status).toBe('complete');
      }
    });

    it('quits when recovery returns quit', async () => {
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'explore') return { success: false, output: 'explore failed' };
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onRecovery,
        maxRetries: 1,
      });

      await conductor.run();

      // Should have stopped
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['explore']).toBe('failed');
        expect(result.value.feature_status).toBeUndefined();
      }
    });

    it('calls onRecovery with isGating=true for gating steps', async () => {
      // stories is gating — set up prerequisites (stories now follows architecture_review)
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
      } as ConductState);

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'stories') return { success: false, output: 'stories failed' };
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        fromStep: 'stories',
        onRecovery,
      });

      await conductor.run();

      expect(onRecovery).toHaveBeenCalledWith(
        'stories',
        true,
        expect.objectContaining({ recoveryCount: 0, retriesExhausted: false }),
      );
    });

    it('navigates back when recovery returns back', async () => {
      // Set up prerequisites through architecture_review (stories' new prereq)
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
      } as ConductState);

      let storiesCalls = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'stories') {
            storiesCalls++;
            if (storiesCalls === 1) return { success: false, output: 'stories failed' };
          }
          return { success: true };
        }),
      };

      const onRecovery = vi.fn().mockResolvedValueOnce('back' as const);
      const onNavigate = vi.fn().mockResolvedValue('explore' as StepName);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        maxRetries: 1,
        fromStep: 'stories',
        onRecovery,
        onNavigate,
      });

      await conductor.run();

      // onNavigate should have been called
      expect(onNavigate).toHaveBeenCalled();
    });

    it('calls runInteractive when recovery returns interactive', async () => {
      let exploreCalls = 0;
      const runner: StepRunner & { runInteractive?: ReturnType<typeof vi.fn> } = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'explore') {
            exploreCalls++;
            if (exploreCalls === 1) return { success: false, output: 'explore failed' };
            return { success: true };
          }
          return { success: true };
        }),
        runInteractive: vi.fn().mockResolvedValue(undefined),
      };
      const onRecovery = vi.fn().mockResolvedValueOnce('interactive' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        maxRetries: 1,
        onRecovery,
      });

      await conductor.run();

      // runInteractive should have been called with the failed step
      expect(runner.runInteractive).toHaveBeenCalledWith('explore');
      // Then the step should have been retried
      expect(exploreCalls).toBe(2);
    });
  });

  describe('complexity assessment', () => {
    it('calls onComplexityAssessment for the complexity step', async () => {
      const runner = createMockStepRunner();
      const onComplexityAssessment = vi.fn().mockResolvedValue('M' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment,
      });

      await conductor.run();

      expect(onComplexityAssessment).toHaveBeenCalledTimes(1);
    });

    it('does not dispatch complexity to stepRunner.run', async () => {
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment: async () => 'M' as const,
      });

      await conductor.run();

      const runMock = runner.run as ReturnType<typeof vi.fn>;
      const steps = runMock.mock.calls.map((c) => c[0]);
      expect(steps).not.toContain('complexity');
    });

    it('stores tier in state after assessment', async () => {
      const runner = createMockStepRunner();
      const onComplexityAssessment = vi.fn().mockResolvedValue('S' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment,
      });

      await conductor.run();

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.complexity_tier).toBe('S');
        expect(result.value.complexity).toBe('done');
      }
    });

    it('passes existing tier as recommendation when one is already persisted', async () => {
      await writeState(statePath, { complexity_tier: 'L' } as ConductState);

      const runner = createMockStepRunner();
      const onComplexityAssessment = vi.fn().mockResolvedValue('L' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment,
      });

      await conductor.run();

      expect(onComplexityAssessment).toHaveBeenCalledWith('L');
    });

    it('uses assessComplexity output as recommendation when no persisted tier', async () => {
      const runner: StepRunner = {
        run: vi.fn().mockResolvedValue({ success: true }),
        assessComplexity: vi.fn().mockResolvedValue('M' as const),
      };
      const onComplexityAssessment = vi.fn().mockResolvedValue('M' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment,
      });

      await conductor.run();

      expect(runner.assessComplexity).toHaveBeenCalled();
      expect(onComplexityAssessment).toHaveBeenCalledWith('M');
    });

    it('passes null recommendation when Claude cannot determine a tier', async () => {
      const runner: StepRunner = {
        run: vi.fn().mockResolvedValue({ success: true }),
        assessComplexity: vi.fn().mockResolvedValue(null),
      };
      const onComplexityAssessment = vi.fn().mockResolvedValue('L' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment,
      });

      await conductor.run();

      expect(onComplexityAssessment).toHaveBeenCalledWith(null);
    });

    it('does not call onComplexityAssessment in auto mode', async () => {
      const runner = createMockStepRunner();
      const onComplexityAssessment = vi.fn().mockResolvedValue('M' as const);
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        mode: 'auto',
        onComplexityAssessment,
      });

      await conductor.run();

      expect(onComplexityAssessment).not.toHaveBeenCalled();
    });

    it('does not set a tier when the prompt throws (e.g., Ctrl-C)', async () => {
      const runner = createMockStepRunner();
      const onComplexityAssessment = vi.fn().mockRejectedValue(new Error('user cancelled'));
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onComplexityAssessment,
      });

      await conductor.run();

      // Step falls into the failure branch (recoverable via the recovery menu).
      // Critical: no tier gets persisted, so resume will re-prompt.
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.complexity_tier).toBeUndefined();
        expect(result.value.complexity).toBe('failed');
      }
    });
  });

  it('skips steps with steps.<name>.disable=true', async () => {
    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: {
        steps: {
          memory: { disable: true },
          explore: { disable: true },
        },
      },
    });

    await conductor.run();

    expect(stepsRun).not.toContain('memory');
    expect(stepsRun).not.toContain('explore');

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['memory']).toBe('skipped');
      expect(result.value['explore']).toBe('skipped');
    }
  });

  it('disabled step satisfies downstream gate', async () => {
    // Disable explore, which is a prerequisite for stories
    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: { steps: { explore: { disable: true } } },
    });

    await conductor.run();

    // stories depends on explore — it should still run because
    // explore was skipped and stepSatisfied returns true for 'skipped'
    expect(stepsRun).not.toContain('explore');
    expect(stepsRun).toContain('stories');
  });

  describe('artifact approval persistence', () => {
    async function writeArtifact(rel: string, content: string): Promise<string> {
      const full = join(dir, rel);
      await mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
      await writeFile(full, content);
      return full;
    }

    function sha(content: string): string {
      return createHash('sha256').update(content).digest('hex');
    }

    it('approvalKey returns project-relative paths', () => {
      const root = '/tmp/root';
      expect(approvalKey(root, '/tmp/root/.docs/plans/a.md')).toBe('.docs/plans/a.md');
    });

    it('filterUnapprovedArtifacts excludes files whose hash matches a prior approval', async () => {
      const file = await writeArtifact('.docs/plans/a.md', 'plan content');
      const approvals = {
        [approvalKey(dir, file)]: {
          sha256: sha('plan content'),
          approved_at: '2026-04-16T00:00:00Z',
        },
      };

      const unapproved = await filterUnapprovedArtifacts([file], approvals, dir);

      expect(unapproved).toEqual([]);
    });

    it('filterUnapprovedArtifacts includes files whose content has changed', async () => {
      const file = await writeArtifact('.docs/plans/a.md', 'new content');
      const approvals = {
        [approvalKey(dir, file)]: {
          sha256: sha('old content'),
          approved_at: '2026-04-16T00:00:00Z',
        },
      };

      const unapproved = await filterUnapprovedArtifacts([file], approvals, dir);

      expect(unapproved).toEqual([file]);
    });

    it('filterUnapprovedArtifacts includes never-before-seen files', async () => {
      const file = await writeArtifact('.docs/plans/a.md', 'plan');
      const unapproved = await filterUnapprovedArtifacts([file], {}, dir);
      expect(unapproved).toEqual([file]);
    });

    it('recordApprovals adds entries keyed by project-relative path', async () => {
      const file = await writeArtifact('.docs/plans/a.md', 'plan');
      const updated = await recordApprovals({}, [file], dir);
      expect(Object.keys(updated)).toEqual(['.docs/plans/a.md']);
      expect(updated['.docs/plans/a.md'].sha256).toBe(sha('plan'));
    });

    it('recordApprovals preserves existing entries for other files', async () => {
      const file = await writeArtifact('.docs/plans/a.md', 'plan');
      const prior = {
        'some/other.md': { sha256: 'deadbeef', approved_at: '2026-04-16T00:00:00Z' },
      };
      const updated = await recordApprovals(prior, [file], dir);
      expect(updated['some/other.md'].sha256).toBe('deadbeef');
      expect(updated['.docs/plans/a.md'].sha256).toBe(sha('plan'));
    });

    it('review gate skips the prompt when every file is already approved', async () => {
      const planFile = await writeArtifact('.docs/plans/a.md', 'plan');
      const approvals = {
        [approvalKey(dir, planFile)]: {
          sha256: sha('plan'),
          approved_at: '2026-04-16T00:00:00Z',
        },
      };
      await writeState(statePath, {
        explore: 'done',
        conflict_check: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        complexity_tier: 'L',
        artifact_approvals: approvals,
      } as ConductState);

      const runner = createMockStepRunner();
      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'plan',
        onReviewArtifacts,
      });

      await conductor.run();

      // Plan's artifact was already approved + unchanged → no re-prompt
      const planCalls = onReviewArtifacts.mock.calls.filter((c) => c[0] === 'plan');
      expect(planCalls.length).toBe(0);
    });

    it('review gate prompts when plan file content changes', async () => {
      // Approval recorded for old content; write new content to disk.
      const planFile = await writeArtifact('.docs/plans/a.md', 'new plan content');
      const approvals = {
        [approvalKey(dir, planFile)]: {
          sha256: sha('OLD content that no longer matches'),
          approved_at: '2026-04-16T00:00:00Z',
        },
      };
      await writeState(statePath, {
        explore: 'done',
        conflict_check: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        complexity_tier: 'L',
        artifact_approvals: approvals,
      } as ConductState);

      const runner = createMockStepRunner();
      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'plan',
        onReviewArtifacts,
      });

      await conductor.run();

      const planCalls = onReviewArtifacts.mock.calls.filter((c) => c[0] === 'plan');
      expect(planCalls.length).toBe(1);
    });

    it('persists approvals to state after a successful review', async () => {
      const planFile = await writeArtifact('.docs/plans/a.md', 'plan content');
      await writeState(statePath, {
        explore: 'done',
        conflict_check: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        complexity_tier: 'L',
      } as ConductState);

      const runner = createMockStepRunner();
      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'plan',
        onReviewArtifacts,
      });

      await conductor.run();

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const approvals = result.value.artifact_approvals ?? {};
        const key = approvalKey(dir, planFile);
        expect(approvals[key]).toBeDefined();
        expect(approvals[key].sha256).toBe(sha('plan content'));
      }
    });

    it('does not persist approvals when user rejects', async () => {
      await writeArtifact('.docs/plans/a.md', 'plan');
      await writeState(statePath, {
        explore: 'done',
        conflict_check: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        complexity_tier: 'L',
      } as ConductState);

      const runCalls: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          runCalls.push(step);
          return { success: true };
        }),
      };
      // First review call: reject. Second: approve (to end the retry loop).
      const onReviewArtifacts = vi
        .fn()
        .mockResolvedValueOnce('rejected' as const)
        .mockResolvedValue('approved' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'plan',
        onReviewArtifacts,
      });

      await conductor.run();

      // Plan should have been re-run at least once (once rejected, once approved).
      expect(runCalls.filter((s) => s === 'plan').length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('rate-limit handling', () => {
    it('waits and retries without burning retry budget on rate limit', async () => {
      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          if (attempt === 1) return { success: false, rateLimited: true, waitSeconds: 5 };
          return { success: true };
        }),
      };
      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 2, // budget would be exhausted if rate-limit consumed attempts
        sleepFn,
        onRecovery: vi.fn().mockResolvedValue('quit' as const),
      });

      const rateLimitEvents: Array<{ waitSeconds: number }> = [];
      events.on('rate_limit', (e) => {
        if (e.type === 'rate_limit') rateLimitEvents.push({ waitSeconds: e.waitSeconds });
      });

      await conductor.run();

      expect(rateLimitEvents).toHaveLength(1);
      expect(rateLimitEvents[0].waitSeconds).toBe(5);
      expect(sleepFn).toHaveBeenCalledWith(5000);
      // runner called at least twice on the first step (1 rate-limited + 1 success),
      // but the step still succeeded (no failure emitted) because rate-limit didn't
      // burn the retry budget.
      expect(attempt).toBeGreaterThanOrEqual(2);
    });

    it('defaults rate-limit wait to 300 seconds when waitSeconds is not provided', async () => {
      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          if (attempt === 1) return { success: false, rateLimited: true };
          return { success: true };
        }),
      };
      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        sleepFn,
      });

      await conductor.run();

      expect(sleepFn).toHaveBeenCalledWith(300_000);
    });

    it('conductor: enters episode and awaits episode.clear() on rate-limited result', async () => {
      // Task 9: RED spec for conductor episode integration
      // Expects: conductor calls episode.enter(deadline) and awaits episode.clear(signal)
      // instead of bare sleep when handling rate limits.

      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          if (attempt === 1) return { success: false, rateLimited: true, waitSeconds: 60 };
          return { success: true };
        }),
      };

      // Mock episode with spy methods to verify calls
      let episodeEnterCalled = false;
      let episodeEnterDeadline: number | null = null;
      let episodeClearCalled = false;
      let episodeClearSignal: AbortSignal | undefined;

      const mockEpisode = {
        enter: (untilMs: number) => {
          episodeEnterCalled = true;
          episodeEnterDeadline = untilMs;
        },
        active: () => false,
        clear: async (signal?: AbortSignal) => {
          episodeClearCalled = true;
          episodeClearSignal = signal;
          return Promise.resolve();
        },
        nextWaitSeconds: () => 60,
      };

      const nowTime = Date.now();
      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 2,
        sleepFn,
        onRecovery: vi.fn().mockResolvedValue('quit' as const),
        rateLimitEpisode: mockEpisode,
      });

      await conductor.run();

      // Assertions (will fail because conductor doesn't yet integrate episode):
      // - episode.enter() was NOT called yet (conductor doesn't integrate episode yet)
      expect(episodeEnterCalled).toBe(true);
      // - deadline should be approximately now + 60000ms
      if (episodeEnterDeadline !== null) {
        const expectedMin = nowTime + 59000; // Allow 1s tolerance
        const expectedMax = nowTime + 61000;
        expect(episodeEnterDeadline).toBeGreaterThanOrEqual(expectedMin);
        expect(episodeEnterDeadline).toBeLessThanOrEqual(expectedMax);
      }
      // - episode.clear(signal) should be called instead of bare sleep
      expect(episodeClearCalled).toBe(true);
      expect(episodeClearSignal).toBeDefined();
      // - attempt counter unchanged (rate-limit doesn't burn budget)
      expect(attempt).toBeGreaterThanOrEqual(2);
      // - sleepFn should NOT have been called (conductor should use episode.clear)
      expect(sleepFn).not.toHaveBeenCalled();
    });
  });

  describe('stale-session handling', () => {
    it('calls resetSession and retries without burning retry budget', async () => {
      let attempt = 0;
      const resetSession = vi.fn().mockResolvedValue(undefined);
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          if (attempt === 1) return { success: false, sessionExpired: true };
          return { success: true };
        }),
        resetSession,
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 2,
      });

      const resetEvents: Array<{ reason: string }> = [];
      events.on('session_reset', (e) => {
        if (e.type === 'session_reset') resetEvents.push({ reason: e.reason });
      });

      await conductor.run();

      expect(resetSession).toHaveBeenCalled();
      expect(resetEvents.length).toBeGreaterThanOrEqual(1);
      expect(attempt).toBeGreaterThanOrEqual(2);
    });

    it('tolerates a runner without resetSession', async () => {
      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          if (attempt === 1) return { success: false, sessionExpired: true };
          return { success: true };
        }),
        // resetSession omitted
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
      });

      await conductor.run();

      // Should not crash; step succeeded on the retry-after-session-expired.
      expect(attempt).toBeGreaterThanOrEqual(2);
    });
  });

  describe('auth-failure handling', () => {
    beforeEach(async () => {
      const { waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      const { refreshSandboxCredentials } = await import(
        '../../src/engine/self-host/sandbox-build-env.js'
      );
      vi.clearAllMocks();
    });

    it('parks on authFailure without burning retry budget', async () => {
      const { waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );

      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          if (attempt === 1) return { success: false, authFailure: true };
          return { success: true };
        }),
      };

      vi.mocked(waitForCredentialsChange).mockResolvedValue({
        type: 'refreshed' as const,
        credentialsPath: '/.credentials.json',
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 2,
      });

      await conductor.run();

      // Runner should have been called at least twice on the first step (1 auth-failed + 1 success)
      expect(attempt).toBeGreaterThanOrEqual(2);
    });

    it('refreshes sandbox credentials before re-attempt after authFailure', async () => {
      const { waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      const { refreshSandboxCredentials } = await import(
        '../../src/engine/self-host/sandbox-build-env.js'
      );

      let attempt = 0;
      const callOrder: string[] = [];
      const mockSandbox = {
        configDir: join(dir, '.sandbox'),
        childEnv: () => process.env,
        teardown: vi.fn().mockResolvedValue(undefined),
      };

      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          callOrder.push(`runner-attempt-${attempt}`);
          if (attempt === 1) return { success: false, authFailure: true };
          return { success: true };
        }),
      };

      vi.mocked(waitForCredentialsChange).mockImplementation(async () => {
        callOrder.push('waitForCredentialsChange');
        return { type: 'refreshed' as const, credentialsPath: '/.credentials.json' };
      });

      vi.mocked(refreshSandboxCredentials).mockImplementation(async () => {
        callOrder.push('refreshSandboxCredentials');
      });

      const mockGuardrails = {
        provisionSandbox: vi.fn().mockResolvedValue(mockSandbox),
        resolveHarnessRoot: vi.fn().mockResolvedValue(null),
        relink: vi.fn().mockResolvedValue(undefined),
        versionGate: vi.fn().mockResolvedValue({ ok: true }),
        releaseGate: vi.fn().mockResolvedValue({ ok: true }),
      };

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 2,
        selfHostGuardrails: mockGuardrails as any,
      });

      // Set activeSandbox directly for testing purposes
      (conductor as any).activeSandbox = mockSandbox;

      await conductor.run();

      // Verify the call order: auth-fail on attempt 1, then wait, then refresh, then retry
      expect(callOrder).toContain('runner-attempt-1');
      expect(callOrder).toContain('waitForCredentialsChange');
      expect(callOrder).toContain('refreshSandboxCredentials');
      expect(callOrder).toContain('runner-attempt-2');

      // Refresh must come before the second attempt
      const refreshIdx = callOrder.indexOf('refreshSandboxCredentials');
      const attempt2Idx = callOrder.indexOf('runner-attempt-2');
      expect(refreshIdx).toBeLessThan(attempt2Idx);
    });

    it('re-enters park on subsequent authFailure without budget burn', async () => {
      const { waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      const { refreshSandboxCredentials } = await import(
        '../../src/engine/self-host/sandbox-build-env.js'
      );

      let attempt = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempt++;
          // Both attempts fail with authFailure
          if (attempt <= 2) return { success: false, authFailure: true };
          return { success: true };
        }),
      };

      vi.mocked(waitForCredentialsChange).mockResolvedValue({
        type: 'refreshed' as const,
        credentialsPath: '/.credentials.json',
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 2,
      });

      await conductor.run();

      // Runner should have been called 3 times: attempt 1 (auth-fail), attempt 2 (auth-fail), attempt 3 (success)
      // This verifies the budget was not burned (would be exhausted if park-resume consumed attempts)
      expect(attempt).toBeGreaterThanOrEqual(3);
      expect(vi.mocked(waitForCredentialsChange)).toHaveBeenCalledTimes(2);
    });

    it('HALTs with credentials-specific reason when park timeout elapses', async () => {
      const { waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      const credentialsPath = join(dir, '.credentials.json');
      const expiresAt = Date.now() - 1000; // expired
      await writeFile(credentialsPath, JSON.stringify({ claudeAiOauth: { expiresAt } }), 'utf-8');

      vi.mocked(waitForCredentialsChange).mockResolvedValue({
        type: 'timeout' as const,
        credentialsPath,
        credentialsState: 'expired' as const,
        expiresAt: String(expiresAt),
      });

      const runner: StepRunner = {
        run: vi.fn(async () => {
          return { success: false, authFailure: true };
        }),
      };

      const mockGuardrails = {
        provisionSandbox: vi.fn(),
        resolveHarnessRoot: vi.fn().mockResolvedValue(null),
        relink: vi.fn(),
        versionGate: vi.fn(),
        releaseGate: vi.fn(),
      };

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 1,
        mode: 'auto',
        daemon: true,
        selfHostGuardrails: mockGuardrails as any,
      });

      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });

      await conductor.run();

      expect(halted).toBe(true);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      // The HALT reason must include the credentials path and the expiresAt
      expect(halt).toContain(credentialsPath);
      expect(halt).toContain(String(expiresAt));
      // Verify it's NOT the generic "retries exhausted" reason
      expect(halt).not.toMatch(/retries exhausted/i);
    });

    // ── TR-4 Task 15: Auth HALT distinguishable from build-defect HALT ─────

    it('TR-4 Test B: auth-park timeout does not consume retry budget', async () => {
      const { waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      const credentialsPath = join(dir, '.credentials.json');
      const expiresAt = Date.now() - 1000;
      await writeFile(credentialsPath, JSON.stringify({ claudeAiOauth: { expiresAt } }), 'utf-8');

      let buildAttempts = 0;

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
          if (step === 'build') {
            buildAttempts++;
            return { success: false, authFailure: true };
          }
          return { success: true };
        }),
      };

      vi.mocked(waitForCredentialsChange).mockResolvedValue({
        type: 'timeout' as const,
        credentialsPath,
        credentialsState: 'expired' as const,
        expiresAt: String(expiresAt),
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        maxRetries: 2, // enough budget to retry if it were burned
      });

      await conductor.run();

      // Test B: only one build attempt made (authFailure triggers park, timeout
      // halts immediately without retrying — attempt counter stays at 1)
      expect(buildAttempts).toBe(1);
    });

    it('TR-4 Test C: escalation PR body carries credentials-specific reason', async () => {
      const { waitForCredentialsChange } = await import(
        '../../src/engine/self-host/operator-credentials.js'
      );
      const credentialsPath = join(dir, '.credentials.json');
      const expiresAt = Date.now() - 1000;
      await writeFile(credentialsPath, JSON.stringify({ claudeAiOauth: { expiresAt } }), 'utf-8');

      const fakePrUrl = 'https://github.com/test/repo/pull/999';
      const capturedOpts: EscalateBuildFailureOpts[] = [];

      const fakeEscalation = vi.fn<any>(async (opts: EscalateBuildFailureOpts) => {
        capturedOpts.push(opts);
        return { prUrl: fakePrUrl };
      });

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
          if (step === 'build') return { success: false, authFailure: true };
          return { success: true };
        }),
      };

      vi.mocked(waitForCredentialsChange).mockResolvedValue({
        type: 'timeout' as const,
        credentialsPath,
        credentialsState: 'expired' as const,
        expiresAt: String(expiresAt),
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        maxRetries: 1,
        escalateBuildFailure: fakeEscalation,
      });

      await conductor.run();

      // Test C: escalation was called with credentials-specific reason
      expect(fakeEscalation).toHaveBeenCalledOnce();
      expect(capturedOpts).toHaveLength(1);

      const failureReason = capturedOpts[0].failureReason;

      // Verify the PR body reason is credentials-specific, not generic "retries exhausted"
      expect(failureReason).not.toMatch(/retries exhausted/i);
      expect(failureReason).toContain(credentialsPath);
      expect(failureReason).toContain(String(expiresAt));
      expect(failureReason).toContain('Operator credentials expired');
    });
  });

  describe('conditional review (conflict_check has review=conditional by default)', () => {
    async function seedConflictArtifact(projectRoot: string): Promise<void> {
      await mkdir(join(projectRoot, '.docs/conflicts'), { recursive: true });
      await writeFile(join(projectRoot, '.docs/conflicts/c.md'), 'conflict report');
    }

    async function seedPrdArtifact(projectRoot: string): Promise<void> {
      await mkdir(join(projectRoot, '.docs/specs'), { recursive: true });
      await writeFile(join(projectRoot, '.docs/specs/spec.md'), 'spec');
    }

    it('auto-approves conflict_check when no marker file exists', async () => {
      await seedConflictArtifact(dir);
      await writeState(statePath, {
        bootstrap: 'done', memory: 'done', assess: 'done', explore: 'done',
        stories: 'done', complexity_tier: 'M',
      } as ConductState);

      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'conflict_check',
        onReviewArtifacts,
      });

      await conductor.run();

      const conflictCalls = onReviewArtifacts.mock.calls.filter((c) => c[0] === 'conflict_check');
      expect(conflictCalls.length).toBe(0);
    });

    it('prompts when conflict_check wrote the marker file', async () => {
      await seedConflictArtifact(dir);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/review-required-conflict_check'), '1');
      await writeState(statePath, {
        bootstrap: 'done', memory: 'done', assess: 'done', explore: 'done',
        stories: 'done', complexity_tier: 'M',
      } as ConductState);

      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'conflict_check',
        onReviewArtifacts,
      });

      await conductor.run();

      const conflictCalls = onReviewArtifacts.mock.calls.filter((c) => c[0] === 'conflict_check');
      expect(conflictCalls.length).toBe(1);
    });

    it('cleans up the marker after approval', async () => {
      await seedConflictArtifact(dir);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const markerPath = join(dir, '.pipeline/review-required-conflict_check');
      await writeFile(markerPath, '1');
      await writeState(statePath, {
        bootstrap: 'done', memory: 'done', assess: 'done', explore: 'done',
        stories: 'done', complexity_tier: 'M',
      } as ConductState);

      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'conflict_check',
        onReviewArtifacts: vi.fn().mockResolvedValue('approved' as const),
      });

      await conductor.run();

      const { access: _access } = await import('fs/promises');
      const exists = await _access(markerPath).then(() => true, () => false);
      expect(exists).toBe(false);
    });

    it('manual review (e.g. prd) always prompts', async () => {
      // prd is the manual-review DECIDE step that produces an artifact
      // (.docs/specs); explore is advisory + artifact-less so it never prompts.
      await seedPrdArtifact(dir);
      await writeState(statePath, {
        bootstrap: 'done', memory: 'done', assess: 'done', explore: 'done',
        complexity_tier: 'M',
      } as ConductState);

      const onReviewArtifacts = vi.fn().mockResolvedValue('approved' as const);
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        fromStep: 'prd',
        onReviewArtifacts,
      });

      await conductor.run();

      const prdCalls = onReviewArtifacts.mock.calls.filter((c) => c[0] === 'prd');
      expect(prdCalls.length).toBe(1);
    });
  });

  describe('retry budget', () => {
    it('auto-retries a failing step up to maxRetries before escalating', async () => {
      let attempts = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempts++;
          return { success: false, output: 'transient error' };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 3,
        onRecovery,
      });

      const retryEvents: unknown[] = [];
      const failedEvents: unknown[] = [];
      events.on('step_retry', (e) => retryEvents.push(e));
      events.on('step_failed', (e) => failedEvents.push(e));

      await conductor.run();

      // First failing step retries twice (attempts 2 and 3), then step_failed once.
      expect(attempts).toBeGreaterThanOrEqual(3);
      expect(retryEvents.length).toBeGreaterThanOrEqual(2);
      expect(failedEvents.length).toBe(1);
      expect(onRecovery).toHaveBeenCalledOnce();
    });

    it('succeeds on a later retry without firing recovery', async () => {
      let calls = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          calls++;
          return calls < 2 ? { success: false, output: 'transient' } : { success: true };
        }),
      };
      const onRecovery = vi.fn();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        maxRetries: 3,
        onRecovery,
      });

      await conductor.run();

      // No step_failed for the first step — it succeeded on retry.
      expect(onRecovery).not.toHaveBeenCalled();
    });

    it('injects a retry hint into subsequent runs after a completion miss', async () => {
      const retryReasons: Array<string | undefined> = [];
      const runner: StepRunner = {
        run: vi.fn(async (_step: StepName, _state, opts) => {
          retryReasons.push(opts?.retryReason);
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir, // no artifacts — completion check fails
        verifyArtifacts: true,
        maxRetries: 3,
        onRecovery: vi.fn().mockResolvedValue('quit' as const),
      });

      await conductor.run();

      // First invocation of the first artifact-producing step has no hint.
      // Subsequent invocations include "Previous attempt did not satisfy…".
      const hintedRuns = retryReasons.filter((r) => r && r.includes('Previous attempt'));
      expect(hintedRuns.length).toBeGreaterThan(0);
    });

    it('honors per-step default retries (e.g. explore → 5)', async () => {
      // Pre-populate state so we start at explore (DEFAULT_STEP_RETRIES.explore=5).
      await writeState(statePath, {
        bootstrap: 'done',
        memory: 'done',
        assess: 'done',
      } as ConductState);

      let attempts = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          attempts++;
          return { success: false, output: 'fail' };
        }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        resume: true,
        onRecovery: vi.fn().mockResolvedValue('quit' as const),
      });

      await conductor.run();

      // explore default is 5 retries
      expect(attempts).toBe(5);
    });
  });

  describe('custom completion predicates', () => {
    it("build step requires .pipeline/task-status.json with all tasks completed", async () => {
      const runner: StepRunner = {
        run: vi.fn().mockResolvedValue({ success: true }),
      };

      // Pre-satisfy every OTHER artifact-producing step so we reach `build`.
      await writeFile(join(dir, '.docs/decisions/technical-assessment-2026-04-16.md'), 'a', {
        flag: 'w',
      }).catch(async () => {
        await mkdir(join(dir, '.docs/decisions'), { recursive: true });
        await writeFile(join(dir, '.docs/decisions/technical-assessment-2026-04-16.md'), 'a');
      });
      await mkdir(join(dir, '.docs/specs'), { recursive: true });
      await writeFile(join(dir, '.docs/specs/feature.md'), 'x');
      await mkdir(join(dir, '.docs/stories/epic'), { recursive: true });
      await writeFile(join(dir, '.docs/stories/epic/a.md'), 'x');
      await mkdir(join(dir, '.docs/conflicts'), { recursive: true });
      await writeFile(join(dir, '.docs/conflicts/c.md'), 'x');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(join(dir, '.docs/plans/p.md'), 'x');
      await mkdir(join(dir, '.docs/architecture'), { recursive: true });
      await writeFile(join(dir, '.docs/architecture/arch.md'), 'x');
      await writeFile(join(dir, '.docs/decisions/adr-001.md'), 'x');
      await mkdir(join(dir, 'spec/acceptance'), { recursive: true });
      await writeFile(join(dir, 'spec/acceptance/s.rb'), 'x');
      await mkdir(join(dir, '.docs/retros'), { recursive: true });
      await writeFile(join(dir, '.docs/retros/r.md'), 'x');

      // Write a task-status.json with an INCOMPLETE task
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/acceptance-specs-red.json'), RED_EVIDENCE_JSON);
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 't1', status: 'pending' }] }),
      );

      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        maxRetries: 1,
        onRecovery,
      });

      const failedEvents: Array<{ step: string; error: string }> = [];
      events.on('step_failed', (e) => {
        if (e.type === 'step_failed') failedEvents.push({ step: e.step, error: e.error });
      });

      await conductor.run();

      const buildFailure = failedEvents.find((e) => e.step === 'build');
      expect(buildFailure).toBeDefined();
      expect(buildFailure?.error).toMatch(/tasks not completed|task-status/i);
    });
  });

  describe('verifyArtifacts gate', () => {
    it('fails a step that declares artifacts but produces none', async () => {
      const runner: StepRunner = {
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir, // empty tmp dir — no artifacts anywhere
        verifyArtifacts: true,
        maxRetries: 1, // fail fast for this test
        onRecovery,
      });

      const failedEvents: Array<{ step: string; error: string }> = [];
      events.on('step_failed', (e) => {
        if (e.type === 'step_failed') failedEvents.push({ step: e.step, error: e.error });
      });

      await conductor.run();

      // First artifact-producing step in the flow is 'assess'
      // (bootstrap/memory produce none). verifyArtifacts flags it missing.
      expect(failedEvents.length).toBeGreaterThan(0);
      expect(failedEvents[0].error).toMatch(/completion check failed|no files matching/);
    });

    it('passes a step whose declared artifacts exist on disk', async () => {
      // Pre-create artifacts whose creation isn't part of the runner's
      // simulated work (UNDERSTAND/DECIDE/BUILD steps that the conductor
      // expects to find pre-existing). For SHIP-phase steps (manual_test,
      // retro, finish), have the runner mock create the artifact when the
      // step runs — this mirrors real behavior (skill writes its proof
      // mid-step) and ensures the file's mtime is naturally fresh relative
      // to session_started_at.
      const { mkdir: _mkdir, writeFile: _wf } = await import('fs/promises');
      const RETRO_SLUG = 'add-foo';
      const preFixtures: Array<[string, string]> = [
        ['.docs/decisions/technical-assessment-2026-04-16.md', 'test'],
        ['.docs/specs/2026-04-16-feature.md', 'test'],
        ['.docs/stories/epic-1/story-a.md', 'test'],
        ['.docs/conflicts/2026-04-16-conflict.md', 'test'],
        ['.docs/plans/2026-04-16-plan.md', 'test'],
        ['.docs/architecture/2026-04-16-arch.md', 'test'],
        ['.docs/decisions/adr-001.md', 'test'],
        ['spec/acceptance/feature_spec.rb', 'test'],
        ['.pipeline/acceptance-specs-red.json', RED_EVIDENCE_JSON],
        [
          '.pipeline/task-status.json',
          JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
        ],
      ];
      for (const [rel, content] of preFixtures) {
        const full = join(dir, rel);
        await _mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
        await _wf(full, content);
      }

      // Seed feature_desc so the retro predicate slug-matches on filename.
      const seedRes = await readState(statePath);
      const seed = seedRes.ok ? seedRes.value : {};
      seed.feature_desc = 'add foo';
      await writeState(statePath, seed);

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          // Simulate SHIP-phase skills writing their proof artifact during
          // the step. This makes the mtime fresh relative to the conductor's
          // session_started_at (set on Conductor.run() entry).
          if (step === 'manual_test') {
            await _wf(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|---|---|\n| story-a | PASS |\n',
            );
          } else if (step === 'prd_audit') {
            await _mkdir(join(dir, '.pipeline'), { recursive: true });
            await _wf(
              join(dir, '.pipeline/prd-audit.md'),
              '# PRD Audit\n\n| FR | Verdict | Evidence |\n|---|---|---|\n| FR-1 | ALIGNED | foo.ts:1 |\n',
            );
          } else if (step === 'architecture_review_as_built') {
            await _mkdir(join(dir, '.docs/decisions'), { recursive: true });
            await _wf(
              join(dir, '.pipeline/architecture-review-as-built.md'),
              '# As-Built Review\n\nVerdict: APPROVED\n',
            );
          } else if (step === 'retro') {
            await _mkdir(join(dir, '.docs/retros'), { recursive: true });
            await _wf(
              join(dir, `.docs/retros/2026-05-01-${RETRO_SLUG}.md`),
              '# Retro\n',
            );
          } else if (step === 'finish') {
            await _mkdir(join(dir, '.pipeline'), { recursive: true });
            await _wf(join(dir, '.pipeline/finish-choice'), 'keep');
          }
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
      });

      const failedEvents: Array<{ step: string }> = [];
      events.on('step_failed', (e) => {
        if (e.type === 'step_failed') failedEvents.push({ step: e.step });
      });

      await conductor.run();

      expect(failedEvents.length).toBe(0);
    });

    it('retries on "retry" recovery action after artifact miss', async () => {
      const runCallCount: Record<string, number> = {};
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          runCallCount[step] = (runCallCount[step] ?? 0) + 1;
          return { success: true };
        }),
      };
      // First call to onRecovery: 'retry' (still no files — will fail again → quit)
      // Second call: 'quit' to end the run cleanly.
      const onRecovery = vi
        .fn<[StepName, boolean], Promise<RecoveryOption>>()
        .mockResolvedValueOnce('retry')
        .mockResolvedValue('quit');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir, // no artifacts — every artifact-producing step fails verification
        verifyArtifacts: true,
        maxRetries: 1, // fail fast so the recovery menu fires after 1 miss
        onRecovery,
      });

      await conductor.run();

      // `prd` (first step with artifacts — explore/complexity are artifact-less)
      // should have been retried once after the artifact-miss failure.
      expect(runCallCount['prd']).toBeGreaterThanOrEqual(2);
    });

    it('is a no-op when verifyArtifacts is false (default)', async () => {
      const runner: StepRunner = {
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        // verifyArtifacts omitted — defaults to false
      });

      const failedEvents: unknown[] = [];
      events.on('step_failed', (e) => failedEvents.push(e));

      await conductor.run();

      expect(failedEvents.length).toBe(0);
    });
  });
});

describe('recovery retry budget', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-retrybudget-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function failThenSucceedRunner(failStep: StepName, succeedAfter: number): { runner: StepRunner; calls: () => number } {
    let count = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step !== failStep) return { success: true };
        count++;
        return count > succeedAfter ? { success: true } : { success: false, output: 'nope' };
      }),
    };
    return { runner, calls: () => count };
  }

  it('passes RecoveryContext with recoveryCount=0 on first recovery entry', async () => {
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', stories: 'done',
      conflict_check: 'done', plan: 'done', architecture_diagram: 'done',
      architecture_review: 'done', writing_system_tests: 'done',
    } as ConductState);
    const { runner } = failThenSucceedRunner('build', Infinity);
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      maxRetries: 1,
      onRecovery,
    });

    await conductor.run();

    expect(onRecovery).toHaveBeenCalledWith(
      'build',
      expect.any(Boolean),
      expect.objectContaining({ recoveryCount: 0, retriesExhausted: false }),
    );
  });

  it('marks retriesExhausted after MAX_RECOVERY_RETRIES cycles', async () => {
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', stories: 'done',
      conflict_check: 'done', plan: 'done', architecture_diagram: 'done',
      architecture_review: 'done', writing_system_tests: 'done',
    } as ConductState);
    const { runner } = failThenSucceedRunner('build', Infinity);

    // Sequence: 1st recovery → retry. 2nd recovery → retry. 3rd recovery → retriesExhausted=true, return quit.
    let call = 0;
    const seenContexts: Array<{ recoveryCount: number; retriesExhausted: boolean }> = [];
    const onRecovery = vi.fn(async (_step, _gating, context) => {
      call++;
      seenContexts.push(context ?? { recoveryCount: -1, retriesExhausted: false });
      if (call <= 2) return 'retry' as const;
      return 'quit' as const;
    });

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      maxRetries: 1,
      onRecovery,
    });

    await conductor.run();

    expect(seenContexts[0]).toEqual({ recoveryCount: 0, retriesExhausted: false });
    expect(seenContexts[1]).toEqual({ recoveryCount: 1, retriesExhausted: false });
    expect(seenContexts[2]).toEqual({ recoveryCount: 2, retriesExhausted: true });
  });

  it('does not infinite-loop when a non-conforming onRecovery returns retry after exhaustion', async () => {
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', stories: 'done',
      conflict_check: 'done', plan: 'done', architecture_diagram: 'done',
      architecture_review: 'done', writing_system_tests: 'done',
    } as ConductState);
    const { runner } = failThenSucceedRunner('build', Infinity);

    // Adversarial callback: returns 'retry' forever, ignoring context.
    // Engine should poll for a different answer once retriesExhausted=true.
    // We give up and return quit after 6 calls so the test terminates.
    let call = 0;
    const onRecovery = vi.fn(async () => {
      call++;
      return call <= 5 ? ('retry' as const) : ('quit' as const);
    });

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      maxRetries: 1,
      onRecovery,
    });

    await conductor.run();

    // The engine looped back to the recovery menu instead of honoring 'retry'
    // after the budget was exhausted. Number of calls proves we didn't short-circuit
    // into an infinite i-- retry loop.
    expect(call).toBeGreaterThan(2);
    expect(call).toBeLessThanOrEqual(6);
  });
});

describe('buildRetryHint', () => {
  it('returns the generic "finish the work now" hint by default', () => {
    const hint = buildRetryHint('stories', 'missing file x');
    expect(hint).toContain('Finish the work now');
    expect(hint).toContain('missing file x');
  });

  it('handles an undefined reason by labeling it "unknown"', () => {
    const hint = buildRetryHint('plan', undefined);
    expect(hint).toContain('unknown');
  });

  it('redirects Claude to update task-status.json for build "tasks not completed" failures', () => {
    const hint = buildRetryHint('build', '9/31 tasks not completed: 9, 10, 11 (+6 more)');
    expect(hint).toContain('may already be done');
    expect(hint).toContain('git log');
    expect(hint).toContain('.pipeline/task-status.json');
    expect(hint).not.toContain('Finish the work now');
  });

  it('falls back to the generic hint for build failures unrelated to task completion', () => {
    const hint = buildRetryHint('build', 'missing .pipeline/task-status.json — the pipeline skill must create it');
    expect(hint).toContain('Finish the work now');
    expect(hint).not.toContain('may already be done');
  });

  it('uses the generic hint for non-build steps even if reason mentions tasks', () => {
    const hint = buildRetryHint('plan', '3 tasks not completed: x');
    expect(hint).toContain('Finish the work now');
    expect(hint).not.toContain('may already be done');
  });
});

describe('auto-heal', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  const mockedExeca = vi.mocked(execa);

  // Fixture: a plan file with two tasks and a task-status.json marking task 9
  // pending and task 10 completed. Shared across the happy-path, skip, and
  // once-per-session tests so each describes only the mocked git behavior.
  async function seedProjectFixture(opts: {
    planContent?: string;
    task9Status?: 'pending' | 'completed';
  } = {}): Promise<void> {
    const {
      planContent = [
        '# Harden MVP',
        '',
        '## Task 9: Users slice',
        '',
        'Implements the Users slice.',
        '',
        '- `src/users/controller.ts`',
        '- `src/users/routes.ts`',
        '',
        '## Task 10: Habits slice',
        '',
        '- `src/habits/controller.ts`',
        '',
      ].join('\n'),
      task9Status = 'pending',
    } = opts;

    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await writeFile(join(dir, '.docs/plans/2026-04-17-harden-mvp.md'), planContent);

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify(
        {
          plan_ref: '2026-04-17-harden-mvp.md',
          tasks: {
            '9': { name: 'Users slice', status: task9Status, batch: 'C' },
            '10': { name: 'Habits slice', status: 'completed', batch: 'C', commit: 'cafef00d' },
          },
        },
        null,
        2,
      ),
    );
  }

  function seedAllOtherArtifacts(): Promise<void[]> {
    // Pre-create every artifact-producing step's expected file so the
    // conductor advances to `build`. Mirrors the verifyArtifacts-gate tests.
    const artifacts: Array<[string, string]> = [
      ['.docs/decisions/technical-assessment-2026-04-17.md', 'test'],
      ['.docs/specs/2026-04-17-feature.md', 'test'],
      ['.docs/stories/epic-1/story-a.md', 'test'],
      ['.docs/conflicts/2026-04-17-conflict.md', 'test'],
      ['.docs/architecture/2026-04-17-arch.md', 'test'],
      ['.docs/decisions/adr-001.md', 'test'],
      ['spec/acceptance/feature_spec.rb', 'test'],
      ['.pipeline/acceptance-specs-red.json', RED_EVIDENCE_JSON],
      ['.docs/retros/2026-04-17-retro.md', 'test'],
    ];
    return Promise.all(
      artifacts.map(async ([rel, content]) => {
        const full = join(dir, rel);
        await mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
        await writeFile(full, content);
      }),
    );
  }

  function routeGitMock(
    handlers: Partial<{
      mergeBase: { stdout: string; exitCode?: number };
      log: { stdout: string; exitCode?: number };
      diffTree: (sha: string) => { stdout: string; exitCode?: number };
    }>,
  ): void {
    mockedExeca.mockImplementation(((cmd: string, args: readonly string[]) => {
      if (cmd !== 'git') {
        return Promise.resolve({ stdout: '', exitCode: 1 } as never);
      }
      const subcommand = args[0];
      if (subcommand === 'merge-base') {
        const h = handlers.mergeBase ?? { stdout: '', exitCode: 128 };
        return Promise.resolve({ stdout: h.stdout, exitCode: h.exitCode ?? 0 } as never);
      }
      if (subcommand === 'log') {
        const h = handlers.log ?? { stdout: '', exitCode: 0 };
        return Promise.resolve({ stdout: h.stdout, exitCode: h.exitCode ?? 0 } as never);
      }
      if (subcommand === 'diff-tree') {
        const sha = args[args.length - 1] as string;
        const h = handlers.diffTree
          ? handlers.diffTree(sha)
          : { stdout: '', exitCode: 0 };
        return Promise.resolve({ stdout: h.stdout, exitCode: h.exitCode ?? 0 } as never);
      }
      return Promise.resolve({ stdout: '', exitCode: 1 } as never);
    }) as never);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-autoheal-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    mockedExeca.mockReset();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('heals a pending task when commit subject + files match unambiguously', async () => {
    await seedAllOtherArtifacts();
    await seedProjectFixture();
    routeGitMock({
      mergeBase: { stdout: 'deadbeef0000000000000000000000000000dead' },
      log: { stdout: 'abc1234567890000000000000000000000000000\tfeat(T9): add users slice' },
      diffTree: () => ({ stdout: 'src/users/controller.ts\nsrc/users/routes.ts' }),
    });

    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
    const healEvents: Array<{ healed: number; skipped: number }> = [];
    events.on('auto_heal', (e) => {
      if (e.type === 'auto_heal') healEvents.push({ healed: e.healed, skipped: e.skipped });
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 2,
    });

    await conductor.run();

    const { readFile: _rf } = await import('fs/promises');
    const afterRaw = await _rf(join(dir, '.pipeline/task-status.json'), 'utf-8');
    const after = JSON.parse(afterRaw);
    expect(after.tasks['9'].status).toBe('completed');
    expect(after.tasks['9'].commit).toBe('abc1234');

    // Build runner was called exactly once — no retry was needed.
    const buildCalls = (runner.run as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'build',
    );
    expect(buildCalls).toHaveLength(1);
    expect(healEvents).toEqual([{ healed: 1, skipped: 0 }]);
  });

  it('leaves a task pending when evidence is weak and runs the normal retry path', async () => {
    await seedAllOtherArtifacts();
    await seedProjectFixture();
    routeGitMock({
      mergeBase: { stdout: 'deadbeef0000000000000000000000000000dead' },
      log: { stdout: 'deadbeef1111111111111111111111111111beef\tchore: lint fixes' },
      diffTree: () => ({ stdout: 'eslintrc.js' }),
    });

    let buildCalls = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'build') buildCalls++;
        return { success: true };
      }),
    };
    const retryEvents: Array<{ reason: string }> = [];
    events.on('step_retry', (e) => {
      if (e.type === 'step_retry' && e.step === 'build') retryEvents.push({ reason: e.reason });
    });
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 2,
      onRecovery,
    });

    await conductor.run();

    const { readFile: _rf } = await import('fs/promises');
    const afterRaw = await _rf(join(dir, '.pipeline/task-status.json'), 'utf-8');
    const after = JSON.parse(afterRaw);
    expect(after.tasks['9'].status).toBe('pending');
    expect(buildCalls).toBeGreaterThanOrEqual(2);
    expect(retryEvents.length).toBeGreaterThanOrEqual(1);
    expect(retryEvents[0].reason).toMatch(/tasks not completed/i);
  });

  it('runs auto-heal at most once per session even across multiple gate failures', async () => {
    await seedAllOtherArtifacts();
    await seedProjectFixture();
    routeGitMock({
      mergeBase: { stdout: 'deadbeef0000000000000000000000000000dead' },
      log: { stdout: 'feedface1111111111111111111111111111face\tchore: nothing relevant' },
      diffTree: () => ({ stdout: 'README.md' }),
    });

    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const healEventCount = { count: 0 };
    events.on('auto_heal', () => {
      healEventCount.count++;
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3,
      onRecovery,
    });

    await conductor.run();

    const gitLogCalls = mockedExeca.mock.calls.filter(
      (c) => c[0] === 'git' && (c[1] as string[])[0] === 'log',
    );
    expect(gitLogCalls).toHaveLength(1);
    expect(healEventCount.count).toBe(1);
  });

  it('silently skips when git is absent and falls through to the normal retry path', async () => {
    await seedAllOtherArtifacts();
    await seedProjectFixture();
    // No .git dir and merge-base fails with 128 (fatal: not a git repository)
    routeGitMock({
      mergeBase: { stdout: '', exitCode: 128 },
      log: { stdout: '', exitCode: 128 },
    });

    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const healEvents: Array<{ healed: number; skipped: number }> = [];
    events.on('auto_heal', (e) => {
      if (e.type === 'auto_heal') healEvents.push({ healed: e.healed, skipped: e.skipped });
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 2,
      onRecovery,
    });

    await conductor.run();

    const { readFile: _rf } = await import('fs/promises');
    const afterRaw = await _rf(join(dir, '.pipeline/task-status.json'), 'utf-8');
    const after = JSON.parse(afterRaw);
    expect(after.tasks['9'].status).toBe('pending');
    // Auto-heal still fired once (and skipped everything) — the dashboard should record the attempt.
    expect(healEvents).toEqual([{ healed: 0, skipped: 1 }]);
  });

  it('writes an audit file under .pipeline/audit-trail with healed + skipped entries', async () => {
    await seedAllOtherArtifacts();
    await seedProjectFixture();
    routeGitMock({
      mergeBase: { stdout: 'deadbeef0000000000000000000000000000dead' },
      log: { stdout: 'abc1234567890000000000000000000000000000\tfeat(T9): add users slice' },
      diffTree: () => ({ stdout: 'src/users/controller.ts' }),
    });

    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 2,
    });

    await conductor.run();

    const auditDir = join(dir, '.pipeline/audit-trail');
    const entries = await readdir(auditDir);
    const autohealFiles = entries.filter((e) => e.startsWith('autoheal-') && e.endsWith('.json'));
    expect(autohealFiles).toHaveLength(1);
    const { readFile: _rf } = await import('fs/promises');
    const audit = JSON.parse(await _rf(join(auditDir, autohealFiles[0]), 'utf-8'));
    expect(Array.isArray(audit.healed)).toBe(true);
    expect(Array.isArray(audit.skipped)).toBe(true);
    expect(audit.healed[0]).toMatchObject({
      taskId: '9',
      commit: 'abc1234',
      subject: 'feat(T9): add users slice',
    });
    expect(audit.healed[0].matchedFiles).toContain('src/users/controller.ts');
  });

  it('never invokes git for non-build steps even when their completion gate fails', async () => {
    // Don't seed artifacts — `assess` will fail its gate, not `build`.
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const healEvents: unknown[] = [];
    events.on('auto_heal', (e) => healEvents.push(e));

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 1,
      onRecovery,
    });

    await conductor.run();

    expect(mockedExeca).not.toHaveBeenCalled();
    expect(healEvents).toHaveLength(0);
  });
});

describe('skip-already-resolved steps', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-skipdone-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('does not re-dispatch steps already marked done', async () => {
    // Pre-populate state with some steps already done — this mirrors the
    // real-world situation of running conduct-ts against a project that
    // already made progress on a previous invocation.
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      complexity_tier: 'L',
    } as ConductState);

    const calledSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calledSteps.push(step);
        return { success: true };
      }),
    };

    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    // None of the `done` steps should have been re-dispatched.
    expect(calledSteps).not.toContain('worktree');
    expect(calledSteps).not.toContain('explore');
    expect(calledSteps).not.toContain('plan');
    expect(calledSteps).not.toContain('acceptance_specs');

    // Only the remaining steps (build → finish) should have run.
    expect(calledSteps).toContain('build');
    expect(calledSteps).toContain('finish');
  });

  it('does not re-dispatch steps marked skipped', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'skipped',
      explore: 'done',
      complexity: 'done',
      complexity_tier: 'S',
      stories: 'done',
      plan: 'done',
      acceptance_specs: 'skipped',
    } as ConductState);

    const calledSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calledSteps.push(step);
        return { success: true };
      }),
    };

    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    expect(calledSteps).not.toContain('memory');
    expect(calledSteps).not.toContain('acceptance_specs');
  });

  it('DOES re-dispatch steps marked failed (so recovery flow can run again)', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      complexity_tier: 'L',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'failed',
    } as ConductState);

    const calledSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calledSteps.push(step);
        return { success: true };
      }),
    };

    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    // failed build is re-entered; done steps before it are skipped.
    expect(calledSteps).toContain('build');
    expect(calledSteps).not.toContain('worktree');
    expect(calledSteps).not.toContain('plan');
  });

  it('DOES re-dispatch a done step when --from targets it explicitly', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      complexity_tier: 'L',
      stories: 'done',
      conflict_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      plan: 'done',
    } as ConductState);

    const calledSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calledSteps.push(step);
        return { success: true };
      }),
    };

    // --from explicitly asks to re-run `plan` regardless of its current status.
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'plan',
    });
    await conductor.run();

    expect(calledSteps[0]).toBe('plan');
  });
});

describe('build-step stall circuit breaker', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-stall-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seedAllArtifactsExceptTaskStatus(): Promise<void> {
    const artifacts: Array<[string, string]> = [
      ['.docs/decisions/technical-assessment-2026-04-18.md', 'x'],
      ['.docs/specs/2026-04-18-feature.md', 'x'],
      ['.docs/stories/epic-1/a.md', 'x'],
      ['.docs/conflicts/2026-04-18.md', 'x'],
      ['.docs/plans/2026-04-18-plan.md', 'x'],
      ['.docs/architecture/arch.md', 'x'],
      ['.docs/decisions/adr-001.md', 'x'],
      ['spec/acceptance/feature_spec.rb', 'x'],
      ['.pipeline/acceptance-specs-red.json', RED_EVIDENCE_JSON],
      ['.docs/retros/2026-04-18-retro.md', 'x'],
    ];
    for (const [rel, content] of artifacts) {
      const full = join(dir, rel);
      await mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
      await writeFile(full, content);
    }
  }

  async function writeTaskStatus(completed: number, total: number): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const tasks: Array<{ id: number; status: string }> = [];
    for (let i = 1; i <= total; i++) {
      tasks.push({ id: i, status: i <= completed ? 'completed' : 'pending' });
    }
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
  }

  it('triggers build_stall after two retries with zero new task completions', async () => {
    await seedAllArtifactsExceptTaskStatus();
    await writeTaskStatus(2, 5); // 2/5 done — and it never changes

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockResolvedValue({ success: true }),
      runInteractive: vi.fn(async () => {
        // The "interactive session" is a no-op for the test; it simulates the
        // user dropping in and /quitting without doing additional work.
      }),
    };

    const stallEvents: Array<{ reason: string; before: number; after: number }> = [];
    events.on('build_stall', (e) => {
      if (e.type === 'build_stall') {
        stallEvents.push({
          reason: e.reason,
          before: e.resolvedBefore,
          after: e.resolvedAfter,
        });
      }
    });

    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3,
      onRecovery,
    });

    await conductor.run();

    expect(stallEvents).toHaveLength(1);
    expect(stallEvents[0].reason).toBe('no_task_progress');
    expect(stallEvents[0].before).toBe(2);
    expect(stallEvents[0].after).toBe(2);
    expect(runner.runInteractive).toHaveBeenCalledWith('build');
  });

  it('triggers build_stall on the first retry when .pipeline/halt-user-input-required is present', async () => {
    await seedAllArtifactsExceptTaskStatus();
    await writeTaskStatus(3, 10);
    // Halt marker present — conductor should stall immediately without
    // waiting for a second retry.
    await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'scope mismatch');

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockResolvedValue({ success: true }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const stallEvents: Array<{ reason: string }> = [];
    events.on('build_stall', (e) => {
      if (e.type === 'build_stall') stallEvents.push({ reason: e.reason });
    });

    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3,
      onRecovery,
    });

    await conductor.run();

    expect(stallEvents).toHaveLength(1);
    expect(stallEvents[0].reason).toBe('halt_marker');
    expect(runner.runInteractive).toHaveBeenCalledWith('build');
    // Marker cleared after acknowledgement.
    let markerStillThere = false;
    try {
      await readFile(join(dir, '.pipeline/halt-user-input-required'));
      markerStillThere = true;
    } catch {
      /* marker removed — expected */
    }
    expect(markerStillThere).toBe(false);
  });

  it('does NOT trigger build_stall when a retry produces new task completions', async () => {
    await seedAllArtifactsExceptTaskStatus();

    let progress = 0;
    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'build') {
          // Each build attempt marks one more task completed.
          progress++;
          await writeTaskStatus(progress, 4);
        }
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const stallEvents: unknown[] = [];
    events.on('build_stall', (e) => stallEvents.push(e));

    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 5,
      onRecovery,
    });

    await conductor.run();

    // Progress was made every attempt, so no stall.
    expect(stallEvents).toHaveLength(0);
    expect(runner.runInteractive).not.toHaveBeenCalled();
  });

  it('proceeds as succeeded when the interactive REPL finishes the work', async () => {
    await seedAllArtifactsExceptTaskStatus();
    await writeTaskStatus(2, 5); // stalled at 2/5

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockResolvedValue({ success: true }),
      runInteractive: vi.fn(async () => {
        // Simulate the user + Claude finishing the remaining tasks during
        // the interactive session.
        await writeTaskStatus(5, 5);
      }),
    };

    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3,
      onRecovery,
    });

    await conductor.run();

    // After the REPL the completion gate passed, so the step succeeded —
    // onRecovery should NOT have fired.
    expect(runner.runInteractive).toHaveBeenCalledWith('build');
    expect(onRecovery).not.toHaveBeenCalledWith('build', expect.anything(), expect.anything());
  });
});

// NOTE: The old `bootstrap-mode skip` suite was removed with the Option B
// design decision: bootstrap + assess are project-level concerns handled by
// `runProjectPrelude` (see src/engine/project-prelude.ts and its test file),
// not per-feature-loop steps. The prelude invokes them on its own triggers
// (marker presence, harness version bump, codebase detection) — there's no
// longer a `bootstrap_mode` field in ConductState for the feature loop to
// react to.

describe('engine/conductor: pipeline-exit false-completion regression', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-bug-test-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('does NOT mark feature_status=complete when pipeline halt marker is present', async () => {
    // The original user-reported bug: pipeline exited mid-implementation
    // (user picked "exit to harness, continue later"), but Claude failed to
    // write .pipeline/halt-user-input-required. Result: build gate read an
    // all-completed task-status.json, build was marked done, SHIP-phase
    // gates cascaded false-completion, feature_status=complete was set.
    //
    // Post-fix: the build predicate fails when the halt marker is present,
    // even with all-complete task-status.json. The conductor's stall
    // handler opens an interactive REPL, the user resolves the blocker
    // there, and the gate re-checks. If the REPL was a no-op (this test),
    // recovery menu fires.
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );
    await writeFile(
      join(dir, '.pipeline/halt-user-input-required'),
      'user requested exit; 1 regression in test_X',
    );
    // Pre-create earlier-step artifacts so the conductor doesn't fail
    // before reaching build.
    const preFixtures: Array<[string, string]> = [
      ['.docs/decisions/technical-assessment-2026-04-16.md', 'a'],
      ['.docs/specs/2026-04-16-feature.md', 'a'],
      ['.docs/stories/epic-1/story-a.md', 'a'],
      ['.docs/conflicts/2026-04-16-conflict.md', 'a'],
      ['.docs/plans/2026-04-16-plan.md', 'a'],
      ['.docs/architecture/2026-04-16-arch.md', 'a'],
      ['.docs/decisions/adr-001.md', 'a'],
      ['spec/acceptance/feature_spec.rb', 'a'],
      ['.pipeline/acceptance-specs-red.json', RED_EVIDENCE_JSON],
    ];
    for (const [rel, content] of preFixtures) {
      const full = join(dir, rel);
      await mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
      await writeFile(full, content);
    }

    // Re-write the halt marker on every run() call so the predicate keeps
    // failing even after the conductor's stall handler clears it.
    const runner: StepRunner = {
      run: vi.fn(async () => {
        await writeFile(
          join(dir, '.pipeline/halt-user-input-required'),
          'user requested exit; 1 regression in test_X',
        );
        return { success: true };
      }),
      // The stall handler opens this REPL on the build step. The mock is
      // a no-op — the user did NOT resolve the halt — so the marker that
      // gets re-written by run() (above) keeps the gate failing.
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 1,
      onRecovery,
    });

    const buildStalls: string[] = [];
    events.on('build_stall', (e) => {
      if (e.type === 'build_stall') buildStalls.push(e.reason);
    });

    await conductor.run();

    // The conductor must have detected the halt marker (build_stall event
    // with reason='halt_marker').
    expect(buildStalls).toContain('halt_marker');

    // Most importantly: feature_status must NOT be 'complete' — the user's
    // unresolved blocker must not silently cascade through to "feature done."
    const r = await readState(statePath);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.feature_status).toBeUndefined();
    }
  });

  it('clears stale .pipeline/finish-choice on session start', async () => {
    // A stale finish-choice marker from a previous run must not satisfy
    // the gate. The conductor sweeps it on Conductor.run() entry, before
    // any step runs.
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/finish-choice'), 'pr');

    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        // On the first runner-dispatched step (memory — worktree is
        // engine-managed), observe that the sweep happened: the marker should
        // already be gone before any runner step.
        const { access } = await import('fs/promises');
        if (step === 'memory') {
          let stillExists = true;
          try {
            await access(join(dir, '.pipeline/finish-choice'));
          } catch {
            stillExists = false;
          }
          // Recorded on the runner's mock for assertion below.
          (runner as unknown as { sweepObserved?: boolean }).sweepObserved = !stillExists;
        }
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: false,
    });

    await conductor.run();

    expect(
      (runner as unknown as { sweepObserved?: boolean }).sweepObserved,
    ).toBe(true);
  });
});

describe('projectRoot is required', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-projectroot-test-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('throws when projectRoot is undefined', async () => {
    const runner = createMockStepRunner();

    // Verify .pipeline does not exist before construction attempt
    let pipelineExistsBefore = false;
    try {
      const files = await readdir(join(dir, '.pipeline'));
      pipelineExistsBefore = files.length > 0;
    } catch {
      pipelineExistsBefore = false;
    }
    expect(pipelineExistsBefore).toBe(false);

    expect(() => {
      new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: undefined as unknown as string,
      });
    }).toThrow(/projectRoot/i);

    // Verify .pipeline was NOT created by failed construction
    let pipelineExistsAfter = false;
    try {
      const files = await readdir(join(dir, '.pipeline'));
      pipelineExistsAfter = files.length > 0;
    } catch {
      pipelineExistsAfter = false;
    }
    expect(pipelineExistsAfter).toBe(false);
  });

  it('throws when projectRoot is an empty string', async () => {
    const runner = createMockStepRunner();

    // Verify .pipeline does not exist before construction attempt
    let pipelineExistsBefore = false;
    try {
      const files = await readdir(join(dir, '.pipeline'));
      pipelineExistsBefore = files.length > 0;
    } catch {
      pipelineExistsBefore = false;
    }
    expect(pipelineExistsBefore).toBe(false);

    expect(() => {
      new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: '',
      });
    }).toThrow(/projectRoot/i);

    // Verify .pipeline was NOT created by failed construction
    let pipelineExistsAfter = false;
    try {
      const files = await readdir(join(dir, '.pipeline'));
      pipelineExistsAfter = files.length > 0;
    } catch {
      pipelineExistsAfter = false;
    }
    expect(pipelineExistsAfter).toBe(false);
  });

  describe('completionCtx threading', () => {
    it('includes daemon flag and isHeadPushed injectable in completion context', async () => {
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        daemon: true,
      });

      // Access private method via bracket notation for testing
      const state: ConductState = {
        worktree: 'pending',
        session_started_at: Date.now(),
      } as ConductState;
      const ctx = (conductor as any)['completionCtx'](state);

      // Verify daemon field is threaded
      expect(ctx.daemon).toBe(true);

      // Verify isHeadPushed is defined and callable
      expect(ctx.isHeadPushed).toBeDefined();
      expect(typeof ctx.isHeadPushed).toBe('function');
    });

    it('isHeadPushed injectable returns null when git runner fails', async () => {
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        daemon: true,
      });

      const state: ConductState = {
        worktree: 'pending',
        session_started_at: Date.now(),
      } as ConductState;
      const ctx = (conductor as any)['completionCtx'](state);

      // Call isHeadPushed and verify it handles errors gracefully
      // (returns null instead of throwing)
      const result = await ctx.isHeadPushed!();
      // In a non-git directory, it should return null (indeterminate)
      expect(result).toBeNull();
    });
  });
});
