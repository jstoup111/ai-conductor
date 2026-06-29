/**
 * metrics.test.ts — unit tests for MetricsRecorder via OtelVisualizer.
 *
 * Tests T15–T16 using OtelVisualizer + InMemoryMetricExporter:
 *   T15: Duration histogram and retries counter
 *   T16: Token metrics — skip when absent, record only present kinds
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { resolveOtelConfig } from '../../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../../src/engine/otel/otel-visualizer.js';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { InMemoryMetricExporter, AggregationTemporality } from '@opentelemetry/sdk-metrics';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeVisualizer(
  spanExporter: InMemorySpanExporter,
  metricExporter: InMemoryMetricExporter,
  pipelineDir: string,
): OtelVisualizer {
  const resolved = resolveOtelConfig(
    { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
    pipelineDir,
  );
  return new OtelVisualizer(resolved, {
    runId: `test-${Date.now()}`,
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
    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({ type: 'step_completed', step: 'brainstorm', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const durationMetric = findMetric(metricExporter, 'conductor.step.duration')!;
    const stepNames = durationMetric.dataPoints.map((d) => d.attributes['step']);
    expect(stepNames).toContain('bootstrap');
    expect(stepNames).toContain('brainstorm');
  });

  it('conductor.step.retries counter is incremented by N for N retries', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({ type: 'step_retry', step: 'brainstorm', attempt: 2, maxAttempts: 3, reason: 'flaky' });
    await emitter.emit({ type: 'step_completed', step: 'brainstorm', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const names = getMetricNames(metricExporter);
    expect(names).toContain('conductor.step.retries');

    const retriesMetric = findMetric(metricExporter, 'conductor.step.retries')!;
    const brainstormRetries = retriesMetric.dataPoints.find(
      (d) => d.attributes['step'] === 'brainstorm',
    );
    expect(brainstormRetries).toBeDefined();
    // 1 retry → counter incremented by 1
    expect((brainstormRetries as any).value).toBe(1);
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

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({ type: 'step_retry', step: 'brainstorm', attempt: 2, maxAttempts: 3, reason: 'flaky' });
    await emitter.emit({ type: 'step_retry', step: 'brainstorm', attempt: 3, maxAttempts: 3, reason: 'timeout' });
    await emitter.emit({ type: 'step_completed', step: 'brainstorm', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const retriesMetric = findMetric(metricExporter, 'conductor.step.retries')!;
    const brainstormRetries = retriesMetric.dataPoints.find(
      (d) => d.attributes['step'] === 'brainstorm',
    );
    expect((brainstormRetries as any).value).toBe(2);
  });
});

// ── T16: Token metrics — skip absent, record only present kinds ───────────────

describe('T16: token metrics — skip-absent, partial kinds', () => {
  it('conductor.step.tokens counter is recorded when tokenUsage is present', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'brainstorm',
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

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'brainstorm',
      status: 'done',
      tokenUsage: { input: 100, output: 50 },
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const tokenMetric = findMetric(metricExporter, 'conductor.step.tokens')!;
    const steps = tokenMetric.dataPoints.map((d) => d.attributes['step']);
    expect(steps).toContain('brainstorm');
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

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'brainstorm',
      status: 'done',
      tokenUsage: { input: 100, output: 50 }, // no cacheRead or cacheCreation
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const tokenMetric = findMetric(metricExporter, 'conductor.step.tokens')!;
    const brainstormPoints = tokenMetric.dataPoints.filter(
      (d) => d.attributes['step'] === 'brainstorm',
    );
    const kinds = brainstormPoints.map((d) => d.attributes['kind']);
    // Only 'input' and 'output' present — NOT 'cacheRead' or 'cacheCreation'
    expect(kinds).toContain('input');
    expect(kinds).toContain('output');
    expect(kinds).not.toContain('cacheRead');
    expect(kinds).not.toContain('cacheCreation');
  });

  it('full tokenUsage (all four kinds) → all four kinds recorded', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'brainstorm',
      status: 'done',
      tokenUsage: { input: 100, output: 50, cacheRead: 20, cacheCreation: 5 },
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const tokenMetric = findMetric(metricExporter, 'conductor.step.tokens')!;
    const brainstormPoints = tokenMetric.dataPoints.filter(
      (d) => d.attributes['step'] === 'brainstorm',
    );
    const kinds = brainstormPoints.map((d) => d.attributes['kind']);
    expect(kinds).toContain('input');
    expect(kinds).toContain('output');
    expect(kinds).toContain('cacheRead');
    expect(kinds).toContain('cacheCreation');
  });

  it('mix: one step with tokenUsage, one without → only the token step has data points', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'brainstorm',
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
    expect(steps).toContain('brainstorm');
    expect(steps).not.toContain('plan'); // no tokenUsage → no data point
  });

  it('token counter values match the actual token counts', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'brainstorm',
      status: 'done',
      tokenUsage: { input: 123, output: 456 },
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const tokenMetric = findMetric(metricExporter, 'conductor.step.tokens')!;
    const inputPoint = tokenMetric.dataPoints.find(
      (d) => d.attributes['step'] === 'brainstorm' && d.attributes['kind'] === 'input',
    ) as any;
    const outputPoint = tokenMetric.dataPoints.find(
      (d) => d.attributes['step'] === 'brainstorm' && d.attributes['kind'] === 'output',
    ) as any;
    expect(inputPoint?.value).toBe(123);
    expect(outputPoint?.value).toBe(456);
  });
});
