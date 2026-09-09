// Covers: task:25
import { describe, expect, it, vi } from 'vitest';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { CapturingSpanExporter as InMemorySpanExporter } from '../fixtures/capturing-span-exporter.js';
import { tmpdir } from 'node:os';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { otelEventTypes } from '../../src/engine/event-sinks.js';
import { MetricsListener, missingMetricsHandlerTypes } from '../../src/engine/otel/metrics-listener.js';
import { MetricsRecorder } from '../../src/engine/otel/metrics.js';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../src/engine/otel/otel-visualizer.js';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

function makeVisualizer(feature: string, spanExporter: InMemorySpanExporter): OtelVisualizer {
  return new OtelVisualizer(
    resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      `${tmpdir()}/${feature}/.pipeline`,
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
