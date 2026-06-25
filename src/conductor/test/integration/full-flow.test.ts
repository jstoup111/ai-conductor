import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { StepName, ConductState, ConductorEvent } from '../../src/types/index.js';

class MockStepRunner implements StepRunner {
  calls: StepName[] = [];
  failOn?: StepName;

  async run(step: StepName): Promise<StepRunResult> {
    this.calls.push(step);
    if (this.failOn === step) {
      return { success: false, output: `${step} failed` };
    }
    return { success: true };
  }
}

describe('Integration: full conductor flow', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let runner: MockStepRunner;
  let collectedEvents: ConductorEvent[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-integration-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    runner = new MockStepRunner();
    collectedEvents = [];

    // Collect all events for verification
    const eventTypes: ConductorEvent['type'][] = [
      'step_started', 'step_completed', 'step_failed',
      'tier_skip', 'gate_blocked', 'feature_complete',
      'checkpoint_reached',
    ];
    for (const type of eventTypes) {
      events.on(type, (event: ConductorEvent) => {
        collectedEvents.push(event);
      });
    }
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('all steps complete successfully with L tier', async () => {
    // Pre-populate state with complexity_tier L
    await writeState(statePath, { complexity_tier: 'L' } as ConductState);

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto', // skip checkpoint prompts
    });

    await conductor.run();

    // Every step EXCEPT `complexity`, `worktree`, and `rebase` (all
    // engine-managed) should have been dispatched to runner.run, in ALL_STEPS
    // order.
    const allStepNames = ALL_STEPS.map((s) => s.name);
    const dispatchedStepNames = allStepNames.filter(
      (n) => n !== 'complexity' && n !== 'worktree' && n !== 'rebase',
    );
    expect(runner.calls).toEqual(dispatchedStepNames);
    expect(runner.calls).toHaveLength(dispatchedStepNames.length);

    // Verify final state
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = result.value;

    // All steps marked 'done'
    for (const step of allStepNames) {
      expect(state[step]).toBe('done');
    }

    // Feature is complete
    expect(state.feature_status).toBe('complete');

    // feature_complete event was emitted
    const completeEvent = collectedEvents.find((e) => e.type === 'feature_complete');
    expect(completeEvent).toBeDefined();
  });

  it('S tier skips expected steps', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
    });

    await conductor.run();

    // Steps that should be skipped for S tier
    const expectedSkipped: StepName[] = [
      'conflict_check',
      'architecture_diagram',
      'architecture_review',
      'acceptance_specs',
      'retro',
    ];

    // Steps that should run: ALL_STEPS minus skipped-for-S-tier minus the
    // engine-managed steps (complexity / worktree / rebase).
    const expectedRun = ALL_STEPS
      .map((s) => s.name)
      .filter(
        (n) =>
          !expectedSkipped.includes(n) &&
          n !== 'complexity' &&
          n !== 'worktree' &&
          n !== 'rebase',
      );

    expect(runner.calls).toEqual(expectedRun);
    expect(runner.calls).toHaveLength(expectedRun.length);

    // Verify final state
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = result.value;

    for (const step of expectedSkipped) {
      expect(state[step]).toBe('skipped');
    }

    for (const step of expectedRun) {
      expect(state[step]).toBe('done');
    }

    expect(state.feature_status).toBe('complete');

    // Verify tier_skip events were emitted for each skipped step
    const skipEvents = collectedEvents.filter((e) => e.type === 'tier_skip');
    expect(skipEvents).toHaveLength(expectedSkipped.length);
  });

  it('stops at failed step', async () => {
    await writeState(statePath, { complexity_tier: 'L' } as ConductState);
    runner.failOn = 'build';

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
    });

    await conductor.run();

    // Verify final state
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = result.value;

    const allStepNames = ALL_STEPS.map((s) => s.name);
    const buildIndex = allStepNames.indexOf('build');

    // Steps before build should be 'done'
    for (let i = 0; i < buildIndex; i++) {
      expect(state[allStepNames[i]]).toBe('done');
    }

    // Build should be 'failed'
    expect(state.build).toBe('failed');

    // Steps after build should be 'pending' (not present in state)
    for (let i = buildIndex + 1; i < allStepNames.length; i++) {
      expect(state[allStepNames[i]] ?? 'pending').toBe('pending');
    }

    // Feature should NOT be complete
    expect(state.feature_status).not.toBe('complete');

    // step_failed event was emitted
    const failEvent = collectedEvents.find((e) => e.type === 'step_failed');
    expect(failEvent).toBeDefined();
    if (failEvent && failEvent.type === 'step_failed') {
      expect(failEvent.step).toBe('build');
    }

    // feature_complete event was NOT emitted
    const completeEvent = collectedEvents.find((e) => e.type === 'feature_complete');
    expect(completeEvent).toBeUndefined();
  });

  it('resumes from last state', async () => {
    // Pre-populate state with first 5 steps done
    const allStepNames = ALL_STEPS.map((s) => s.name);
    const preState: ConductState = { complexity_tier: 'L' };
    const doneCount = 5;
    for (let i = 0; i < doneCount; i++) {
      (preState as Record<string, unknown>)[allStepNames[i]] = 'done';
    }
    preState.last_step = allStepNames[doneCount - 1];
    await writeState(statePath, preState);

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      resume: true,
      mode: 'auto',
    });

    await conductor.run();

    // Only remaining steps should have been run. `rebase` is engine-managed
    // (not dispatched to runner.run); the first `doneCount` steps include the
    // other engine-managed steps (complexity/worktree), so the remaining
    // runner-dispatched steps are slice(doneCount) minus `rebase`.
    const expectedRun = allStepNames.slice(doneCount).filter((n) => n !== 'rebase');
    expect(runner.calls).toEqual(expectedRun);
    expect(runner.calls).toHaveLength(expectedRun.length);

    // Verify all steps are now done
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = result.value;

    for (const step of allStepNames) {
      expect(state[step]).toBe('done');
    }

    expect(state.feature_status).toBe('complete');
  });
});
