import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../test-conductor.js';
import { writeState, readState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
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

    expect({
      result,
      runnerSteps: run.mock.calls.map(([step]) => step),
      boundaryChecks: operatorParkBoundary.mock.calls.length,
      boundaryObservation,
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
      persisted: { memory: 'done', explore: 'pending' },
    });
  });
});
