// Covers: task:9, task:25
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { CapturingSpanExporter } from '../fixtures/capturing-span-exporter.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { MetricsRecorder } from '../../src/engine/otel/metrics.js';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../src/engine/otel/otel-visualizer.js';
import { wireDaemonOtel, wireInteractiveOtelMetrics } from '../../src/engine/otel/wire.js';

const buildExporters = vi.hoisted(() => vi.fn());
vi.mock('../../src/engine/otel/transport.js', () => ({ buildExporters }));

function makeVisualizer(feature: string, spanExporter: CapturingSpanExporter): OtelVisualizer {
  return new OtelVisualizer(
    resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      join(process.cwd(), '.pipeline', 'otel-visualizer-parity', feature),
    ),
    { spanExporter },
  );
}

function features(exporter: CapturingSpanExporter): string[] {
  return exporter
    .getFinishedSpans()
    .map((span: ReadableSpan) => span.resource.attributes['conductor.feature'])
    .filter((feature): feature is string => typeof feature === 'string');
}

interface MetricPoint { attributes: Record<string, unknown>; }

function dimensions(exporter: InMemoryMetricExporter, instrument: string): Array<Record<string, unknown>> {
  return exporter.getMetrics().flatMap((batch) => batch.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === instrument)
    .flatMap((metric) => metric.dataPoints as unknown as MetricPoint[])
    .map(({ attributes }) => Object.fromEntries(
      Object.entries(attributes).filter(([key]) => !['project', 'worker', 'feature'].includes(key)),
    ));
}

function distinctDimensionSets(exporter: InMemoryMetricExporter, instrument: string): Array<Record<string, unknown>> {
  const seen = new Map<string, Record<string, unknown>>();
  for (const point of dimensions(exporter, instrument)) {
    seen.set(JSON.stringify(Object.entries(point).sort(([left], [right]) => left.localeCompare(right))), point);
  }
  return [...seen.values()];
}

const wireConfig = { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } } as const;

describe('daemon and interactive metric wiring parity (Task 9)', () => {
  it('projects matching dimensions and swallows recorder failures on both listener wirings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'otel-wiring-parity-'));
    const daemonExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const interactiveExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const daemonEvents = new ConductorEventEmitter();
    const interactiveEvents = new ConductorEventEmitter();
    buildExporters.mockReset();
    buildExporters
      .mockReturnValueOnce({ spanExporter: new InMemorySpanExporter(), metricExporter: daemonExporter })
      .mockReturnValueOnce({ spanExporter: new InMemorySpanExporter(), metricExporter: interactiveExporter });
    await mkdir(join(root, '.worktrees', 'feature', '.pipeline'), { recursive: true });
    const daemon = wireDaemonOtel(wireConfig, {
      mainRoot: root, project: root, projectName: 'project', workerName: 'worker', rootEvents: daemonEvents,
    });
    const interactive = wireInteractiveOtelMetrics(wireConfig, {
      pipelineDir: join(root, '.pipeline'), project: root, feature: 'feature', runId: 'run', branch: undefined,
      engineVersion: undefined, harnessVersion: undefined,
    }, interactiveEvents);
    const forwarded = startFeatureEventPersistence(join(root, '.worktrees', 'feature'), daemonEvents, 'feature');
    const replay = async (events: ConductorEventEmitter, dimensionsPresent: boolean) => {
      await events.emit({ type: 'step_started', step: 'build', index: 0 });
      await events.emit({ type: 'provider_attempt', step: 'build', provider: 'claude', preferredProvider: 'codex', model: 'opus', invoked: true, outcome: 'success', ...(dimensionsPresent ? { effort: 'high' as const, tier: 'M' as const } : {}) });
      await events.emit({ type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 3, reason: 'retry', model: 'opus', provider: 'claude', ...(dimensionsPresent ? { effort: 'high' as const, tier: 'M' as const } : {}) });
      await events.emit({ type: 'step_completed', step: 'build', status: 'done', model: 'opus', preferredProvider: 'codex', actualProvider: 'claude', ...(dimensionsPresent ? { effort: 'high' as const, tier: 'M' as const } : {}) });
    };
    try {
      expect(daemon).not.toBeNull();
      expect(interactive).not.toBeNull();
      await daemonEvents.emit({ type: 'feature_dispatch_started', slug: 'feature', kind: 'initial' });
      await replay(forwarded.events, true);
      await replay(interactiveEvents, true);
      await replay(forwarded.events, false);
      await replay(interactiveEvents, false);

      const nextDaemon: string[] = [];
      const nextInteractive: string[] = [];
      daemonEvents.on('build_progress', () => nextDaemon.push('next'));
      interactiveEvents.on('build_progress', () => nextInteractive.push('next'));
      const throwing = vi.spyOn(MetricsRecorder.prototype, 'onStepClose').mockImplementation(() => undefined as never);
      throwing.mockImplementationOnce(() => { throw new Error('expected recorder failure'); });
      await forwarded.events.emit({ type: 'step_completed', step: 'build', status: 'done' });
      throwing.mockImplementationOnce(() => { throw new Error('expected recorder failure'); });
      await interactiveEvents.emit({ type: 'step_completed', step: 'build', status: 'done' });
      await daemonEvents.emit({ type: 'build_progress', completed: 1, total: 1 });
      await interactiveEvents.emit({ type: 'build_progress', completed: 1, total: 1 });
      expect(nextDaemon).toEqual(['next']);
      expect(nextInteractive).toEqual(['next']);
      throwing.mockRestore();
      await daemon!.flush();
      await interactive!.stop();

      for (const instrument of ['conductor.step.duration', 'conductor.step.retries', 'conductor.step.dispatches']) {
        expect(distinctDimensionSets(daemonExporter, instrument)).toEqual(distinctDimensionSets(interactiveExporter, instrument));
      }
      expect(dimensions(daemonExporter, 'conductor.step.duration')).toContainEqual(expect.objectContaining({ model: 'opus', effort: 'high', provider: 'claude', tier: 'M' }));
      for (const instrument of ['conductor.step.duration', 'conductor.step.retries']) {
        const omitted = dimensions(daemonExporter, instrument).find((point) =>
          point.model === 'opus' && point.provider === 'claude'
          && !Object.hasOwn(point, 'effort') && !Object.hasOwn(point, 'tier'),
        );
        expect(omitted, `${instrument} must omit effort and tier when the fixture omits them`).toBeDefined();
      }
    } finally {
      forwarded.stop();
      await daemon?.stop();
      await interactive?.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('OtelVisualizer concurrent dispatch isolation', () => {
  it('flushes two feature-scoped buses without crossing enriched spans', async () => {
    const alphaEmitter = new ConductorEventEmitter();
    const betaEmitter = new ConductorEventEmitter();
    const alphaExporter = new CapturingSpanExporter();
    const betaExporter = new CapturingSpanExporter();
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
    await Promise.all([alpha.stop(), beta.stop()]);

    expect(features(alphaExporter)).toEqual(['alpha', 'alpha']);
    expect(features(betaExporter)).toEqual(['beta', 'beta']);
  });
});
