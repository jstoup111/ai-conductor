// Covers: task:12, task:13
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { Conductor } from '../test-conductor.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS, VALIDATION_GROUP } from '../../src/engine/steps.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { MetricsListener } from '../../src/engine/otel/metrics-listener.js';
import { MetricsRecorder } from '../../src/engine/otel/metrics.js';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../src/engine/otel/otel-visualizer.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { CapturingSpanExporter } from '../fixtures/capturing-span-exporter.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';

interface MetricPoint { attributes: Record<string, unknown>; value: unknown; }
type TelemetryMode = 'enabled' | 'disabled' | 'failing-exporter';
type SerialResult = Awaited<ReturnType<Conductor['run']>>;
interface SerialFixture {
  result: SerialResult;
  calls: number;
  events: ConductorEvent[];
  ledger: Array<Record<string, unknown>>;
  spans: ReturnType<CapturingSpanExporter['getFinishedSpans']>;
  metrics: InMemoryMetricExporter;
  state: ConductState;
  warnings: string[];
  step: StepName;
}

interface BuiltinFixture extends Omit<SerialFixture, 'calls' | 'step'> {
  calls: StepName[];
}

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function metricPoints(exporter: InMemoryMetricExporter, name: string): MetricPoint[] {
  const points = exporter.getMetrics().flatMap((batch) => batch.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as unknown as MetricPoint[]);
  // forceFlush and shutdown can expose the same cumulative point in separate
  // in-memory collection batches. Dimensions, not collection cadence, define
  // the single serial observation being asserted here.
  return [...new Map(points.map((point) => [JSON.stringify(point.attributes), point])).values()];
}

function lifecycleEvents(events: readonly ConductorEvent[]): ConductorEvent[] {
  return events.filter((event) => (
    event.type === 'step_started' || event.type === 'step_completed' || event.type === 'step_failed'
    || event.type === 'step_refused' || event.type === 'step_retry' || event.type === 'provider_attempt'
  ));
}

async function runSerial(input: {
  outcomes: Array<Awaited<ReturnType<StepRunner['run']>>>;
  telemetry?: TelemetryMode;
  widthOneGroup?: boolean;
}): Promise<SerialFixture> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-telemetry-parity-'));
  directories.push(projectRoot);
  const stateFilePath = join(projectRoot, 'conduct-state.json');
  const state: ConductState = {
    ...Object.fromEntries(ALL_STEPS.map(({ name }) => [name, 'done'])),
    memory: 'pending', explore: 'pending', complexity_tier: 'M', track: 'technical', feature_desc: 'serial-telemetry-parity',
  };
  const serialStep: StepName = input.widthOneGroup ? VALIDATION_GROUP.members[0] as StepName : 'memory';
  if (input.widthOneGroup) {
    state.memory = 'done';
    for (const member of VALIDATION_GROUP.members) state[member as StepName] = 'pending';
    state.finish = 'pending';
  }
  await writeState(stateFilePath, state);

  let now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const events = new ConductorEventEmitter();
  const observed: ConductorEvent[] = [];
  for (const type of ['step_started', 'step_completed', 'step_failed', 'step_refused', 'step_retry', 'provider_attempt'] as const) {
    events.on(type, (event) => { observed.push(event); });
  }
  const ledgerPath = join(projectRoot, '.pipeline', 'events.jsonl');
  const persister = new EventPersister(ledgerPath, events, { nowMs: () => now });
  persister.start();

  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const meterProvider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 })] });
  const metrics = new MetricsListener(new MetricsRecorder(meterProvider.getMeter('conductor-telemetry-parity'), { project: 'project', worker: 'worker' }), () => now, 'serial-telemetry-parity');
  const spanExporter = new CapturingSpanExporter();
  const warnings: string[] = [];
  let visualizer: OtelVisualizer | undefined;
  if ((input.telemetry ?? 'enabled') !== 'disabled') {
    const exporter: SpanExporter = input.telemetry === 'failing-exporter'
      ? { export: () => { throw new Error('controlled exporter fault'); }, shutdown: async () => undefined }
      : spanExporter;
    visualizer = new OtelVisualizer(
      resolveOtelConfig({ otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } }, join(projectRoot, '.pipeline')),
      { spanExporter: exporter, onWarning: (warning) => warnings.push(warning), exportTimeoutMillis: 50 },
    );
    visualizer.start(events, { runId: 'serial-run', feature: 'serial-telemetry-parity', project: projectRoot });
    metrics.start(events);
  }

  let calls = 0;
  let boundaryChecks = 0;
  const run = vi.fn<StepRunner['run']>(async (step, _state, options) => {
    expect(step).toBe(serialStep);
    const outcome = input.outcomes[calls++]!;
    now += 10;
    await events.emit({
      type: 'provider_attempt', step, executionContext: options?.executionContext,
      provider: 'claude', preferredProvider: 'codex', model: 'gpt-5.6-luna', effort: 'high', tier: 'M',
      fallbackReason: input.widthOneGroup ? 'only one eligible member remained' : 'controlled fallback',
      invoked: true, outcome: outcome.success ? 'success' : 'failure',
    });
    return outcome;
  });
  const conductor = new Conductor({
    projectRoot, stateFilePath, stepRunner: { run }, events, fromStep: serialStep, mode: 'auto', daemon: true, maxRetries: 2,
    verifyArtifacts: false, featureSlug: 'serial-telemetry-parity', operatorParkBoundary: async () => ++boundaryChecks > 1,
    ...(input.widthOneGroup ? {
      config: {
        steps: Object.fromEntries(VALIDATION_GROUP.members.slice(1).map((member) => [member, { disable: true }])),
      },
    } : {}),
    gh: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })), git: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })), runGh: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  });

  try {
    const result = await conductor.run();
    await meterProvider.forceFlush();
    await visualizer?.stop();
    const ledger = (await readFile(ledgerPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    return { result, calls, events: observed, ledger, spans: spanExporter.getFinishedSpans(), metrics: metricExporter, state: JSON.parse(await readFile(stateFilePath, 'utf8')) as ConductState, warnings, step: serialStep };
  } finally {
    persister.stop();
    metrics.stop();
    await meterProvider.shutdown();
    await visualizer?.stop();
  }
}

function serialStepSpan(fixture: SerialFixture) {
  return fixture.spans.filter((span) => span.name === fixture.step);
}

async function runBuiltinGroup(input: {
  outcomes?: Partial<Record<StepName, Array<Awaited<ReturnType<StepRunner['run']>>>>>;
  validationConcurrency?: number;
} = {}): Promise<BuiltinFixture> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-built-in-group-telemetry-'));
  directories.push(projectRoot);
  const stateFilePath = join(projectRoot, 'conduct-state.json');
  const state: ConductState = {
    ...Object.fromEntries(ALL_STEPS.map(({ name }) => [name, 'done'])),
    ...Object.fromEntries(VALIDATION_GROUP.members.map((member) => [member, 'pending'])),
    finish: 'pending', complexity_tier: 'M', track: 'technical', feature_desc: 'built-in-group-telemetry-parity',
  };
  await writeState(stateFilePath, state);
  let now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const events = new ConductorEventEmitter();
  const observed: ConductorEvent[] = [];
  for (const type of ['step_started', 'step_completed', 'step_failed', 'step_retry', 'provider_attempt', 'group_member_step'] as const) {
    events.on(type, (event) => { observed.push(event); });
  }
  const ledgerPath = join(projectRoot, '.pipeline', 'events.jsonl');
  const persister = new EventPersister(ledgerPath, events, { nowMs: () => now });
  persister.start();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const meterProvider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 })] });
  const metrics = new MetricsListener(new MetricsRecorder(meterProvider.getMeter('built-in-group-telemetry'), { project: 'project', worker: 'worker' }), () => now, 'built-in-group-telemetry');
  const spanExporter = new CapturingSpanExporter();
  const visualizer = new OtelVisualizer(
    resolveOtelConfig({ otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } }, join(projectRoot, '.pipeline')),
    { spanExporter, exportTimeoutMillis: 50 },
  );
  visualizer.start(events, { runId: 'built-in-group-run', feature: 'built-in-group-telemetry', project: projectRoot });
  metrics.start(events);

  const calls: StepName[] = [];
  let boundaryChecks = 0;
  const conductor = new Conductor({
    projectRoot, stateFilePath, events, fromStep: VALIDATION_GROUP.members[0] as StepName, mode: 'auto', daemon: true,
    maxRetries: 2, verifyArtifacts: false, featureSlug: 'built-in-group-telemetry',
    config: { validation_concurrency: input.validationConcurrency },
    operatorParkBoundary: async () => ++boundaryChecks > 1,
    stepRunner: {
      run: async (step, _state, options) => {
        calls.push(step);
        const outcomes = input.outcomes?.[step];
        const outcome = outcomes?.shift() ?? { success: true };
        // Each local fake completes on its own event-loop turn. This retains
        // concurrent admission while making the injected clock observe the
        // member's own finish before a sibling can advance it.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        now += 10;
        await events.emit({
          type: 'provider_attempt', step, executionContext: options?.executionContext,
          provider: 'claude', preferredProvider: 'codex', model: 'gpt-5.6-luna', effort: 'high', tier: 'M',
          fallbackReason: 'controlled built-in fallback', invoked: true, outcome: outcome.success ? 'success' : 'failure',
        });
        return outcome;
      },
    },
    gh: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })), git: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })), runGh: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  });
  try {
    const result = await conductor.run();
    await meterProvider.forceFlush();
    await visualizer.stop();
    const ledger = (await readFile(ledgerPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    return { result, calls, events: observed, ledger, spans: spanExporter.getFinishedSpans(), metrics: metricExporter, state: JSON.parse(await readFile(stateFilePath, 'utf8')) as ConductState, warnings: [] };
  } finally {
    persister.stop();
    metrics.stop();
    await meterProvider.shutdown();
    await visualizer.stop();
  }
}

describe('serial conductor telemetry parity', () => {
  it('persists and projects one width-one fallback serial execution with bounded attribution', async () => {
    const fixture = await runSerial({
      outcomes: [{ success: true, model: 'gpt-5.6-luna', effort: 'high', preferredProvider: 'codex', actualProvider: 'claude' }], widthOneGroup: true,
    });
    const lifecycle = lifecycleEvents(fixture.events);
    const started = lifecycle.find((event) => event.type === 'step_started');
    const completed = lifecycle.find((event) => event.type === 'step_completed');

    expect(fixture.result).toEqual({ kind: 'operator-parked', boundary: { kind: 'step', name: 'manual_test' } });
    expect(fixture.calls).toBe(1);
    expect(fixture.events.filter((event) => event.type === 'parallel_started')).toHaveLength(0);
    expect(fixture.events.filter((event) => event.type === 'step_started' && VALIDATION_GROUP.members.slice(1).includes(event.step))).toHaveLength(0);
    for (const skippedMember of VALIDATION_GROUP.members.slice(1)) {
      expect(fixture.spans.filter((span) => span.name === skippedMember)).toHaveLength(0);
      expect(metricPoints(fixture.metrics, 'conductor.step.duration').filter((point) => point.attributes.step === skippedMember)).toHaveLength(0);
    }
    expect(started?.executionContext).toEqual(expect.objectContaining({ executionId: expect.any(String), subject: { kind: 'lifecycle-step', step: 'manual_test' } }));
    expect(lifecycle.map((event) => ('executionContext' in event ? event.executionContext?.executionId : undefined)))
      .toEqual([started?.executionContext?.executionId, started?.executionContext?.executionId, started?.executionContext?.executionId]);
    expect(completed?.executionContext).toEqual(started?.executionContext);

    const persisted = fixture.ledger.filter((event) => event.type === 'step_started' || event.type === 'step_completed');
    expect(persisted).toHaveLength(2);
    expect(persisted[1]).toMatchObject({ executionContext: started?.executionContext, activeInterval: { startedAtMs: 1_000, durationMs: 10 } });
    expect(serialStepSpan(fixture)).toHaveLength(1);
    expect(serialStepSpan(fixture)[0]?.attributes).toMatchObject({
      'conductor.step': 'manual_test', 'conductor.provider': 'claude', 'conductor.provider.preferred': 'codex', 'conductor.fallback': true,
      'conductor.fallback.reason': 'only one eligible member remained', 'conductor.model': 'gpt-5.6-luna', 'conductor.effort': 'high', 'conductor.complexity_tier': 'M',
    });
    const duration = metricPoints(fixture.metrics, 'conductor.step.duration');
    expect(duration).toHaveLength(1);
    expect(duration[0]?.attributes).toMatchObject({ step: 'manual_test', model: 'gpt-5.6-luna', effort: 'high', provider: 'claude', tier: 'M' });
    for (const point of [...duration, ...metricPoints(fixture.metrics, 'conductor.step.dispatches')]) {
      expect(point.attributes).not.toHaveProperty('executionId');
      expect(point.attributes).not.toHaveProperty('fallbackReason');
    }
  });

  it('keeps retry-success under one serial scope and one terminal duration', async () => {
    const fixture = await runSerial({ outcomes: [
      { success: false, output: 'first controlled failure', model: 'gpt-5.6-luna', effort: 'high', actualProvider: 'claude' },
      { success: true, model: 'gpt-5.6-luna', effort: 'high', preferredProvider: 'codex', actualProvider: 'claude' },
    ] });
    const lifecycle = lifecycleEvents(fixture.events);
    const started = lifecycle.find((event) => event.type === 'step_started');
    const retry = lifecycle.find((event) => event.type === 'step_retry');
    const completed = lifecycle.find((event) => event.type === 'step_completed');

    expect(fixture.calls).toBe(2);
    expect(retry).toMatchObject({ step: 'memory', attempt: 2, maxAttempts: 2, executionContext: started?.executionContext });
    expect(completed?.executionContext).toEqual(started?.executionContext);
    expect(serialStepSpan(fixture)).toHaveLength(1);
    expect(serialStepSpan(fixture)[0]?.attributes['conductor.retry.count']).toBe(1);
    expect(metricPoints(fixture.metrics, 'conductor.step.duration')).toHaveLength(1);
    expect(metricPoints(fixture.metrics, 'conductor.step.retries')).toHaveLength(1);
    expect(metricPoints(fixture.metrics, 'conductor.step.outcomes')[0]?.attributes.outcome).toBe('success');
    const persisted = fixture.ledger.filter((event) => event.type === 'step_started' || event.type === 'step_retry' || event.type === 'step_completed');
    expect(persisted).toHaveLength(3);
    expect(persisted.at(-1)).toMatchObject({ executionContext: started?.executionContext, activeInterval: { startedAtMs: 1_000, durationMs: 20 } });
  });

  it('closes exhausted and refused serial executions once with their truthful outcomes', async () => {
    const exhausted = await runSerial({ outcomes: [
      { success: false, output: 'first controlled failure', effort: 'high' }, { success: false, output: 'second controlled failure', effort: 'high' },
    ] });
    const refusal = await runSerial({ outcomes: [{ success: false, refusal: { kind: 'needs-human', reason: 'controlled refusal' } }] });

    expect(exhausted.calls).toBe(2);
    expect(exhausted.events.filter((event) => event.type === 'step_failed')).toHaveLength(1);
    expect(exhausted.events.filter((event) => event.type === 'step_completed')).toHaveLength(0);
    expect(serialStepSpan(exhausted)).toHaveLength(1);
    expect(serialStepSpan(exhausted)[0]?.attributes['conductor.step.status']).toBe('failed');
    expect(metricPoints(exhausted.metrics, 'conductor.step.outcomes')[0]?.attributes.outcome).toBe('failure');
    const exhaustedStarted = exhausted.events.find((event) => event.type === 'step_started');
    const exhaustedTerminal = exhausted.ledger.find((event) => event.type === 'step_failed');
    expect(exhaustedTerminal).toMatchObject({ executionContext: exhaustedStarted?.executionContext, activeInterval: { startedAtMs: 1_000, durationMs: 20 } });
    expect(metricPoints(exhausted.metrics, 'conductor.step.duration')).toHaveLength(1);

    expect(refusal.calls).toBe(1);
    expect(refusal.events.filter((event) => event.type === 'step_refused')).toHaveLength(1);
    expect(refusal.events.filter((event) => event.type === 'step_failed' || event.type === 'step_completed')).toHaveLength(0);
    expect(refusal.state.memory).toBe('refused');
    expect(serialStepSpan(refusal)).toHaveLength(1);
    expect(serialStepSpan(refusal)[0]?.attributes['conductor.step.status']).toBe('refused');
    expect(metricPoints(refusal.metrics, 'conductor.step.outcomes')[0]?.attributes.outcome).toBe('refusal');
    const refusalStarted = refusal.events.find((event) => event.type === 'step_started');
    const refusalTerminal = refusal.ledger.find((event) => event.type === 'step_refused');
    expect(refusalTerminal).toMatchObject({ executionContext: refusalStarted?.executionContext, activeInterval: { startedAtMs: 1_000, durationMs: 10 } });
    expect(metricPoints(refusal.metrics, 'conductor.step.duration')).toHaveLength(1);
  });

  it('keeps serial dispatch and state identical when telemetry is disabled or its exporter fails', async () => {
    const outcomes = [
      { success: false, output: 'controlled retry before exporter isolation' },
      { success: true },
    ];
    const ordinary = await runSerial({ outcomes: [{ success: true }] });
    const enabled = await runSerial({ outcomes });
    const disabled = await runSerial({ outcomes, telemetry: 'disabled' });
    const failing = await runSerial({ outcomes, telemetry: 'failing-exporter' });

    const ordinaryStarted = ordinary.events.find((event) => event.type === 'step_started');
    const ordinaryCompleted = ordinary.events.find((event) => event.type === 'step_completed');
    expect(ordinaryCompleted?.executionContext).toEqual(ordinaryStarted?.executionContext);
    expect(ordinary.ledger.find((event) => event.type === 'step_completed')).toMatchObject({
      executionContext: ordinaryStarted?.executionContext,
      activeInterval: { startedAtMs: 1_000, durationMs: 10 },
    });
    expect(serialStepSpan(ordinary)).toHaveLength(1);
    expect(metricPoints(ordinary.metrics, 'conductor.step.duration')).toHaveLength(1);

    for (const fixture of [enabled, disabled, failing]) {
      expect(fixture.result).toEqual({ kind: 'operator-parked', boundary: { kind: 'step', name: 'memory' } });
      expect(fixture.calls).toBe(2);
      expect(fixture.state.memory).toBe('done');
      expect(fixture.events.filter((event) => event.type === 'step_completed')).toHaveLength(1);
    }
    expect(disabled.spans).toHaveLength(0);
    expect(disabled.metrics.getMetrics()).toHaveLength(0);
    expect(failing.warnings).toHaveLength(1);
  });

  it('derives every wider built-in member from the registry and gives each an execution scope', async () => {
    const fixture = await runBuiltinGroup();
    const started = fixture.events.filter((event) => event.type === 'step_started');
    const completed = fixture.events.filter((event) => event.type === 'step_completed');

    expect(fixture.calls).toEqual(VALIDATION_GROUP.members);
    expect(started.map((event) => event.step)).toEqual(VALIDATION_GROUP.members);
    expect(completed.map((event) => event.step)).toEqual(VALIDATION_GROUP.members);
    const groupDuration = (fixture.ledger.find((event) => event.type === 'parallel_completed')?.activeInterval as { durationMs?: number } | undefined)?.durationMs;
    const memberDurations: number[] = [];
    for (const member of VALIDATION_GROUP.members) {
      const start = started.find((event) => event.step === member);
      const terminal = completed.find((event) => event.step === member);
      expect(start?.executionContext).toEqual(expect.objectContaining({
        executionId: expect.any(String), subject: { kind: 'lifecycle-step', step: member },
      }));
      expect(terminal?.executionContext).toEqual(start?.executionContext);
      const persisted = fixture.ledger.find((event) => event.type === 'step_completed' && event.step === member);
      expect(persisted).toMatchObject({
        executionContext: start?.executionContext,
        activeInterval: { durationMs: expect.any(Number) },
      });
      memberDurations.push((persisted?.activeInterval as { durationMs: number }).durationMs);
      expect(fixture.spans.filter((span) => span.name === member)).toHaveLength(1);
      expect(metricPoints(fixture.metrics, 'conductor.step.duration').filter((point) => point.attributes.step === member)).toHaveLength(1);
    }
    expect(groupDuration).toBeDefined();
    expect(memberDurations.every((duration) => duration <= groupDuration!)).toBe(true);
    expect(memberDurations.some((duration) => duration < groupDuration!)).toBe(true);
  });

  it('admits cap-one built-in members one at a time without queue-duration telemetry', async () => {
    const fixture = await runBuiltinGroup({ validationConcurrency: 1 });
    const terminals = fixture.ledger.filter((event) => event.type === 'step_completed');

    expect(fixture.calls).toEqual(VALIDATION_GROUP.members);
    expect(terminals.map((event) => event.step)).toEqual(VALIDATION_GROUP.members);
    expect(terminals.map((event) => event.activeInterval)).toEqual(
      VALIDATION_GROUP.members.map((_member, index) => ({ startedAtMs: 1_000 + index * 10, durationMs: 10 })),
    );
    for (const member of VALIDATION_GROUP.members) {
      expect(fixture.events.filter((event) => event.type === 'step_started' && event.step === member)).toHaveLength(1);
      expect(fixture.spans.filter((span) => span.name === member)).toHaveLength(1);
      expect(metricPoints(fixture.metrics, 'conductor.step.duration').filter((point) => point.attributes.step === member)).toHaveLength(1);
    }
  });

  it('retains each member scope across retries and closes an exhausted member as failed', async () => {
    const retryMember = VALIDATION_GROUP.members[0] as StepName;
    const retried = await runBuiltinGroup({
      outcomes: {
        [retryMember]: [{ success: false, output: 'controlled retry' }, { success: true }],
      },
    });
    const exhausted = await runBuiltinGroup({
      outcomes: {
        [retryMember]: [{ success: false, output: 'controlled exhaustion' }, { success: false, output: 'controlled exhaustion' }],
      },
    });
    const retriedStart = retried.events.find((event): event is Extract<ConductorEvent, { type: 'step_started' }> => event.type === 'step_started' && event.step === retryMember);
    const retry = retried.events.find((event): event is Extract<ConductorEvent, { type: 'step_retry' }> => event.type === 'step_retry' && event.step === retryMember);
    const retriedTerminal = retried.events.find((event): event is Extract<ConductorEvent, { type: 'step_completed' }> => event.type === 'step_completed' && event.step === retryMember);

    expect(retry).toMatchObject({ attempt: 2, maxAttempts: 2, executionContext: retriedStart?.executionContext });
    expect(retriedTerminal?.executionContext).toEqual(retriedStart?.executionContext);
    expect(metricPoints(retried.metrics, 'conductor.step.retries').filter((point) => point.attributes.step === retryMember)).toHaveLength(1);
    expect(exhausted.events.filter((event) => event.type === 'step_failed' && event.step === retryMember)).toHaveLength(1);
    expect(exhausted.events.filter((event) => event.type === 'step_completed' && event.step === retryMember)).toHaveLength(0);
    expect(exhausted.spans.filter((span) => span.name === retryMember)).toHaveLength(1);
    expect(metricPoints(exhausted.metrics, 'conductor.step.outcomes').find((point) => point.attributes.step === retryMember)?.attributes.outcome).toBe('failure');
    for (const member of VALIDATION_GROUP.members) {
      expect(exhausted.events.filter((event) => (event.type === 'step_completed' || event.type === 'step_failed') && event.step === member)).toHaveLength(1);
      expect(metricPoints(exhausted.metrics, 'conductor.step.duration').filter((point) => point.attributes.step === member)).toHaveLength(1);
    }
  });

  it('keeps mixed built-in member lifecycles independent of the group halt', async () => {
    const failedMember = VALIDATION_GROUP.members[1] as StepName;
    const fixture = await runBuiltinGroup({
      outcomes: {
        [failedMember]: [{ success: false, output: 'controlled mixed failure' }, { success: false, output: 'controlled mixed failure' }],
      },
    });

    expect(fixture.state[VALIDATION_GROUP.members[0] as StepName]).toBe('failed');
    for (const member of VALIDATION_GROUP.members) {
      expect(fixture.events.filter((event) => event.type === 'step_started' && event.step === member)).toHaveLength(1);
      expect(fixture.events.filter((event) => (event.type === 'step_completed' || event.type === 'step_failed') && event.step === member)).toHaveLength(1);
      expect(fixture.spans.filter((span) => span.name === member)).toHaveLength(1);
      expect(metricPoints(fixture.metrics, 'conductor.step.duration').filter((point) => point.attributes.step === member)).toHaveLength(1);
    }
    expect(metricPoints(fixture.metrics, 'conductor.step.outcomes').find((point) => point.attributes.step === failedMember)?.attributes.outcome).toBe('failure');
  });
});
