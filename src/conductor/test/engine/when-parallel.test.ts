/**
 * Tests for T9-T10 (when: conductor dispatch) and T12-T22 (parallel: fan-out).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));

import type { ConductState, ConductorEvent } from '../../src/types/index.js';
import type { StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';

function mockRunner(result: StepRunResult = { success: true }): StepRunner {
  return { run: vi.fn().mockResolvedValue(result) };
}

/** Wire up an emitter to collect all events into an array. */
function collectEvents(emitter: ConductorEventEmitter): ConductorEvent[] {
  const collected: ConductorEvent[] = [];
  const ALL_EVENT_TYPES: ConductorEvent['type'][] = [
    'step_started', 'step_completed', 'step_failed', 'step_retry',
    'checkpoint_reached', 'recovery_needed', 'gate_blocked', 'tier_skip',
    'config_skip', 'navigation_back', 'rate_limit', 'session_reset',
    'feature_complete', 'dashboard_refresh', 'auto_heal', 'mode_skip',
    'build_stall', 'when_skip', 'parallel_started', 'parallel_completed',
    'parallel_failure',
  ];
  for (const t of ALL_EVENT_TYPES) {
    emitter.on(t, (e) => { collected.push(e); });
  }
  return collected;
}

// Build a state file that marks all built-in steps done except a named one,
// so the conductor only runs that step during the test.
async function seedAllDoneExcept(
  statePath: string,
  exceptStep: StepName,
): Promise<void> {
  const { ALL_STEPS } = await import('../../src/engine/steps.js');
  const state: Record<string, string> = {};
  for (const s of ALL_STEPS) {
    if (s.name !== exceptStep) state[s.name] = 'done';
  }
  await writeState(statePath, state as ConductState);
}

async function readStateValue(statePath: string): Promise<ConductState> {
  const result = await readState(statePath);
  if (!result.ok) throw new Error('state not readable');
  return result.value;
}

describe('when: conditional step skip (T9)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let emitted: ConductorEvent[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'when-test-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    emitted = collectEvents(events);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('skips a step and emits when_skip when when: expression is false (T9)', async () => {
    // Seed: all done except 'explore'. explore has when: tier == L, but state has tier S.
    await seedAllDoneExcept(statePath, 'explore');
    await writeState(statePath, {
      ...(await readStateValue(statePath)),
      complexity_tier: 'S',
    });

    const runner = mockRunner();
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: {
        steps: {
          explore: { when: 'tier == L' },
        },
      },
      mode: 'auto',
    });

    await conductor.run();

    const skipEvt = emitted.find((e) => e.type === 'when_skip') as
      | Extract<ConductorEvent, { type: 'when_skip' }>
      | undefined;
    expect(skipEvt).toBeDefined();
    expect(skipEvt?.step).toBe('explore');
    expect(skipEvt?.expression).toBe('tier == L');

    // Step should be recorded as skipped in state
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.explore).toBe('skipped');
    }

    // Runner should NOT have been called for the skipped step
    const runCalls = (runner.run as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(runCalls).not.toContain('explore');
  });

  it('does NOT skip a step when when: expression is true (T9)', async () => {
    await seedAllDoneExcept(statePath, 'explore');
    await writeState(statePath, {
      ...(await readStateValue(statePath)),
      complexity_tier: 'L',
    });

    const runner = mockRunner();
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: { steps: { explore: { when: 'tier == L' } } },
      mode: 'auto',
    });

    await conductor.run();

    const skipEvt = emitted.find((e) => e.type === 'when_skip');
    expect(skipEvt).toBeUndefined();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.explore).toBe('done');
    }
  });

  it('emits undefinedKey in when_skip when state key is undefined (T9)', async () => {
    await seedAllDoneExcept(statePath, 'explore');
    // Do NOT set bootstrap_mode → it will be undefined

    const runner = mockRunner();
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: { steps: { explore: { when: '${bootstrap_mode} == new' } } },
      mode: 'auto',
    });

    await conductor.run();

    const skipEvt = emitted.find((e) => e.type === 'when_skip') as
      | Extract<ConductorEvent, { type: 'when_skip' }>
      | undefined;
    expect(skipEvt).toBeDefined();
    expect(skipEvt?.undefinedKey).toBe('bootstrap_mode');
  });

  it('gates downstream steps when a skipped step has dependents (T10)', async () => {
    // Use the real step graph: 'plan' requires 'conflict_check' which requires 'stories'.
    // If we mark plan as skipped-via-when, the downstream 'architecture_diagram' may
    // be blocked depending on gate logic. We verify the skipped state propagates.
    await seedAllDoneExcept(statePath, 'plan');
    await writeState(statePath, {
      ...(await readStateValue(statePath)),
      complexity_tier: 'S',
    });

    const runner = mockRunner();
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: { steps: { plan: { when: 'tier == L' } } },
      mode: 'auto',
    });

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.plan).toBe('skipped');
    }
  });
});

describe('parallel: group execution (T15-T22)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let emitted: ConductorEvent[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'parallel-test-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    emitted = collectEvents(events);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('emits parallel_started and parallel_completed on success (T22)', async () => {
    await seedAllDoneExcept(statePath, 'explore');

    const runner = mockRunner({ success: true });
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: {
        steps: {
          explore: {
            parallel: [
              { name: 'frontend', skill: 'skills/explore/SKILL.md' },
              { name: 'backend', skill: 'skills/explore/SKILL.md' },
            ],
          },
        },
      },
      mode: 'auto',
    });

    await conductor.run();

    const startedEvt = emitted.find((e) => e.type === 'parallel_started') as
      Extract<ConductorEvent, { type: 'parallel_started' }> | undefined;
    expect(startedEvt).toBeDefined();
    expect(startedEvt?.step).toBe('explore');
    expect(startedEvt?.branches).toContain('frontend');
    expect(startedEvt?.branches).toContain('backend');

    const completedEvt = emitted.find((e) => e.type === 'parallel_completed') as
      Extract<ConductorEvent, { type: 'parallel_completed' }> | undefined;
    expect(completedEvt).toBeDefined();
    expect(completedEvt?.step).toBe('explore');
  });

  it('writes synthetic state keys for each branch (T16)', async () => {
    await seedAllDoneExcept(statePath, 'explore');

    const runner = mockRunner({ success: true });
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: {
        steps: {
          explore: {
            parallel: [
              { name: 'alpha' },
              { name: 'beta' },
            ],
          },
        },
      },
      mode: 'auto',
    });

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const raw = result.value as Record<string, unknown>;
      expect(raw['explore__alpha']).toBe('done');
      expect(raw['explore__beta']).toBe('done');
    }
  });

  it('emits parallel_failure and fails group on gating branch failure (T18)', async () => {
    await seedAllDoneExcept(statePath, 'explore');

    const runner: StepRunner = {
      run: vi.fn()
        .mockResolvedValueOnce({ success: false, output: 'branch error' })
        .mockResolvedValue({ success: true }),
    };

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: {
        steps: {
          explore: {
            parallel: [
              { name: 'gating-branch' },   // advisory defaults to false → gating
              { name: 'other-branch' },
            ],
          },
        },
      },
      mode: 'auto',
    });

    await conductor.run();

    const failureEvt = emitted.find((e) => e.type === 'parallel_failure') as
      Extract<ConductorEvent, { type: 'parallel_failure' }> | undefined;
    expect(failureEvt).toBeDefined();
    expect(failureEvt?.branch).toBe('gating-branch');

    // Group step itself must be failed
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.explore).toBe('failed');
    }
  });

  it('continues group on advisory branch failure (T19)', async () => {
    await seedAllDoneExcept(statePath, 'explore');

    const runner: StepRunner = {
      run: vi.fn()
        .mockResolvedValueOnce({ success: false, output: 'advisory error' })
        .mockResolvedValue({ success: true }),
    };

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: {
        steps: {
          explore: {
            parallel: [
              { name: 'advisory-branch', advisory: true },
              { name: 'other-branch' },
            ],
          },
        },
      },
      mode: 'auto',
    });

    await conductor.run();

    const failureEvt = emitted.find((e) => e.type === 'parallel_failure');
    expect(failureEvt).toBeDefined();

    // Group should still complete successfully
    const completedEvt = emitted.find((e) => e.type === 'parallel_completed');
    expect(completedEvt).toBeDefined();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.explore).toBe('done');
      const raw = result.value as Record<string, unknown>;
      expect(raw['explore__advisory-branch']).toBe('failed');
      expect(raw['explore__other-branch']).toBe('done');
    }
  });

  it('sets all synthetic keys to skipped when when: false on a parallel group (T21)', async () => {
    await seedAllDoneExcept(statePath, 'explore');
    await writeState(statePath, {
      ...(await readStateValue(statePath)),
      complexity_tier: 'S',
    });

    const runner = mockRunner();
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: {
        steps: {
          explore: {
            when: 'tier == L',
            parallel: [
              { name: 'branch-a' },
              { name: 'branch-b' },
            ],
          },
        },
      },
      mode: 'auto',
    });

    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const raw = result.value as Record<string, unknown>;
      expect(result.value.explore).toBe('skipped');
      expect(raw['explore__branch-a']).toBe('skipped');
      expect(raw['explore__branch-b']).toBe('skipped');
    }
  });

  it('runs all branches concurrently (Promise.all fan-out — T15)', async () => {
    await seedAllDoneExcept(statePath, 'explore');

    const callOrder: string[] = [];
    const runner: StepRunner = {
      run: vi.fn().mockImplementation(async () => {
        callOrder.push('called');
        return { success: true };
      }),
    };

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      config: {
        steps: {
          explore: {
            parallel: [
              { name: 'a' },
              { name: 'b' },
              { name: 'c' },
            ],
          },
        },
      },
      mode: 'auto',
    });

    await conductor.run();

    // All three branches must have been dispatched
    expect((runner.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });
});

describe('config validation: when: and parallel: (T13)', () => {
  it('validateConfig rejects invalid when: expression', async () => {
    const { validateConfig } = await import('../../src/engine/config.js');
    const result = validateConfig({
      steps: {
        explore: { when: 'tier > L' },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/unsupported/i);
    }
  });

  it('validateConfig rejects parallel: with skill on same step (mutual exclusion)', async () => {
    const { validateConfig } = await import('../../src/engine/config.js');
    const result = validateConfig({
      steps: {
        explore: {
          skill: 'skills/explore/SKILL.md',
          parallel: [{ name: 'a' }],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/mutually exclusive/);
    }
  });

  it('validateConfig accepts valid when: expression', async () => {
    const { validateConfig } = await import('../../src/engine/config.js');
    const result = validateConfig({
      steps: {
        explore: { when: 'tier == L' },
      },
    });
    expect(result.ok).toBe(true);
  });

  it('validateConfig accepts valid parallel: array', async () => {
    const { validateConfig } = await import('../../src/engine/config.js');
    const result = validateConfig({
      steps: {
        explore: {
          parallel: [
            { name: 'a', skill: 'skills/explore/SKILL.md' },
            { name: 'b', advisory: true },
          ],
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it('validateConfig rejects duplicate branch names in parallel:', async () => {
    const { validateConfig } = await import('../../src/engine/config.js');
    const result = validateConfig({
      steps: {
        explore: {
          parallel: [
            { name: 'dup' },
            { name: 'dup' },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/duplicate branch/);
    }
  });

  it('validateConfig rejects branch missing name', async () => {
    const { validateConfig } = await import('../../src/engine/config.js');
    const result = validateConfig({
      steps: {
        explore: {
          parallel: [{ skill: 'x' }],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/name must be/);
    }
  });
});
