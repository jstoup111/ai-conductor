// Covers: task:5, task:6
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

describe('MetricsListener dispatch dimensions', () => {
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
        invoked: true, outcome: 'success',
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
        { step: 'build', metering: 'unmetered', provider: 'claude', fallback: true, project: 'project', worker: 'worker', feature: 'feature' },
        { step: 'plan', metering: 'unmetered', provider: 'claude', fallback: false, project: 'project', worker: 'worker', feature: 'feature' },
        { step: 'finish', metering: 'unmetered', provider: 'claude', project: 'project', worker: 'worker', feature: 'feature' },
      ]);
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
