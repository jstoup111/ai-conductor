import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../test-conductor.js';
import { writeState, readState } from '../../src/engine/state.js';
import { ALL_STEPS, VALIDATION_GROUP } from '../../src/engine/steps.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { resolveGroupMembership } from '../../src/engine/conductor.js';
import { isOperatorParked } from '../../src/engine/park-marker.js';
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

function noExternalIo(): Pick<ConductorOptions, 'gh' | 'git' | 'runGh'> {
  const result = { stdout: '', stderr: '', exitCode: 0 };
  return {
    gh: vi.fn(async () => result),
    git: vi.fn(async () => result),
    runGh: vi.fn(async () => result),
  };
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

  it('mechanically inventories every supported scheduling-unit dispatch boundary', async () => {
    const conductorSource = await readFile(
      new URL('../../src/engine/conductor.ts', import.meta.url),
      'utf8',
    );
    const guardedSegments = [
      /if \(stepCfg\?\.parallel\) \{[\s\S]*?await this\.runParallelGroupViaCore\(/,
      /if \(groupEntryName === step\.name && membership\.dispatchable\.length > 1\) \{[\s\S]*?return runGroupBranch\(/,
    ].map((pattern) => {
      const match = conductorSource.match(pattern);
      expect(match).not.toBeNull();
      const source = match![0];
      const start = conductorSource.indexOf(source);
      return {
        start,
        guard: start + source.indexOf('await stopAtOperatorParkBoundary();'),
        end: start + source.length,
      };
    });
    const serialGuard = conductorSource.lastIndexOf(
      'const preDispatchPark = await stopAtOperatorParkBoundary();',
    );
    const serialDispatch = conductorSource.indexOf(
      'this.stepRunner.run(',
      serialGuard,
    );
    expect(serialGuard).toBeGreaterThan(-1);
    expect(serialDispatch).toBeGreaterThan(serialGuard);
    guardedSegments.push({
      start: serialGuard,
      guard: serialGuard,
      end: serialDispatch + 'this.stepRunner.run('.length,
    });
    const reviewedHelperDispatchAllowlist = [
      "await this.stepRunner.run('remediate', state, { retryReason: dispatchContext });",
      'return this.stepRunner.run(name, state, { retryReason: retryHint });',
      'return await this.stepRunner.run(name, state, { retryReason: retryHint });',
      "return this.stepRunner.run('wiring_check', state);",
      'return runGroupBranch(member, state, { stepRunner: this.stepRunner }, 1);',
      "return this.stepRunner.run('finish', state, options);",
      // The two bounded FINISH prose passes. Both are reached only from inside
      // the already-park-guarded FINISH dispatch.
      "this.stepRunner.run('finish', state, { ...options, finishProsePass: 'judge' })",
      "this.stepRunner.run('finish', state, { ...options, finishProsePass: 'author' })",
    ];
    const dispatchPrimitives = [
      'this.stepRunner.run(',
      'runGroupBranch(',
      'this.runParallelGroupViaCore(',
    ];
    const discoveredDispatches = dispatchPrimitives.flatMap((primitive) =>
      [...conductorSource.matchAll(new RegExp(primitive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map(
        (match) => ({ primitive, offset: match.index! }),
      ),
    );
    const unreviewedDispatches = discoveredDispatches.filter(({ offset }) => {
      const guarded = guardedSegments.some(
        (segment) => offset > segment.guard && offset < segment.end,
      );
      const reviewedHelper = reviewedHelperDispatchAllowlist.some((allowed) =>
        conductorSource
          .slice(Math.max(0, offset - 40), offset + allowed.length + 40)
          .includes(allowed),
      );
      return !guarded && !reviewedHelper;
    });

    expect({ discoveredDispatches, unreviewedDispatches }).toEqual({
      discoveredDispatches: expect.arrayContaining([
        expect.objectContaining({ primitive: 'this.stepRunner.run(' }),
        expect.objectContaining({ primitive: 'runGroupBranch(' }),
        expect.objectContaining({ primitive: 'this.runParallelGroupViaCore(' }),
      ]),
      unreviewedDispatches: [],
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

  it('parks after a settled serial step before dispatching a later parallel validation group', async () => {
    const members = [
      'manual_test',
      'prd_audit',
      'architecture_review_as_built',
    ] as const;
    await writeState(statePath, stateWithPending('memory', ...members));
    const run = vi.fn<StepRunner['run']>(async () => ({ success: true }));
    const events = new ConductorEventEmitter();
    const parallelStarts: Array<Extract<ConductorEvent, { type: 'parallel_started' }>> = [];
    events.on('parallel_started', (event) => {
      if (event.type === 'parallel_started') parallelStarts.push(event);
    });
    let boundaryChecks = 0;
    const operatorParkBoundary = vi.fn<
      NonNullable<ConductorOptions['operatorParkBoundary']>
    >(async () => {
      boundaryChecks += 1;
      return boundaryChecks > 1;
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
      operatorParkBoundary,
      ...noExternalIo(),
    });

    const result = await conductor.run();

    expect({
      result,
      runnerSteps: run.mock.calls.map(([step]) => step),
      memberRunnerCalls: run.mock.calls.filter(([step]) =>
        members.includes(step as typeof members[number]),
      ),
      parallelStarts,
    }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'step', name: 'memory' },
      },
      runnerSteps: ['memory'],
      memberRunnerCalls: [],
      parallelStarts: [],
    });
  });

  it('keeps a failed gate diagnostic authoritative when parking becomes active during bounded recovery', async () => {
    await writeState(statePath, stateWithPending('build_review'));
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
      persisted: { buildReview: 'failed', wiringCheck: undefined },
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

  it('joins a configured parallel group before parking at its durable owner boundary', async () => {
    await writeState(statePath, stateWithPending('memory', 'explore'));
    const alphaStarted = deferred();
    const betaStarted = deferred();
    const releaseAlpha = deferred();
    const releaseBeta = deferred();
    const alphaSettled = deferred();
    const parkObserved = deferred();
    const timeline: string[] = [];
    let parked = false;
    let settledMembers = 0;
    let boundaryObservation:
      | {
          event: ConductorEvent;
          alpha: unknown;
          beta: unknown;
          owner: ConductState['memory'];
        }
      | undefined;
    const events = new ConductorEventEmitter();
    events.on('operator_park_boundary', (event) => {
      void (async () => {
        const state = await readState(statePath);
        if (state.ok) {
          const raw = state.value as unknown as Record<string, unknown>;
          boundaryObservation = {
            event,
            alpha: raw['memory__alpha'],
            beta: raw['memory__beta'],
            owner: state.value.memory,
          };
        }
        parkObserved.resolve();
      })();
    });
    const run = vi.fn<StepRunner['run']>(async (step) => {
      if (String(step) === 'alpha') {
        timeline.push('alpha-started');
        alphaStarted.resolve();
        await releaseAlpha.promise;
        timeline.push('alpha-settled');
        settledMembers += 1;
        alphaSettled.resolve();
      } else if (String(step) === 'beta') {
        timeline.push('beta-started');
        betaStarted.resolve();
        await releaseBeta.promise;
        timeline.push('beta-settled');
        settledMembers += 1;
      }
      return { success: true };
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events,
      config: {
        validation_concurrency: 2,
        steps: {
          memory: {
            parallel: [{ name: 'alpha' }, { name: 'beta' }],
          },
        },
      },
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => parked,
    });

    const resultPromise = conductor.run();
    await Promise.all([alphaStarted.promise, betaStarted.promise]);
    releaseAlpha.resolve();
    await alphaSettled.promise;
    parked = true;
    releaseBeta.resolve();
    const result = await resultPromise;
    await parkObserved.promise;

    expect({
      result,
      timeline,
      boundaryObservation,
      laterSerialDispatches: run.mock.calls.filter(([step]) => step === 'explore').length,
      settledMembers,
    }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'group', name: 'memory' },
      },
      timeline: ['alpha-started', 'beta-started', 'alpha-settled', 'beta-settled'],
      boundaryObservation: {
        event: {
          type: 'operator_park_boundary',
          featureSlug: 'operator-park-boundary',
          boundary: { kind: 'group', name: 'memory' },
        },
        alpha: 'done',
        beta: 'done',
        owner: 'done',
      },
      laterSerialDispatches: 0,
      settledMembers: 2,
    });
  });

  it('preserves mixed parallel statuses before parking at the next boundary', async () => {
    await writeState(
      statePath,
      stateWithPending('memory', 'explore', 'architecture_diagram'),
    );
    let boundaryChecks = 0;
    let boundaryObservation: Record<string, unknown> | undefined;
    const parkObserved = deferred();
    const events = new ConductorEventEmitter();
    events.on('operator_park_boundary', async () => {
      const persisted = await readState(statePath);
      if (persisted.ok) boundaryObservation = persisted.value as Record<string, unknown>;
      parkObserved.resolve();
    });
    const run = vi.fn<StepRunner['run']>(async (step) => {
      const branch = String(step);
      return {
        success: branch !== 'failed-advisory',
        output: branch === 'failed-advisory' ? 'advisory failure' : undefined,
      };
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events,
      config: {
        steps: {
          memory: {
            parallel: [
              { name: 'successful' },
              { name: 'failed-advisory', advisory: true },
            ],
          },
          explore: {
            when: 'tier == L',
            parallel: [{ name: 'skipped' }],
          },
        },
      },
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => {
        boundaryChecks += 1;
        return boundaryChecks >= 3;
      },
    });

    const result = await conductor.run();
    await parkObserved.promise;

    expect({
      result,
      statuses: boundaryObservation && {
        memory: boundaryObservation.memory,
        successful: boundaryObservation['memory__successful'],
        failedAdvisory: boundaryObservation['memory__failed-advisory'],
        explore: boundaryObservation.explore,
        skipped: boundaryObservation['explore__skipped'],
      },
      laterDispatches: run.mock.calls.filter(([step]) => step === 'architecture_diagram').length,
    }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'group', name: 'memory' },
      },
      statuses: {
        memory: 'done',
        successful: 'done',
        failedAdvisory: 'failed',
        explore: 'skipped',
        skipped: 'skipped',
      },
      laterDispatches: 0,
    });
  });

  it('joins the built-in SHIP validation group before parking and does not dispatch the later unit', async () => {
    await writeState(statePath, {
      ...stateWithPending(
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
        'rebase',
      ),
      track: 'product',
      complexity_tier: 'M',
    });
    const members = [
      'manual_test',
      'prd_audit',
      'architecture_review_as_built',
    ] as const;
    const yieldCounts: Record<(typeof members)[number], number> = {
      manual_test: 4,
      prd_audit: 1,
      architecture_review_as_built: 2,
    };
    const startOrder: StepName[] = [];
    const settlementOrder: StepName[] = [];
    let activeMembers = 0;
    let maxActiveMembers = 0;
    let startsAtFirstSettlement = 0;
    let thirdStartedWithoutCapacity = false;
    let parked = false;
    let boundaryObservation:
      | {
          event: ConductorEvent;
          memberStatuses: Record<string, unknown>;
          syntheticStatuses: Record<string, unknown>;
        }
      | undefined;
    const events = new ConductorEventEmitter();
    events.on('operator_park_boundary', async (event) => {
      const persisted = await readState(statePath);
      if (persisted.ok) {
        const raw = persisted.value as unknown as Record<string, unknown>;
        boundaryObservation = {
          event,
          memberStatuses: Object.fromEntries(
            members.map((member) => [member, raw[member]]),
          ),
          syntheticStatuses: Object.fromEntries(
            members.map((member) => [
              `validation__${member}`,
              raw[`validation__${member}`],
            ]),
          ),
        };
      }
    });
    const run = vi.fn<StepRunner['run']>(async (step) => {
      if (members.includes(step as (typeof members)[number])) {
        const member = step as (typeof members)[number];
        if (startOrder.length === 0) parked = true;
        if (member === 'architecture_review_as_built' && activeMembers >= 2) {
          thirdStartedWithoutCapacity = true;
        }
        activeMembers += 1;
        maxActiveMembers = Math.max(maxActiveMembers, activeMembers);
        startOrder.push(member);
        for (let index = 0; index < yieldCounts[member]; index += 1) {
          await Promise.resolve();
        }
        if (settlementOrder.length === 0) startsAtFirstSettlement = startOrder.length;
        settlementOrder.push(member);
        activeMembers -= 1;
      }
      return { success: true };
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events,
      config: { validation_concurrency: 2 },
      fromStep: 'manual_test',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => parked,
      ...noExternalIo(),
    });

    const result = await conductor.run();

    expect({
      result,
      startsAtFirstSettlement,
      thirdStartedWithoutCapacity,
      maxActiveMembers,
      startedMembers: startOrder,
      settlementOrder,
      boundaryObservation,
      laterUnitDispatches: run.mock.calls.filter(([step]) => step === 'rebase').length,
    }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'group', name: 'validation' },
      },
      startsAtFirstSettlement: 2,
      thirdStartedWithoutCapacity: false,
      maxActiveMembers: 2,
      startedMembers: [
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ],
      settlementOrder: [
        'prd_audit',
        'manual_test',
        'architecture_review_as_built',
      ],
      boundaryObservation: {
        event: {
          type: 'operator_park_boundary',
          featureSlug: 'operator-park-boundary',
          boundary: { kind: 'group', name: 'validation' },
        },
        memberStatuses: {
          manual_test: 'done',
          prd_audit: 'done',
          architecture_review_as_built: 'done',
        },
        syntheticStatuses: {
          validation__manual_test: 'done',
          validation__prd_audit: 'done',
          validation__architecture_review_as_built: 'done',
        },
      },
      laterUnitDispatches: 0,
    });
  });

  it('skips an all-skipped built-in SHIP group before parking at the later pending unit', async () => {
    const members = [
      'manual_test',
      'prd_audit',
      'architecture_review_as_built',
    ] as const;
    await writeState(statePath, {
      ...stateWithPending('rebase'),
      complexity_tier: 'S',
      track: 'technical',
      manual_test: 'skipped',
      prd_audit: 'skipped',
      architecture_review_as_built: 'skipped',
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
      fromStep: 'manual_test',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary,
      ...noExternalIo(),
    });

    const result = await conductor.run();
    const persisted = await readState(statePath);

    expect({
      result,
      memberStatuses: persisted.ok
        ? Object.fromEntries(members.map((member) => [member, persisted.value[member]]))
        : persisted,
      boundaryChecks: operatorParkBoundary.mock.calls.length,
      memberRunnerCalls: run.mock.calls.filter(([step]) => members.includes(step as typeof members[number])),
      laterUnitRunnerCalls: run.mock.calls.filter(([step]) => step === 'rebase'),
    }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'pre-first-unit' },
      },
      memberStatuses: {
        manual_test: 'skipped',
        prd_audit: 'skipped',
        architecture_review_as_built: 'skipped',
      },
      boundaryChecks: 1,
      memberRunnerCalls: [],
      laterUnitRunnerCalls: [],
    });
  });

  it('parks a one-member built-in SHIP group through the ordinary serial boundary without fan-out', async () => {
    const state: ConductState = {
      ...stateWithPending(
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ),
      complexity_tier: 'M',
      track: 'technical',
      architecture_review: 'skipped',
    };
    await writeState(statePath, state);
    const run = vi.fn<StepRunner['run']>(async () => ({ success: true }));
    const operatorParkBoundary = vi.fn<
      NonNullable<ConductorOptions['operatorParkBoundary']>
    >(async () => true);
    const parallelStarts: Array<Extract<ConductorEvent, { type: 'parallel_started' }>> = [];
    const events = new ConductorEventEmitter();
    events.on('parallel_started', (event) => {
      if (event.type === 'parallel_started') parallelStarts.push(event);
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events,
      fromStep: 'manual_test',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary,
      ...noExternalIo(),
    });

    const result = await conductor.run();

    expect({
      membership: resolveGroupMembership(
        VALIDATION_GROUP,
        state,
        'technical',
        CLAUDE_MODEL_POLICY,
      ).dispatchable.map((member) => member.name),
      result,
      boundaryChecks: operatorParkBoundary.mock.calls.length,
      parallelStarts,
      runnerCalls: run.mock.calls,
    }).toEqual({
      membership: ['manual_test'],
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'pre-first-unit' },
      },
      boundaryChecks: 1,
      parallelStarts: [],
      runnerCalls: [],
    });
  });

  it('joins the deterministic BUILD verification group before parking and blocks build review', async () => {
    await writeState(statePath, {
      ...stateWithPending('test_suite', 'build_review'),
      track: 'technical',
      complexity_tier: 'M',
    });
    const members = ['test_suite'] as const;
    const suiteStarted = deferred();
    const releaseSuite = deferred();
    const settled: StepName[] = [];
    let parked = false;
    const run = vi.fn<StepRunner['run']>(async (step) => {
      return { success: true };
    });
    const ensure = vi.fn(async () => {
      suiteStarted.resolve();
      await releaseSuite.promise;
      settled.push('test_suite');
      return {
        status: 'EXECUTED',
        freshness: { status: 'STALE', reason: 'missing' },
        evidence: {} as never,
      } as const;
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      config: { validation_concurrency: 2 },
      fromStep: 'test_suite',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => parked,
      fullSuiteVerifier: {
        ensure,
        inspect: async () => ({ status: 'STALE', reason: 'missing' }),
      },
      ...noExternalIo(),
    });

    const resultPromise = conductor.run();
    await suiteStarted.promise;
    releaseSuite.resolve();
    await Promise.resolve();
    parked = true;
    const result = await resultPromise;
    const persisted = await readState(statePath);
    const raw = persisted.ok
      ? (persisted.value as unknown as Record<string, unknown>)
      : {};

    expect({
      result,
      settled,
      memberStatuses: Object.fromEntries(members.map((member) => [member, raw[member]])),
      syntheticStatuses: Object.fromEntries(
        members.map((member) => [
          `build_verification__${member}`,
          raw[`build_verification__${member}`],
        ]),
      ),
      buildReviewDispatches: run.mock.calls.filter(([step]) => step === 'build_review').length,
      suiteEnsureCalls: ensure.mock.calls.length,
    }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'step', name: 'test_suite' },
      },
      settled: ['test_suite'],
      memberStatuses: { test_suite: 'done' },
      syntheticStatuses: {
        build_verification__test_suite: undefined,
      },
      buildReviewDispatches: 0,
      suiteEnsureCalls: 1,
    });
  });

  it.each([
    {
      name: 'pending semantic build review',
      pending: ['build_review'] as StepName[],
    },
  ])('keeps $name semantics while parking blocks the next unit', async ({ pending }) => {
    await writeState(statePath, stateWithPending(...pending));
    const run = vi.fn<StepRunner['run']>(async () => ({ success: true }));
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      fromStep: pending[0],
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => true,
      ...noExternalIo(),
    });

    const result = await conductor.run();

    const persisted = await readState(statePath);
    expect({ result, runnerCalls: run.mock.calls }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'pre-first-unit' },
      },
      runnerCalls: [],
    });
    // build_review is the pending semantic gate. Parking must not manufacture
    // a retired wiring_check wait/dispatch on its way to that boundary.
    if (pending.length === 1 && pending[0] === 'build_review') {
      expect(persisted.ok && persisted.value.wiring_check).toBeUndefined();
      expect(run.mock.calls.map(([step]) => step)).not.toContain('wiring_check');
    }
  });

  it('keeps interactive dispatch and checkpoint sequences identical with a repo-root park marker', async () => {
    const runInteractive = async (parked: boolean) => {
      const caseRoot = join(projectRoot, parked ? 'parked' : 'baseline');
      const caseStatePath = join(caseRoot, 'conduct-state.json');
      await mkdir(caseRoot, { recursive: true });
      await writeState(caseStatePath, stateWithPending('build', 'wiring_check'));
      if (parked) {
        const markerDir = join(caseRoot, '.daemon', 'parked');
        await mkdir(markerDir, { recursive: true });
        await writeFile(join(markerDir, 'interactive-feature'), 'operator\n');
      }

      const dispatched: StepName[] = [];
      const checkpoints: StepName[] = [];
      const operatorParkBoundaries: ConductorEvent[] = [];
      const caseEvents = new ConductorEventEmitter();
      caseEvents.on('operator_park_boundary', (event) => {
        operatorParkBoundaries.push(event);
      });
      const conductor = new Conductor({
        projectRoot: caseRoot,
        stateFilePath: caseStatePath,
        stepRunner: {
          run: async (step) => {
            dispatched.push(step);
            return { success: true };
          },
        },
        events: caseEvents,
        fromStep: 'build',
        mode: 'interactive',
        daemon: false,
        verifyArtifacts: false,
        onCheckpoint: async (step) => {
          checkpoints.push(step);
          return 'quit';
        },
        ...noExternalIo(),
      });

      const result = await conductor.run();
      return { result, dispatched, checkpoints, operatorParkBoundaries };
    };

    const baseline = await runInteractive(false);
    const withParkMarker = await runInteractive(true);

    expect(withParkMarker).toEqual(baseline);
    expect(baseline).toEqual({
      result: undefined,
      dispatched: ['build'],
      checkpoints: ['build'],
      operatorParkBoundaries: [],
    });
  });

  it('logs a marker-read anomaly and fails closed before the first pending unit', async () => {
    await writeState(statePath, stateWithPending('memory'));
    const run = vi.fn<StepRunner['run']>(async () => ({ success: true }));
    const featureSlug = 'operator-park-boundary';
    const logLines: string[] = [];
    await mkdir(join(projectRoot, '.daemon', 'parked', featureSlug), { recursive: true });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug,
      operatorParkBoundary: () =>
        isOperatorParked(projectRoot, featureSlug, (error) => {
          logLines.push(`operator park marker read failed: ${error.message}`);
        }),
    });

    const result = await conductor.run();
    const daemonCliSource = await readFile(
      new URL('../../src/daemon-cli.ts', import.meta.url),
      'utf8',
    );

    expect({
      result,
      runnerCalls: run.mock.calls,
      logLines,
      daemonWiresMarkerReadErrors: /operatorParkBoundary:\s*\(\)\s*=>\s*isOperatorParked\(\s*projectRoot,\s*item\.slug,\s*\(error\)\s*=>\s*featureLog\(`operator park marker read failed: \$\{error\.message\}`\),?\s*\)/.test(
        daemonCliSource,
      ),
    }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'pre-first-unit' },
      },
      runnerCalls: [],
      logLines: [expect.stringMatching(/operator park marker read failed:.*EISDIR/i)],
      daemonWiresMarkerReadErrors: true,
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
