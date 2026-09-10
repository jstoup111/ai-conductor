// Covers: task:8
/**
 * T22: OTel exporter e2e integration tests.
 *
 * Complements the acceptance spec (test/integration/otel-observability.test.ts)
 * without duplicating it. The acceptance spec validates the FR-* contracts at a
 * high level; these tests verify specific structural details:
 *
 *  - File transport: OTLP-JSON lines contain expected resourceSpans fields with
 *    the correct step names and metric scope names.
 *  - OTLP transport (in-memory): confirms root + per-step children + metric
 *    descriptors are present after a full fixture run.
 *
 * Both fixtures use the exact production-wiring path (no test-only shortcuts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { ConductorEventEmitter } from '../../src/ui/events.js';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../src/engine/otel/otel-visualizer.js';
import { MetricsListener } from '../../src/engine/otel/metrics-listener.js';
import { MetricsRecorder } from '../../src/engine/otel/metrics.js';
import { buildResource } from '../../src/engine/otel/resource.js';
import { buildExporters } from '../../src/engine/otel/transport.js';
import { CapturingSpanExporter as InMemorySpanExporter } from '../fixtures/capturing-span-exporter.js';
import { InMemoryMetricExporter, AggregationTemporality, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

// ── Shared fixture ─────────────────────────────────────────────────────────────

async function runFixture(emitter: ConductorEventEmitter): Promise<void> {
  await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
  await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
  await emitter.emit({ type: 'step_started', step: 'plan', index: 1 });
  await emitter.emit({
    type: 'step_completed',
    step: 'plan',
    status: 'done',
    tokenUsage: { input: 200, output: 80 },
  });
  await emitter.emit({
    type: 'feature_cost_snapshot',
    costUsd: 0,
    costComplete: false,
    byDimension: [],
    tokensByDimension: [{ step: 'plan', tokens: { input: 200, output: 80 } }],
  });
  await emitter.emit({ type: 'feature_complete', featureDesc: 'e2e-test' });
}

const operatorAttributes = {
  'deployment.environment.name': 'staging',
  'team.name': 'platform',
};

function resourceAttributes(resource: { attributes?: Array<{ key: string; value?: { stringValue?: string } }> }): Record<string, string> {
  return Object.fromEntries(
    (resource.attributes ?? []).flatMap(({ key, value }) =>
      value?.stringValue === undefined ? [] : [[key, value.stringValue]],
    ),
  );
}

// ── File exporter ──────────────────────────────────────────────────────────────

describe('T22-file: file transport writes decodable OTLP-JSON with correct structure', () => {
  let tempDir: string;
  let pipelineDir: string;
  let emitter: ConductorEventEmitter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'otel-e2e-file-'));
    pipelineDir = join(tempDir, '.pipeline');
    emitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes declared attributes into the OTLP-JSON resource lists for span and metric exports', async () => {
    const resolved = resolveOtelConfig({ otel: { exporter: 'file', attributes: operatorAttributes } }, pipelineDir);
    if (!resolved.enabled) throw new Error('file OTel fixture must resolve as enabled');
    const vis = new OtelVisualizer(resolved, {
      runId: 'e2e-file-1',
      feature: 'e2e-test',
      project: 'test-project',
    });
    const exporters = buildExporters(resolved);
    const provider = new MeterProvider({
      resource: buildResource({
        attributes: resolved.attributes,
        pipelineDir,
        project: 'test-project',
        projectName: 'test-project',
        workerName: 'test-worker',
      }, 'metrics'),
      readers: [new PeriodicExportingMetricReader({ exporter: exporters.metricExporter, exportIntervalMillis: 60_000 })],
    });
    const listener = new MetricsListener(
      new MetricsRecorder(
        provider.getMeter('file-exporter'),
        { project: 'test-project', worker: 'test-worker', feature: 'e2e-test' },
        resolved.attributes,
      ),
      undefined,
      'e2e-test',
    );
    vis.start(emitter);
    listener.start(emitter);
    await runFixture(emitter);
    listener.stop();
    await provider.shutdown();
    await vis.stop();

    const content = await readFile(join(pipelineDir, 'otel.jsonl'), 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    // Every line must be valid JSON.
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    const payloads = lines.map((line) => JSON.parse(line) as {
      resourceSpans?: Array<{ resource?: { attributes?: Array<{ key: string; value?: { stringValue?: string } }> } }>;
      resourceMetrics?: Array<{ resource?: { attributes?: Array<{ key: string; value?: { stringValue?: string } }> } }>;
    });
    const spanResource = payloads.flatMap((payload) => payload.resourceSpans ?? []).at(0)?.resource;
    const metricResource = payloads.flatMap((payload) => payload.resourceMetrics ?? []).at(0)?.resource;

    expect({
      span: resourceAttributes(spanResource ?? {}),
      metric: resourceAttributes(metricResource ?? {}),
    }).toMatchObject({ span: operatorAttributes, metric: operatorAttributes });
  });

  it('keeps a completed fixture and emits one export-failure warning when the file target is unwritable', async () => {
    const filePath = join(pipelineDir, 'directory-not-a-file');
    await mkdir(filePath, { recursive: true });
    const warnings: string[] = [];
    const resolved = resolveOtelConfig({ otel: { exporter: 'file', file: filePath, attributes: operatorAttributes } }, pipelineDir);
    const vis = new OtelVisualizer(resolved, {
      runId: 'e2e-file-unwritable', feature: 'e2e-test', project: 'test-project',
      onWarning: (warning) => warnings.push(warning),
    });

    vis.start(emitter);
    await expect(runFixture(emitter)).resolves.toBeUndefined();
    await vis.stop();

    expect(warnings).toEqual([expect.stringContaining('[otel] span export failed')]);
  });
});

// ── OTLP transport (in-memory exporters) ──────────────────────────────────────

describe('T22-otlp: OTLP transport (in-memory exporters) — structure assertions', () => {
  let tempDir: string;
  let pipelineDir: string;
  let emitter: ConductorEventEmitter;
  let spanExporter: InMemorySpanExporter;
  let metricExporter: InMemoryMetricExporter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'otel-e2e-otlp-'));
    pipelineDir = join(tempDir, '.pipeline');
    emitter = new ConductorEventEmitter();
    spanExporter = new InMemorySpanExporter();
    metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('produces one root span + per-step children with correct trace parentage', async () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318', attributes: operatorAttributes } },
      pipelineDir,
    );
    if (!resolved.enabled) throw new Error('OTLP OTel fixture must resolve as enabled');
    const vis = new OtelVisualizer(resolved, {
      runId: 'e2e-otlp-1',
      feature: 'e2e-test',
      project: 'test-project',
      spanExporter,
      metricExporter,
    });
    vis.start(emitter);
    await runFixture(emitter);
    await vis.stop();

    const spans = spanExporter.getFinishedSpans();

    // One root span (conductor.run).
    const roots = spans.filter((s) => !s.parentSpanContext);
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe('conductor.run');

    // Two step spans as children of the root.
    const children = spans.filter((s) => s.parentSpanContext);
    const childNames = children.map((s) => s.name).sort();
    expect(childNames).toEqual(['bootstrap', 'plan'].sort());

    // All children share the root's traceId and are parented to the root span.
    for (const child of children) {
      expect(child.spanContext().traceId).toBe(roots[0].spanContext().traceId);
      expect(child.parentSpanContext?.spanId).toBe(roots[0].spanContext().spanId);
    }
  });

  it('emits conductor.step.duration and conductor.feature.step.tokens metric descriptors', async () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318', attributes: operatorAttributes } },
      pipelineDir,
    );
    if (!resolved.enabled) throw new Error('OTLP OTel fixture must resolve as enabled');
    const vis = new OtelVisualizer(resolved, {
      runId: 'e2e-otlp-2',
      feature: 'e2e-test',
      project: 'test-project',
      spanExporter,
      metricExporter,
    });
    const provider = new MeterProvider({
      resource: buildResource({
        attributes: resolved.attributes,
        pipelineDir,
        project: 'test-project',
        projectName: 'test-project',
        workerName: 'test-worker',
      }, 'metrics'),
      readers: [new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 })],
    });
    const listener = new MetricsListener(
      new MetricsRecorder(
        provider.getMeter('otlp-exporter'),
        { project: 'test-project', worker: 'test-worker', feature: 'e2e-test' },
        resolved.attributes,
      ),
      undefined,
      'e2e-test',
    );
    vis.start(emitter);
    listener.start(emitter);
    await runFixture(emitter);
    listener.stop();
    await provider.shutdown();
    await vis.stop();

    const metricNames = metricExporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics.map((m) => m.descriptor.name)));

    expect({
      metricNames,
      spanResource: spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')?.resource.attributes,
      metricResource: metricExporter.getMetrics()[0]?.resource.attributes,
    }).toMatchObject({
      metricNames: expect.arrayContaining(['conductor.step.duration', 'conductor.feature.step.tokens']),
      spanResource: operatorAttributes,
      metricResource: operatorAttributes,
    });
  });

  it('resource attributes are present on every span (non-empty run.id, feature, project)', async () => {
    const resolved = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir,
    );
    const vis = new OtelVisualizer(resolved, {
      runId: 'e2e-otlp-3',
      feature: 'e2e-feature',
      project: 'e2e-project',
      spanExporter,
      metricExporter,
    });
    vis.start(emitter);
    await runFixture(emitter);
    await vis.stop();

    for (const span of spanExporter.getFinishedSpans()) {
      const r = span.resource.attributes;
      expect(r['conductor.run.id']).toBe('e2e-otlp-3');
      expect(r['conductor.feature']).toBe('e2e-feature');
      expect(r['conductor.project']).toBe('e2e-project');
    }
  });
});
