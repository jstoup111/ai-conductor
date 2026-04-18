import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));
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
import { writeFile, mkdir } from 'fs/promises';
import { createHash } from 'crypto';

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

    // L tier has no skips; complexity is handled by the engine (not stepRunner)
    const expectedOrder = ALL_STEPS.map((s) => s.name).filter((n) => n !== 'complexity');
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
      let callCount = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          callCount++;
          if (callCount === 3) return { success: false, output: 'brainstorm failed' };
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onRecovery,
      });

      await conductor.run();

      expect(onRecovery).toHaveBeenCalledWith('brainstorm', false);
    });

    it('retries step when recovery returns retry', async () => {
      let brainstormCalls = 0;
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'brainstorm') {
            brainstormCalls++;
            if (brainstormCalls === 1) return { success: false, output: 'failed first time' };
            return { success: true };
          }
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValueOnce('retry' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onRecovery,
      });

      await conductor.run();

      // brainstorm should have been called twice (fail + retry)
      expect(brainstormCalls).toBe(2);
      // All steps should have completed
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.feature_status).toBe('complete');
      }
    });

    it('skips step when recovery returns skip (non-gating)', async () => {
      // brainstorm is advisory (non-gating), so skip should work
      let callCount = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          callCount++;
          if (callCount === 3) return { success: false, output: 'brainstorm failed' };
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('skip' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onRecovery,
      });

      await conductor.run();

      // brainstorm should be marked skipped
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['brainstorm']).toBe('skipped');
        // Should have continued past brainstorm
        expect(result.value.feature_status).toBe('complete');
      }
    });

    it('quits when recovery returns quit', async () => {
      let callCount = 0;
      const runner: StepRunner = {
        run: vi.fn(async () => {
          callCount++;
          if (callCount === 3) return { success: false, output: 'brainstorm failed' };
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        onRecovery,
      });

      await conductor.run();

      // Should have stopped
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value['brainstorm']).toBe('failed');
        expect(result.value.feature_status).toBeUndefined();
      }
    });

    it('calls onRecovery with isGating=true for gating steps', async () => {
      // stories is gating — set up prerequisites
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        brainstorm: 'done',
        complexity: 'done',
      } as ConductState);

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'stories') return { success: false, output: 'stories failed' };
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
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
      // Set up prerequisites through brainstorm
      await writeState(statePath, {
        worktree: 'done',
        memory: 'done',
        brainstorm: 'done',
        complexity: 'done',
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
      const onNavigate = vi.fn().mockResolvedValue('brainstorm' as StepName);
      const conductor = new Conductor({
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
      let brainstormCalls = 0;
      const runner: StepRunner & { runInteractive?: ReturnType<typeof vi.fn> } = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'brainstorm') {
            brainstormCalls++;
            if (brainstormCalls === 1) return { success: false, output: 'brainstorm failed' };
            return { success: true };
          }
          return { success: true };
        }),
        runInteractive: vi.fn().mockResolvedValue(undefined),
      };
      const onRecovery = vi.fn().mockResolvedValueOnce('interactive' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        maxRetries: 1,
        onRecovery,
      });

      await conductor.run();

      // runInteractive should have been called with the failed step
      expect(runner.runInteractive).toHaveBeenCalledWith('brainstorm');
      // Then the step should have been retried
      expect(brainstormCalls).toBe(2);
    });
  });

  describe('complexity assessment', () => {
    it('calls onComplexityAssessment for the complexity step', async () => {
      const runner = createMockStepRunner();
      const onComplexityAssessment = vi.fn().mockResolvedValue('M' as const);
      const conductor = new Conductor({
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
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: {
        steps: {
          memory: { disable: true },
          brainstorm: { disable: true },
        },
      },
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
      config: { steps: { brainstorm: { disable: true } } },
    });

    await conductor.run();

    // stories depends on brainstorm — it should still run because
    // brainstorm was skipped and stepSatisfied returns true for 'skipped'
    expect(stepsRun).not.toContain('brainstorm');
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
        brainstorm: 'done',
        conflict_check: 'done',
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
        brainstorm: 'done',
        conflict_check: 'done',
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
        brainstorm: 'done',
        conflict_check: 'done',
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
        brainstorm: 'done',
        conflict_check: 'done',
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

  describe('conditional review (conflict_check has review=conditional by default)', () => {
    async function seedConflictArtifact(projectRoot: string): Promise<void> {
      await mkdir(join(projectRoot, '.docs/conflicts'), { recursive: true });
      await writeFile(join(projectRoot, '.docs/conflicts/c.md'), 'conflict report');
    }

    async function seedBrainstormArtifact(projectRoot: string): Promise<void> {
      await mkdir(join(projectRoot, '.docs/specs'), { recursive: true });
      await writeFile(join(projectRoot, '.docs/specs/spec.md'), 'spec');
    }

    it('auto-approves conflict_check when no marker file exists', async () => {
      await seedConflictArtifact(dir);
      await writeState(statePath, {
        bootstrap: 'done', memory: 'done', assess: 'done', brainstorm: 'done',
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
        bootstrap: 'done', memory: 'done', assess: 'done', brainstorm: 'done',
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
        bootstrap: 'done', memory: 'done', assess: 'done', brainstorm: 'done',
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

    it('manual review (e.g. brainstorm) always prompts', async () => {
      await seedBrainstormArtifact(dir);
      await writeState(statePath, {
        bootstrap: 'done', memory: 'done', assess: 'done',
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
        fromStep: 'brainstorm',
        onReviewArtifacts,
      });

      await conductor.run();

      const brainstormCalls = onReviewArtifacts.mock.calls.filter((c) => c[0] === 'brainstorm');
      expect(brainstormCalls.length).toBe(1);
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

    it('honors per-step default retries (e.g. brainstorm → 5)', async () => {
      // Pre-populate state so we start at brainstorm (DEFAULT_STEP_RETRIES.brainstorm=5).
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

      // brainstorm default is 5 retries
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
      // Pre-create every artifact-producing step's expected file. `build` uses
      // a custom completion predicate that parses task-status.json — seed it
      // with a completed task so the predicate passes.
      const { mkdir: _mkdir, writeFile: _wf } = await import('fs/promises');
      const artifacts: Array<[string, string]> = [
        ['.docs/decisions/technical-assessment-2026-04-16.md', 'test'],
        ['.docs/specs/2026-04-16-feature.md', 'test'],
        ['.docs/stories/epic-1/story-a.md', 'test'],
        ['.docs/conflicts/2026-04-16-conflict.md', 'test'],
        ['.docs/plans/2026-04-16-plan.md', 'test'],
        ['.docs/architecture/2026-04-16-arch.md', 'test'],
        ['.docs/decisions/adr-001.md', 'test'],
        ['spec/acceptance/feature_spec.rb', 'test'],
        [
          '.pipeline/task-status.json',
          JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
        ],
        ['.docs/retros/2026-04-16-retro.md', 'test'],
      ];
      for (const [rel, content] of artifacts) {
        const full = join(dir, rel);
        await _mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
        await _wf(full, content);
      }

      const runner: StepRunner = {
        run: vi.fn().mockResolvedValue({ success: true }),
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

      // `assess` should have been retried once after the artifact-miss failure
      expect(runCallCount['assess']).toBeGreaterThanOrEqual(2);
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
      worktree: 'done', memory: 'done', brainstorm: 'done', complexity: 'done', stories: 'done',
      conflict_check: 'done', plan: 'done', architecture_diagram: 'done',
      architecture_review: 'done', writing_system_tests: 'done',
    } as ConductState);
    const { runner } = failThenSucceedRunner('build', Infinity);
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
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
      worktree: 'done', memory: 'done', brainstorm: 'done', complexity: 'done', stories: 'done',
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
      worktree: 'done', memory: 'done', brainstorm: 'done', complexity: 'done', stories: 'done',
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
      brainstorm: 'done',
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

    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    // None of the `done` steps should have been re-dispatched.
    expect(calledSteps).not.toContain('worktree');
    expect(calledSteps).not.toContain('brainstorm');
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
      brainstorm: 'done',
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

    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    expect(calledSteps).not.toContain('memory');
    expect(calledSteps).not.toContain('acceptance_specs');
  });

  it('DOES re-dispatch steps marked failed (so recovery flow can run again)', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      brainstorm: 'done',
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

    const conductor = new Conductor({ stateFilePath: statePath, stepRunner: runner, events });
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
      brainstorm: 'done',
      complexity: 'done',
      complexity_tier: 'L',
      stories: 'done',
      conflict_check: 'done',
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
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'plan',
    });
    await conductor.run();

    expect(calledSteps[0]).toBe('plan');
  });
});

describe('bootstrap-mode skip', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-modeskip-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("skips assess with a mode_skip event when bootstrap_mode is 'new'", async () => {
    await writeState(statePath, {
      bootstrap: 'done',
      bootstrap_mode: 'new',
    } as ConductState);

    const calledSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calledSteps.push(step);
        return { success: true };
      }),
    };

    const modeSkipEvents: Array<{ step: string; mode: string }> = [];
    events.on('mode_skip', (e) => {
      if (e.type === 'mode_skip') modeSkipEvents.push({ step: e.step, mode: e.mode });
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
    });

    await conductor.run();

    expect(calledSteps).not.toContain('assess');
    expect(modeSkipEvents).toHaveLength(1);
    expect(modeSkipEvents[0]).toEqual({ step: 'assess', mode: 'new' });

    const finalState = await readState(statePath);
    expect(finalState.ok).toBe(true);
    if (finalState.ok) {
      expect(finalState.value.assess).toBe('skipped');
    }
  });

  it("runs assess normally when bootstrap_mode is 'fresh'", async () => {
    await writeState(statePath, {
      bootstrap: 'done',
      bootstrap_mode: 'fresh',
    } as ConductState);

    const calledSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calledSteps.push(step);
        return { success: true };
      }),
    };
    const modeSkipEvents: unknown[] = [];
    events.on('mode_skip', (e) => modeSkipEvents.push(e));

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
    });

    await conductor.run();

    expect(calledSteps).toContain('assess');
    expect(modeSkipEvents).toHaveLength(0);
  });

  it('runs assess normally when bootstrap_mode is absent from state', async () => {
    await writeState(statePath, { bootstrap: 'done' } as ConductState);

    const calledSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calledSteps.push(step);
        return { success: true };
      }),
    };
    const modeSkipEvents: unknown[] = [];
    events.on('mode_skip', (e) => modeSkipEvents.push(e));

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
    });

    await conductor.run();

    expect(calledSteps).toContain('assess');
    expect(modeSkipEvents).toHaveLength(0);
  });

  it("does not skip any non-assess step when mode is 'new'", async () => {
    await writeState(statePath, {
      bootstrap: 'done',
      bootstrap_mode: 'new',
    } as ConductState);

    const calledSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calledSteps.push(step);
        return { success: true };
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
    });

    await conductor.run();

    // Every non-complexity, non-assess step should have run. (complexity is
    // handled by the engine, not by runner.run.)
    const expectedSteps: StepName[] = [
      'memory',
      'brainstorm',
      'stories',
      'conflict_check',
      'plan',
      'architecture_diagram',
      'architecture_review',
      'worktree',
      'acceptance_specs',
      'build',
      'manual_test',
      'retro',
      'finish',
    ];
    for (const step of expectedSteps) {
      expect(calledSteps).toContain(step);
    }
  });
});
