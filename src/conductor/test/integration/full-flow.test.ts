import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Conductor } from '../test-conductor.js';
import { findResumeIndex } from '../../src/engine/conductor.js';
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

  it('stops at failed step', async () => {
    await writeState(statePath, { complexity_tier: 'L' } as ConductState);
    runner.failOn = 'build';

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      // Isolate the engine-native `rebase` step to a throwaway dir (see above).
      projectRoot: dir,
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

  it('resumes at the first unresolved step', async () => {
    const allStepNames = ALL_STEPS.map((s) => s.name);
    const preState: ConductState = { complexity_tier: 'L' };
    for (const step of allStepNames.slice(0, 2)) {
      (preState as Record<string, unknown>)[step] = 'done';
    }

    expect(findResumeIndex(preState, ALL_STEPS)).toBe(
      allStepNames.indexOf('explore'),
    );
  });
});
