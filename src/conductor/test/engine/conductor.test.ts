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

  it('enters recovery flow when step returns failure', async () => {
    // Fail on the 3rd step (brainstorm)
    let callCount = 0;
    const runner: StepRunner = {
      run: vi.fn(async () => {
        callCount++;
        if (callCount === 3) return { success: false, output: 'brainstorm failed' };
        return { success: true };
      }),
    };
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    const failedEvents: Array<{ step: string; error: string; retryCount: number }> = [];
    events.on('step_failed', (e) => {
      if (e.type === 'step_failed') failedEvents.push({ step: e.step, error: e.error, retryCount: e.retryCount });
    });

    await conductor.run();

    // step_failed should have been emitted
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].step).toBe('brainstorm');

    // Should NOT have advanced past the failed step
    expect(runner.run).toHaveBeenCalledTimes(3);
  });

  it('does NOT advance to next step on failure', async () => {
    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        if (step === 'brainstorm') return { success: false, output: 'error' };
        return { success: true };
      },
    };
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // Should have run worktree, memory, brainstorm and stopped
    expect(stepsRun).toEqual(['worktree', 'memory', 'brainstorm']);
    // complexity (the step after brainstorm) should NOT have been called
    expect(stepsRun).not.toContain('complexity');
  });

  it('does NOT set feature_status=complete on failure', async () => {
    let callCount = 0;
    const runner: StepRunner = {
      run: async () => {
        callCount++;
        if (callCount === 2) return { success: false };
        return { success: true };
      },
    };
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feature_status).toBeUndefined();
    }
  });

  it('marks failed step as failed in state', async () => {
    let callCount = 0;
    const runner: StepRunner = {
      run: async () => {
        callCount++;
        if (callCount === 3) return { success: false };
        return { success: true };
      },
    };
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['brainstorm']).toBe('failed');
    }
  });

  it('with resume option starts at last in_progress step', async () => {
    // Pre-populate state: worktree=done, memory=done, brainstorm=in_progress
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      brainstorm: 'in_progress',
    } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events, resume: true });

    await conductor.run();

    // Should start at brainstorm (the in_progress step), not worktree
    expect(stepsRun[0]).toBe('brainstorm');
    expect(stepsRun).not.toContain('worktree');
    expect(stepsRun).not.toContain('memory');
  });

  it('with resume option starts at first pending after last done when no in_progress', async () => {
    // Pre-populate state: worktree=done, memory=done, brainstorm=pending
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
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events, resume: true });

    await conductor.run();

    // Should start at brainstorm (first pending after last done)
    expect(stepsRun[0]).toBe('brainstorm');
    expect(stepsRun).not.toContain('worktree');
    expect(stepsRun).not.toContain('memory');
  });

  it('with fromStep option starts at specified step', async () => {
    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events, fromStep: 'stories' });

    await conductor.run();

    // Should start at stories
    expect(stepsRun[0]).toBe('stories');
    expect(stepsRun).not.toContain('worktree');
    expect(stepsRun).not.toContain('brainstorm');
  });

  it('emits step_failed event with correct payload on failure', async () => {
    let callCount = 0;
    const runner: StepRunner = {
      run: async () => {
        callCount++;
        if (callCount === 2) return { success: false, output: 'memory check failed' };
        return { success: true };
      },
    };
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    const failedEvents: Array<{ type: string; step: string; error: string; retryCount: number }> = [];
    events.on('step_failed', (e) => {
      if (e.type === 'step_failed') {
        failedEvents.push({ type: e.type, step: e.step, error: e.error, retryCount: e.retryCount });
      }
    });

    await conductor.run();

    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0]).toEqual({
      type: 'step_failed',
      step: 'memory',
      error: 'memory check failed',
      retryCount: 0,
    });
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
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

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
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

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
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    const expectedOrder = ALL_STEPS.map((s) => s.name);
    expect(stepsRun).toEqual(expectedOrder);
  });

  it('marks all skipped steps as skipped in state for tier S', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const runner = createMockStepRunner();
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

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
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    const tierSkipEvents: Array<{ step: string; tier: string }> = [];
    events.on('tier_skip', (e) => {
      if (e.type === 'tier_skip') tierSkipEvents.push({ step: e.step, tier: e.tier });
    });

    await conductor.run();

    expect(tierSkipEvents.length).toBe(5);
    expect(tierSkipEvents.map((e) => e.step)).toContain('conflict_check');
    expect(tierSkipEvents.map((e) => e.step)).toContain('architecture_diagram');
    expect(tierSkipEvents.map((e) => e.step)).toContain('architecture_review');
    expect(tierSkipEvents.map((e) => e.step)).toContain('acceptance_specs');
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
    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

    await conductor.run();

    // L tier has no skips, so all steps should run
    const expectedOrder = ALL_STEPS.map((s) => s.name);
    expect(stepsRun).toEqual(expectedOrder);

    // No tier_skip events should be emitted
    const tierSkipEvents: Array<{ step: string }> = [];
    events.on('tier_skip', (e) => {
      if (e.type === 'tier_skip') tierSkipEvents.push({ step: e.step });
    });
    expect(tierSkipEvents.length).toBe(0);
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
