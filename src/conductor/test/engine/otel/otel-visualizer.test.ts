// Covers: task:2, task:5, task:6, task:8, task:10
/**
 * T9: OtelVisualizer — provider/processor setup (off hot path).
 * T17: hot-path guard — emit() resolves promptly even when the transport blocks.
 * FR-5/FR-8 infra; R1.
 *
 * Verifies that constructing the visualizer assembles a TracerProvider with a
 * BatchSpanProcessor and a MeterProvider with a PeriodicExportingMetricReader
 * over the injected exporters and the Task-7 resource.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { resolveOtelConfig } from '../../../src/engine/otel/otel-config.js';
import { createOtelVisualizer } from '../../../src/engine/otel/create-otel-visualizer.js';
import { OtelVisualizer } from '../../../src/engine/otel/otel-visualizer.js';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import {
  InMemoryMetricExporter,
  AggregationTemporality,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';

describe('OtelVisualizer — T9: provider/processor setup', () => {
  let tempDir: string;
  let pipelineDir: string;
  let spanExporter: InMemorySpanExporter;
  let metricExporter: InMemoryMetricExporter;
  let emitter: ConductorEventEmitter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'otel-vis-t9-'));
    pipelineDir = join(tempDir, '.pipeline');
    spanExporter = new InMemorySpanExporter();
    metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    emitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('constructs without throwing given a valid enabled config with injected exporters', () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir,
    );
    expect(
      () =>
        new OtelVisualizer(resolved, {
          runId: 'test-run-1',
          feature: 'test-feature',
          project: 'test-project',
          spanExporter,
          metricExporter,
        }),
    ).not.toThrow();
  });

  it('has name property "otel" (VisualizerPlugin contract)', () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir,
    );
    const vis = new OtelVisualizer(resolved, {
      runId: 'test-run-name',
      feature: 'test-feature',
      project: 'test-project',
      spanExporter,
      metricExporter,
    });
    expect(vis.name).toBe('otel');
  });

  it('start() attaches to emitter (does not throw)', () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir,
    );
    const vis = new OtelVisualizer(resolved, {
      runId: 'test-run-start',
      feature: 'test-feature',
      project: 'test-project',
      spanExporter,
      metricExporter,
    });
    expect(() => vis.start(emitter)).not.toThrow();
    // cleanup
    return vis.stop();
  });

  it('subscribes to exactly the event types derived by otelEventTypes()', async () => {
    vi.resetModules();
    const expectedEventTypes = ['renderer_error'];
    vi.doMock('../../../src/engine/event-sinks.js', () => ({
      otelEventTypes: () => expectedEventTypes,
    }));

    try {
      const { OtelVisualizer: FreshOtelVisualizer } = await import('../../../src/engine/otel/otel-visualizer.js');
      const { ConductorEventEmitter: FreshConductorEventEmitter } = await import('../../../src/ui/events.js');
      const freshEmitter = new FreshConductorEventEmitter();
      const on = vi.spyOn(freshEmitter, 'on');
      const vis = new FreshOtelVisualizer(
        resolveOtelConfig(
          { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
          pipelineDir,
        ),
        {
          runId: 'test-registry-subscriptions',
          feature: 'test-feature',
          project: 'test-project',
          spanExporter,
          metricExporter,
        },
      );

      vis.start(freshEmitter);

      expect(new Set(on.mock.calls.map(([type]) => type))).toEqual(new Set(expectedEventTypes));
      await vis.stop();
    } finally {
      vi.doUnmock('../../../src/engine/event-sinks.js');
      vi.resetModules();
    }
  });

  it('records a bus-emitted loop_halt as the halted root span outcome', async () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir,
    );
    const vis = new OtelVisualizer(resolved, {
      runId: 'test-loop-halt-outcome',
      feature: 'test-feature',
      project: 'test-project',
      spanExporter,
      metricExporter,
    });
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({ type: 'loop_halt', step: 'build', reason: 'missing task evidence' });
    await vis.stop();

    const root = spanExporter.getFinishedSpans().find((span) => !span.parentSpanContext)!;
    expect(root.attributes['conductor.run.outcome']).toBe('halted');
  });

  it('uses identity supplied to start() for exported spans', async () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir,
    );
    const vis = new OtelVisualizer(resolved, {
      runId: 'constructor-run',
      feature: 'constructor-feature',
      project: 'constructor-project',
      spanExporter,
      metricExporter,
    });

    vis.start(emitter, {
      runId: 'start-run',
      feature: 'start-feature',
      project: 'start-project',
      branch: 'feat/start-context',
      engineVersion: '1.2.3',
      pipelineDir,
    });
    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const resource = spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')?.resource;
    expect(resource?.attributes).toMatchObject({
      'conductor.run.id': 'start-run',
      'conductor.feature': 'start-feature',
      'conductor.project': 'start-project',
      'conductor.branch': 'feat/start-context',
      'conductor.engine.version': '1.2.3',
    });
  });

  it('persists a generated run id when start context omits one', async () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir,
    );
    const vis = new OtelVisualizer(resolved, { spanExporter, metricExporter });

    vis.start(emitter, { pipelineDir });
    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const persisted = await readFile(join(pipelineDir, 'conduct-session-id'), 'utf-8');
    const runId = spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')
      ?.resource.attributes['conductor.run.id'];
    expect({ persisted, runId }).toEqual({
      persisted: expect.stringMatching(/\S/),
      runId: persisted,
    });
  });

  it('stop() resolves — BatchSpanProcessor + PeriodicMetricReader flush and shut down', async () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir,
    );
    const vis = new OtelVisualizer(resolved, {
      runId: 'test-run-stop',
      feature: 'test-feature',
      project: 'test-project',
      spanExporter,
      metricExporter,
    });
    vis.start(emitter);
    await expect(vis.stop()).resolves.toBeUndefined();
  });

  it('stop() without start() still resolves (no-op flush on no emitter)', async () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir,
    );
    const vis = new OtelVisualizer(resolved, {
      runId: 'test-run-nostop',
      feature: 'test-feature',
      project: 'test-project',
      spanExporter,
      metricExporter,
    });
    // Never called start — stop should still work
    await expect(vis.stop()).resolves.toBeUndefined();
  });

  it('exporter receives spans after stop() flushes the BatchSpanProcessor', async () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir,
    );
    const vis = new OtelVisualizer(resolved, {
      runId: 'test-run-flush',
      feature: 'test-feature',
      project: 'test-project',
      spanExporter,
      metricExporter,
    });
    vis.start(emitter);
    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'feature_complete', featureDesc: 'test' });
    // Before stop: BatchSpanProcessor may not have exported yet
    await vis.stop();
    // After stop + forceFlush: spans must be in the exporter
    expect(spanExporter.getFinishedSpans().length).toBeGreaterThan(0);
  });
});

describe('Task 5: visualizer identity wiring', () => {
  let identityTempDir: string;
  let identityPipelineDir: string;
  let identitySpanExporter: InMemorySpanExporter;
  let identityMetricExporter: InMemoryMetricExporter;
  let identityEmitter: ConductorEventEmitter;

  beforeEach(async () => {
    identityTempDir = await mkdtemp(join(tmpdir(), 'otel-vis-identity-'));
    identityPipelineDir = join(identityTempDir, '.pipeline');
    identitySpanExporter = new InMemorySpanExporter();
    identityMetricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    identityEmitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(identityTempDir, { recursive: true, force: true });
  });

  async function exportStepMetric(
    feature: string,
    project = join(identityTempDir, 'projects', 'nested-project'),
    projectName?: string,
  ) {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318', project_name: projectName } },
      identityPipelineDir,
    );
    const vis = createOtelVisualizer(
      resolved,
      {
        spanExporter: identitySpanExporter,
        metricExporter: identityMetricExporter,
      },
      identityEmitter,
    );
    expect(vis).not.toBeNull();
    vis!.start(identityEmitter, {
      runId: 'shared-resource-run-id',
      feature,
      project,
      pipelineDir: identityPipelineDir,
    });

    await identityEmitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await identityEmitter.emit({ type: 'step_completed', step: 'build', status: 'done' });
    await identityEmitter.emit({ type: 'feature_complete' });
    await vis!.stop();

    const durationMetric = identityMetricExporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics))
      .find((metric) => metric.descriptor.name === 'conductor.step.duration')!;
    return {
      dataPoint: durationMetric.dataPoints[0],
      span: identitySpanExporter.getFinishedSpans().find((candidate) => candidate.name === 'build')!,
      metricResource: identityMetricExporter.getMetrics()[0].resource,
    };
  }

  it('derives the metric project basename and shares the run resource identity with spans', async () => {
    const exported = await exportStepMetric('nested-feature');

    expect({
      dataPoint: exported.dataPoint.attributes,
      spanInstanceId: exported.span.resource.attributes['service.instance.id'],
      metricInstanceId: exported.metricResource.attributes['service.instance.id'],
    }).toEqual({
      dataPoint: { step: 'build', project: 'nested-project', feature: 'nested-feature' },
      spanInstanceId: 'nested-project/nested-feature',
      metricInstanceId: 'nested-project/nested-feature',
    });
  });

  it('exports a feature-stable metric resource while the span resource keeps the run id', async () => {
    const exported = await exportStepMetric('nested-feature');

    // The backend copies the metric Resource into `target_info`'s label set, so
    // a run-varying attribute here mints one series per run — the defect the
    // 2026-08-28 as-built review caught after `service.instance.id` was re-keyed.
    expect(Object.keys(exported.metricResource.attributes).sort()).toEqual([
      'conductor.branch',
      'conductor.feature',
      'conductor.project',
      'service.instance.id',
      'service.name',
    ]);
    expect(Object.values(exported.metricResource.attributes)).not.toContain('shared-resource-run-id');
    expect(exported.span.resource.attributes['conductor.run.id']).toBe('shared-resource-run-id');
  });

  it('passes an unknown feature through to metric data points', async () => {
    const exported = await exportStepMetric('unknown');

    expect(exported.dataPoint.attributes).toEqual({
      step: 'build',
      project: 'nested-project',
      feature: 'unknown',
    });
  });

  it('uses configured names to distinguish same-basename roots without changing resource identity', async () => {
    const firstProject = join(identityTempDir, 'tenant-a', 'shared');
    const secondProject = join(identityTempDir, 'tenant-b', 'shared');
    const first = await exportStepMetric('feature-a', firstProject, ' tenant-a ');
    identityMetricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    identitySpanExporter = new InMemorySpanExporter();
    const second = await exportStepMetric('feature-b', secondProject, 'tenant-b');

    expect({
      firstProject: first.dataPoint.attributes['project'],
      secondProject: second.dataPoint.attributes['project'],
      serviceName: first.metricResource.attributes['service.name'],
      conductorProject: first.metricResource.attributes['conductor.project'],
    }).toEqual({
      firstProject: 'tenant-a',
      secondProject: 'tenant-b',
      serviceName: 'ai-conductor',
      conductorProject: firstProject,
    });
  });
});

describe('Task 5: feature cost snapshot routing', () => {
  let task5TempDir: string;
  let task5PipelineDir: string;
  let task5SpanExporter: InMemorySpanExporter;
  let task5MetricExporter: InMemoryMetricExporter;
  let task5Emitter: ConductorEventEmitter;

  beforeEach(async () => {
    task5TempDir = await mkdtemp(join(tmpdir(), 'otel-vis-feature-cost-'));
    task5PipelineDir = join(task5TempDir, '.pipeline');
    task5SpanExporter = new InMemorySpanExporter();
    task5MetricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    task5Emitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(task5TempDir, { recursive: true, force: true });
  });

  function makeTask5Visualizer(
    metricExporter = task5MetricExporter,
    emitter = task5Emitter,
  ): OtelVisualizer {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      task5PipelineDir,
    );
    const visualizer = new OtelVisualizer(resolved, {
      runId: 'task-5-run',
      feature: 'task-5-feature',
      project: 'task-5-project',
      spanExporter: task5SpanExporter,
      metricExporter,
    });
    visualizer.start(emitter);
    return visualizer;
  }

  function metric(exporter: InMemoryMetricExporter, name: string) {
    return exporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics))
      .find((candidate) => candidate.descriptor.name === name);
  }

  it('records ledger-driven cost and token buckets even without a matching step span', async () => {
    const visualizer = makeTask5Visualizer();
    await task5Emitter.emit({
      type: 'feature_cost_snapshot',
      costUsd: 3.5,
      costComplete: true,
      byDimension: [{ step: 'build_review', model: 'm2', source: 'rate-card', costUsd: 2 }],
      tokensByDimension: [{ step: 'build_review', model: 'm2', tokens: { input: 150, output: 15 } }],
    });
    await visualizer.stop();

    expect(metric(task5MetricExporter, 'conductor.feature.cost')?.dataPoints).toContainEqual(
      expect.objectContaining({ value: 3.5, attributes: {
        project: 'task-5-project', feature: 'task-5-feature', cost_complete: true,
      } }),
    );
    expect(metric(task5MetricExporter, 'conductor.feature.step.cost')?.dataPoints).toContainEqual(
      expect.objectContaining({ value: 2, attributes: {
        project: 'task-5-project', feature: 'task-5-feature', step: 'build_review', model: 'm2', source: 'rate-card',
      } }),
    );
    expect(metric(task5MetricExporter, 'conductor.feature.step.tokens')?.dataPoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 150, attributes: expect.objectContaining({ step: 'build_review', model: 'm2', kind: 'input' }) }),
        expect.objectContaining({ value: 15, attributes: expect.objectContaining({ step: 'build_review', model: 'm2', kind: 'output' }) }),
      ]),
    );
  });

  it('keeps equal step-close and finish-time totals on the feature cost gauge', async () => {
    const visualizer = makeTask5Visualizer();
    await task5Emitter.emit({
      type: 'feature_cost_snapshot', costUsd: 3.5, costComplete: true, byDimension: [], tokensByDimension: [],
    });
    await task5Emitter.emit({
      type: 'feature_usage_total', dispatches: 2, meteredDispatches: 1, unmeteredDispatches: 1,
      costUnmeteredDispatches: 0, costUsd: 3.5, inputTokens: 0, outputTokens: 0,
    });
    await visualizer.stop();

    const values = metric(task5MetricExporter, 'conductor.feature.cost')!.dataPoints
      .filter((point) => point.attributes['project'] === 'task-5-project')
      .map((point) => ({ value: point.value, costComplete: point.attributes['cost_complete'] }));
    expect(values).toEqual(expect.arrayContaining([
      { value: 3.5, costComplete: true },
      { value: 3.5, costComplete: false },
    ]));
  });

  it('exports the cumulative snapshot for a later visualizer with the same feature identity', async () => {
    const first = makeTask5Visualizer();
    await task5Emitter.emit({
      type: 'feature_cost_snapshot', costUsd: 1.5, costComplete: true, byDimension: [], tokensByDimension: [],
    });
    await first.stop();

    const secondExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const secondEmitter = new ConductorEventEmitter();
    const second = makeTask5Visualizer(secondExporter, secondEmitter);
    await secondEmitter.emit({
      type: 'feature_cost_snapshot', costUsd: 3.5, costComplete: true, byDimension: [], tokensByDimension: [],
    });
    await second.stop();

    expect(metric(secondExporter, 'conductor.feature.cost')?.dataPoints).toContainEqual(
      expect.objectContaining({ value: 3.5, attributes: {
        project: 'task-5-project', feature: 'task-5-feature', cost_complete: true,
      } }),
    );
  });

  it('exports an incomplete zero total without a step-cost point for an empty snapshot', async () => {
    const visualizer = makeTask5Visualizer();
    await task5Emitter.emit({
      type: 'feature_cost_snapshot', costUsd: 0, costComplete: false, byDimension: [], tokensByDimension: [],
    });
    await visualizer.stop();

    expect(metric(task5MetricExporter, 'conductor.feature.cost')?.dataPoints).toContainEqual(
      expect.objectContaining({ value: 0, attributes: {
        project: 'task-5-project', feature: 'task-5-feature', cost_complete: false,
      } }),
    );
    expect(metric(task5MetricExporter, 'conductor.feature.step.cost')).toBeUndefined();
  });
});

// ── Task 6: meter shutdown after final flush ───────────────────────────────

describe('Task 6: stop() shuts down the meter provider after its final flush', () => {
  let task6TempDir: string;
  let task6PipelineDir: string;
  let task6SpanExporter: InMemorySpanExporter;
  let task6MetricExporter: InMemoryMetricExporter;
  let task6Emitter: ConductorEventEmitter;

  beforeEach(async () => {
    vi.useFakeTimers();
    task6TempDir = await mkdtemp(join(tmpdir(), 'otel-vis-meter-stop-'));
    task6PipelineDir = join(task6TempDir, '.pipeline');
    task6SpanExporter = new InMemorySpanExporter();
    task6MetricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    task6Emitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(task6TempDir, { recursive: true, force: true });
  });

  function makeTask6Visualizer(): OtelVisualizer {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      task6PipelineDir,
    );
    const visualizer = new OtelVisualizer(resolved, {
      runId: 'task-6-run',
      feature: 'task-6-feature',
      project: 'task-6-project',
      spanExporter: task6SpanExporter,
      metricExporter: task6MetricExporter,
    });
    visualizer.start(task6Emitter);
    return visualizer;
  }

  async function stopWithSdkTimers(visualizer: OtelVisualizer): Promise<void> {
    const stopped = visualizer.stop();
    // The OTel processors use timeout-backed asynchronous flushes. Advance the
    // bounded flush window while retaining control of the periodic-reader clock.
    await vi.advanceTimersByTimeAsync(5_000);
    await stopped;
  }

  it('exports the latest metric value before stop() resolves', async () => {
    const visualizer = makeTask6Visualizer();
    const exportSpy = vi.spyOn(task6MetricExporter, 'export');
    await task6Emitter.emit({
      type: 'feature_cost_snapshot', costUsd: 1.5, costComplete: true, byDimension: [], tokensByDimension: [],
    });
    await task6Emitter.emit({
      type: 'feature_cost_snapshot', costUsd: 3.5, costComplete: true, byDimension: [], tokensByDimension: [],
    });

    await stopWithSdkTimers(visualizer);

    expect(exportSpy).toHaveBeenCalledTimes(1);
    const featureCost = task6MetricExporter.getMetrics()
      .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics))
      .find((candidate) => candidate.descriptor.name === 'conductor.feature.cost');
    expect(featureCost?.dataPoints).toContainEqual(expect.objectContaining({ value: 3.5 }));
  });

  it('does not export again across three metric intervals after stop()', async () => {
    const visualizer = makeTask6Visualizer();
    const exportSpy = vi.spyOn(task6MetricExporter, 'export');
    await task6Emitter.emit({
      type: 'feature_cost_snapshot', costUsd: 3.5, costComplete: true, byDimension: [], tokensByDimension: [],
    });

    await stopWithSdkTimers(visualizer);
    const exportsAtStop = exportSpy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3 * 60_000);

    expect(exportSpy).toHaveBeenCalledTimes(exportsAtStop);
  });

  it('keeps force-closed spans readable after stop()', async () => {
    const visualizer = makeTask6Visualizer();
    await task6Emitter.emit({ type: 'step_started', step: 'build', index: 0 });

    await stopWithSdkTimers(visualizer);

    expect(task6SpanExporter.getFinishedSpans().map((span) => span.name)).toEqual(
      expect.arrayContaining(['build', 'conductor.run']),
    );
  });

  it('does not export metrics when no metric was recorded', async () => {
    const visualizer = makeTask6Visualizer();
    const exportSpy = vi.spyOn(task6MetricExporter, 'export');

    await stopWithSdkTimers(visualizer);

    expect(exportSpy).not.toHaveBeenCalled();
  });
});

// ── Task 7: bounded, idempotent stop and sequential runs ──────────────────

describe('Task 7: stop stays bounded and sequential runs do not interleave', () => {
  let task7TempDir: string;
  let task7PipelineDir: string;
  let task7Emitter: ConductorEventEmitter;

  beforeEach(async () => {
    vi.useFakeTimers();
    task7TempDir = await mkdtemp(join(tmpdir(), 'otel-vis-stop-bounded-'));
    task7PipelineDir = join(task7TempDir, '.pipeline');
    task7Emitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(task7TempDir, { recursive: true, force: true });
  });

  function makeVisualizer(
    metricExporter: PushMetricExporter,
    exportTimeoutMillis = 100,
    onWarning?: (message: string) => void,
  ): OtelVisualizer {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      task7PipelineDir,
    );
    const visualizer = new OtelVisualizer(resolved, {
      runId: 'task-7-run',
      feature: 'task-7-feature',
      project: 'task-7-project',
      spanExporter: new InMemorySpanExporter(),
      metricExporter,
      exportTimeoutMillis,
      onWarning,
    });
    visualizer.start(task7Emitter);
    return visualizer;
  }

  it('bounds stop when metric export and shutdown both hang', async () => {
    const warn = vi.fn();
    const shutdown = vi.fn(() => new Promise<void>(() => {}));
    const hangingExporter: PushMetricExporter = {
      export(_metrics: ResourceMetrics, _callback): void {
        // Simulate a transport that never completes its export callback.
      },
      forceFlush: async (): Promise<void> => {},
      shutdown,
    };
    const timeoutMillis = 100;
    const visualizer = makeVisualizer(hangingExporter, timeoutMillis, warn);
    await task7Emitter.emit({
      type: 'feature_cost_snapshot', costUsd: 1, costComplete: true, byDimension: [], tokensByDimension: [],
    });

    const stopped = visualizer.stop();
    await vi.advanceTimersByTimeAsync(timeoutMillis + 25);

    await expect(stopped).resolves.toBeUndefined();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns the in-flight stop promise when a signal arrives during stop and shuts down once', async () => {
    const shutdown = vi.fn(async (): Promise<void> => {});
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    exporter.shutdown = shutdown;
    const processOn = vi.spyOn(process, 'on');
    const visualizer = makeVisualizer(exporter);

    const first = visualizer.stop();
    const sigintHandler = processOn.mock.calls.find(([signal]) => signal === 'SIGINT')?.[1];
    expect(sigintHandler).toBeTypeOf('function');
    (sigintHandler as () => void)();
    const second = visualizer.stop();

    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(125);
    await first;
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when stop is called before start', async () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      task7PipelineDir,
    );
    const visualizer = new OtelVisualizer(resolved, {
      spanExporter: new InMemorySpanExporter(),
      metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    });

    await expect(visualizer.stop()).resolves.toBeUndefined();
  });

  it('exports only from the next visualizer after the previous sequential run stops', async () => {
    const firstExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const firstExport = vi.spyOn(firstExporter, 'export');
    const first = makeVisualizer(firstExporter);
    await task7Emitter.emit({
      type: 'feature_cost_snapshot', costUsd: 1, costComplete: true, byDimension: [], tokensByDimension: [],
    });
    const firstStopped = first.stop();
    await vi.advanceTimersByTimeAsync(125);
    await firstStopped;
    const firstExportsAtStop = firstExport.mock.calls.length;

    const secondExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const secondExport = vi.spyOn(secondExporter, 'export');
    const second = makeVisualizer(secondExporter);
    await task7Emitter.emit({
      type: 'feature_cost_snapshot', costUsd: 2, costComplete: true, byDimension: [], tokensByDimension: [],
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(firstExport).toHaveBeenCalledTimes(firstExportsAtStop);
    expect(secondExport).toHaveBeenCalled();

    const secondStopped = second.stop();
    await vi.advanceTimersByTimeAsync(125);
    await secondStopped;
  });
});

// ── T17: hot-path guard — emit() resolves promptly (R1 non-blocking) ──────────

describe('T17: hot-path guard — emit() does not await the transport', () => {
  /**
   * Regression guard for R1: handlers must be synchronous (O(1)) and must NOT
   * await the exporter. If a handler awaited the exporter, emit() would block
   * for the full duration of the export call, stalling the event bus.
   *
   * We inject a span exporter whose export() method blocks indefinitely (never
   * calls the callback). If emit() awaited the export, it would never resolve.
   * The test asserts that emit() resolves within a short deadline.
   */
  let t17TempDir: string;
  let t17PipelineDir: string;
  let t17MetricExporter: InMemoryMetricExporter;
  let t17Emitter: ConductorEventEmitter;

  beforeEach(async () => {
    t17TempDir = await mkdtemp(join(tmpdir(), 'otel-vis-t17-'));
    t17PipelineDir = join(t17TempDir, '.pipeline');
    t17MetricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    t17Emitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(t17TempDir, { recursive: true, force: true });
  });

  it('emitter.emit() resolves promptly even when the transport export blocks indefinitely', async () => {
    // A span exporter that blocks forever — never calls the result callback.
    const blockingExporter: SpanExporter = {
      export(_spans: ReadableSpan[], _resultCallback: (result: { code: number }) => void): void {
        // Intentionally never calls _resultCallback — simulates a hung transport.
      },
      async shutdown(): Promise<void> {},
    };

    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      t17PipelineDir,
    );
    const vis = new OtelVisualizer(resolved, {
      runId: 'test-hotpath',
      feature: 'test-feature',
      project: 'test-project',
      spanExporter: blockingExporter,
      metricExporter: t17MetricExporter,
    });
    vis.start(t17Emitter);

    // emit() must resolve in ≪1 second even though the exporter never calls back.
    const DEADLINE_MS = 500;
    const start = Date.now();
    await t17Emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await t17Emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await t17Emitter.emit({ type: 'feature_complete', featureDesc: 'test' });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(DEADLINE_MS);

    // stop() may hang (blocked export) — don't await it in this test. The test
    // only verifies that the *emit* path is non-blocking (R1 guard).
    // Suppress unused import warning: vi is used for type checking context.
    vi.stubGlobal('__t17_vis_ref', vis); // keep vis alive for GC; not awaited
  });
});

// ── T19: bounded export timeout ────────────────────────────────────────────────

describe('T19: bounded export timeout — stop() resolves within exportTimeoutMillis', () => {
  /**
   * Verifies that an export that never calls its resultCallback is abandoned
   * after exportTimeoutMillis and stop() resolves rather than hanging forever.
   *
   * We inject a "hanging" span exporter (export() never calls the callback)
   * and a very short exportTimeoutMillis so the test stays fast.
   */
  let t19TempDir: string;
  let t19PipelineDir: string;
  let t19MetricExporter: InMemoryMetricExporter;
  let t19Emitter: ConductorEventEmitter;

  beforeEach(async () => {
    t19TempDir = await mkdtemp(join(tmpdir(), 'otel-vis-t19-'));
    t19PipelineDir = join(t19TempDir, '.pipeline');
    t19MetricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    t19Emitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(t19TempDir, { recursive: true, force: true });
  });

  it('stop() resolves within the export timeout even when the transport never responds', async () => {
    // Span exporter that blocks forever — never calls the result callback.
    const hangingExporter: SpanExporter = {
      export(_spans: ReadableSpan[], _cb: (r: { code: number }) => void): void {
        // Never calls _cb.
      },
      async shutdown(): Promise<void> {},
    };

    const TIMEOUT_MS = 200; // short bound for test speed
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      t19PipelineDir,
    );
    const vis = new OtelVisualizer(resolved, {
      runId: 'test-t19',
      feature: 'test-feature',
      project: 'test-project',
      spanExporter: hangingExporter,
      metricExporter: t19MetricExporter,
      exportTimeoutMillis: TIMEOUT_MS,
    });
    vis.start(t19Emitter);
    await t19Emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await t19Emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await t19Emitter.emit({ type: 'feature_complete', featureDesc: 'test' });

    // stop() must abandon the hung export and resolve within a reasonable multiple
    // of TIMEOUT_MS (allowing for scheduling jitter).
    const DEADLINE_MS = TIMEOUT_MS * 5;
    const start = Date.now();
    await expect(vis.stop()).resolves.toBeUndefined();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(DEADLINE_MS);
  }, 10_000 /* test timeout: must complete well before 10 s */);
});

// ── Task 19: pipeline closeout live-bus export ──────────────────────────────

describe('Task 19: pipeline_closeout export', () => {
  let closeoutTempDir: string;
  let closeoutPipelineDir: string;
  let closeoutSpanExporter: InMemorySpanExporter;
  let closeoutMetricExporter: InMemoryMetricExporter;
  let closeoutEmitter: ConductorEventEmitter;

  beforeEach(async () => {
    closeoutTempDir = await mkdtemp(join(tmpdir(), 'otel-vis-closeout-'));
    closeoutPipelineDir = join(closeoutTempDir, '.pipeline');
    closeoutSpanExporter = new InMemorySpanExporter();
    closeoutMetricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    closeoutEmitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(closeoutTempDir, { recursive: true, force: true });
  });

  it('subscribes synchronously and adds obligation timing to the active build span', async () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      closeoutPipelineDir,
    );
    const vis = new OtelVisualizer(resolved, {
      runId: 'test-closeout-span',
      feature: 'test-feature',
      project: 'test-project',
      spanExporter: closeoutSpanExporter,
      metricExporter: closeoutMetricExporter,
    });
    const onSpy = vi.spyOn(closeoutEmitter, 'on');
    vis.start(closeoutEmitter);

    await closeoutEmitter.emit({ type: 'step_started', step: 'build', index: 0 });
    const closeoutEvent = {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 100,
      endedAt: 140,
      ts: 150,
    } as const;
    const closeoutHandler = onSpy.mock.calls.find(([type]) => type === 'pipeline_closeout')?.[1];
    expect(closeoutHandler).toBeDefined();
    expect(closeoutHandler!({ ...closeoutEvent, obligation: 'summary' })).toBeUndefined();
    await closeoutEmitter.emit(closeoutEvent);
    await closeoutEmitter.emit({ type: 'step_completed', step: 'build', status: 'done' });
    await closeoutEmitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const buildSpan = closeoutSpanExporter.getFinishedSpans().find((span) => span.name === 'build')!;
    const closeout = buildSpan.events.find(
      (event) => event.name === 'pipeline_closeout' && event.attributes?.['obligation'] === 'evaluator',
    );
    expect(closeout?.attributes).toMatchObject({
      obligation: 'evaluator',
      startedAt: 100,
      endedAt: 140,
      durationMs: 40,
    });
  });
});

// ── T21: flush on exit — SIGINT/SIGTERM handlers ──────────────────────────────

describe('T21: flush on exit — idempotent stop() and signal handlers', () => {
  let t21TempDir: string;
  let t21PipelineDir: string;
  let t21SpanExporter: InMemorySpanExporter;
  let t21MetricExporter: InMemoryMetricExporter;
  let t21Emitter: ConductorEventEmitter;

  beforeEach(async () => {
    t21TempDir = await mkdtemp(join(tmpdir(), 'otel-vis-t21-'));
    t21PipelineDir = join(t21TempDir, '.pipeline');
    t21SpanExporter = new InMemorySpanExporter();
    t21MetricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    t21Emitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(t21TempDir, { recursive: true, force: true });
  });

  function makeVis(): OtelVisualizer {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      t21PipelineDir,
    );
    return new OtelVisualizer(resolved, {
      runId: 'test-t21',
      feature: 'test-feature',
      project: 'test-project',
      spanExporter: t21SpanExporter,
      metricExporter: t21MetricExporter,
    });
  }

  it('calling stop() twice returns the same promise (no double-flush)', async () => {
    const vis = makeVis();
    vis.start(t21Emitter);
    await t21Emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await t21Emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await t21Emitter.emit({ type: 'feature_complete', featureDesc: 'test' });

    const p1 = vis.stop();
    const p2 = vis.stop();
    // Both must be the same promise object (idempotent).
    expect(p1).toBe(p2);
    await p1;
    // Spans must appear exactly once (no duplicate flush).
    const roots = t21SpanExporter.getFinishedSpans().filter((s) => !s.parentSpanContext);
    expect(roots).toHaveLength(1);
  });

  it('SIGINT triggers stop() and spans are flushed', async () => {
    const vis = makeVis();
    const processOn = vi.spyOn(process, 'on');
    vis.start(t21Emitter);
    await t21Emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await t21Emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await t21Emitter.emit({ type: 'feature_complete', featureDesc: 'test' });

    // Invoke only this visualizer's handler. Broadcasting a real process-wide
    // SIGINT also invokes Vitest's signal handler in a reused fork, which can
    // terminate the worker after the test has passed.
    const sigintHandler = processOn.mock.calls.find(([signal]) => signal === 'SIGINT')?.[1];
    expect(sigintHandler).toBeTypeOf('function');
    (sigintHandler as () => void)();

    // Wait for the flush to complete by awaiting stop() directly.
    // stop() is idempotent: calling it again after SIGINT triggered it returns
    // the same promise that is already resolving.
    await vis.stop();

    expect(t21SpanExporter.getFinishedSpans().length).toBeGreaterThan(0);
  });

  it('SIGTERM triggers stop() and spans are flushed', async () => {
    const vis = makeVis();
    const processOn = vi.spyOn(process, 'on');
    vis.start(t21Emitter);
    await t21Emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
    await t21Emitter.emit({ type: 'step_completed', step: 'plan', status: 'done' });
    await t21Emitter.emit({ type: 'feature_complete', featureDesc: 'test' });

    // Invoke only this visualizer's handler. Broadcasting a real process-wide
    // SIGTERM also invokes unrelated handlers retained by other test fixtures
    // in a reused Vitest fork, some of which legitimately terminate the process.
    const sigtermHandler = processOn.mock.calls.find(([signal]) => signal === 'SIGTERM')?.[1];
    expect(sigtermHandler).toBeTypeOf('function');
    (sigtermHandler as () => void)();
    await vis.stop();

    expect(t21SpanExporter.getFinishedSpans().length).toBeGreaterThan(0);
  });

  it('signal handler is removed after stop() — no listener leak', async () => {
    const vis = makeVis();
    vis.start(t21Emitter);

    const sigintCountBefore = process.listenerCount('SIGINT');
    await vis.stop();
    // After stop, our handler must have been unregistered.
    const sigintCountAfter = process.listenerCount('SIGINT');
    expect(sigintCountAfter).toBe(sigintCountBefore - 1);
  });

  it('stop() without prior start() still resolves (no-op flush on empty state)', async () => {
    const vis = makeVis();
    // Never call start() — stop() should still resolve cleanly.
    await expect(vis.stop()).resolves.toBeUndefined();
  });
});
