/**
 * otel-progress.test.ts — Task 15: OTel mapping for the three intra-step
 * build-progress event kinds (build_progress / build_no_progress /
 * build_stall), per adr-2026-07-10-intra-step-build-progress-events.
 *
 * With the OTel visualizer started, emitting each of the three kinds must
 * record a span event on the active build-step span (or the run span when
 * no step span is open), carrying resolved/total/reason attributes as
 * appropriate to the kind.
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

function makeVisualizer(
  spanExporter: InMemorySpanExporter,
  metricExporter: InMemoryMetricExporter,
  pipelineDir: string,
  onWarning?: (msg: string) => void,
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
    onWarning,
  });
}

let tempDir: string;
let pipelineDir: string;
let spanExporter: InMemorySpanExporter;
let metricExporter: InMemoryMetricExporter;
let emitter: ConductorEventEmitter;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'otel-progress-'));
  pipelineDir = join(tempDir, '.pipeline');
  spanExporter = new InMemorySpanExporter();
  metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  emitter = new ConductorEventEmitter();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('Task 15: OTel maps the three build-progress event kinds', () => {
  it('build_progress records a span event on the active build-step span with resolved/total attributes', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 4 });
    await emitter.emit({
      type: 'build_progress',
      step: 'build',
      resolved: 3,
      total: 10,
      currentTaskId: 'T4',
    });
    await emitter.emit({ type: 'step_completed', step: 'build', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'build')!;
    expect(span).toBeDefined();
    const progressEvent = span.events.find((e) => e.name === 'build_progress');
    expect(progressEvent).toBeDefined();
    expect(progressEvent!.attributes?.['resolved']).toBe(3);
    expect(progressEvent!.attributes?.['total']).toBe(10);
    expect(progressEvent!.attributes?.['currentTaskId']).toBe('T4');
  });

  it('build_no_progress records a span event with resolved/total/quietMinutes attributes', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 4 });
    await emitter.emit({
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 15,
      resolved: 3,
      total: 10,
    });
    await emitter.emit({ type: 'step_completed', step: 'build', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'build')!;
    const noProgressEvent = span.events.find((e) => e.name === 'build_no_progress');
    expect(noProgressEvent).toBeDefined();
    expect(noProgressEvent!.attributes?.['resolved']).toBe(3);
    expect(noProgressEvent!.attributes?.['total']).toBe(10);
    expect(noProgressEvent!.attributes?.['quietMinutes']).toBe(15);
  });

  it('build_stall records a span event with a reason attribute', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 4 });
    await emitter.emit({
      type: 'build_stall',
      step: 'build',
      reason: 'no_task_progress',
      resolvedBefore: 3,
      resolvedAfter: 3,
    });
    await emitter.emit({ type: 'step_completed', step: 'build', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'build')!;
    const stallEvent = span.events.find((e) => e.name === 'build_stall');
    expect(stallEvent).toBeDefined();
    expect(stallEvent!.attributes?.['reason']).toBe('no_task_progress');
    expect(stallEvent!.attributes?.['resolvedBefore']).toBe(3);
    expect(stallEvent!.attributes?.['resolvedAfter']).toBe(3);
  });

  it('build_progress with no open step span attaches to the run span (not thrown)', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await expect(
      emitter.emit({ type: 'build_progress', step: 'build', resolved: 1, total: 5 }),
    ).resolves.toBeUndefined();

    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const runSpan = spanExporter.getFinishedSpans().find((s) => !s.parentSpanId)!;
    const progressEvent = runSpan.events.find((e) => e.name === 'build_progress');
    expect(progressEvent).toBeDefined();
  });
});

describe('Task 16: OTel negative paths for build-progress events', () => {
  it('OTel disabled: no visualizer subscribes, so build-progress events emit with no throw and no export', async () => {
    // Simulate the production FR-1 gate: resolveOtelConfig({}) is disabled, so no
    // OtelVisualizer is ever constructed and start() is never called — the
    // emitter has zero listeners for these event types.
    const resolved = resolveOtelConfig({}, pipelineDir);
    expect(resolved.enabled).toBe(false);

    // No vis.start(emitter) call here — mirrors the production no-op gate.
    await expect(
      emitter.emit({ type: 'step_started', step: 'build', index: 4 }),
    ).resolves.toBeUndefined();
    await expect(
      emitter.emit({ type: 'build_progress', step: 'build', resolved: 1, total: 5 }),
    ).resolves.toBeUndefined();
    await expect(
      emitter.emit({
        type: 'build_no_progress',
        step: 'build',
        quietMinutes: 15,
        resolved: 1,
        total: 5,
      }),
    ).resolves.toBeUndefined();
    await expect(
      emitter.emit({
        type: 'build_stall',
        step: 'build',
        reason: 'no_task_progress',
        resolvedBefore: 1,
        resolvedAfter: 1,
      }),
    ).resolves.toBeUndefined();

    // No exporter ever received spans/metrics since nothing subscribed.
    expect(spanExporter.getFinishedSpans()).toHaveLength(0);
  });

  it('build_no_progress with no active step or run span (before any step_started) no-ops synchronously without throwing', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    // No step_started has fired yet, but ensureRunSpan() lazily opens a run
    // span on first build-progress event — so this exercises the "attach to
    // run span" fallback, not a true no-span case, and must never throw or block.
    const start = Date.now();
    await expect(
      emitter.emit({
        type: 'build_no_progress',
        step: 'build',
        quietMinutes: 15,
        resolved: 1,
        total: 5,
      }),
    ).resolves.toBeUndefined();
    expect(Date.now() - start).toBeLessThan(50);

    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();
  });

  it('build_stall with no active step or run span no-ops synchronously without throwing', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    const start = Date.now();
    await expect(
      emitter.emit({
        type: 'build_stall',
        step: 'build',
        reason: 'no_task_progress',
        resolvedBefore: 1,
        resolvedAfter: 1,
      }),
    ).resolves.toBeUndefined();
    expect(Date.now() - start).toBeLessThan(50);

    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();
  });

  it('step_retry for an unopened step no-ops synchronously (no state, no throw)', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    // No step_started fired for 'build' — SpanManager.onStepRetry has no
    // tracked state and must silently drop the event (no warn, no throw).
    await expect(
      emitter.emit({
        type: 'step_retry',
        step: 'build',
        attempt: 1,
        maxAttempts: 3,
        reason: 'flaky',
      }),
    ).resolves.toBeUndefined();

    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    // No spans at all should have been created (no step ever started).
    expect(spanExporter.getFinishedSpans()).toHaveLength(0);
  });
});
