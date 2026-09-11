// Covers: task:5, task:6, task:7, task:8
import { describe, expect, it } from 'vitest';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { MetricsListener } from '../../../src/engine/otel/metrics-listener.js';
import { MetricsRecorder } from '../../../src/engine/otel/metrics.js';

interface MetricPoint {
  attributes: Record<string, unknown>;
  value: unknown;
}

function attributesFor(
  exporter: InMemoryMetricExporter,
  name: string,
  step: string,
): Record<string, unknown> | undefined {
  return exporter.getMetrics()
    .flatMap((batch) => batch.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as unknown as MetricPoint[])
    .find((point) => point.attributes.step === step)
    ?.attributes;
}

function attributesForInstrument(
  exporter: InMemoryMetricExporter,
  name: string,
): Record<string, unknown>[] {
  return exporter.getMetrics()
    .flatMap((batch) => batch.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as unknown as MetricPoint[])
    .map((point) => point.attributes);
}

function pointsForInstrument(
  exporter: InMemoryMetricExporter,
  name: string,
): MetricPoint[] {
  return exporter.getMetrics()
    .flatMap((batch) => batch.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as unknown as MetricPoint[]);
}

function descriptorForInstrument(exporter: InMemoryMetricExporter, name: string): { unit?: string } | undefined {
  return exporter.getMetrics()
    .flatMap((batch) => batch.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === name)
    ?.descriptor;
}

function resourceAttributes(exporter: InMemoryMetricExporter): Record<string, unknown>[] {
  return exporter.getMetrics().map((batch) => batch.resource.attributes as Record<string, unknown>);
}

describe('MetricsListener dispatch dimensions', () => {
  it('retains the latest complete dispatch dimensions when a step fails', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const emitter = new ConductorEventEmitter();
    let now = 100;
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      () => now,
      'feature',
    );
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', provider: 'claude', model: 'opus', effort: 'high', tier: 'M', invoked: true, outcome: 'failure',
      });
      now = 125;
      await emitter.emit({ type: 'step_failed', step: 'build', error: 'failed', retryCount: 0 });
      await provider.forceFlush();

      expect(attributesFor(exporter, 'conductor.step.duration', 'build')).toEqual({
        step: 'build', model: 'opus', effort: 'high', provider: 'claude', tier: 'M',
        project: 'project', worker: 'worker', feature: 'feature',
      });
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('counts invoked attempts once with provider and explicit fallback state', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const emitter = new ConductorEventEmitter();
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      undefined,
      'feature',
    );
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', provider: 'claude', preferredProvider: 'codex',
        model: 'opus', effort: 'high', tier: 'M', invoked: true, outcome: 'success',
      });
      await emitter.emit({
        type: 'provider_attempt', step: 'plan', provider: 'claude', preferredProvider: 'claude',
        invoked: true, outcome: 'success',
      });
      await emitter.emit({
        type: 'provider_attempt', step: 'finish', provider: 'claude', invoked: true, outcome: 'success',
      });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', provider: 'provider-lifecycle', invoked: false,
        outcome: 'success', lifecycle: { phase: 'settled', attemptId: 'attempt-1', recoveryCount: 0 },
      });
      await emitter.emit({
        type: 'step_completed', step: 'build', status: 'done', actualProvider: 'claude',
      });
      await provider.forceFlush();

      expect(attributesForInstrument(exporter, 'conductor.step.dispatches')).toEqual([
        { step: 'build', metering: 'unmetered', model: 'opus', effort: 'high', provider: 'claude', tier: 'M', fallback: true, project: 'project', worker: 'worker', feature: 'feature' },
        { step: 'plan', metering: 'unmetered', provider: 'claude', fallback: false, project: 'project', worker: 'worker', feature: 'feature' },
        { step: 'finish', metering: 'unmetered', provider: 'claude', project: 'project', worker: 'worker', feature: 'feature' },
      ]);
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('keeps fallback on dispatches while omitting it from duration and retries', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const emitter = new ConductorEventEmitter();
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      undefined,
      'feature',
    );
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', provider: 'claude', preferredProvider: 'codex',
        model: 'opus', effort: 'high', tier: 'M', invoked: true, outcome: 'success',
      });
      await emitter.emit({
        type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 3, reason: 'retry',
        model: 'opus', effort: 'high', provider: 'claude', tier: 'M',
      });
      await emitter.emit({
        type: 'step_completed', step: 'build', status: 'done', actualProvider: 'claude',
        model: 'opus', effort: 'high', tier: 'M',
      });
      await provider.forceFlush();

      expect(attributesFor(exporter, 'conductor.step.duration', 'build')).not.toHaveProperty('fallback');
      expect(attributesFor(exporter, 'conductor.step.retries', 'build')).not.toHaveProperty('fallback');
      expect(attributesFor(exporter, 'conductor.step.dispatches', 'build')).toMatchObject({ fallback: true });
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('projects close and retry dimensions without retaining them for dimensionless or orphan events', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const emitter = new ConductorEventEmitter();
    let now = 100;
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      () => now,
      'feature',
    );
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', provider: 'claude', model: 'opus', invoked: true, outcome: 'success',
      });
      await emitter.emit({
        type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 3, reason: 'retry',
        model: 'opus', effort: 'high', provider: 'claude', tier: 'M',
      });
      await emitter.emit({ type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'dimensionless retry' });
      now = 125;
      await emitter.emit({
        type: 'step_completed', step: 'build', status: 'done', model: 'opus', effort: 'high', tier: 'M', actualProvider: 'claude',
      });

      await emitter.emit({ type: 'step_started', step: 'plan', index: 1 });
      now = 150;
      await emitter.emit({ type: 'step_completed', step: 'plan', status: 'done' });
      await emitter.emit({ type: 'step_retry', step: 'plan', attempt: 1, maxAttempts: 3, reason: 'dimensionless retry' });
      await emitter.emit({ type: 'step_retry', step: 'finish', attempt: 1, maxAttempts: 3, reason: 'orphan retry' });
      await provider.forceFlush();

      const identity = { project: 'project', worker: 'worker', feature: 'feature' };
      expect(attributesFor(exporter, 'conductor.step.duration', 'build')).toEqual({
        step: 'build', model: 'opus', effort: 'high', provider: 'claude', tier: 'M', ...identity,
      });
      const buildRetryPoints = exporter.getMetrics()
        .flatMap((batch) => batch.scopeMetrics)
        .flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === 'conductor.step.retries')
        .flatMap((metric) => metric.dataPoints as unknown as MetricPoint[])
        .filter((point) => point.attributes.step === 'build')
        .map((point) => point.attributes);
      expect(buildRetryPoints).toContainEqual({
        step: 'build', model: 'opus', effort: 'high', provider: 'claude', tier: 'M', ...identity,
      });
      expect(buildRetryPoints).toContainEqual({ step: 'build', ...identity });
      expect(attributesFor(exporter, 'conductor.step.duration', 'plan')).toEqual({ step: 'plan', ...identity });
      expect(attributesFor(exporter, 'conductor.step.retries', 'plan')).toEqual({ step: 'plan', ...identity });
      expect(attributesFor(exporter, 'conductor.step.retries', 'finish')).toEqual({ step: 'finish', ...identity });
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });
});

describe('MetricsListener correlated member duration projection (Task 7)', () => {
  function configuredContext(executionId: string, parentGroup: string, member = 'audit') {
    return {
      executionId,
      subject: { kind: 'configured-member' as const, parentGroup, member },
    };
  }

  it('keeps interleaved same-name configured members independent and closes each at its frozen settlement', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })] });
    const emitter = new ConductorEventEmitter();
    let now = 100;
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      () => now,
      'feature',
    );
    const first = configuredContext('execution-a', 'group A');
    const second = configuredContext('execution-b', 'group B');
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0, executionContext: first });
      now = 110;
      await emitter.emit({ type: 'step_started', step: 'build', index: 0, executionContext: second });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', executionContext: first, provider: 'claude',
        model: 'opus', effort: 'high', tier: 'M', invoked: true, outcome: 'success',
      });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', executionContext: second, provider: 'codex',
        model: 'gpt-5.6', effort: 'medium', tier: 'L', invoked: true, outcome: 'success',
      });
      now = 120;
      await emitter.emit({ type: 'group_member_step', member: 'audit', skill: 'audit', phase: 'result', outcome: 'verdict:pass', executionContext: first });
      now = 130;
      await emitter.emit({ type: 'group_member_step', member: 'audit', skill: 'audit', phase: 'result', outcome: 'verdict:pass', executionContext: second });
      now = 190;
      await emitter.emit({ type: 'group_member_step', member: 'audit', skill: 'audit', phase: 'result', outcome: 'late verdict:pass', executionContext: first });
      now = 200;
      await emitter.emit({ type: 'step_completed', step: 'build', status: 'done', executionContext: first });
      now = 300;
      await emitter.emit({ type: 'step_completed', step: 'build', status: 'done', executionContext: second });
      await provider.forceFlush();

      expect(pointsForInstrument(exporter, 'conductor.step.duration')).toEqual(expect.arrayContaining([
        expect.objectContaining({
          value: expect.objectContaining({ count: 1, sum: 20 }),
          attributes: { step: 'configured:group%20A/audit', model: 'opus', effort: 'high', provider: 'claude', tier: 'M', project: 'project', worker: 'worker', feature: 'feature' },
        }),
        expect.objectContaining({
          value: expect.objectContaining({ count: 1, sum: 20 }),
          attributes: { step: 'configured:group%20B/audit', model: 'gpt-5.6', effort: 'medium', provider: 'codex', tier: 'L', project: 'project', worker: 'worker', feature: 'feature' },
        }),
      ]));
      expect(pointsForInstrument(exporter, 'conductor.step.dispatches')).toHaveLength(2);
      expect(descriptorForInstrument(exporter, 'conductor.step.duration')?.unit).toBe('ms');
      for (const attributes of resourceAttributes(exporter)) {
        expect(attributes).not.toHaveProperty('executionId');
        expect(attributes).not.toHaveProperty('attemptId');
        expect(attributes).not.toHaveProperty('conductor.execution.id');
        expect(attributes).not.toHaveProperty('conductor.attempt.id');
      }
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('keeps one retry lifetime and cannot let a late terminal close a newer same-subject execution', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })] });
    const emitter = new ConductorEventEmitter();
    let now = 10;
    const listener = new MetricsListener(new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }), () => now, 'feature');
    const first = configuredContext('execution-first', 'group');
    const second = configuredContext('execution-second', 'group');
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0, executionContext: first });
      now = 20;
      await emitter.emit({ type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 2, reason: 'retry', executionContext: first });
      now = 40;
      await emitter.emit({ type: 'step_completed', step: 'build', status: 'done', executionContext: first });
      now = 50;
      await emitter.emit({ type: 'step_started', step: 'build', index: 0, executionContext: second });
      now = 60;
      await emitter.emit({ type: 'step_completed', step: 'build', status: 'done', executionContext: first });
      now = 80;
      await emitter.emit({ type: 'step_completed', step: 'build', status: 'done', executionContext: second });
      await provider.forceFlush();

      const duration = pointsForInstrument(exporter, 'conductor.step.duration')
        .find((point) => point.attributes.step === 'configured:group/audit');
      expect(duration?.value).toMatchObject({ count: 2, min: 30, max: 30, sum: 60 });
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('preserves missing dimensions as absent and never turns member completion into an extra dispatch', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })] });
    const emitter = new ConductorEventEmitter();
    let now = 10;
    const listener = new MetricsListener(new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }), () => now, 'feature');
    const context = configuredContext('execution-no-dimensions', 'group');
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0, executionContext: context });
      await emitter.emit({ type: 'provider_attempt', step: 'build', executionContext: context, provider: 'codex', invoked: false, outcome: 'unavailable', fallbackReason: 'secret provider detail' });
      now = 20;
      await emitter.emit({ type: 'group_member_step', member: 'audit', skill: 'audit', phase: 'result', outcome: 'verdict:pass', executionContext: context });
      now = 30;
      await emitter.emit({ type: 'step_completed', step: 'build', status: 'done', executionContext: context });
      await provider.forceFlush();

      const duration = attributesFor(exporter, 'conductor.step.duration', 'configured:group/audit');
      expect(duration).toEqual({ step: 'configured:group/audit', project: 'project', worker: 'worker', feature: 'feature' });
      expect(attributesForInstrument(exporter, 'conductor.step.dispatches')).toEqual([]);
      expect(duration).not.toHaveProperty('executionId');
      expect(duration).not.toHaveProperty('fallbackReason');
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('leaves member event delivery intact when metrics are disabled or the recorder throws', async () => {
    const disabled = new ConductorEventEmitter();
    const context = configuredContext('execution-disabled', 'group');
    await expect(disabled.emit({ type: 'step_started', step: 'build', index: 0, executionContext: context })).resolves.toBeUndefined();
    await expect(disabled.emit({ type: 'step_completed', step: 'build', status: 'done', executionContext: context })).resolves.toBeUndefined();

    const emitter = new ConductorEventEmitter();
    const delivered: string[] = [];
    emitter.on('group_member_step', (event) => {
      const member = event as Extract<typeof event, { type: 'group_member_step' }>;
      if (member.phase === 'result') delivered.push(member.member);
    });
    const throwingRecorder = {
      forFeature: () => throwingRecorder,
      onStepClose: () => { throw new Error('export failed'); },
    } as unknown as MetricsRecorder;
    const listener = new MetricsListener(throwingRecorder, () => 10, 'feature');
    listener.start(emitter);
    try {
      await expect(emitter.emit({ type: 'step_started', step: 'build', index: 0, executionContext: context })).resolves.toBeUndefined();
      await expect(emitter.emit({ type: 'group_member_step', member: 'audit', skill: 'audit', phase: 'result', outcome: 'verdict:pass', executionContext: context })).resolves.toBeUndefined();
      await expect(emitter.emit({ type: 'step_completed', step: 'build', status: 'done', executionContext: context })).resolves.toBeUndefined();
      expect(delivered).toEqual(['audit']);
    } finally {
      listener.stop();
    }
  });
});

describe('MetricsListener retry and refusal projection (Task 8)', () => {
  function configuredContext(executionId: string, parentGroup: string, member = 'audit') {
    return {
      executionId,
      subject: { kind: 'configured-member' as const, parentGroup, member },
    };
  }

  function outcomePoint(exporter: InMemoryMetricExporter, step: string, outcome: string): MetricPoint | undefined {
    return pointsForInstrument(exporter, 'conductor.step.outcomes')
      .find((point) => point.attributes.step === step && point.attributes.outcome === outcome);
  }

  it('correlates serial and member policy retries without zero-filled retries or duplicate terminal outcomes', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })] });
    const emitter = new ConductorEventEmitter();
    let now = 10;
    const listener = new MetricsListener(new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }), () => now, 'feature');
    const member = configuredContext('execution-exhausted', 'review');
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
      await emitter.emit({ type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 3, reason: 'failed attempt', model: 'opus', effort: 'high', provider: 'claude', tier: 'M' });
      now = 20;
      await emitter.emit({ type: 'step_completed', step: 'build', status: 'done' });

      now = 30;
      await emitter.emit({ type: 'step_started', step: 'build', index: 0, executionContext: member });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', executionContext: member, provider: 'codex',
        model: 'gpt-5.6', effort: 'medium', tier: 'L', invoked: true, outcome: 'failure',
        tokenUsage: { input: 10, output: 5, costUsd: 0.01 },
      });
      await emitter.emit({ type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 3, reason: 'failed attempt', model: 'gpt-5.6', effort: 'medium', provider: 'codex', tier: 'L', executionContext: member });
      await emitter.emit({ type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'failed attempt', model: 'gpt-5.6', effort: 'medium', provider: 'codex', tier: 'L', executionContext: member });
      now = 50;
      await emitter.emit({ type: 'group_member_step', member: 'audit', skill: 'audit', phase: 'result', outcome: 'failed', executionContext: member });
      now = 60;
      await emitter.emit({ type: 'step_failed', step: 'build', error: 'exhausted', retryCount: 2, executionContext: member });
      await emitter.emit({ type: 'step_failed', step: 'build', error: 'late duplicate', retryCount: 2, executionContext: member });
      await provider.forceFlush();

      expect(pointsForInstrument(exporter, 'conductor.step.retries')).toEqual(expect.arrayContaining([
        expect.objectContaining({
          value: 1,
          attributes: { step: 'build', model: 'opus', effort: 'high', provider: 'claude', tier: 'M', project: 'project', worker: 'worker', feature: 'feature' },
        }),
        expect.objectContaining({
          value: 2,
          attributes: { step: 'configured:review/audit', model: 'gpt-5.6', effort: 'medium', provider: 'codex', tier: 'L', project: 'project', worker: 'worker', feature: 'feature' },
        }),
      ]));
      expect(outcomePoint(exporter, 'build', 'success')?.value).toBe(1);
      expect(outcomePoint(exporter, 'configured:review/audit', 'failure')?.value).toBe(1);
      expect(pointsForInstrument(exporter, 'conductor.step.dispatches')).toEqual([
        expect.objectContaining({
          value: 1,
          attributes: {
            step: 'configured:review/audit', metering: 'fully-metered', model: 'gpt-5.6', effort: 'medium', provider: 'codex', tier: 'L',
            project: 'project', worker: 'worker', feature: 'feature',
          },
        }),
      ]);
      expect(pointsForInstrument(exporter, 'conductor.step.retries').some((point) => point.attributes.step === 'plan')).toBe(false);
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('closes started refusals once at their own boundary without fabricating pre-start or late terminals', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })] });
    const emitter = new ConductorEventEmitter();
    let now = 10;
    const listener = new MetricsListener(new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }), () => now, 'feature');
    const first = configuredContext('execution-first', 'review');
    const second = configuredContext('execution-second', 'review');
    const neverStarted = configuredContext('execution-never-started', 'review');
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'plan', index: 0 });
      now = 20;
      await emitter.emit({ type: 'step_refused', step: 'plan', kind: 'needs-human', reason: 'operator required' });
      await emitter.emit({ type: 'step_refused', step: 'plan', kind: 'needs-human', reason: 'duplicate' });

      now = 30;
      await emitter.emit({ type: 'step_started', step: 'build', index: 0, executionContext: first });
      now = 40;
      await emitter.emit({ type: 'group_member_step', member: 'audit', skill: 'audit', phase: 'result', outcome: 'verdict:pass', executionContext: first });
      now = 50;
      await emitter.emit({ type: 'step_refused', step: 'build', kind: 'validation-verdict', reason: 'authoritative refusal', executionContext: first });
      now = 60;
      await emitter.emit({ type: 'step_started', step: 'build', index: 0, executionContext: second });
      now = 70;
      await emitter.emit({ type: 'step_refused', step: 'build', kind: 'validation-verdict', reason: 'late first refusal', executionContext: first });
      await emitter.emit({ type: 'step_refused', step: 'build', kind: 'validation-verdict', reason: 'not admitted', executionContext: neverStarted });
      now = 90;
      await emitter.emit({ type: 'step_completed', step: 'build', status: 'done', executionContext: second });
      await provider.forceFlush();

      expect(outcomePoint(exporter, 'plan', 'refusal')?.value).toBe(1);
      expect(outcomePoint(exporter, 'configured:review/audit', 'refusal')?.value).toBe(1);
      expect(outcomePoint(exporter, 'configured:review/audit', 'success')?.value).toBe(1);
      expect(pointsForInstrument(exporter, 'conductor.step.duration')).toEqual(expect.arrayContaining([
        expect.objectContaining({ attributes: expect.objectContaining({ step: 'plan' }), value: expect.objectContaining({ count: 1, sum: 10 }) }),
        expect.objectContaining({ attributes: expect.objectContaining({ step: 'configured:review/audit' }), value: expect.objectContaining({ count: 2, sum: 40 }) }),
      ]));
      expect(pointsForInstrument(exporter, 'conductor.step.duration').some((point) => point.attributes.executionId === 'execution-never-started')).toBe(false);
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('does not turn rate limits or non-invoked candidates into retries or dispatches', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })] });
    const emitter = new ConductorEventEmitter();
    const listener = new MetricsListener(new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }), undefined, 'feature');
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'test_suite', index: 0 });
      await emitter.emit({ type: 'rate_limit', waitSeconds: 3, reason: 'usage-exhausted' });
      await emitter.emit({ type: 'provider_attempt', step: 'test_suite', provider: 'codex', invoked: false, outcome: 'unavailable' });
      await emitter.emit({ type: 'step_completed', step: 'test_suite', status: 'done' });
      await provider.forceFlush();

      expect(pointsForInstrument(exporter, 'conductor.step.retries')).toEqual([]);
      expect(pointsForInstrument(exporter, 'conductor.step.dispatches')).toEqual([]);
      expect(outcomePoint(exporter, 'test_suite', 'success')?.value).toBe(1);
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('keeps retry and refusal event delivery intact when the metrics recorder throws', async () => {
    const emitter = new ConductorEventEmitter();
    const delivered: string[] = [];
    const throwingRecorder = {
      forFeature: () => throwingRecorder,
      onRetry: () => { throw new Error('retry export failed'); },
      onStepClose: () => { throw new Error('refusal export failed'); },
      onStepTerminal: () => { throw new Error('outcome export failed'); },
    } as unknown as MetricsRecorder;
    const listener = new MetricsListener(throwingRecorder, () => 10, 'feature');
    listener.start(emitter);
    emitter.on('step_retry', () => { delivered.push('retry'); });
    emitter.on('step_refused', () => { delivered.push('refusal'); });

    try {
      await expect(emitter.emit({ type: 'step_started', step: 'build', index: 0 })).resolves.toBeUndefined();
      await expect(emitter.emit({ type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 2, reason: 'failed attempt' })).resolves.toBeUndefined();
      await expect(emitter.emit({ type: 'step_refused', step: 'build', kind: 'needs-human', reason: 'operator required' })).resolves.toBeUndefined();
      expect(delivered).toEqual(['retry', 'refusal']);
    } finally {
      listener.stop();
    }
  });
});
