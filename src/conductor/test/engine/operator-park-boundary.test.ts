// Covers: task:1
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
import { EventPersister } from '../../src/engine/event-persister.js';
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

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
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

async function terminalMarkerNames(root: string): Promise<string[]> {
  return Promise.all(
    ['HALT', 'HALT.class'].map(async (name) =>
      readFile(join(root, '.pipeline', name), 'utf8').then(() => name).catch(() => undefined),
    ),
  ).then((names) => names.filter((name): name is string => name !== undefined));
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

  it('persists an attempt boundary with its feature and step on the existing event spine', async () => {
    const events = new ConductorEventEmitter();
    const eventsPath = join(projectRoot, '.pipeline', 'events.jsonl');
    const persister = new EventPersister(eventsPath, events);
    persister.start();

    await events.emit({
      type: 'operator_park_boundary',
      featureSlug: 'parked-feature',
      boundary: { kind: 'attempt', step: 'build', attempt: 2 },
    });
    persister.stop();

    expect(JSON.parse(await readFile(eventsPath, 'utf8'))).toMatchObject({
      type: 'operator_park_boundary',
      featureSlug: 'parked-feature',
      boundary: { kind: 'attempt', step: 'build', attempt: 2 },
    });
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
    const dispatchPrimitives = [
      'this.stepRunner.run(',
      'runGroupBranch(',
      'this.runParallelGroupViaCore(',
    ] as const;
    const prdWideningReconciliationDispatch = `const judgement = await this.stepRunner.run('remediate', state, {
          remediationRequest: {
            mode: 'prd-widening-reconciliation',
            projection: JSON.stringify(context.value),
            nativeSchema: PRD_WIDENING_RECONCILIATION_SCHEMA,
          },
        });`;
    const buildReviewAdjudicationDispatch = `const dispatched = await this.stepRunner.run('remediate', state, {
                        retryReason: \`Adjudicate this complete build-review context only; write \${requestedMode} remediation output.\\n\${JSON.stringify(context)}\`,
                      });`;
    // A string entry matches the exact statement text; a RegExp entry matches
    // the executionContext-reshaped helper dispatches whose option objects span
    // several lines. Either way the primitive must sit at the matched offset.
    const reviewedHelperDispatchAllowlist: ReadonlyArray<string | RegExp> = [
      "await this.stepRunner.run('remediate', state, { retryReason: dispatchContext });",
      prdWideningReconciliationDispatch,
      buildReviewAdjudicationDispatch,
      /return(?: await)? this\.stepRunner\.run\(name, state, \{\s*retryReason: retryHint,\s*\.\.\.identityOption,\s*\.\.\.executionContextOption,\s*\}\);/g,
      // Configured-group branches run only through runParallelGroupViaCore,
      // whose caller is one of the guarded scheduling-unit entries above.
      /return runGroupBranch\(member, state, \{\s*stepRunner: this\.stepRunner,\s*executionContext,/g,
      "return this.stepRunner.run('finish', state, options);",
      // The two bounded FINISH prose passes. Both are reached only from inside
      // the already-park-guarded FINISH dispatch.
      "this.stepRunner.run('finish', state, { ...options, finishProsePass: 'judge' })",
      `this.stepRunner.run('finish', state, {
          ...options,
          finishProsePass: 'author',
          ...(request.revisionGuidance === undefined
            ? {}
            : { revisionGuidance: request.revisionGuidance }),
        })`,
    ];
    expect(conductorSource).toContain(prdWideningReconciliationDispatch);
    expect(conductorSource).toContain(buildReviewAdjudicationDispatch);
    const guardedSegmentsIn = (source: string) => {
      const guardedSegments = [
        /if \(stepCfg\?\.parallel\) \{[\s\S]*?await this\.runParallelGroupViaCore\(/,
        /if \(\s*groupEntryName === step\.name &&[\s\S]*?runGroupBranch\(/,
      ].map((pattern) => {
        const match = source.match(pattern);
        expect(match).not.toBeNull();
        const guardedSource = match![0];
        const start = source.indexOf(guardedSource);
        return {
          start,
          guard: start + guardedSource.indexOf('await stopAtOperatorParkBoundary();'),
          end: start + guardedSource.length,
        };
      });
      const serialGuard = source.lastIndexOf(
        'const preDispatchPark = await stopAtOperatorParkBoundary();',
      );
      // The guarded serial block is one park guard followed by a dispatch
      // ternary whose final arm folds the prd_audit preparation and the
      // regular fallback into one runner call. The segment runs from the
      // guard to that dispatch so every arm of the ternary counts as guarded,
      // not only the first one found.
      const serialFallbackDispatch = 'return await this.stepRunner.run(step.name, state, {';
      const serialDispatch = source.indexOf(serialFallbackDispatch, serialGuard);
      expect(serialGuard).toBeGreaterThan(-1);
      expect(serialDispatch).toBeGreaterThan(serialGuard);
      guardedSegments.push({
        start: serialGuard,
        guard: serialGuard,
        end: serialDispatch + serialFallbackDispatch.length,
      });
      return guardedSegments;
    };
    const unreviewedDispatchesIn = (source: string) => {
      const discoveredDispatches = dispatchPrimitives.flatMap((primitive) =>
        [...source.matchAll(new RegExp(primitive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map(
          (match) => ({ primitive, offset: match.index! }),
        ),
      );
      const guardedSegments = guardedSegmentsIn(source);
      return {
        discoveredDispatches,
        unreviewedDispatches: discoveredDispatches.filter(({ primitive, offset }) => {
          const guarded = guardedSegments.some(
            (segment) => offset > segment.guard && offset < segment.end,
          );
          const reviewedHelper = reviewedHelperDispatchAllowlist.some((statement) => {
            if (statement instanceof RegExp) {
              return [...source.matchAll(statement)].some((match) => {
                const primitiveOffset = match[0].indexOf(primitive);
                return primitiveOffset !== -1 && offset === match.index! + primitiveOffset;
              });
            }
            const primitiveOffset = statement.indexOf(primitive);
            if (primitiveOffset === -1) return false;
            let statementOffset = source.indexOf(statement);
            while (statementOffset !== -1) {
              if (offset === statementOffset + primitiveOffset) return true;
              statementOffset = source.indexOf(statement, statementOffset + statement.length);
            }
            return false;
          });
          return !guarded && !reviewedHelper;
        }),
      };
    };
    const { discoveredDispatches, unreviewedDispatches } = unreviewedDispatchesIn(conductorSource);

    expect({ discoveredDispatches, unreviewedDispatches }).toEqual({
      discoveredDispatches: expect.arrayContaining([
        expect.objectContaining({ primitive: 'this.stepRunner.run(' }),
        expect.objectContaining({ primitive: 'runGroupBranch(' }),
        expect.objectContaining({ primitive: 'this.runParallelGroupViaCore(' }),
      ]),
      unreviewedDispatches: [],
    });

    const unguardedRemediateDispatch = "const judgement = await this.stepRunner.run('remediate', state, { retryReason: 'unguarded reconciliation dispatch' });";
    const unguardedSource = conductorSource.replace(
      prdWideningReconciliationDispatch,
      unguardedRemediateDispatch,
    );
    const unguardedOffset = unguardedSource.indexOf(
      'this.stepRunner.run(',
      unguardedSource.indexOf(unguardedRemediateDispatch),
    );
    expect(unguardedOffset).toBeGreaterThan(-1);
    expect(unreviewedDispatchesIn(unguardedSource).unreviewedDispatches).toContainEqual({
      primitive: 'this.stepRunner.run(',
      offset: unguardedOffset,
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

    expect({ result, runnerCalls: run.mock.calls, terminalMarkers: await terminalMarkerNames(projectRoot) }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'pre-first-unit' },
      },
      runnerCalls: [],
      terminalMarkers: [],
    });
  });

  it('parks before the first pending serial unit when the boundary reader rejects', async () => {
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
      operatorParkBoundary: async () => { throw new Error('park boundary unreadable'); },
    });

    const result = await conductor.run();

    expect({ result, runnerCalls: run.mock.calls, terminalMarkers: await terminalMarkerNames(projectRoot) }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'pre-first-unit' },
      },
      runnerCalls: [],
      terminalMarkers: [],
    });
  });

  it('declines an ordinary-path retry after a park lands during attempt one', async () => {
    await writeState(statePath, stateWithPending('memory'));
    let parked = false;
    const run = vi.fn<StepRunner['run']>(async () => {
      parked = true;
      return { success: false, output: 'retry me' };
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      maxRetries: 3,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => parked,
    });

    const result = await conductor.run();

    expect({ result, runnerCalls: run.mock.calls.length }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'attempt', step: 'memory', attempt: 2 },
      },
      runnerCalls: 1,
    });
  });

  it('routes a self-host admission cancellation to the operator-park terminal before retry accounting', async () => {
    await writeState(statePath, stateWithPending('build'));
    const events = new ConductorEventEmitter();
    const retries: ConductorEvent[] = [];
    const failures: ConductorEvent[] = [];
    events.on('step_retry', (event) => { retries.push(event); });
    events.on('step_failed', (event) => { failures.push(event); });
    const run = vi.fn<StepRunner['run']>(async () => ({ success: true }));
    const conductor = new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: { run }, events,
      fromStep: 'build', mode: 'auto', daemon: true, selfHost: true,
      verifyArtifacts: false, featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => false,
    });
    const admission = vi.fn(async () => ({ success: false, operatorParkedBeforeDispatch: true }));
    (conductor as unknown as { runSelfBuildDispatch: typeof admission }).runSelfBuildDispatch = admission;

    const result = await conductor.run();

    expect({ result, admissionCalls: admission.mock.calls.length, runnerCalls: run.mock.calls.length, retries, failures }).toEqual({
      result: { kind: 'operator-parked', boundary: { kind: 'attempt', step: 'build', attempt: 1 } },
      admissionCalls: 1,
      runnerCalls: 0,
      retries: [],
      failures: [],
    });
  });

  it('keeps a declined third build attempt terminal, in progress, and free of accounting', async () => {
    await writeState(statePath, stateWithPending('build'));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    const evidencePath = join(projectRoot, '.pipeline', 'task-evidence.json');
    await writeFile(evidencePath, JSON.stringify({
      evidenceStamps: {},
      noEvidenceAttempts: 7,
      noEvidenceReasons: ['zero_work_product'],
      migrationGrandfather: [],
      lastResolvedCount: 0,
    }));
    const events = new ConductorEventEmitter();
    const timeline: ConductorEvent[] = [];
    const emit = events.emit.bind(events);
    vi.spyOn(events, 'emit').mockImplementation(async (event) => {
      timeline.push(event);
      await emit(event);
    });
    const run = vi.fn<StepRunner['run']>(async () => ({
      success: false,
      output: 'build needs another attempt',
    }));
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      maxRetries: 3,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => run.mock.calls.length >= 2,
      config: { build_progress: { enabled: false } } as never,
    });

    const result = await conductor.run();
    const persisted = await readState(statePath);
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as { noEvidenceAttempts: number };
    const boundaryIndex = timeline.findIndex((event) => event.type === 'operator_park_boundary');

    expect({
      result,
      dispatchedAttempts: run.mock.calls.map(([, , options]) => options?.attempt),
      terminalEvents: timeline.slice(boundaryIndex).map((event) => event.type),
      terminalMarkers: await terminalMarkerNames(projectRoot),
      persisted: persisted.ok ? persisted.value.build : persisted,
      noEvidenceAttempts: evidence.noEvidenceAttempts,
    }).toEqual({
      result: { kind: 'operator-parked', boundary: { kind: 'attempt', step: 'build', attempt: 3 } },
      // Escalation is derived only immediately before a dispatch; a third
      // attempt would be the first model-rung escalation, but is declined.
      dispatchedAttempts: [1, 2],
      terminalEvents: ['operator_park_boundary'],
      terminalMarkers: [],
      persisted: 'in_progress',
      noEvidenceAttempts: 7,
    });
  });

  it('fails toward parked when the ordinary-path retry check rejects', async () => {
    await writeState(statePath, stateWithPending('memory'));
    const boundary = vi.fn<NonNullable<ConductorOptions['operatorParkBoundary']>>(
      async () => {
        if (boundary.mock.calls.length >= 3) throw new Error('park boundary unreadable');
        return false;
      },
    );
    const run = vi.fn<StepRunner['run']>(async () => ({ success: false, output: 'retry me' }));
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      maxRetries: 3,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: boundary,
    });

    const result = await conductor.run();

    expect({ result, runnerCalls: run.mock.calls.length }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'attempt', step: 'memory', attempt: 2 },
      },
      runnerCalls: 1,
    });
  });

  it('allows an ordinary-path retry dispatch when no park is active', async () => {
    await writeState(statePath, stateWithPending('memory'));
    const run = vi.fn<StepRunner['run']>()
      .mockResolvedValueOnce({ success: false, output: 'retry me' })
      .mockResolvedValueOnce({ success: true });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      maxRetries: 3,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => false,
    });

    const result = await conductor.run();

    expect({ result, runnerCalls: run.mock.calls.length }).toEqual({
      result: undefined,
      runnerCalls: 2,
    });
  });

  it('allows an ordinary-path retry dispatch when a park is removed before its check', async () => {
    await writeState(statePath, stateWithPending('memory'));
    let parked = false;
    const boundary = vi.fn<NonNullable<ConductorOptions['operatorParkBoundary']>>(async () => {
      // The park marker existed after attempt one but is removed before this
      // next-attempt read, so retry admission proceeds normally.
      parked = false;
      return parked;
    });
    let calls = 0;
    const run = vi.fn<StepRunner['run']>(async () => {
      calls += 1;
      if (calls === 1) {
        parked = true;
        return { success: false, output: 'retry me' };
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
      maxRetries: 3,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: boundary,
    });

    const result = await conductor.run();

    expect({ result, runnerCalls: run.mock.calls.length, boundaryCalls: boundary.mock.calls.length }).toEqual({
      result: undefined,
      runnerCalls: 2,
      boundaryCalls: 3,
    });
  });

  it('emits one attempt-boundary event when the ordinary-path retry is declined', async () => {
    await writeState(statePath, stateWithPending('memory'));
    let parked = false;
    const events = new ConductorEventEmitter();
    const boundaries: Array<Extract<ConductorEvent, { type: 'operator_park_boundary' }>> = [];
    events.on('operator_park_boundary', (event) => {
      if (event.type === 'operator_park_boundary') boundaries.push(event);
    });
    const run = vi.fn<StepRunner['run']>(async () => {
      parked = true;
      return { success: false, output: 'retry me' };
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events,
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      maxRetries: 3,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => parked,
    });

    await conductor.run();

    expect(boundaries).toEqual([
      {
        type: 'operator_park_boundary',
        featureSlug: 'operator-park-boundary',
        boundary: { kind: 'attempt', step: 'memory', attempt: 2 },
      },
    ]);
  });

  it('routes every free and budgeted serial retry back through the attempt park gate', async () => {
    // These are deliberately asserted against the serial-loop source rather
    // than duplicating the loop's branch mechanics in seven broad fixtures.
    // The ordinary-path tests above execute the gate; this inventory binds
    // every non-consuming and ordinary retry branch to that same loop entry.
    const conductorSource = await readFile(
      new URL('../../src/engine/conductor.ts', import.meta.url),
      'utf8',
    );
    const serialLoopStart = conductorSource.indexOf('while (attempt < stepMaxRetries) {');
    const serialLoopEnd = conductorSource.indexOf('\n\n        if (succeeded &&', serialLoopStart);
    expect(serialLoopStart).toBeGreaterThan(-1);
    expect(serialLoopEnd).toBeGreaterThan(serialLoopStart);
    const serialLoop = conductorSource.slice(serialLoopStart, serialLoopEnd);

    const reentryCases = [
      ['rate-limit wait', 'if (result.rateLimited)', 'attempt--;\n            continue;'],
      ['stale-session reset', 'if (result.sessionExpired)', 'attempt--;\n            continue;'],
      ['auth refresh', 'if (result.authFailure)', 'attempt--;\n            continue;'],
      ['finish-publication progress retry', 'if (progressBypassed || attempt < stepMaxRetries)', 'continue;'],
      ['test-suite infrastructure retry', 'MAX_SUITE_INFRASTRUCTURE_RETRIES', 'attempt--;\n                continue;'],
      ['build-review mechanical-fault retry', 'result.currentLapMechanicalFault === true', 'attempt--;\n                continue;'],
      ['budgeted completion-check miss', "reason: completion.reason ?? 'completion check failed'", 'continue;'],
    ] as const;

    for (const [name, branch, reentry] of reentryCases) {
      const branchOffset = serialLoop.indexOf(branch);
      expect(branchOffset, `${name} branch is inside the serial retry loop`).toBeGreaterThan(-1);
      expect(
        serialLoop.indexOf(reentry, branchOffset),
        `${name} re-enters the serial retry loop`,
      ).toBeGreaterThan(branchOffset);
    }

    const attemptGate = /this\.daemon\s*&&\s*this\.featureSlug !== undefined\s*&&\s*this\.operatorParkBoundary\s*&&\s*await this\.operatorParkBoundary\(\)\.catch\(\(\) => true\)/;
    expect(attemptGate.test(serialLoop)).toBe(true);
    // The runtime cases immediately above prove a rejected gate returns the
    // typed termination before a runner call. Every listed `continue` returns
    // to this one loop entry, so no free or budgeted retry can bypass it.
    expect(serialLoop.search(attemptGate)).toBeLessThan(serialLoop.indexOf('this.stepRunner.run(step.name, state, {'));
  });

  it('declines a test-suite infrastructure retry before a second suite dispatch', async () => {
    await writeState(statePath, stateWithPending('test_suite'));
    let parked = false;
    const boundary = vi.fn<NonNullable<ConductorOptions['operatorParkBoundary']>>(async () => parked);
    const boundaries: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('operator_park_boundary', (event) => { boundaries.push(event); });
    const ensure = vi.fn(async () => {
      parked = true;
      return { status: 'FAILED', reason: 'internal_error', message: 'suite runner unavailable' } as const;
    });
    const conductor = new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: { run: vi.fn() }, events: emitter,
      fromStep: 'test_suite', mode: 'auto', daemon: true, verifyArtifacts: false,
      featureSlug: 'operator-park-boundary', operatorParkBoundary: boundary,
      fullSuiteVerifier: { inspect: async () => ({ status: 'STALE', reason: 'missing' }), ensure },
      ...noExternalIo(),
    });

    const result = await conductor.run();

    expect({ result, suiteDispatches: ensure.mock.calls.length, boundaryCalls: boundary.mock.calls.length,
      terminalMarkers: await terminalMarkerNames(projectRoot), eventTail: boundaries.at(-1) }).toEqual({
      result: { kind: 'operator-parked', boundary: { kind: 'attempt', step: 'test_suite', attempt: 1 } },
      suiteDispatches: 1,
      boundaryCalls: 3,
      terminalMarkers: [],
      eventTail: boundaries.at(-1),
    });
  });

  it('lets a running successful attempt drain before parking at its next unit boundary', async () => {
    await writeState(statePath, stateWithPending('memory', 'explore'));
    const started = deferred();
    const release = deferred<{ success: boolean; output: string }>();
    let parked = false;
    const run = vi.fn<StepRunner['run']>(async (step) => {
      if (step === 'memory') {
        started.resolve();
        return release.promise;
      }
      throw new Error(`park should decline ${step}`);
    });
    const events = new ConductorEventEmitter();
    const completed: Array<Extract<ConductorEvent, { type: 'step_completed' }>> = [];
    events.on('step_completed', (event) => {
      if (event.type === 'step_completed') completed.push(event);
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

    const resultPromise = conductor.run();
    await started.promise;
    parked = true;
    expect(run).toHaveBeenCalledTimes(1);
    release.resolve({ success: true, output: 'drained success output' });
    const result = await resultPromise;
    const persisted = await readState(statePath);

    expect({
      result,
      runnerSteps: run.mock.calls.map(([step]) => step),
      completed,
      persisted: persisted.ok ? { memory: persisted.value.memory, explore: persisted.value.explore } : persisted,
    }).toEqual({
      result: { kind: 'operator-parked', boundary: { kind: 'step', name: 'memory' } },
      runnerSteps: ['memory'],
      completed: [expect.objectContaining({ step: 'memory', status: 'done', tail: ['drained success output'] })],
      persisted: { memory: 'done', explore: 'pending' },
    });
  });

  it('records a failed running attempt before parking its retry', async () => {
    await writeState(statePath, stateWithPending('memory'));
    const started = deferred();
    const release = deferred<{ success: boolean; output: string }>();
    let parked = false;
    const run = vi.fn<StepRunner['run']>(async () => {
      started.resolve();
      return release.promise;
    });
    const events = new ConductorEventEmitter();
    const retries: Array<Extract<ConductorEvent, { type: 'step_retry' }>> = [];
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry') retries.push(event);
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events,
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      maxRetries: 2,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => parked,
    });

    const resultPromise = conductor.run();
    await started.promise;
    parked = true;
    expect(run).toHaveBeenCalledTimes(1);
    release.resolve({ success: false, output: 'drained failure output' });
    const [result, persisted] = await Promise.all([resultPromise, readState(statePath)]);

    expect({
      result,
      runnerCalls: run.mock.calls.length,
      retries,
      persisted: persisted.ok ? persisted.value.memory : persisted,
    }).toEqual({
      result: { kind: 'operator-parked', boundary: { kind: 'attempt', step: 'memory', attempt: 2 } },
      runnerCalls: 1,
      retries: [expect.objectContaining({ step: 'memory', attempt: 2, reason: 'drained failure output' })],
      persisted: 'in_progress',
    });
  });

  it('resumes an unparked declined step at attempt one with a fresh retry budget', async () => {
    await writeState(statePath, stateWithPending('memory'));
    let parked = false;
    const initialRun = vi.fn<StepRunner['run']>(async () => {
      parked = true;
      return { success: false, output: 'park after this attempt' };
    });
    const initial = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run: initialRun },
      events: new ConductorEventEmitter(),
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      maxRetries: 3,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => parked,
    });

    await expect(initial.run()).resolves.toEqual({
      kind: 'operator-parked',
      boundary: { kind: 'attempt', step: 'memory', attempt: 2 },
    });
    const afterInitial = await readState(statePath);
    expect(afterInitial.ok ? afterInitial.value.memory : afterInitial).toBe('in_progress');

    const resumedRun = vi.fn<StepRunner['run']>(async () => ({
      success: false,
      output: 'park the resumed retry',
    }));
    const resumed = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run: resumedRun },
      events: new ConductorEventEmitter(),
      resume: true,
      mode: 'auto',
      daemon: true,
      maxRetries: 3,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => resumedRun.mock.calls.length > 0,
    });

    await expect(resumed.run()).resolves.toEqual({
      kind: 'operator-parked',
      boundary: { kind: 'attempt', step: 'memory', attempt: 2 },
    });
    expect(resumedRun.mock.calls.map(([step, , options]) => ({ step, attempt: options?.attempt }))).toEqual([
      { step: 'memory', attempt: 1 },
    ]);
  });

  it('keeps committed build tasks complete when an unparked build step resumes', async () => {
    await writeState(statePath, stateWithPending('build'));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    const taskStatusPath = join(projectRoot, '.pipeline', 'task-status.json');
    const committedTasks = {
      tasks: [
        { id: '1', name: 'settled task one', status: 'completed' },
        { id: '2', name: 'settled task two', status: 'completed' },
        { id: '3', name: 'current task', status: 'in_progress' },
      ],
    };
    await writeFile(taskStatusPath, JSON.stringify(committedTasks));
    const run = vi.fn<StepRunner['run']>(async () => ({ success: false, output: 'park after resumed build' }));
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      resume: true,
      mode: 'auto',
      daemon: true,
      maxRetries: 3,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => run.mock.calls.length > 0,
      config: { build_progress: { enabled: false } } as never,
    });

    await expect(conductor.run()).resolves.toEqual({
      kind: 'operator-parked',
      boundary: { kind: 'attempt', step: 'build', attempt: 2 },
    });
    expect({
      dispatchedSteps: run.mock.calls.map(([step]) => step),
      taskStatuses: JSON.parse(await readFile(taskStatusPath, 'utf8')),
    }).toEqual({
      dispatchedSteps: ['build'],
      taskStatuses: committedTasks,
    });
  });

  it('returns at the pre-unit park gate when a resumed step remains parked', async () => {
    const parkedState = stateWithPending('memory');
    parkedState.memory = 'in_progress';
    await writeState(statePath, parkedState);
    const run = vi.fn<StepRunner['run']>(async () => ({ success: true }));
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      resume: true,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => true,
    });

    const [result, persisted] = await Promise.all([conductor.run(), readState(statePath)]);
    expect({
      result,
      runnerCalls: run.mock.calls.length,
      persisted: persisted.ok ? persisted.value.memory : persisted,
    }).toEqual({
      result: { kind: 'operator-parked', boundary: { kind: 'pre-first-unit' } },
      runnerCalls: 0,
      persisted: 'in_progress',
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
      boundaryChecks: 3,
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
      return boundaryChecks > 2;
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

  it('parks before bounded recovery dispatch when a failed gate activates the park', async () => {
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
          }
        : persisted,
    }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'attempt', step: 'build_review', attempt: 2 },
      },
      runnerSteps: ['build_review'],
      failed: [],
      parkedBoundaries: [
        {
          type: 'operator_park_boundary',
          featureSlug: 'operator-park-boundary',
          boundary: { kind: 'attempt', step: 'build_review', attempt: 2 },
        },
      ],
      persisted: { buildReview: 'in_progress' },
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

  it('settles a parked configured member, preserves its successful sibling, and stops the join', async () => {
    await writeState(statePath, stateWithPending('memory', 'explore'));
    let parked = false;
    const events = new ConductorEventEmitter();
    const failures: Array<Extract<ConductorEvent, { type: 'parallel_failure' }>> = [];
    const parkBoundaries: Array<Extract<ConductorEvent, { type: 'operator_park_boundary' }>> = [];
    events.on('parallel_failure', (event) => {
      if (event.type === 'parallel_failure') failures.push(event);
    });
    events.on('operator_park_boundary', (event) => {
      if (event.type === 'operator_park_boundary') parkBoundaries.push(event);
    });
    const run = vi.fn<StepRunner['run']>(async (step) => {
      if (step === ('parked-member' as StepName)) {
        parked = true;
        return { success: false, output: 'retry after park' };
      }
      return { success: true };
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events,
      config: { steps: { memory: { max_retries: 2, parallel: [{ name: 'parked-member' }, { name: 'passing-member' }] } } },
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => parked,
    });

    const result = await conductor.run();
    const persisted = await readState(statePath);

    expect({
      result,
      calls: run.mock.calls.map(([step]) => step),
      failures,
      parkBoundaries,
      state: persisted.ok ? {
        memory: persisted.value.memory,
        parked: (persisted.value as Record<string, unknown>)['memory__parked-member'],
        passing: (persisted.value as Record<string, unknown>)['memory__passing-member'],
      } : persisted,
    }).toEqual({
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'attempt', step: 'memory', attempt: 2, member: 'parked-member' },
      },
      calls: ['parked-member', 'passing-member'],
      failures: [],
      parkBoundaries: [{
        type: 'operator_park_boundary',
        featureSlug: 'operator-park-boundary',
        boundary: { kind: 'attempt', step: 'memory', attempt: 2, member: 'parked-member' },
      }],
      state: { memory: 'in_progress', parked: 'in_progress', passing: 'done' },
    });
  });

  it('keeps a genuine configured-member failure authoritative beside a parked member', async () => {
    await writeState(statePath, stateWithPending('memory', 'explore'));
    const releaseParkedMember = deferred();
    const failedMemberExhausted = deferred();
    let parked = false;
    let failedAttempts = 0;
    const failures: Array<Extract<ConductorEvent, { type: 'parallel_failure' }>> = [];
    const parkBoundaries: Array<Extract<ConductorEvent, { type: 'operator_park_boundary' }>> = [];
    const events = new ConductorEventEmitter();
    events.on('parallel_failure', (event) => {
      if (event.type === 'parallel_failure') failures.push(event);
    });
    events.on('operator_park_boundary', (event) => {
      if (event.type === 'operator_park_boundary') parkBoundaries.push(event);
    });
    const run = vi.fn<StepRunner['run']>(async (step) => {
      if (step === ('parked-member' as StepName)) {
        await releaseParkedMember.promise;
        return { success: false, output: 'parked retry' };
      }
      if (step === ('failed-member' as StepName)) {
        failedAttempts += 1;
        if (failedAttempts === 2) failedMemberExhausted.resolve();
        return { success: false, output: 'original failed-member diagnostic' };
      }
      return { success: true };
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run },
      events,
      config: { validation_concurrency: 2, steps: { memory: {
        max_retries: 2,
        parallel: [{ name: 'parked-member' }, { name: 'failed-member' }],
      } } },
      fromStep: 'memory',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'operator-park-boundary',
      operatorParkBoundary: async () => parked,
    });

    const resultPromise = conductor.run();
    await failedMemberExhausted.promise;
    parked = true;
    releaseParkedMember.resolve();
    const result = await resultPromise;
    const persisted = await readState(statePath);

    expect({
      result,
      calls: run.mock.calls.map(([step]) => step),
      failures,
      parkBoundaries,
      state: persisted.ok ? {
        group: persisted.value.memory,
        parked: (persisted.value as Record<string, unknown>)['memory__parked-member'],
        failed: (persisted.value as Record<string, unknown>)['memory__failed-member'],
      } : persisted,
    }).toEqual({
      result: undefined,
      calls: ['parked-member', 'failed-member', 'failed-member'],
      failures: [{
        type: 'parallel_failure',
        step: 'memory',
        branch: 'failed-member',
        error: 'original failed-member diagnostic',
      }],
      parkBoundaries: [],
      state: { group: 'failed', parked: 'in_progress', failed: 'failed' },
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
      settlementCount: settlementOrder.length,
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
      settlementOrder: expect.arrayContaining([
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ]),
      settlementCount: 3,
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
      membership: ['manual_test', 'prd_audit', 'architecture_review_as_built'],
      result: {
        kind: 'operator-parked',
        boundary: { kind: 'pre-first-unit' },
      },
      boundaryChecks: 1,
      parallelStarts: [],
      runnerCalls: [],
    });
  });

  it('parks before serial test-suite verification and blocks build review', async () => {
    const state: ConductState = {
      ...stateWithPending('test_suite', 'build_review'),
      track: 'technical',
      complexity_tier: 'M',
    };
    // test_suite is the serial BUILD verifier and build_review is the next
    // semantic owner.
    const buildReview = ALL_STEPS.find(({ name }) => name === 'build_review');
    expect({
      reviewPrerequisites: buildReview?.prerequisites,
    }).toEqual({
      reviewPrerequisites: ['test_suite'],
    });
    await writeState(statePath, state);
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
  });

  it('keeps interactive dispatch and checkpoint sequences identical with a repo-root park marker', async () => {
    const runInteractive = async (parked: boolean) => {
      const caseRoot = join(projectRoot, parked ? 'parked' : 'baseline');
      const caseStatePath = join(caseRoot, 'conduct-state.json');
      await mkdir(caseRoot, { recursive: true });
      await writeState(caseStatePath, stateWithPending('build', 'test_suite'));
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

  it('keeps a parked interactive run on its full retry ladder without consulting park state', async () => {
    await writeState(statePath, stateWithPending('memory'));
    await mkdir(join(projectRoot, '.daemon', 'parked'), { recursive: true });
    await writeFile(join(projectRoot, '.daemon', 'parked', 'interactive-feature'), 'operator\n');
    const boundary = vi.fn<NonNullable<ConductorOptions['operatorParkBoundary']>>(async () => true);
    const run = vi.fn<StepRunner['run']>(async (_step, _state, options) => ({
      success: options?.attempt === 3,
      output: 'retry interactive work',
    }));
    const conductor = new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: { run }, events: new ConductorEventEmitter(),
      fromStep: 'memory', mode: 'interactive', daemon: false, maxRetries: 3,
      verifyArtifacts: false, featureSlug: 'interactive-feature', operatorParkBoundary: boundary,
    });

    await conductor.run();

    expect({ attempts: run.mock.calls.map(([, , options]) => options?.attempt), parkReads: boundary.mock.calls.length })
      .toEqual({ attempts: [1, 2, 3], parkReads: 0 });
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
