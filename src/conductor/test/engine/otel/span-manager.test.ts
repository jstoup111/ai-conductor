/**
 * span-manager.test.ts — unit tests for SpanManager via OtelVisualizer.
 *
 * Tests T10–T14 using OtelVisualizer + InMemorySpanExporter (same pattern as
 * the acceptance spec). Covers:
 *   T10: Run span lifecycle (one trace per run)
 *   T11: Step spans — duration & status
 *   T12: Step span negatives — orphan & re-run
 *   T13: Step span attributes (with safe tier omission)
 *   T14: Span events for retries / gate verdicts / kickbacks
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

// ── Shared setup ──────────────────────────────────────────────────────────────

let tempDir: string;
let pipelineDir: string;
let spanExporter: InMemorySpanExporter;
let metricExporter: InMemoryMetricExporter;
let emitter: ConductorEventEmitter;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'otel-spans-'));
  pipelineDir = join(tempDir, '.pipeline');
  spanExporter = new InMemorySpanExporter();
  metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  emitter = new ConductorEventEmitter();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ── T10: Run span lifecycle ───────────────────────────────────────────────────

describe('T10: run span lifecycle — one trace per run', () => {
  it('first event opens exactly one root span', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'feature_complete', featureDesc: 'test' });
    await vis.stop();

    const roots = spanExporter.getFinishedSpans().filter((s) => !s.parentSpanId);
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe('conductor.run');
  });

  it('feature_complete closes the run span with OK status', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'feature_complete', featureDesc: 'test' });
    await vis.stop();

    const roots = spanExporter.getFinishedSpans().filter((s) => !s.parentSpanId);
    expect(roots[0].status.code).toBe(1 /* OK */);
  });

  it('run ending without feature_complete closes run span on flush (forceCloseAll)', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    // No feature_complete — simulate abrupt termination
    await vis.stop();

    const roots = spanExporter.getFinishedSpans().filter((s) => !s.parentSpanId);
    expect(roots).toHaveLength(1); // closed on flush
  });

  it('two early events create only one root span (not duplicated)', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'step-a', index: 0 });
    await emitter.emit({ type: 'step_started', step: 'step-b', index: 1 });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const roots = spanExporter.getFinishedSpans().filter((s) => !s.parentSpanId);
    expect(roots).toHaveLength(1);
  });

  it('all step spans share the root span traceId (one trace per run)', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({ type: 'step_completed', step: 'brainstorm', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const spans = spanExporter.getFinishedSpans();
    const root = spans.find((s) => !s.parentSpanId)!;
    const children = spans.filter((s) => s.parentSpanId);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.spanContext().traceId).toBe(root.spanContext().traceId);
    }
  });
});

// ── T11: Step spans — duration & status ──────────────────────────────────────

describe('T11: step spans — duration and status', () => {
  it('step_started opens a span named for the step', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({ type: 'step_completed', step: 'brainstorm', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const step = spanExporter.getFinishedSpans().find((s) => s.name === 'brainstorm');
    expect(step).toBeDefined();
  });

  it('step_completed closes the step span with OK status', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
    await emitter.emit({ type: 'step_completed', step: 'plan', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const step = spanExporter.getFinishedSpans().find((s) => s.name === 'plan')!;
    expect(step.status.code).toBe(1 /* OK */);
  });

  it('step span has a positive duration (endTime > startTime)', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const step = spanExporter.getFinishedSpans().find((s) => s.name === 'bootstrap')!;
    const durNs = step.duration[0] * 1e9 + step.duration[1];
    expect(durNs).toBeGreaterThan(0);
  });

  it('step_failed closes the step span with ERROR status', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'stories', index: 3 });
    await emitter.emit({
      type: 'step_failed',
      step: 'stories',
      error: 'something went wrong',
      retryCount: 0,
    });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const step = spanExporter.getFinishedSpans().find((s) => s.name === 'stories')!;
    expect(step.status.code).toBe(2 /* ERROR */);
  });

  it('step span is parented to the run span (same traceId, parentSpanId matches)', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const spans = spanExporter.getFinishedSpans();
    const root = spans.find((s) => !s.parentSpanId)!;
    const step = spans.find((s) => s.name === 'bootstrap')!;
    expect(step.parentSpanId).toBe(root.spanContext().spanId);
    expect(step.spanContext().traceId).toBe(root.spanContext().traceId);
  });
});

// ── T12: Step span negatives — orphan & re-run ───────────────────────────────

describe('T12: step span negatives — orphan and re-run', () => {
  it('orphan step_completed (no open span) → no span added + one warning, no throw', async () => {
    const warnings: string[] = [];
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir, (msg) =>
      warnings.push(msg),
    );
    vis.start(emitter);

    // No step_started — orphan completion
    await expect(
      emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' }),
    ).resolves.toBeUndefined();

    await vis.stop();

    // No spans (run span not opened either — first event was orphan step_completed)
    const stepSpans = spanExporter.getFinishedSpans().filter((s) => s.name === 'bootstrap');
    expect(stepSpans).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it('second step_started for the same step creates a distinct new span', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    // Second step_started for the same step (re-run)
    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({ type: 'step_completed', step: 'brainstorm', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    // Two brainstorm spans: the re-run span (closed OK) + original (force-closed)
    const brainstormSpans = spanExporter.getFinishedSpans().filter((s) => s.name === 'brainstorm');
    expect(brainstormSpans.length).toBeGreaterThanOrEqual(2);
  });

  it('orphan step_failed → one warning, no throw', async () => {
    const warnings: string[] = [];
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir, (msg) =>
      warnings.push(msg),
    );
    vis.start(emitter);

    await expect(
      emitter.emit({ type: 'step_failed', step: 'plan', error: 'err', retryCount: 0 }),
    ).resolves.toBeUndefined();

    await vis.stop();
    expect(warnings).toHaveLength(1);
  });
});

// ── T13: Step span attributes ─────────────────────────────────────────────────

describe('T13: step span attributes', () => {
  it('closed step span carries conductor.step, conductor.step.index, conductor.step.status, conductor.retry.count', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({ type: 'step_retry', step: 'brainstorm', attempt: 2, maxAttempts: 3, reason: 'flaky' });
    await emitter.emit({ type: 'step_completed', step: 'brainstorm', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'brainstorm')!;
    expect(span.attributes['conductor.step']).toBe('brainstorm');
    expect(span.attributes['conductor.step.index']).toBe(1);
    expect(span.attributes['conductor.step.status']).toBe('done');
    expect(span.attributes['conductor.retry.count']).toBe(1);
  });

  it('conductor.complexity_tier is OMITTED when unknown (not set to "undefined" or null)', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
    await emitter.emit({ type: 'step_completed', step: 'plan', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'plan')!;
    // Must not be present at all — not the string 'undefined', not null.
    expect(Object.prototype.hasOwnProperty.call(span.attributes, 'conductor.complexity_tier')).toBe(false);
  });

  it('conductor.retry.count is 0 for a step that was never retried', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'bootstrap')!;
    expect(span.attributes['conductor.retry.count']).toBe(0);
  });

  it('step_failed carries conductor.step.status=failed and retryCount from the event', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'stories', index: 3 });
    await emitter.emit({ type: 'step_failed', step: 'stories', error: 'timeout', retryCount: 2 });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'stories')!;
    expect(span.attributes['conductor.step.status']).toBe('failed');
    expect(span.attributes['conductor.retry.count']).toBe(2);
  });
});

// ── T14: Span events — retries / gate verdicts / kickbacks ───────────────────

describe('T14: span events for retries / gate verdicts / kickbacks', () => {
  it('step_retry for the active step adds a span event on the open step span', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({ type: 'step_retry', step: 'brainstorm', attempt: 2, maxAttempts: 3, reason: 'flaky' });
    await emitter.emit({ type: 'step_completed', step: 'brainstorm', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'brainstorm')!;
    const retryEvent = span.events.find((e) => e.name === 'retry');
    expect(retryEvent).toBeDefined();
    expect(retryEvent!.attributes?.['attempt']).toBe(2);
    expect(retryEvent!.attributes?.['reason']).toBe('flaky');
  });

  it('gate_verdict for the active step adds a span event on the step span', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
    await emitter.emit({ type: 'gate_verdict', step: 'plan', satisfied: true, reason: 'all good' });
    await emitter.emit({ type: 'step_completed', step: 'plan', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'plan')!;
    const verdictEvent = span.events.find((e) => e.name === 'gate_verdict');
    expect(verdictEvent).toBeDefined();
    expect(verdictEvent!.attributes?.['satisfied']).toBe(true);
  });

  it('kickback adds a span event on the from-step span when that step is open', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
    await emitter.emit({ type: 'kickback', from: 'plan', to: 'stories', count: 1 });
    await emitter.emit({ type: 'step_completed', step: 'plan', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'plan')!;
    const kickbackEvent = span.events.find((e) => e.name === 'kickback');
    expect(kickbackEvent).toBeDefined();
    expect(kickbackEvent!.attributes?.['from']).toBe('plan');
    expect(kickbackEvent!.attributes?.['to']).toBe('stories');
  });

  it('gate_verdict with no open step span attaches to run span (not thrown, not mis-attributed)', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    // Open a step, complete it (span closed), then receive out-of-band gate_verdict
    await emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
    await emitter.emit({ type: 'step_completed', step: 'plan', status: 'done' });
    // Out-of-band gate_verdict — plan span is already closed
    await expect(
      emitter.emit({ type: 'gate_verdict', step: 'plan', satisfied: false }),
    ).resolves.toBeUndefined(); // must not throw

    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    // The run span should carry the gate_verdict event
    const runSpan = spanExporter.getFinishedSpans().find((s) => !s.parentSpanId)!;
    const verdictEvent = runSpan.events.find((e) => e.name === 'gate_verdict');
    expect(verdictEvent).toBeDefined();
  });

  it('multiple step_retry events accumulate as separate span events', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({ type: 'step_retry', step: 'brainstorm', attempt: 2, maxAttempts: 3, reason: 'flaky' });
    await emitter.emit({ type: 'step_retry', step: 'brainstorm', attempt: 3, maxAttempts: 3, reason: 'timeout' });
    await emitter.emit({ type: 'step_completed', step: 'brainstorm', status: 'done' });
    await emitter.emit({ type: 'feature_complete' });
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'brainstorm')!;
    const retryEvents = span.events.filter((e) => e.name === 'retry');
    expect(retryEvents).toHaveLength(2);
    expect(span.attributes['conductor.retry.count']).toBe(2);
  });
});

// ── T20: Incomplete-span close (unit-level coverage for FR-9) ─────────────────
//
// FR-9 passes at the acceptance level via OtelVisualizer.stop() → forceCloseAll().
// These unit tests confirm the granular contract at the SpanManager level:
// - Single open step at flush → ERROR status + conductor.incomplete=true
// - Multiple open steps → all closed + all have conductor.incomplete=true
// - Run span closed even when a child step is open (run span always ends OK)

describe('T20: incomplete-span close (FR-9 unit coverage)', () => {
  it('step open at flush is closed with ERROR status and conductor.incomplete=true', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    // No step_completed / feature_complete — simulate abrupt stop
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'brainstorm')!;
    expect(span).toBeDefined();
    expect(span.status.code).toBe(2 /* ERROR */);
    expect(span.attributes['conductor.incomplete']).toBe(true);
  });

  it('multiple open steps at flush are all closed with conductor.incomplete=true', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
    await emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
    // All three left open — forceCloseAll must handle all
    await vis.stop();

    const spans = spanExporter.getFinishedSpans().filter((s) => s.parentSpanId);
    const names = spans.map((s) => s.name).sort();
    expect(names).toEqual(['bootstrap', 'brainstorm', 'plan'].sort());
    for (const s of spans) {
      expect(s.status.code).toBe(2 /* ERROR */);
      expect(s.attributes['conductor.incomplete']).toBe(true);
    }
  });

  it('run span is closed even when a child step is still open at flush', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
    // plan is open; no feature_complete
    await vis.stop();

    const spans = spanExporter.getFinishedSpans();
    const rootSpan = spans.find((s) => !s.parentSpanId);
    expect(rootSpan).toBeDefined(); // run span must be closed
    expect(rootSpan!.name).toBe('conductor.run');

    const planSpan = spans.find((s) => s.name === 'plan');
    expect(planSpan).toBeDefined();
    expect(planSpan!.attributes['conductor.incomplete']).toBe(true);
  });

  it('incomplete step has conductor.step.status=incomplete attribute', async () => {
    const vis = makeVisualizer(spanExporter, metricExporter, pipelineDir);
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'stories', index: 3 });
    await vis.stop();

    const span = spanExporter.getFinishedSpans().find((s) => s.name === 'stories')!;
    expect(span.attributes['conductor.step.status']).toBe('incomplete');
  });
});
