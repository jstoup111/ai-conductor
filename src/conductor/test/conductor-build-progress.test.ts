/**
 * Task 9: conductor wires BuildProgressWatcher around the build-step await.
 *
 * Cases:
 *   - build step run  → watcher constructed with this.projectRoot, started
 *     before the step's await, stopped once the await resolves.
 *   - non-build steps → no watcher constructed at all.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));

const starts: string[] = [];
const stops: string[] = [];
const constructedWith: Array<{ projectRoot: string; step: string }> = [];

vi.mock('../src/engine/build-progress-watcher.js', () => {
  class FakeBuildProgressWatcher {
    private step: string;
    constructor(opts: { projectRoot: string; step: string }) {
      this.step = opts.step;
      constructedWith.push({ projectRoot: opts.projectRoot, step: opts.step });
    }
    start(): void {
      starts.push(this.step);
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
import type { StepName } from '../src/types/index.js';

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
    events = new ConductorEventEmitter();
    starts.length = 0;
    stops.length = 0;
    constructedWith.length = 0;
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
      maxRetries: 1,
    });

    await conductor.run();

    expect(callOrder).toContain('plan');

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
      maxRetries: 1,
    });

    await conductor.run().catch(() => {
      // A thrown step may propagate or be caught internally depending on
      // engine recovery wiring — either way the watcher must be stopped.
    });

    expect(starts.filter((s) => s === 'build').length).toBe(1);
    expect(stops.filter((s) => s === 'build').length).toBe(1);
  });

  it('constructs no watcher at all when build_progress.enabled is false', async () => {
    const callOrder: string[] = [];
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSucceedingRunner(callOrder),
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      maxRetries: 1,
      config: { build_progress: { enabled: false } },
    });

    await conductor.run();

    expect(callOrder).toContain('build');
    expect(constructedWith).toEqual([]);
    expect(starts).toEqual([]);
    expect(stops).toEqual([]);
  });
});
