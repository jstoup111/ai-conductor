/**
 * Task 9: conductor wires BuildProgressWatcher around the build-step await.
 *
 * Cases:
 *   - build step run  → watcher constructed with this.projectRoot, started
 *     before the step's await, stopped once the await resolves.
 *   - non-build steps → no watcher constructed at all.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));

const starts: string[] = [];
const stops: string[] = [];
const constructedWith: Array<{ projectRoot: string; step: string }> = [];
let endAttemptOnStart = false;
let endAttemptCallsOnStart = 0;
let endAttemptCallCountsByWatcher: number[] = [];
let latestEndAttempt: ((reason: 'active_stall') => void) | undefined;

vi.mock('../src/engine/build-progress-watcher.js', () => {
  class FakeBuildProgressWatcher {
    private step: string;
    private readonly endAttempt?: (reason: 'active_stall') => void;
    constructor(opts: {
      projectRoot: string;
      step: string;
      endAttempt?: (reason: 'active_stall') => void;
    }) {
      this.step = opts.step;
      this.endAttempt = opts.endAttempt;
      latestEndAttempt = opts.endAttempt;
      constructedWith.push({ projectRoot: opts.projectRoot, step: opts.step });
    }
    start(): void {
      starts.push(this.step);
      if (endAttemptOnStart) {
        endAttemptOnStart = false;
        this.endAttempt?.('active_stall');
      }
      const endAttemptCalls = endAttemptCallCountsByWatcher.shift() ?? endAttemptCallsOnStart;
      for (let call = 0; call < endAttemptCalls; call++) {
        this.endAttempt?.('active_stall');
      }
      endAttemptCallsOnStart = 0;
    }
    stop(): void {
      stops.push(this.step);
    }
  }
  return { BuildProgressWatcher: FakeBuildProgressWatcher };
});

import { ConductorEventEmitter } from '../src/ui/events.js';
import { Conductor } from '../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../src/engine/conductor.js';
import { writeState } from '../src/engine/state.js';
import { ALL_STEPS } from '../src/engine/steps.js';
import type { ConductState, StepName } from '../src/types/index.js';

/** Step runner that succeeds every step immediately, recording call order. */
function makeSucceedingRunner(callOrder: string[]): StepRunner {
  return {
    run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
      callOrder.push(step);
      return { success: true };
    }),
  };
}

describe('conductor/build-progress-watcher wiring', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-build-progress-'));
    statePath = join(dir, 'conduct-state.json');
    const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']));
    delete state.build;
    await writeState(statePath, state as ConductState);
    events = new ConductorEventEmitter();
    starts.length = 0;
    stops.length = 0;
    constructedWith.length = 0;
    endAttemptOnStart = false;
    endAttemptCallsOnStart = 0;
    endAttemptCallCountsByWatcher = [];
    latestEndAttempt = undefined;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('constructs, starts, and stops exactly one watcher for the build step, with this.projectRoot', async () => {
    const callOrder: string[] = [];
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSucceedingRunner(callOrder),
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'build',
      maxRetries: 1,
    });

    await conductor.run();

    expect(callOrder).toContain('build');

    const buildConstructions = constructedWith.filter((c) => c.step === 'build');
    expect(buildConstructions.length).toBe(1);
    expect(buildConstructions[0].projectRoot).toBe(dir);

    expect(starts.filter((s) => s === 'build').length).toBe(1);
    expect(stops.filter((s) => s === 'build').length).toBe(1);
  });

  it('never constructs a watcher for plan or finish steps', async () => {
    const callOrder: string[] = [];
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSucceedingRunner(callOrder),
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'build',
      maxRetries: 1,
    });

    await conductor.run();

    expect(callOrder).toContain('build');

    const nonBuildSteps = constructedWith.filter((c) => c.step !== 'build');
    expect(nonBuildSteps).toEqual([]);
    expect(starts.every((s) => s === 'build')).toBe(true);
    expect(stops.every((s) => s === 'build')).toBe(true);
  });

  it('stops the watcher even when the build step throws', async () => {
    const throwingRunner: StepRunner = {
      run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
        if (step === 'build') throw new Error('boom');
        return { success: true };
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: throwingRunner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'build',
      maxRetries: 1,
    });

    await conductor.run().catch(() => {
      // A thrown step may propagate or be caught internally depending on
      // engine recovery wiring — either way the watcher must be stopped.
    });

    expect(starts.filter((s) => s === 'build').length).toBe(1);
    expect(stops.filter((s) => s === 'build').length).toBe(1);
  });

  it('stops the build watcher when the build step rejects', async () => {
    const rejectingRunner: StepRunner = {
      run: vi.fn(async (step: StepName): Promise<StepRunResult> =>
        step === 'build' ? { success: false, output: 'rejected' } : { success: true }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: rejectingRunner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'build',
      maxRetries: 1,
    });

    await conductor.run();

    expect(starts.filter((s) => s === 'build')).toHaveLength(1);
    expect(stops.filter((s) => s === 'build')).toHaveLength(1);
  });

  it('constructs no watcher at all when build_progress.enabled is false', async () => {
    const callOrder: string[] = [];
    const activityEvents: unknown[] = [];
    const activeStalls: unknown[] = [];
    const stalls: unknown[] = [];
    events.on('build_progress', (event) => {
      activityEvents.push(event);
    });
    events.on('build_active_stall', (event) => {
      activeStalls.push(event);
    });
    events.on('build_stall', (event) => {
      if (event.type === 'build_stall') stalls.push(event);
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSucceedingRunner(callOrder),
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'build',
      maxRetries: 1,
      config: { build_progress: { enabled: false } },
    });

    await conductor.run();

    expect(callOrder).toContain('build');
    expect(constructedWith).toEqual([]);
    expect(starts).toEqual([]);
    expect(stops).toEqual([]);
    expect(activityEvents).toEqual([]);
    expect(activeStalls).toEqual([]);
    expect(stalls).toEqual([]);
  });

  it('ends an active-stalled build attempt through its local abort signal and spends one retry', async () => {
    endAttemptOnStart = true;
    const abortSignals: AbortSignal[] = [];
    let buildCalls = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName, _state, options): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        buildCalls++;
        if (options?.abortSignal) abortSignals.push(options.abortSignal);
        return options?.abortSignal?.aborted
          ? { success: false, output: 'attempt ended by active stall' }
          : { success: true };
      }),
    };
    const stalls: Array<Extract<import('../src/types/events.js').ConductorEvent, { type: 'build_stall' }>> = [];
    events.on('build_stall', (event) => {
      if (event.type === 'build_stall') stalls.push(event);
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'build',
      maxRetries: 2,
    });

    await conductor.run();

    expect(buildCalls).toBe(2);
    expect(abortSignals).toHaveLength(2);
    expect(abortSignals[0]?.aborted).toBe(true);
    expect(abortSignals[1]?.aborted).toBe(false);
    expect(stalls).toEqual([expect.objectContaining({ reason: 'active_stall' })]);
  });

  it('does not let an endAttempt callback after completion change a settled result', async () => {
    const abortSignals: AbortSignal[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName, _state, options): Promise<StepRunResult> => {
        if (step === 'build' && options?.abortSignal) abortSignals.push(options.abortSignal);
        return { success: true };
      }),
    };
    const stalls: Array<Extract<import('../src/types/events.js').ConductorEvent, { type: 'build_stall' }>> = [];
    events.on('build_stall', (event) => {
      if (event.type === 'build_stall') stalls.push(event);
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'build',
      maxRetries: 1,
    });

    await conductor.run();
    latestEndAttempt?.('active_stall');

    expect(abortSignals).toHaveLength(1);
    expect(abortSignals[0]?.aborted).toBe(false);
    expect(stalls).toEqual([]);
  });

  it('ends a still-running attempt only once when the watcher calls endAttempt twice', async () => {
    endAttemptCallCountsByWatcher = [2];
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    const abortSignals: AbortSignal[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName, _state, options): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        if (options?.abortSignal) abortSignals.push(options.abortSignal);
        return options?.abortSignal?.aborted
          ? { success: false, output: 'attempt ended by active stall' }
          : { success: true };
      }),
    };
    const stalls: Array<Extract<import('../src/types/events.js').ConductorEvent, { type: 'build_stall' }>> = [];
    events.on('build_stall', (event) => {
      if (event.type === 'build_stall') stalls.push(event);
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'build',
      maxRetries: 2,
    });

    try {
      await conductor.run();

      expect(abort).toHaveBeenCalledTimes(1);
      expect(abortSignals).toHaveLength(2);
      expect(abortSignals[0]?.aborted).toBe(true);
      expect(abortSignals[1]?.aborted).toBe(false);
      expect(stalls).toEqual([expect.objectContaining({ reason: 'active_stall' })]);
    } finally {
      abort.mockRestore();
    }
  });

  it('keeps pinned second-attempt no_task_progress ahead of active_stall', async () => {
    endAttemptCallCountsByWatcher = [1, 1];
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.docs/plans/build-progress.md'), '### Task 1: Pending work\n');
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
      tasks: [{ id: '1', status: 'pending' }],
    }));
    const abortSignals: AbortSignal[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName, _state, options): Promise<StepRunResult> => {
        if (step === 'build' && options?.abortSignal) abortSignals.push(options.abortSignal);
        return step === 'build' && options?.abortSignal?.aborted
          ? { success: false, output: 'attempt ended by active stall' }
          : { success: true };
      }),
    };
    const stalls: Array<Extract<import('../src/types/events.js').ConductorEvent, { type: 'build_stall' }>> = [];
    events.on('build_stall', (event) => {
      if (event.type === 'build_stall') stalls.push(event);
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'build',
      maxRetries: 2,
      verifyArtifacts: true,
    });

    await conductor.run();

    expect(abortSignals.map((signal) => signal.aborted)).toEqual([true, true]);
    expect(stalls.map((event) => event.reason)).toEqual([
      'active_stall',
      'no_task_progress',
    ]);
    expect((runner.run as ReturnType<typeof vi.fn>).mock.calls.map(([step]) => step)).toContain('remediate');
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      'build stalled: no task progress',
    );
  });

  it('does not end or classify a warn-only build watcher as stalled', async () => {
    const abortSignals: AbortSignal[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName, _state, options): Promise<StepRunResult> => {
        if (step === 'build' && options?.abortSignal) abortSignals.push(options.abortSignal);
        return { success: true };
      }),
    };
    const stalls: Array<Extract<import('../src/types/events.js').ConductorEvent, { type: 'build_stall' }>> = [];
    events.on('build_stall', (event) => {
      if (event.type === 'build_stall') stalls.push(event);
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'build',
      maxRetries: 1,
      config: { build_progress: { active_stall_action: 'warn' } },
    });

    await conductor.run();

    expect(abortSignals).toHaveLength(1);
    expect(abortSignals[0]?.aborted).toBe(false);
    expect(stalls).toEqual([]);
  });
});
