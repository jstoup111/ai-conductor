// Covers: task:9, task:25
import { describe, expect, it, vi } from 'vitest';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { CapturingSpanExporter as InMemorySpanExporter } from '../fixtures/capturing-span-exporter.js';
import { join } from 'node:path';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { otelEventTypes } from '../../src/engine/event-sinks.js';
import { MetricsListener, missingMetricsHandlerTypes } from '../../src/engine/otel/metrics-listener.js';
import { MetricsRecorder } from '../../src/engine/otel/metrics.js';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../src/engine/otel/otel-visualizer.js';

interface MetricPoint {
  attributes: Record<string, unknown>;
}

function dimensionSets(exporter: InMemoryMetricExporter, instrument: string): Array<Record<string, unknown>> {
  return exporter.getMetrics()
    .flatMap((batch) => batch.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === instrument)
    .flatMap((metric) => metric.dataPoints as unknown as MetricPoint[])
    .map(({ attributes }) => Object.fromEntries(
      Object.entries(attributes).filter(([key]) => !['project', 'worker', 'feature'].includes(key)),
    ));
}

function pipelineDir(name: string): string {
  return join(process.cwd(), '.pipeline', 'otel-visualizer-parity', name);
}

function makeVisualizer(feature: string, spanExporter: InMemorySpanExporter): OtelVisualizer {
  return new OtelVisualizer(
    resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir(feature),
    ),
    {
      spanExporter,
      metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  );
}

function features(exporter: InMemorySpanExporter): string[] {
  return exporter
    .getFinishedSpans()
    .map((span: ReadableSpan) => span.resource.attributes['conductor.feature'])
    .filter((feature): feature is string => typeof feature === 'string');
}

describe('OtelVisualizer concurrent dispatch parity (Task 25)', () => {
  it('keeps listener and visualizer metric dimensions equal, including absent fields and swallowed recorder failures', async () => {
    const listenerExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const listenerProvider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter: listenerExporter, exportIntervalMillis: 60_000 })],
    });
    const listenerEmitter = new ConductorEventEmitter();
    const listener = new MetricsListener(
      new MetricsRecorder(listenerProvider.getMeter('parity'), { project: 'project', worker: 'worker', feature: 'feature' }),
      () => 100,
      'feature',
    );
    const visualizerExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const visualizerEmitter = new ConductorEventEmitter();
    const visualizer = new OtelVisualizer(
      resolveOtelConfig({ otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } }, pipelineDir('parity')),
      { spanExporter: new InMemorySpanExporter(), metricExporter: visualizerExporter },
    );
    listener.start(listenerEmitter);
    visualizer.start(visualizerEmitter, { project: 'project', feature: 'feature' });

    const replay = async (emitter: ConductorEventEmitter, dimensions = true): Promise<void> => {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', provider: 'claude', preferredProvider: 'codex', model: 'opus',
        invoked: true, outcome: 'success', tokenUsage: { input: 10, output: 5 },
      });
      await emitter.emit({
        type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 3, reason: 'retry', model: 'opus',
        ...(dimensions ? { effort: 'high' as const, tier: 'M' as const, provider: 'claude' } : {}),
      });
      await emitter.emit({
        type: 'step_completed', step: 'build', status: 'done', model: 'opus', preferredProvider: 'codex',
        actualProvider: 'claude', tokenUsage: { input: 10, output: 5 },
        ...(dimensions ? { effort: 'high' as const, tier: 'M' as const } : {}),
      });
    };

    try {
      await replay(listenerEmitter);
      await replay(visualizerEmitter);
      await listenerProvider.forceFlush();
      await visualizer.stop();

      for (const instrument of ['conductor.step.duration', 'conductor.step.retries', 'conductor.step.dispatches']) {
        expect(dimensionSets(visualizerExporter, instrument)).toEqual(dimensionSets(listenerExporter, instrument));
      }
      expect(dimensionSets(listenerExporter, 'conductor.step.duration')).toEqual([
        { step: 'build', model: 'opus', effort: 'high', provider: 'claude', tier: 'M', fallback: true },
      ]);
      expect(dimensionSets(listenerExporter, 'conductor.step.retries')).toEqual([
        { step: 'build', model: 'opus', effort: 'high', provider: 'claude', tier: 'M' },
      ]);
      expect(dimensionSets(listenerExporter, 'conductor.step.dispatches')).toEqual([
        { step: 'build', metering: 'cost-unmetered', model: 'opus', provider: 'claude', fallback: true },
      ]);
      for (const exporter of [listenerExporter, visualizerExporter]) {
        expect(exporter.getMetrics()
          .flatMap((batch) => batch.scopeMetrics)
          .flatMap((scope) => scope.metrics)
          .filter((metric) => metric.descriptor.name === 'conductor.step.dispatches')
          .flatMap((metric) => metric.dataPoints as unknown as Array<{ value: number }>)
          .map((point) => point.value)).toEqual([1]);
      }

      const missingListenerExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
      const missingListenerProvider = new MeterProvider({
        readers: [new PeriodicExportingMetricReader({ exporter: missingListenerExporter, exportIntervalMillis: 60_000 })],
      });
      const missingListenerEmitter = new ConductorEventEmitter();
      const missingListener = new MetricsListener(
        new MetricsRecorder(missingListenerProvider.getMeter('parity'), { project: 'project', worker: 'worker', feature: 'feature' }),
        () => 100,
        'feature',
      );
      const missingVisualizerExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
      const missingVisualizerEmitter = new ConductorEventEmitter();
      const missingVisualizer = new OtelVisualizer(
        resolveOtelConfig({ otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } }, pipelineDir('missing-parity')),
        { spanExporter: new InMemorySpanExporter(), metricExporter: missingVisualizerExporter },
      );
      missingListener.start(missingListenerEmitter);
      missingVisualizer.start(missingVisualizerEmitter, { project: 'project', feature: 'feature' });
      await replay(missingListenerEmitter, false);
      await replay(missingVisualizerEmitter, false);
      await missingListenerProvider.forceFlush();
      await missingVisualizer.stop();

      expect(dimensionSets(missingListenerExporter, 'conductor.step.duration')).toEqual([
        { step: 'build', model: 'opus', provider: 'claude', fallback: true },
      ]);
      expect(dimensionSets(missingListenerExporter, 'conductor.step.retries')).toEqual([
        { step: 'build', model: 'opus' },
      ]);
      expect(dimensionSets(missingListenerExporter, 'conductor.step.dispatches')).toEqual([
        { step: 'build', metering: 'cost-unmetered', model: 'opus', provider: 'claude', fallback: true },
      ]);
      for (const instrument of ['conductor.step.duration', 'conductor.step.retries', 'conductor.step.dispatches']) {
        expect(dimensionSets(missingVisualizerExporter, instrument)).toEqual(dimensionSets(missingListenerExporter, instrument));
      }
      missingListener.stop();
      await missingListenerProvider.shutdown();
    } finally {
      listener.stop();
      await listenerProvider.shutdown();
    }
  });

  it('swallows a throwing recorder and continues delivering subsequent events', async () => {
    const received: string[] = [];
    const throwingListenerEmitter = new ConductorEventEmitter();
    const throwingRecorder = {
      forFeature: () => throwingRecorder,
      onStepClose: () => { throw new Error('expected'); },
    };
    const throwingListener = new MetricsListener(throwingRecorder as unknown as MetricsRecorder, undefined, 'feature');
    throwingListenerEmitter.on('build_progress', () => received.push('listener'));
    throwingListener.start(throwingListenerEmitter);
    await throwingListenerEmitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await throwingListenerEmitter.emit({ type: 'step_completed', step: 'build', status: 'done' });
    await throwingListenerEmitter.emit({ type: 'build_progress', completed: 1, total: 1 });
    throwingListener.stop();

    const throwingVisualizerEmitter = new ConductorEventEmitter();
    const throwingVisualizer = new OtelVisualizer(
      resolveOtelConfig({ otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } }, pipelineDir('throwing-parity')),
      { spanExporter: new InMemorySpanExporter(), metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE) },
    );
    throwingVisualizer.start(throwingVisualizerEmitter, { project: 'project', feature: 'feature' });
    (throwingVisualizer as unknown as { metricsRecorder: { onStepClose: () => void; onRunClose: () => void } }).metricsRecorder = {
      onStepClose: () => { throw new Error('expected'); },
      onRunClose: () => {},
    };
    throwingVisualizerEmitter.on('build_progress', () => received.push('visualizer'));
    await throwingVisualizerEmitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await throwingVisualizerEmitter.emit({ type: 'step_completed', step: 'build', status: 'done' });
    await throwingVisualizerEmitter.emit({ type: 'build_progress', completed: 1, total: 1 });
    await throwingVisualizer.stop();
    expect(received).toEqual(['listener', 'visualizer']);
  });

  it('flushes two feature-scoped buses concurrently without crossing spans, while both subscribe from the sink registry', async () => {
    const alphaEmitter = new ConductorEventEmitter();
    const betaEmitter = new ConductorEventEmitter();
    const alphaExporter = new InMemorySpanExporter();
    const betaExporter = new InMemorySpanExporter();
    const alpha = makeVisualizer('alpha', alphaExporter);
    const beta = makeVisualizer('beta', betaExporter);

    alpha.start(alphaEmitter, { runId: 'run-alpha', feature: 'alpha', project: 'repo' });
    beta.start(betaEmitter, { runId: 'run-beta', feature: 'beta', project: 'repo' });

    await Promise.all([
      alphaEmitter.emit({ type: 'step_started', step: 'build', index: 0 }),
      betaEmitter.emit({ type: 'step_started', step: 'build', index: 0 }),
    ]);
    await Promise.all([
      alphaEmitter.emit({ type: 'step_completed', step: 'build', status: 'done' }),
      betaEmitter.emit({ type: 'step_completed', step: 'build', status: 'done' }),
    ]);
    await Promise.all([
      alphaEmitter.emit({ type: 'feature_complete' }),
      betaEmitter.emit({ type: 'feature_complete' }),
    ]);

    // Initiate both closeouts before awaiting either one: this is the N=2
    // dispatch shape, not two serial visualizer lifecycles.
    const alphaFlush = alpha.stop();
    const betaFlush = beta.stop();
    await Promise.all([alphaFlush, betaFlush]);

    expect(features(alphaExporter)).toEqual(['alpha', 'alpha']);
    expect(features(betaExporter)).toEqual(['beta', 'beta']);
  });

  it('subscribes MetricsListener to every OTel sink declared by the registry', () => {
    const emitter = new ConductorEventEmitter();
    const on = vi.spyOn(emitter, 'on');
    const provider = new MeterProvider();
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('test'), { project: 'project', worker: 'worker' }),
    );

    listener.start(emitter);

    expect(new Set(on.mock.calls.map(([type]) => type))).toEqual(new Set(otelEventTypes()));
    expect(
      missingMetricsHandlerTypes(),
      `MetricsListener lacks handlers for OTel event type(s): ${missingMetricsHandlerTypes().join(', ')}`,
    ).toEqual([]);
    listener.stop();
  });

  it('names a declared OTel sink that lacks a real listener handler', () => {
    expect(missingMetricsHandlerTypes(['kickback'], {})).toEqual(['kickback']);
  });
});
