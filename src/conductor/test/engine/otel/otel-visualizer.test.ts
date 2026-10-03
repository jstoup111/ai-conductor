// Covers: task:6, task:8, task:10
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { otelTracedEventTypes } from '../../../src/engine/event-sinks.js';
import { resolveOtelConfig } from '../../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../../src/engine/otel/otel-visualizer.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
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

  it('exports a closed step with its source ref before the root span closes', async () => {
    const visualizer = makeVisualizer();
    visualizer.start(emitter, {
      runId: 'run-1', feature: 'feature', project: 'project', sourceRef: 'jstoup111/ai-conductor#2000',
    });

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'build', status: 'done' });
    await (visualizer as unknown as { tracerProvider: { forceFlush: () => Promise<void> } }).tracerProvider.forceFlush();

    const exported = spanExporter.getFinishedSpans();
    expect(exported.find((span) => span.name === 'build')?.resource.attributes['conductor.source.ref'])
      .toBe('jstoup111/ai-conductor#2000');
    expect(exported.some((span) => span.name === 'conductor.run')).toBe(false);

    await visualizer.stop();
  });

  it('projects terminal and rebase provenance through the visualizer while preserving complete events', async () => {
    const eventsPath = join(pipelineDir, 'events.jsonl');
    const persister = new EventPersister(eventsPath, emitter);
    const visualizer = makeVisualizer();
    persister.start();
    visualizer.start(emitter, {
      runId: 'run-1', feature: 'feature', project: 'project', sourceRef: 'owner/repo#2000',
    });

    await emitter.emit({ type: 'step_started', step: 'rebase', index: 0 });
    await emitter.emit({ type: 'rebase_noop', baseSha: 'B1' });
    await emitter.emit({ type: 'rebase_changed', baseSha: 'B2', changedPaths: [] });
    await emitter.emit({ type: 'step_completed', step: 'rebase', status: 'done' });
    await emitter.emit({
      type: 'feature_complete', headSha: 'H', prUrl: 'https://example.test/pr/1', prDisposition: 'opened',
    });
    await visualizer.stop();
    persister.stop();

    const spans = spanExporter.getFinishedSpans();
    expect(spans.find((span) => span.name === 'rebase')?.attributes['vcs.base.sha']).toBe('B2');
    expect(spans.find((span) => span.name === 'conductor.run')?.attributes).toMatchObject({
      'vcs.head.sha': 'H', 'vcs.base.sha': 'B2', 'conductor.pr.url': 'https://example.test/pr/1',
      'conductor.pr.disposition': 'opened',
    });
    expect(JSON.parse((await readFile(eventsPath, 'utf8')).trim().split('\n').at(-1)!)).toMatchObject({
      type: 'feature_complete', headSha: 'H', prUrl: 'https://example.test/pr/1', prDisposition: 'opened',
    });
  });

  it('omits only VCS span attributes when commit provenance is disabled', async () => {
    const visualizer = new OtelVisualizer(
      resolveOtelConfig({
        otel: {
          exporter: 'otlp', endpoint: 'http://localhost:4318',
          provenance: { commit: false, pr: true, issue: true, feature: true },
        },
      }, pipelineDir),
      { spanExporter, metricExporter },
    );
    visualizer.start(emitter, {
      runId: 'run-1', feature: 'feature', project: 'project', sourceRef: 'owner/repo#2000',
    });

    await emitter.emit({ type: 'step_started', step: 'rebase', index: 0 });
    await emitter.emit({ type: 'rebase_noop', baseSha: 'B' });
    await emitter.emit({ type: 'feature_complete', headSha: 'H', baseSha: 'B', prUrl: 'https://example.test/pr/1', prDisposition: 'opened' });
    await visualizer.stop();

    const run = spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')!;
    const rebase = spanExporter.getFinishedSpans().find((span) => span.name === 'rebase')!;
    expect(run.attributes).not.toHaveProperty('vcs.head.sha');
    expect(run.attributes).not.toHaveProperty('vcs.base.sha');
    expect(run.resource.attributes['conductor.source.ref']).toBe('owner/repo#2000');
    expect(rebase.attributes).not.toHaveProperty('vcs.base.sha');
    expect(run.attributes).toMatchObject({
      'conductor.pr.url': 'https://example.test/pr/1', 'conductor.pr.disposition': 'opened',
    });
  });

  it('omits only PR span attributes when PR provenance is disabled', async () => {
    const visualizer = new OtelVisualizer(
      resolveOtelConfig({ otel: { exporter: 'otlp', endpoint: 'http://localhost:4318', provenance: { pr: false } } }, pipelineDir),
      { spanExporter, metricExporter },
    );
    visualizer.start(emitter, { runId: 'run-1', feature: 'feature', project: 'project' });
    await emitter.emit({ type: 'step_started', step: 'rebase', index: 0 });
    await emitter.emit({ type: 'rebase_noop', baseSha: 'B' });
    await emitter.emit({ type: 'feature_complete', headSha: 'H', prUrl: 'https://example.test/pr/1', prDisposition: 'opened' });
    await visualizer.stop();

    const run = spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')!;
    expect(run.attributes).toMatchObject({ 'vcs.head.sha': 'H', 'vcs.base.sha': 'B' });
    expect(run.attributes).not.toHaveProperty('conductor.pr.url');
    expect(run.attributes).not.toHaveProperty('conductor.pr.disposition');
  });

  it('persists provenance events when every export toggle is disabled', async () => {
    const eventsPath = join(pipelineDir, 'events.jsonl');
    const persister = new EventPersister(eventsPath, emitter);
    const visualizer = new OtelVisualizer(
      resolveOtelConfig({
        otel: { exporter: 'otlp', endpoint: 'http://localhost:4318', provenance: { commit: false, pr: false, issue: false, feature: false } },
      }, pipelineDir),
      { spanExporter, metricExporter },
    );
    persister.start();
    visualizer.start(emitter, { runId: 'run-1', feature: 'feature', project: 'project' });
    await emitter.emit({ type: 'step_started', step: 'rebase', index: 0 });
    await emitter.emit({ type: 'feature_complete', headSha: 'H', baseSha: 'B', prUrl: 'https://example.test/pr/1', prDisposition: 'opened' });
    await visualizer.stop();
    persister.stop();

    expect(JSON.parse((await readFile(eventsPath, 'utf8')).trim().split('\n').at(-1)!)).toMatchObject({
      type: 'feature_complete', headSha: 'H', baseSha: 'B', prUrl: 'https://example.test/pr/1', prDisposition: 'opened',
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

  it('projects refusal through the registry-derived trace subscription without recording metrics', async () => {
    const visualizer = makeVisualizer();
    visualizer.start(emitter, { runId: 'run-1', feature: 'feature', project: 'project' });

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({ type: 'step_refused', step: 'build', kind: 'needs-human', reason: 'operator required' });
    await emitter.emit({ type: 'feature_complete' });
    await visualizer.stop();

    const span = spanExporter.getFinishedSpans().find((candidate) => candidate.name === 'build')!;
    expect({
      refusalSubscribed: otelTracedEventTypes().includes('step_refused'),
      status: span.status.code,
      outcome: span.attributes['conductor.step.status'],
      metrics: metricExporter.getMetrics(),
    }).toEqual({ refusalSubscribed: true, status: 0, outcome: 'refused', metrics: [] });
  });
});
