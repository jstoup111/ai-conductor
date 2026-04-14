import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ConductState } from '../../src/types/index.js';
import type { StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor, getNavigableSteps, navigateBack } from '../../src/engine/conductor.js';
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
    // Pre-populate prerequisites so gate passes
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      brainstorm: 'done',
    } as ConductState);

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

  it('checks gate before running each step', async () => {
    // stories requires brainstorm — set brainstorm='pending', start from stories
    await writeState(statePath, {} as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'stories',
    });

    await conductor.run();

    // stories should NOT have been run because brainstorm is pending
    expect(stepsRun).not.toContain('stories');
  });

  it('blocks and emits gate_blocked event when gate fails', async () => {
    // stories requires brainstorm — leave brainstorm pending
    await writeState(statePath, {} as ConductState);

    const runner = createMockStepRunner();
    const conductor = new Conductor({
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
    expect(blockedEvents[0].reason).toContain('brainstorm');
  });

  it('passes gate when prerequisite is done', async () => {
    // brainstorm=done satisfies stories prerequisite
    await writeState(statePath, { brainstorm: 'done' } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
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
    // brainstorm=stale should still satisfy the stories gate
    await writeState(statePath, { brainstorm: 'stale' } as ConductState);

    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
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
      brainstorm: 'done',
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
      brainstorm: 'done',
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
    // Run only brainstorm (non-checkpoint step)
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
    } as ConductState);

    const runner = createMockStepRunner();
    const onCheckpoint = vi.fn().mockResolvedValue('continue' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'brainstorm',
      onCheckpoint,
    });

    const checkpointEvents: Array<{ step: string }> = [];
    events.on('checkpoint_reached', (e) => {
      if (e.type === 'checkpoint_reached') checkpointEvents.push({ step: e.step });
    });

    await conductor.run();

    // brainstorm, stories, plan etc. are not checkpoint steps
    expect(checkpointEvents.filter((e) =>
      e.step === 'brainstorm' || e.step === 'stories' || e.step === 'plan'
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
      brainstorm: 'done',
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
      brainstorm: 'done',
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
      brainstorm: 'done',
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

  describe('backward navigation', () => {
    it('getNavigableSteps returns only done and stale steps', () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        brainstorm: 'in_progress',
        complexity: 'pending',
        stories: 'stale',
      };

      const navigable = getNavigableSteps(state);

      const names = navigable.map((s) => s.name);
      expect(names).toContain('worktree');
      expect(names).toContain('memory');
      expect(names).toContain('stories');
      expect(names).not.toContain('brainstorm');
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
        brainstorm: 'done',
        complexity: 'done',
        stories: 'done',
      };

      const result = navigateBack(state, 'brainstorm');

      expect(result.state['brainstorm']).toBe('pending');
    });

    it('navigateBack marks all downstream done steps as stale', () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        brainstorm: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'skipped',
        plan: 'done',
      };

      const result = navigateBack(state, 'brainstorm');

      // brainstorm itself is pending (not stale)
      expect(result.state['brainstorm']).toBe('pending');
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
        brainstorm: 'done',
        complexity: 'done',
      };

      const result = navigateBack(state, 'brainstorm');

      // brainstorm is index 2 in ALL_STEPS
      const expectedIndex = ALL_STEPS.findIndex((s) => s.name === 'brainstorm');
      expect(result.index).toBe(expectedIndex);
    });

    it('Conductor jumps to target index after back navigation', async () => {
      // Set up all prerequisites done through build (a checkpoint step)
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        brainstorm: 'done',
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
        brainstorm: 'done',
        complexity: 'done',
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
        brainstorm: 'done',
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
      const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

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
      const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

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
        brainstorm: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'done',
        plan: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        acceptance_specs: 'done',
        build: 'done',
        manual_test: 'done',
        retro: 'done',
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
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        resume: true,
      });

      await conductor.run();

      // When feature is already complete and resume=true, conductor should
      // start from step 0 (treat as new feature), running all steps again
      expect(stepsRun[0]).toBe('worktree');
      expect(stepsRun.length).toBe(ALL_STEPS.length);
    });

    it('does not set feature_status=complete if any step failed', async () => {
      let callCount = 0;
      const runner: StepRunner = {
        run: async () => {
          callCount++;
          if (callCount === 2) return { success: false };
          return { success: true };
        },
      };
      const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });

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

  it('skips steps listed in config.steps.disable', async () => {
    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: { steps: { disable: ['memory', 'brainstorm'] } },
    });

    await conductor.run();

    expect(stepsRun).not.toContain('memory');
    expect(stepsRun).not.toContain('brainstorm');

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value['memory']).toBe('skipped');
      expect(result.value['brainstorm']).toBe('skipped');
    }
  });

  it('disabled step satisfies downstream gate', async () => {
    // Disable brainstorm, which is a prerequisite for stories
    const stepsRun: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName) => {
        stepsRun.push(step);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: { steps: { disable: ['brainstorm'] } },
    });

    await conductor.run();

    // stories depends on brainstorm — it should still run because
    // brainstorm was skipped and stepSatisfied returns true for 'skipped'
    expect(stepsRun).not.toContain('brainstorm');
    expect(stepsRun).toContain('stories');
  });
});
