import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../test-conductor.js';
import { writeState, readState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';
import type {
  ConductorOptions,
  OperatorParkedTermination,
  SchedulingUnitRef,
  StepRunner,
} from '../../src/engine/conductor.js';

function stateWithPending(...pending: StepName[]): ConductState {
  return {
    ...Object.fromEntries(ALL_STEPS.map(({ name }) => [name, 'done'])),
    ...Object.fromEntries(pending.map((name) => [name, 'pending'])),
    complexity_tier: 'M',
    track: 'technical',
    feature_desc: 'operator park boundary',
  } as ConductState;
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('operator park boundary contract', () => {
  let projectRoot: string;
  let statePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'operator-park-boundary-'));
    statePath = join(projectRoot, 'conduct-state.json');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('represents every scheduling-unit boundary and optional daemon boundary options', () => {
    const boundaries = [
      { kind: 'step', name: 'memory' },
      { kind: 'group', name: 'ship-validation' },
      { kind: 'pre-first-unit' },
    ] satisfies SchedulingUnitRef[];
    const parked = boundaries.map((boundary) => ({
      kind: 'operator-parked' as const,
      boundary,
    })) satisfies OperatorParkedTermination[];
    const options = [
      {},
      {
        featureSlug: 'boundary-aware-operator-parking',
        operatorParkBoundary: async () => false,
      },
    ] satisfies Pick<
      ConductorOptions,
      'featureSlug' | 'operatorParkBoundary'
    >[];

    expect({
      boundaries: parked.map(({ boundary }) => boundary.kind),
      configured: options.map((option) => 'featureSlug' in option),
    }).toEqual({
      boundaries: ['step', 'group', 'pre-first-unit'],
      configured: [false, true],
    });
  });

  it('parks before the first pending serial unit without dispatching it', async () => {
    await writeState(statePath, stateWithPending('memory'));
    const run = vi.fn<StepRunner['run']>(async () => ({ success: true }));
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => true,
    });

    const result = await conductor.run();

    expect({ result, runnerCalls: run.mock.calls }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'pre-first-unit' },
      },
      runnerCalls: [],
    });
  });

  it('settles the active serial step once, persists it, then parks before the next step', async () => {
    await writeState(statePath, stateWithPending('memory', 'explore'));
    const run = vi.fn<StepRunner['run']>(async () => ({ success: true }));
    let boundaryObservation:
      | { memory: ConductState['memory']; explore: ConductState['explore'] }
      | undefined;
    const operatorParkBoundary = vi.fn<
      NonNullable<ConductorOptions['operatorParkBoundary']>
    >(async () => {
      if (operatorParkBoundary.mock.calls.length === 1) return false;
      const state = await readState(statePath);
      if (!state.ok) return false;
      boundaryObservation = {
        memory: state.value.memory,
        explore: state.value.explore,
      };
      return boundaryObservation.memory === 'done' && boundaryObservation.explore === 'pending';
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary,
    });

    const result = await conductor.run();
    const persisted = await readState(statePath);
    const persistedState = persisted.ok ? persisted.value : undefined;

    expect({
      result,
      runnerSteps: run.mock.calls.map(([step]) => step),
      boundaryChecks: operatorParkBoundary.mock.calls.length,
      boundaryObservation,
      settledStepsStillInProgress: persistedState
        ? ALL_STEPS
            .map(({ name }) => name)
            .filter((name) => persistedState[name] === 'in_progress')
        : ['state-read-failed'],
      persisted:
        persisted.ok
          ? { memory: persisted.value.memory, explore: persisted.value.explore }
          : persisted,
    }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'step', name: 'memory' },
      },
      runnerSteps: ['memory'],
      boundaryChecks: 2,
      boundaryObservation: { memory: 'done', explore: 'pending' },
      settledStepsStillInProgress: [],
      persisted: { memory: 'done', explore: 'pending' },
    });
  });

  it('keeps a failed gate diagnostic authoritative when parking becomes active during bounded recovery', async () => {
    await writeState(statePath, stateWithPending('build_review', 'wiring_check'));
    let parked = false;
    const events = new ConductorEventEmitter();
    const failed: Array<{ step: StepName; error: string; retryCount: number }> = [];
    const parkedBoundaries: ConductorEvent[] = [];
    events.on('step_failed', (event) => {
      if (event.type === 'step_failed') {
        failed.push({
          step: event.step,
          error: event.error,
          retryCount: event.retryCount,
        });
      }
    });
    events.on('operator_park_boundary', (event) => {
      parkedBoundaries.push(event);
    });
    const run = vi.fn<StepRunner['run']>(async (step) => {
      if (step === 'build_review') parked = true;
      return {
        success: false,
        output: 'build review found a genuine structural gap',
      };
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events,
      fromStep: 'build_review',
      mode: 'auto',
      daemon: true,
      maxRetries: 2,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => parked,
    });

    const result = await conductor.run();
    const persisted = await readState(statePath);

    expect({
      result,
      runnerSteps: run.mock.calls.map(([step]) => step),
      failed,
      parkedBoundaries,
      persisted: persisted.ok
        ? {
            buildReview: persisted.value.build_review,
            wiringCheck: persisted.value.wiring_check,
          }
        : persisted,
    }).toEqual({
      result: undefined,
      runnerSteps: ['build_review', 'build_review'],
      failed: [
        {
          step: 'build_review',
          error: 'build review found a genuine structural gap',
          retryCount: 2,
        },
      ],
      parkedBoundaries: [],
      persisted: { buildReview: 'failed', wiringCheck: 'pending' },
    });
  });

  it('keeps durable persistence failure authoritative after a successful runner', async () => {
    await writeState(statePath, stateWithPending('memory', 'explore'));
    const preservedStatePath = join(projectRoot, 'conduct-state-before-obstruction.json');
    let parked = false;
    const events = new ConductorEventEmitter();
    const parkedBoundaries: ConductorEvent[] = [];
    const loopHaltReasons: string[] = [];
    events.on('operator_park_boundary', (event) => {
      parkedBoundaries.push(event);
    });
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') loopHaltReasons.push(event.reason);
    });
    const run = vi.fn<StepRunner['run']>(async () => {
      await rename(statePath, preservedStatePath);
      await mkdir(statePath);
      parked = true;
      return { success: true };
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events,
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => parked,
    });

    const result = await conductor.run();
    const preserved = await readState(preservedStatePath);
    const haltDiagnostic = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8');

    expect({
      result,
      runnerSteps: run.mock.calls.map(([step]) => step),
      loopHaltReasons,
      haltDiagnostic,
      parkedBoundaries,
      preserved: preserved.ok
        ? {
            memory: preserved.value.memory,
            explore: preserved.value.explore,
          }
        : preserved,
    }).toEqual({
      result: undefined,
      runnerSteps: ['memory'],
      loopHaltReasons: [expect.stringMatching(/EISDIR|directory|rename/i)],
      haltDiagnostic: expect.stringMatching(/EISDIR|directory|rename/i),
      parkedBoundaries: [],
      preserved: { memory: 'in_progress', explore: 'pending' },
    });
  });

  it('observes a park requested while the active serial step settles and does not dispatch the next step', async () => {
    await writeState(statePath, stateWithPending('memory', 'explore'));
    const started = deferred();
    const release = deferred();
    let parked = false;
    let settlements = 0;
    const run = vi.fn<StepRunner['run']>(async (step) => {
      if (step === 'memory') {
        started.resolve();
        await release.promise;
        settlements += 1;
      }
      return { success: true };
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => parked,
    });

    const resultPromise = conductor.run();
    await started.promise;
    parked = true;
    release.resolve();
    const result = await resultPromise;

    expect({
      result,
      runnerSteps: run.mock.calls.map(([step]) => step),
      settlements,
    }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'step', name: 'memory' },
      },
      runnerSteps: ['memory'],
      settlements: 1,
    });
  });

  it('fails closed before the first pending unit when the operator park boundary cannot be read', async () => {
    await writeState(statePath, stateWithPending('memory'));
    const run = vi.fn<StepRunner['run']>(async () => ({ success: true }));
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => {
        throw Object.assign(new Error('park state is unreadable'), { code: 'EACCES' });
      },
    });

    const result = await conductor.run();

    expect({ result, runnerCalls: run.mock.calls }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'pre-first-unit' },
      },
      runnerCalls: [],
    });
  });

  it('consults parking only at the first pending unit after tier-skipped entries', async () => {
    await writeState(statePath, {
      ...stateWithPending('coherence_check', 'acceptance_specs', 'build'),
      complexity_tier: 'S',
    });
    const run = vi.fn<StepRunner['run']>(async () => ({ success: true }));
    const operatorParkBoundary = vi.fn<
      NonNullable<ConductorOptions['operatorParkBoundary']>
    >(async () => true);
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      fromStep: 'coherence_check',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary,
    });

    const result = await conductor.run();

    expect({
      result,
      boundaryChecks: operatorParkBoundary.mock.calls.length,
      runnerCalls: run.mock.calls,
    }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'pre-first-unit' },
      },
      boundaryChecks: 1,
      runnerCalls: [],
    });
  });
});
