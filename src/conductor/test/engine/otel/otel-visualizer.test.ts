// Covers: task:6
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { otelTracedEventTypes } from '../../../src/engine/event-sinks.js';
import { resolveOtelConfig } from '../../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../../src/engine/otel/otel-visualizer.js';
import { CapturingSpanExporter } from '../../fixtures/capturing-span-exporter.js';

describe('OtelVisualizer', () => {
  let tempDir: string;
  let pipelineDir: string;
  let emitter: ConductorEventEmitter;
  let spanExporter: CapturingSpanExporter;
  let metricExporter: InMemoryMetricExporter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'otel-visualizer-'));
    pipelineDir = join(tempDir, '.pipeline');
    emitter = new ConductorEventEmitter();
    spanExporter = new CapturingSpanExporter();
    metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeVisualizer(): OtelVisualizer {
    return new OtelVisualizer(
      resolveOtelConfig({ otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } }, pipelineDir),
      { spanExporter, metricExporter },
    );
  }

  it('subscribes via the visualizer emitter seam and exports enriched spans', async () => {
    const visualizer = makeVisualizer();
    const on = vi.spyOn(emitter, 'on');
    visualizer.start(emitter, { runId: 'run-1', feature: 'feature', project: 'project' });

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({
      type: 'provider_attempt', step: 'build', provider: 'claude', preferredProvider: 'codex',
      model: 'sonnet', fallbackReason: 'codex unavailable', invoked: true, outcome: 'success',
    });
    await emitter.emit({
      type: 'step_completed', step: 'build', status: 'done', actualProvider: 'claude', effort: 'high', tier: 'M',
    });
    await emitter.emit({ type: 'feature_complete' });
    await visualizer.stop();

    expect(new Set(on.mock.calls.map(([type]) => type))).toEqual(new Set(otelTracedEventTypes()));
    expect(spanExporter.getFinishedSpans().find((span) => span.name === 'build')?.attributes).toMatchObject({
      'conductor.model': 'sonnet',
      'conductor.effort': 'high',
      'conductor.complexity_tier': 'M',
      'conductor.provider': 'claude',
      'conductor.provider.preferred': 'codex',
      'conductor.fallback': true,
      'conductor.fallback.reason': 'codex unavailable',
    });
  });

  it('keeps the visualizer spans-only even when given a metric exporter', async () => {
    const visualizer = makeVisualizer();
    visualizer.start(emitter, { runId: 'run-1', feature: 'feature', project: 'project' });

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'build', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await visualizer.stop();

    expect(spanExporter.getFinishedSpans().map((span) => span.name)).toEqual(['build', 'conductor.run']);
    expect(metricExporter.getMetrics()).toEqual([]);
  });

  it('reads resolved attributes once for its trace Resource and reports dropped keys through one warning callback', async () => {
    const onWarning = vi.fn();
    const visualizer = new OtelVisualizer(
      resolveOtelConfig({
        otel: {
          exporter: 'otlp',
          endpoint: 'http://localhost:4318',
          attributes: {
            'deployment.environment.name': ' staging ',
            invalid: 'dropped',
          },
        },
      }, pipelineDir),
      { spanExporter, metricExporter, onWarning },
    );
    visualizer.start(emitter, { runId: 'run-1', feature: 'feature', project: 'project' });

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({ type: 'feature_complete' });
    await visualizer.stop();

    const traceResource = spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')?.resource.attributes;
    expect({
      traceResource,
      invalidPresent: Object.hasOwn(traceResource ?? {}, 'invalid'),
      warnings: { count: onWarning.mock.calls.length, message: onWarning.mock.calls[0]?.[0] },
      metricBatches: metricExporter.getMetrics(),
    }).toMatchObject({
      traceResource: { 'deployment.environment.name': 'staging' },
      invalidPresent: false,
      warnings: { count: 1, message: expect.stringContaining('invalid') },
      metricBatches: [],
    });
  });

  it('ignores lifecycle-only provider attempts without overwriting an invoked attempt on the step span', async () => {
    const visualizer = makeVisualizer();
    visualizer.start(emitter, { runId: 'run-1', feature: 'feature', project: 'project' });

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({
      type: 'provider_attempt', step: 'build', provider: 'claude', preferredProvider: 'codex',
      invoked: true, outcome: 'success',
    });
    await emitter.emit({
      type: 'provider_attempt', step: 'build', provider: 'provider-lifecycle', invoked: false,
      outcome: 'success', lifecycle: { phase: 'settled', attemptId: 'attempt-1', recoveryCount: 0 },
    });
    await emitter.emit({ type: 'step_failed', step: 'build', error: 'failed', retryCount: 0 });
    await emitter.emit({ type: 'feature_complete' });
    await visualizer.stop();

    expect(spanExporter.getFinishedSpans().find((span) => span.name === 'build')?.attributes)
      .toMatchObject({
        'conductor.provider': 'claude',
        'conductor.provider.preferred': 'codex',
        'conductor.fallback': true,
      });
  });
});
