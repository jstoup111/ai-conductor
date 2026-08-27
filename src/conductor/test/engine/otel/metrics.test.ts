// Covers: task:1
/**
 * Covers: task:1, task:2, task:3, task:4
 * metrics.test.ts — unit tests for MetricsRecorder via OtelVisualizer.
 *
 * Tests T15–T16 using OtelVisualizer + InMemoryMetricExporter:
 *   T15: Duration histogram and retries counter
 *   T16: Token metrics — skip when absent, record only present kinds
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { resolveOtelConfig } from '../../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../../src/engine/otel/otel-visualizer.js';
import { DURATION_BUCKET_BOUNDARIES_MS, MetricsRecorder } from '../../../src/engine/otel/metrics.js';
import type { Meter } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type HistogramMetricData,
} from '@opentelemetry/sdk-metrics';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeVisualizer(
  spanExporter: InMemorySpanExporter,
  metricExporter: InMemoryMetricExporter,
  pipelineDir: string,
  runId = `test-${Date.now()}`,
): OtelVisualizer {
  const resolved = resolveOtelConfig(
    { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
    pipelineDir,
  );
  return new OtelVisualizer(resolved, {
    runId,
    feature: 'test-feature',
    project: 'test-project',
    spanExporter,
    metricExporter,
  });
}

function getMetricNames(exporter: InMemoryMetricExporter): string[] {
  return exporter
    .getMetrics()
    .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics.map((m) => m.descriptor.name)));
}

function findMetric(exporter: InMemoryMetricExporter, name: string) {
  return exporter
    .getMetrics()
    .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics))
    .find((m) => m.descriptor.name === name);
}

async function recordMetricsWithIdentity(identityAttrs: { project: string; feature: string }) {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const meterProvider = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
  });
  const recorder = new MetricsRecorder(meterProvider.getMeter('metrics-recorder-test'), identityAttrs);

  recorder.onStepClose('build', 25, 1, { input: 100, output: 50 }, 'test-model');
  recorder.onPipelineCloseout({
    type: 'pipeline_closeout',
    obligation: 'simplify',
    startedAt: 1_000,
    endedAt: 1_125,
    ts: 1_130,
  });
  await meterProvider.forceFlush();

  return exporter;
}

// ── Shared setup ──────────────────────────────────────────────────────────────

let tempDir: string;
let pipelineDir: string;
let spanExporter: InMemorySpanExporter;
let metricExporter: InMemoryMetricExporter;
let emitter: ConductorEventEmitter;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'otel-metrics-'));
  pipelineDir = join(tempDir, '.pipeline');
  spanExporter = new InMemorySpanExporter();
  metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  emitter = new ConductorEventEmitter();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ── Task 1: duration bucket boundaries ──────────────────────────────────────

describe('Task 1: duration bucket boundaries', () => {
  it('are strictly increasing and span 10 ms through 30 minutes', () => {
    expect(DURATION_BUCKET_BOUNDARIES_MS.every(
      (boundary, index) => index === 0 || boundary > DURATION_BUCKET_BOUNDARIES_MS[index - 1],
    )).toBe(true);
    expect(DURATION_BUCKET_BOUNDARIES_MS[0]).toBeLessThanOrEqual(10);
    expect(DURATION_BUCKET_BOUNDARIES_MS.at(-1)).toBeGreaterThanOrEqual(1_800_000);
    expect(DURATION_BUCKET_BOUNDARIES_MS.some((boundary) => boundary >= 252_464)).toBe(true);
  });

  it('resolves representative durations to four distinct buckets', () => {
    const resolvedBoundaries = [240, 4_000, 90_000, 600_000].map((durationMs) =>
      DURATION_BUCKET_BOUNDARIES_MS.find((boundary) => boundary >= durationMs),
    );

    expect(resolvedBoundaries).not.toContain(undefined);
    expect(new Set(resolvedBoundaries).size).toBe(4);
  });
});

// ── Task 2: step-duration histogram advice ─────────────────────────────────

describe('Task 2: step-duration histogram advice', () => {
  it('passes the shared duration boundaries as advice when creating conductor.step.duration', () => {
    const createHistogram = vi.fn();
    const meter = {
      createHistogram,
      createCounter: vi.fn(),
    } as unknown as Meter;

    new MetricsRecorder(meter);

    const stepDurationCall = createHistogram.mock.calls.find(
      ([name]) => name === 'conductor.step.duration',
    );
    expect(stepDurationCall?.[1]?.advice?.explicitBucketBoundaries)
      .toEqual([
        10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
        30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
      ]);
  });
});

// ── Task 3: closeout-duration histogram advice and descriptions ─────────────

describe('Task 3: closeout-duration histogram advice and descriptions', () => {
  it('shares duration advice and declares the 30-minute saturation bound for both duration instruments', () => {
    const createHistogram = vi.fn();
    const meter = {
      createHistogram,
      createCounter: vi.fn(),
    } as unknown as Meter;

    new MetricsRecorder(meter);

    const durationOptions = Object.fromEntries(createHistogram.mock.calls) as Record<string, {
      advice?: { explicitBucketBoundaries?: number[] };
      description?: string;
    }>;

    expect({
      closeoutAdvice: durationOptions['conductor.pipeline.closeout.duration']?.advice
        ?.explicitBucketBoundaries,
      stepDescription: durationOptions['conductor.step.duration']?.description,
      closeoutDescription: durationOptions['conductor.pipeline.closeout.duration']?.description,
    }).toEqual({
      closeoutAdvice: DURATION_BUCKET_BOUNDARIES_MS,
      stepDescription: expect.stringContaining('quantiles saturate above 30 min (largest finite bucket boundary)'),
      closeoutDescription: expect.stringContaining('quantiles saturate above 30 min (largest finite bucket boundary)'),
    });
  });
});

// ── Task 4: step-duration overflow and zero observations ───────────────────

describe('Task 4: step-duration overflow and zero observations', () => {
  it('keeps overflow and zero observations in their exact histogram buckets', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter })],
    });

    try {
      const recorder = new MetricsRecorder(provider.getMeter('task-4'));
      recorder.onStepClose('overflow-and-zero', 2_000_000, 0);
      recorder.onStepClose('overflow-and-zero', 0, 0);

      await provider.forceFlush();

      const metric = findMetric(exporter, 'conductor.step.duration');
      const point = (metric as HistogramMetricData | undefined)?.dataPoints.find(
        (dataPoint) => dataPoint.attributes['step'] === 'overflow-and-zero',
      );

      expect(point).toBeDefined();
      expect(point?.value.count).toBe(2);
      expect(point?.value.sum).toBe(2_000_000);
      expect(point?.value.buckets.boundaries.at(-1)).toBe(DURATION_BUCKET_BOUNDARIES_MS.at(-1));
      expect(point?.value.buckets.counts.at(-1)).toBe(1);
      expect(point?.value.buckets.counts[0]).toBe(1);
    } finally {
      await provider.shutdown();
    }
  });
});

// ── Task 5: closeout-duration overflow observation ─────────────────────────

describe('Task 5: closeout-duration overflow observation', () => {
  it('keeps a closeout overflow observation in the bucket above the largest finite boundary', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter })],
    });

    try {
      const recorder = new MetricsRecorder(provider.getMeter('task-5'));
      const closeout = {
        type: 'pipeline_closeout',
        obligation: 'summary',
        startedAt: 1_000,
        endedAt: 2_001_000,
        ts: 2_001_000,
      } as const;

      expect(() => recorder.onPipelineCloseout(closeout)).not.toThrow();
      await provider.forceFlush();

      const metric = findMetric(exporter, 'conductor.pipeline.closeout.duration');
      const point = (metric as HistogramMetricData | undefined)?.dataPoints.find(
        (dataPoint) => dataPoint.attributes['obligation'] === 'summary',
      );

      expect(point).toBeDefined();
      expect(point?.value.count).toBe(1);
      expect(point?.value.sum).toBe(2_000_000);
      expect(point?.value.buckets.boundaries.at(-1)).toBe(DURATION_BUCKET_BOUNDARIES_MS.at(-1));
      expect(point?.value.buckets.counts.at(-1)).toBe(1);
    } finally {
      await provider.shutdown();
    }
  });
});

// ── T15: Duration histogram and retries counter ───────────────────────────────

describe('T15: step duration histogram and retries counter', () => {
  it('conductor.step.duration histogram is recorded for each completed step', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const names = getMetricNames(metricExporter);
    expect(names).toContain('conductor.step.duration');
  });

  it('duration data points carry the step attribute', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'step_started', step: 'explore', index: 1 });
    await emitter.emit({ type: 'step_completed', step: 'explore', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const durationMetric = findMetric(metricExporter, 'conductor.step.duration')!;
    const stepNames = durationMetric.dataPoints.map((d) => d.attributes['step']);
    expect(stepNames).toContain('bootstrap');
    expect(stepNames).toContain('explore');
  });

  it('conductor.step.retries counter is incremented by N for N retries', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'explore', index: 1 });
    await emitter.emit({ type: 'step_retry', step: 'explore', attempt: 2, maxAttempts: 3, reason: 'flaky' });
    await emitter.emit({ type: 'step_completed', step: 'explore', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const names = getMetricNames(metricExporter);
    expect(names).toContain('conductor.step.retries');

    const retriesMetric = findMetric(metricExporter, 'conductor.step.retries')!;
    const exploreRetries = retriesMetric.dataPoints.find(
      (d) => d.attributes['step'] === 'explore',
    );
    expect(exploreRetries).toBeDefined();
    // 1 retry → counter incremented by 1
    expect(exploreRetries?.value).toBe(1);
  });

  it('retries counter has NO data point for steps with zero retries', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    // If the metric exists at all, bootstrap should NOT be in it (no retries)
    const retriesMetric = findMetric(metricExporter, 'conductor.step.retries');
    if (retriesMetric) {
      const bootstrapData = retriesMetric.dataPoints.find(
        (d) => d.attributes['step'] === 'bootstrap',
      );
      expect(bootstrapData).toBeUndefined();
    }
    // If the metric doesn't exist (no retries at all), that's also acceptable
  });

  it('two retries for a step → counter value is 2', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'explore', index: 1 });
    await emitter.emit({ type: 'step_retry', step: 'explore', attempt: 2, maxAttempts: 3, reason: 'flaky' });
    await emitter.emit({ type: 'step_retry', step: 'explore', attempt: 3, maxAttempts: 3, reason: 'timeout' });
    await emitter.emit({ type: 'step_completed', step: 'explore', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const retriesMetric = findMetric(metricExporter, 'conductor.step.retries')!;
    const exploreRetries = retriesMetric.dataPoints.find(
      (d) => d.attributes['step'] === 'explore',
    );
    expect(exploreRetries?.value).toBe(2);
  });
});

// ── T16: Token metrics — skip absent, record only present kinds ───────────────

describe('T16: token metrics — skip-absent, partial kinds', () => {
  it('conductor.step.tokens counter is recorded when tokenUsage is present', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'explore', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'explore',
      status: 'done',
      tokenUsage: { input: 100, output: 50 },
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const names = getMetricNames(metricExporter);
    expect(names).toContain('conductor.step.tokens');
  });

  it('token data points contain the step attribute for a step with tokenUsage', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'explore', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'explore',
      status: 'done',
      tokenUsage: { input: 100, output: 50 },
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const tokenMetric = findMetric(metricExporter, 'conductor.step.tokens')!;
    const steps = tokenMetric.dataPoints.map((d) => d.attributes['step']);
    expect(steps).toContain('explore');
  });

  it('tokenUsage absent → zero token data points for that step (no NaN / zero-fill)', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
    // No tokenUsage on this step
    await emitter.emit({ type: 'step_completed', step: 'plan', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const tokenMetric = findMetric(metricExporter, 'conductor.step.tokens');
    if (tokenMetric) {
      const planData = tokenMetric.dataPoints.filter((d) => d.attributes['step'] === 'plan');
      expect(planData).toHaveLength(0); // no data points for 'plan'
    }
    // If metric doesn't exist at all (no token steps), that's also acceptable
  });

  it('partial tokenUsage (input + output only) → only those two kinds recorded', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'explore', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'explore',
      status: 'done',
      tokenUsage: { input: 100, output: 50 }, // no cacheRead or cacheCreation
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const tokenMetric = findMetric(metricExporter, 'conductor.step.tokens')!;
    const explorePoints = tokenMetric.dataPoints.filter(
      (d) => d.attributes['step'] === 'explore',
    );
    const kinds = explorePoints.map((d) => d.attributes['kind']);
    // Only 'input' and 'output' present — NOT 'cacheRead' or 'cacheCreation'
    expect(kinds).toContain('input');
    expect(kinds).toContain('output');
    expect(kinds).not.toContain('cacheRead');
    expect(kinds).not.toContain('cacheCreation');
  });

  it('full tokenUsage (all four kinds) → all four kinds recorded', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'explore', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'explore',
      status: 'done',
      tokenUsage: { input: 100, output: 50, cacheRead: 20, cacheCreation: 5 },
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const tokenMetric = findMetric(metricExporter, 'conductor.step.tokens')!;
    const explorePoints = tokenMetric.dataPoints.filter(
      (d) => d.attributes['step'] === 'explore',
    );
    const kinds = explorePoints.map((d) => d.attributes['kind']);
    expect(kinds).toContain('input');
    expect(kinds).toContain('output');
    expect(kinds).toContain('cacheRead');
    expect(kinds).toContain('cacheCreation');
  });

  it('mix: one step with tokenUsage, one without → only the token step has data points', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'explore', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'explore',
      status: 'done',
      tokenUsage: { input: 100, output: 50 },
    });
    await emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
    // No tokenUsage on plan
    await emitter.emit({ type: 'step_completed', step: 'plan', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const tokenMetric = findMetric(metricExporter, 'conductor.step.tokens')!;
    const steps = tokenMetric.dataPoints.map((d) => d.attributes['step']);
    expect(steps).toContain('explore');
    expect(steps).not.toContain('plan'); // no tokenUsage → no data point
  });

  it('token counter values match the actual token counts', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'explore', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'explore',
      status: 'done',
      tokenUsage: { input: 123, output: 456 },
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const tokenMetric = findMetric(metricExporter, 'conductor.step.tokens')!;
    const inputPoint = tokenMetric.dataPoints.find(
      (d) => d.attributes['step'] === 'explore' && d.attributes['kind'] === 'input',
    ) as any;
    const outputPoint = tokenMetric.dataPoints.find(
      (d) => d.attributes['step'] === 'explore' && d.attributes['kind'] === 'output',
    ) as any;
    expect(inputPoint?.value).toBe(123);
    expect(outputPoint?.value).toBe(456);
  });
});

// ── Task 1: step cost counter ───────────────────────────────────────────────

describe('Task 1: step cost counter', () => {
  it('records provider cost with step, model, and source attributes', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'explore', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'explore',
      status: 'done',
      model: 'gpt-5.6-terra',
      tokenUsage: { input: 100, output: 50, costUsd: 0.42, costSource: 'provider' },
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const costMetric = findMetric(metricExporter, 'conductor.step.cost')!;
    const point = costMetric.dataPoints.find((dataPoint) => dataPoint.attributes['step'] === 'explore');
    expect(point?.value).toBe(0.42);
    expect(point?.attributes).toMatchObject({
      step: 'explore',
      model: 'gpt-5.6-terra',
      source: 'provider',
    });
  });

  it('records rate-card cost with the rate-card source attribute', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
    await emitter.emit({
      type: 'step_completed',
      step: 'plan',
      status: 'done',
      tokenUsage: { input: 100, output: 50, costUsd: 0.12, costSource: 'rate-card' },
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const costMetric = findMetric(metricExporter, 'conductor.step.cost')!;
    const point = costMetric.dataPoints.find((dataPoint) => dataPoint.attributes['step'] === 'plan');
    expect(point?.attributes['source']).toBe('rate-card');
  });

  it('records an explicit zero-cost observation', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 3 });
    await emitter.emit({
      type: 'step_completed',
      step: 'build',
      status: 'done',
      tokenUsage: { input: 100, output: 50, costUsd: 0, costSource: 'provider' },
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const costMetric = findMetric(metricExporter, 'conductor.step.cost')!;
    const point = costMetric.dataPoints.find((dataPoint) => dataPoint.attributes['step'] === 'build');
    expect(point?.value).toBe(0);
  });
});

// ── Task 19: closeout duration histogram ────────────────────────────────────

describe('Task 19: closeout duration histogram', () => {
  it('records the closeout duration with its obligation attribute', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({
      type: 'pipeline_closeout',
      obligation: 'simplify',
      startedAt: 1_000,
      endedAt: 1_125,
      ts: 1_130,
    });
    await emitter.emit({ type: 'step_completed', step: 'build', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const metric = findMetric(metricExporter, 'conductor.pipeline.closeout.duration')!;
    const point = metric.dataPoints.find(
      (dataPoint) => dataPoint.attributes['obligation'] === 'simplify',
    );
    expect(point?.value).toMatchObject({ count: 1, sum: 125 });
  });
});

describe('Task 3: metric identity attributes', () => {
  it('adds identity without removing each instrument’s existing attributes', async () => {
    const exporter = await recordMetricsWithIdentity({
      project: 'project-a',
      feature: 'feature-a',
    });

    expect({
      duration: findMetric(exporter, 'conductor.step.duration')!.dataPoints.map((point) => point.attributes),
      retries: findMetric(exporter, 'conductor.step.retries')!.dataPoints.map((point) => point.attributes),
      tokens: findMetric(exporter, 'conductor.step.tokens')!.dataPoints.map((point) => point.attributes),
      closeout: findMetric(exporter, 'conductor.pipeline.closeout.duration')!.dataPoints.map((point) => point.attributes),
    }).toEqual({
      duration: [{ step: 'build', project: 'project-a', feature: 'feature-a' }],
      retries: [{ step: 'build', project: 'project-a', feature: 'feature-a' }],
      tokens: [
        { step: 'build', kind: 'input', model: 'test-model', project: 'project-a', feature: 'feature-a' },
        { step: 'build', kind: 'output', model: 'test-model', project: 'project-a', feature: 'feature-a' },
      ],
      closeout: [{ obligation: 'simplify', project: 'project-a', feature: 'feature-a' }],
    });
  });

  it('keeps project identity distinct between recorder instances', async () => {
    const first = await recordMetricsWithIdentity({ project: 'project-a', feature: 'shared-feature' });
    const second = await recordMetricsWithIdentity({ project: 'project-b', feature: 'shared-feature' });

    expect([
      findMetric(first, 'conductor.step.duration')!.dataPoints[0].attributes['project'],
      findMetric(second, 'conductor.step.duration')!.dataPoints[0].attributes['project'],
    ]).toEqual(['project-a', 'project-b']);
  });
});

describe('Task 4: bounded metric identity', () => {
  it('pinning: full-run data points omit the injected run id', async () => {
    const runId = 'run-id-that-must-not-label-metrics';
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir, runId);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({ type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'flaky' });
    await emitter.emit({
      type: 'step_completed',
      step: 'build',
      status: 'done',
      tokenUsage: { input: 100, output: 50 },
    });
    await emitter.emit({
      type: 'pipeline_closeout',
      obligation: 'simplify',
      startedAt: 1_000,
      endedAt: 1_125,
      ts: 1_130,
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const dataPointAttributes = metricExporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics))
      .flatMap((metric) => metric.dataPoints.map((dataPoint) => dataPoint.attributes));

    expect(dataPointAttributes).not.toHaveLength(0);
    expect(dataPointAttributes.every((attributes) => (
      !Object.keys(attributes).some((key) => /run[._-]?id/i.test(key))
      && !Object.values(attributes).includes(runId)
    ))).toBe(true);
  });

  it('pinning: counters aggregate across projects without changing instrument names', async () => {
    const first = await recordMetricsWithIdentity({ project: 'project-a', feature: 'shared-feature' });
    const second = await recordMetricsWithIdentity({ project: 'project-b', feature: 'shared-feature' });
    const retries = (exporter: InMemoryMetricExporter) => (
      findMetric(exporter, 'conductor.step.retries')!.dataPoints[0].value as number
    );

    expect({
      firstInstrumentNames: getMetricNames(first),
      secondInstrumentNames: getMetricNames(second),
      retriesTotal: retries(first) + retries(second),
    }).toEqual({
      firstInstrumentNames: [
        'conductor.step.duration',
        'conductor.step.retries',
        'conductor.step.tokens',
        'conductor.pipeline.closeout.duration',
      ],
      secondInstrumentNames: [
        'conductor.step.duration',
        'conductor.step.retries',
        'conductor.step.tokens',
        'conductor.pipeline.closeout.duration',
      ],
      retriesTotal: 2,
    });
  });
});

// ── Run outcome counter ──────────────────────────────────────────────────────────────

describe('run outcome counter', () => {
  it('records a completed run as outcome=complete', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'build', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const metric = findMetric(metricExporter, 'conductor.run.outcomes');
    expect(metric?.dataPoints).toEqual([
      expect.objectContaining({
        attributes: { outcome: 'complete', project: 'test-project', feature: 'test-feature' },
        value: 1,
      }),
    ]);
  });

  it('records a halted run as outcome=halted', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({ type: 'loop_halt', step: 'build', reason: 'needs human' });
    await vis.stop();

    const metric = findMetric(metricExporter, 'conductor.run.outcomes');
    expect(metric?.dataPoints).toEqual([
      expect.objectContaining({
        attributes: { outcome: 'halted', project: 'test-project', feature: 'test-feature' },
        value: 1,
      }),
    ]);
  });

  it('records an interrupted run as outcome=terminated', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await vis.stop();

    const metric = findMetric(metricExporter, 'conductor.run.outcomes');
    expect(metric?.dataPoints).toEqual([
      expect.objectContaining({
        attributes: { outcome: 'terminated', project: 'test-project', feature: 'test-feature' },
        value: 1,
      }),
    ]);
  });

  it('does not double-count a completed run when a late halt arrives', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({ type: 'feature_complete' });
    await emitter.emit({ type: 'loop_halt', reason: 'late arrival' });
    await vis.stop();

    const metric = findMetric(metricExporter, 'conductor.run.outcomes');
    expect(metric?.dataPoints).toEqual([
      expect.objectContaining({
        attributes: { outcome: 'complete', project: 'test-project', feature: 'test-feature' },
        value: 1,
      }),
    ]);
  });

  it('does not record an outcome when no run span was opened', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    expect(findMetric(metricExporter, 'conductor.run.outcomes')).toBeUndefined();
  });
});
