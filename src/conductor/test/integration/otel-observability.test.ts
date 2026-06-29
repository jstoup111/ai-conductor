/**
 * Acceptance specs (RED) — OTel Observability Phase 1.
 *
 * These are the OUTER end-to-end gate the pipeline drives 22 tasks to satisfy
 * (.docs/plans/2026-06-28-otel-observability.md). They assert the PRD acceptance
 * criteria (FR-1…FR-10) against the REAL `ConductorEventEmitter`, with the OTel
 * exporter attached exactly as production wires it (a bus listener packaged as a
 * `visualizer` plugin, per ADR-014).
 *
 * Expected to FAIL now: the modules under `src/engine/otel/` and the
 * `@opentelemetry/*` deps do not exist yet. Module-not-found is correct RED
 * (infrastructure absent) — granular unit tests are added per-task during build.
 *
 * NO HTTP / NO UI here by design — the exporter is internal; the "view" lives in
 * the external OTLP backend, which is out of scope (PRD non-goals).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';

// ── Modules under construction (do not exist yet → RED) ──────────────────────
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../src/engine/otel/otel-visualizer.js';
// In-memory OTel exporters (deps added in Task 1 → RED until then)
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { InMemoryMetricExporter, AggregationTemporality } from '@opentelemetry/sdk-metrics';

/**
 * A representative SDLC run: 3 steps, one with a retry, one carrying tokenUsage,
 * one without. Mirrors the event shapes in src/types/events.ts.
 */
async function emitRepresentativeRun(emitter: ConductorEventEmitter): Promise<void> {
  await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
  await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });

  await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
  await emitter.emit({
    type: 'step_retry',
    step: 'brainstorm',
    attempt: 2,
    maxAttempts: 3,
    reason: 'flaky',
  });
  await emitter.emit({
    type: 'step_completed',
    step: 'brainstorm',
    status: 'done',
    tokenUsage: { input: 100, output: 50 }, // partial kinds (no cache) — FR-5
  });

  await emitter.emit({ type: 'step_started', step: 'plan', index: 2 });
  // no tokenUsage on this one — token rows must be skipped (FR-5 negative)
  await emitter.emit({ type: 'step_completed', step: 'plan', status: 'done' });

  await emitter.emit({ type: 'feature_complete', featureDesc: 'otel-phase-1' });
}

/** Flatten every finished span from an in-memory exporter. */
function allSpans(exporter: InMemorySpanExporter) {
  return exporter.getFinishedSpans();
}

describe('OTel Observability — Phase 1 acceptance', () => {
  let tempDir: string;
  let pipelineDir: string;
  let emitter: ConductorEventEmitter;
  let spanExporter: InMemorySpanExporter;
  let metricExporter: InMemoryMetricExporter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'otel-accept-'));
    pipelineDir = join(tempDir, '.pipeline');
    emitter = new ConductorEventEmitter();
    spanExporter = new InMemorySpanExporter();
    metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Build the production-shaped visualizer with in-memory exporters injected. */
  function startVisualizer(overrides: Record<string, unknown> = {}): OtelVisualizer {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir,
    );
    const vis = new OtelVisualizer(resolved, {
      runId: 'run-fixed-1',
      feature: 'otel-phase-1',
      project: 'james-stoup-agents',
      spanExporter,
      metricExporter,
      ...overrides,
    });
    vis.start(emitter);
    return vis;
  }

  // ── FR-2 / FR-3 / FR-4: trace shape ────────────────────────────────────────
  describe('Story: one trace per run with per-step spans (FR-2/3/4)', () => {
    it('produces one root run span with one child span per executed step', async () => {
      const vis = startVisualizer();
      await emitRepresentativeRun(emitter);
      await vis.stop();

      const spans = allSpans(spanExporter);
      const roots = spans.filter((s) => !s.parentSpanId);
      expect(roots).toHaveLength(1); // single root run span (FR-2)

      const stepSpans = spans.filter((s) => s.parentSpanId);
      expect(stepSpans.map((s) => s.name).sort()).toEqual(
        ['bootstrap', 'brainstorm', 'plan'].sort(),
      );
      // all step spans share the root's trace id (one trace per run)
      for (const s of stepSpans) {
        expect(s.spanContext().traceId).toBe(roots[0].spanContext().traceId);
        expect(s.parentSpanId).toBe(roots[0].spanContext().spanId);
      }
    });

    it('each step span has a positive duration and OK status', async () => {
      const vis = startVisualizer();
      await emitRepresentativeRun(emitter);
      await vis.stop();

      for (const s of allSpans(spanExporter).filter((x) => x.parentSpanId)) {
        const durNs = s.duration[0] * 1e9 + s.duration[1];
        expect(durNs).toBeGreaterThan(0);
        expect(s.status.code).not.toBe(2 /* ERROR */);
      }
    });

    it('step spans carry conductor.* attributes; retry recorded as a span event (FR-4)', async () => {
      const vis = startVisualizer();
      await emitRepresentativeRun(emitter);
      await vis.stop();

      const brainstorm = allSpans(spanExporter).find((s) => s.name === 'brainstorm')!;
      expect(brainstorm.attributes['conductor.step']).toBe('brainstorm');
      expect(brainstorm.attributes['conductor.step.index']).toBe(1);
      expect(brainstorm.attributes['conductor.step.status']).toBe('done');
      // the step_retry for brainstorm becomes a span event on its open span
      expect(brainstorm.events.some((e) => e.name.includes('retry'))).toBe(true);
    });
  });

  // ── FR-5: metrics ──────────────────────────────────────────────────────────
  describe('Story: duration/retry/token metrics (FR-5)', () => {
    it('emits a step.duration histogram and a retries counter; tokens only when present', async () => {
      const vis = startVisualizer();
      await emitRepresentativeRun(emitter);
      await vis.stop();
      await metricExporter.forceFlush?.();

      const names = metricExporter
        .getMetrics()
        .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics.map((m) => m.descriptor.name)));

      expect(names).toContain('conductor.step.duration');
      expect(names).toContain('conductor.step.retries');
      expect(names).toContain('conductor.step.tokens');

      // token data points exist only for the step that carried tokenUsage (brainstorm),
      // never for 'plan' (no tokenUsage) — no zero-fill / NaN points.
      const tokenMetric = metricExporter
        .getMetrics()
        .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics))
        .find((m) => m.descriptor.name === 'conductor.step.tokens')!;
      const steps = tokenMetric.dataPoints.map((d) => d.attributes['step']);
      expect(steps).toContain('brainstorm');
      expect(steps).not.toContain('plan');
    });
  });

  // ── FR-6: resource / run correlation ────────────────────────────────────────
  describe('Story: resource attributes identify the run (FR-6)', () => {
    it('every span carries non-empty run/feature/project resource attributes', async () => {
      const vis = startVisualizer();
      await emitRepresentativeRun(emitter);
      await vis.stop();

      for (const s of allSpans(spanExporter)) {
        const r = s.resource.attributes;
        expect(r['conductor.run.id']).toBe('run-fixed-1');
        expect(r['conductor.feature']).toBeTruthy();
        expect(r['conductor.project']).toBeTruthy();
        expect(r['service.name']).toBeTruthy();
      }
    });
  });

  // ── FR-7: file transport writes a decodable OTLP-JSON file ──────────────────
  describe('Story: file transport (FR-7)', () => {
    it('writes a non-empty decodable .pipeline/otel.jsonl when exporter=file', async () => {
      const resolved = resolveOtelConfig({ otel: { exporter: 'file' } }, pipelineDir);
      const vis = new OtelVisualizer(resolved, {
        runId: 'run-fixed-2',
        feature: 'otel-phase-1',
        project: 'james-stoup-agents',
      });
      vis.start(emitter);
      await emitRepresentativeRun(emitter);
      await vis.stop();

      const content = await readFile(join(pipelineDir, 'otel.jsonl'), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });

  // ── FR-8: failures never break the run ──────────────────────────────────────
  describe('Story: exporter failure isolation (FR-8)', () => {
    it('an unreachable OTLP endpoint leaves the run unaffected with exactly one warning', async () => {
      const warnings: string[] = [];
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://127.0.0.1:1/v1/traces' } }, // refused
        pipelineDir,
      );
      const vis = new OtelVisualizer(resolved, {
        runId: 'run-fixed-3',
        feature: 'otel-phase-1',
        project: 'james-stoup-agents',
        onWarning: (m: string) => warnings.push(m),
      });
      vis.start(emitter);

      // The run (event emission) must complete without throwing.
      await expect(emitRepresentativeRun(emitter)).resolves.toBeUndefined();
      await expect(vis.stop()).resolves.toBeUndefined();

      expect(warnings.length).toBe(1); // bounded — not one-per-event
    });
  });

  // ── FR-9: incomplete spans are closed, not dropped ──────────────────────────
  describe('Story: incomplete span on interruption (FR-9)', () => {
    it('a step left open at flush is closed ERROR with conductor.incomplete=true', async () => {
      const vis = startVisualizer();
      await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
      await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
      // interrupted mid-step: 'brainstorm' starts but never completes
      await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
      // no feature_complete — simulate process teardown via stop()/flush
      await vis.stop();

      const brainstorm = allSpans(spanExporter).find((s) => s.name === 'brainstorm')!;
      expect(brainstorm).toBeDefined(); // not dropped
      expect(brainstorm.status.code).toBe(2 /* ERROR */);
      expect(brainstorm.attributes['conductor.incomplete']).toBe(true);
    });
  });

  // ── FR-1: no-op when disabled (regression; real call site, real input) ──────
  describe('Story: disabled is a true no-op (FR-1)', () => {
    it('absent otel config constructs no exporter and leaves events.jsonl byte-identical', async () => {
      // Baseline: only EventPersister attached, no otel.
      const baseDir = await mkdtemp(join(tmpdir(), 'otel-baseline-'));
      const basePath = join(baseDir, 'events.jsonl');
      const baseEmitter = new ConductorEventEmitter();
      const basePersister = new EventPersister(basePath, baseEmitter);
      basePersister.start();
      await emitRepresentativeRun(baseEmitter);
      basePersister.stop();
      const baseline = await readFile(basePath, 'utf-8');

      // With-otel-disabled: resolve disabled config; wiring must construct nothing.
      const resolved = resolveOtelConfig({ /* no otel key */ }, pipelineDir);
      expect(resolved.enabled).toBe(false);

      const eventsPath = join(pipelineDir, 'events.jsonl');
      const persister = new EventPersister(eventsPath, emitter);
      persister.start();
      await emitRepresentativeRun(emitter);
      persister.stop();
      const withDisabled = await readFile(eventsPath, 'utf-8');

      // ts fields differ; compare structure line-for-line minus ts.
      const strip = (s: string) =>
        s
          .trim()
          .split('\n')
          .map((l) => {
            const o = JSON.parse(l);
            delete o.ts;
            return JSON.stringify(o);
          });
      expect(strip(withDisabled)).toEqual(strip(baseline));

      await rm(baseDir, { recursive: true, force: true });
    });
  });
});
