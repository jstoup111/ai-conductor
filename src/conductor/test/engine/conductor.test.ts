import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ConductState } from '../../src/types/index.js';
import type { StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';

function createMockStepRunner(result: StepRunResult = { success: true }): StepRunner {
  return {
    run: vi.fn().mockResolvedValue(result),
  };
}

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

  it('starts at step index 0 for new feature', async () => {
    const runner = createMockStepRunner();
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // The first call to run should have been with the first step
    expect(runner.run).toHaveBeenCalledTimes(ALL_STEPS.length);
    expect((runner.run as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('worktree');
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
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // Every step should have been in_progress when its runner was called
    expect(statusesDuringRun['worktree']).toBe('in_progress');
    expect(statusesDuringRun['brainstorm']).toBe('in_progress');
    expect(statusesDuringRun['finish']).toBe('in_progress');
  });

  it('marks step done after success', async () => {
    const runner = createMockStepRunner();
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // After run completes, all steps should be 'done' in state file
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['worktree']).toBe('done');
      expect(result.value['brainstorm']).toBe('done');
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
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // Steps should be called in exact ALL_STEPS order
    const expectedOrder = ALL_STEPS.map((s) => s.name);
    expect(callOrder).toEqual(expectedOrder);
  });

  it('sets feature_status=complete when all steps done', async () => {
    const runner = createMockStepRunner();
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feature_status).toBe('complete');
    }
  });

  it('emits step_started and step_completed events', async () => {
    const runner = createMockStepRunner();
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    const emitted: Array<{ type: string; step: string }> = [];
    events.on('step_started', (e) => {
      if (e.type === 'step_started') emitted.push({ type: e.type, step: e.step });
    });
    events.on('step_completed', (e) => {
      if (e.type === 'step_completed') emitted.push({ type: e.type, step: e.step });
    });

    await conductor.run();

    // Should have started and completed events for each step
    expect(emitted.length).toBe(ALL_STEPS.length * 2);

    // Check first step events are in correct order
    expect(emitted[0]).toEqual({ type: 'step_started', step: 'worktree' });
    expect(emitted[1]).toEqual({ type: 'step_completed', step: 'worktree' });

    // Check last step
    const lastIdx = (ALL_STEPS.length - 1) * 2;
    expect(emitted[lastIdx]).toEqual({ type: 'step_started', step: 'finish' });
    expect(emitted[lastIdx + 1]).toEqual({ type: 'step_completed', step: 'finish' });
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

    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    // SIGINT handler should have been registered
    expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));

    // State should have been saved (handler calls writeState)
    const result = await readState(statePath);
    expect(result.ok).toBe(true);

    processOnSpy.mockRestore();
  });
});
