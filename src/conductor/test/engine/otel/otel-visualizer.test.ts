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
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { resolveOtelConfig } from '../../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../../src/engine/otel/otel-visualizer.js';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { InMemoryMetricExporter, AggregationTemporality } from '@opentelemetry/sdk-metrics';

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
    const roots = t21SpanExporter.getFinishedSpans().filter((s) => !s.parentSpanId);
    expect(roots).toHaveLength(1);
  });

  it('SIGINT triggers stop() and spans are flushed', async () => {
    const vis = makeVis();
    vis.start(t21Emitter);
    await t21Emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await t21Emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await t21Emitter.emit({ type: 'feature_complete', featureDesc: 'test' });

    // Simulate SIGINT — triggers the registered handler.
    process.emit('SIGINT');

    // Wait for the flush to complete by awaiting stop() directly.
    // stop() is idempotent: calling it again after SIGINT triggered it returns
    // the same promise that is already resolving.
    await vis.stop();

    expect(t21SpanExporter.getFinishedSpans().length).toBeGreaterThan(0);
  });

  it('SIGTERM triggers stop() and spans are flushed', async () => {
    const vis = makeVis();
    vis.start(t21Emitter);
    await t21Emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
    await t21Emitter.emit({ type: 'step_completed', step: 'plan', status: 'done' });
    await t21Emitter.emit({ type: 'feature_complete', featureDesc: 'test' });

    process.emit('SIGTERM');
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
