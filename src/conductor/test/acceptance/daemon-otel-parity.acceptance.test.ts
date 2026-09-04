// Covers: task:9, task:10
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { ConductorEvent } from '../../src/types/events.js';

const fixture = vi.hoisted(() => ({
  worktreePath: '',
  events: [] as ConductorEvent[],
  filteredType: undefined as ConductorEvent['type'] | undefined,
  metricExportAttempts: 0,
  metricExportCalls: 0,
  outcomes: [] as Array<{ slug: string; status: string; reason: string }>,
}));
const buildExporters = vi.hoisted(() => vi.fn());
vi.mock('../../src/engine/otel/transport.js', () => ({ buildExporters }));
vi.mock('../../src/engine/self-host/daemon-build-token.js', () => ({ readDaemonBuildToken: vi.fn(async () => ({ state: 'ok' as const, token: 'test-daemon-token' })) }));
vi.mock('../../src/engine/ci-fix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/ci-fix.js')>()),
  defaultCiFixProbe: vi.fn(async () => ({ exitCode: 0, stdout: 'claude 1.0.0', stderr: '' })),
}));
vi.mock('../../src/engine/daemon-deps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/daemon-deps.js')>();
  return { ...actual, resolveDaemonBaseSha: vi.fn(async () => 'a'.repeat(40)) };
});
vi.mock('../../src/engine/work-order.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/work-order.js')>();
  return { ...actual, buildWorkOrder: vi.fn((input) => input) };
});
vi.mock('../../src/engine/daemon-runner.js', () => ({
  makeRunFeature: (deps: { beginFeatureRun: (worktree: { path: string; branch: string }, item: { slug: string }) => Promise<Record<string, unknown>> }) => async (item: { slug: string }) => {
    const scope = await deps.beginFeatureRun({ path: fixture.worktreePath, branch: `feat/${item.slug}` }, item);
    const events = scope.events as { emit: (event: ConductorEvent) => Promise<void> };
    for (const event of fixture.events) if (event.type !== fixture.filteredType) await events.emit(event);
    for (let attempt = 0; attempt < fixture.metricExportAttempts; attempt += 1) {
      await events.emit({
        type: 'provider_attempt',
        step: 'build',
        provider: 'claude',
        outcome: 'success',
        invoked: true,
        tokenUsage: { input: 10, output: 2, costUsd: 0.25 },
      });
      await vi.advanceTimersByTimeAsync(60_000);
    }
    // The periodic exports need fake time, while daemon shutdown awaits the
    // SDK's real completion path. Return to real timers before cleanup.
    if (fixture.metricExportAttempts > 0) vi.useRealTimers();
    await (scope.stop as () => Promise<void>)();
    const outcome = { slug: item.slug, status: 'halted', reason: 'test dispatch complete' };
    fixture.outcomes.push(outcome);
    return outcome;
  },
}));

import { buildInteractiveVisualizers } from '../../src/index.js';
import { runDaemonMode } from '../../src/daemon-cli.js';
import { otelEventTypes } from '../../src/engine/event-sinks.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { VisualizerFactoryContext } from '../../src/types/plugin.js';
import type { OtelVisualizerStartContext } from '../../src/engine/otel/wire.js';

let dirs: string[] = [];
afterEach(async () => {
  buildExporters.mockReset(); fixture.events = []; fixture.filteredType = undefined;
  fixture.metricExportAttempts = 0; fixture.metricExportCalls = 0; fixture.outcomes = [];
  vi.useRealTimers();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))); dirs = [];
});

const config = { otel: { exporter: 'otlp', endpoint: 'http://fake-collector:4318' } } as HarnessConfig;
const eventSequences: Partial<Record<ConductorEvent['type'], ConductorEvent[]>> = {
  step_started: [{ type: 'step_started', step: 'build', index: 0 }],
  step_completed: [{ type: 'step_started', step: 'build', index: 0 }, { type: 'step_completed', step: 'build', status: 'done' }],
  step_failed: [{ type: 'step_started', step: 'build', index: 0 }, { type: 'step_failed', step: 'build', error: 'boom', retryCount: 1 }],
  provider_attempt: [{ type: 'provider_attempt', step: 'build', provider: 'claude', outcome: 'success', invoked: true, tokenUsage: { input: 10, output: 2, costUsd: 0.25 } }],
  feature_usage_total: [{ type: 'feature_usage_total', dispatches: 1, meteredDispatches: 1, unmeteredDispatches: 0, costUnmeteredDispatches: 0, costUsd: 0.25, inputTokens: 10, outputTokens: 2 }],
  feature_cost_snapshot: [{ type: 'feature_cost_snapshot', costUsd: 0.25, costComplete: true, byDimension: [{ step: 'build', model: 'test-model', source: 'provider', costUsd: 0.25 }], tokensByDimension: [{ step: 'build', model: 'test-model', tokens: { input: 10, output: 2 } }] }],
  step_retry: [{ type: 'step_started', step: 'build', index: 0 }, { type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 3, reason: 'retry' }],
  gate_verdict: [{ type: 'gate_verdict', step: 'build', satisfied: true }],
  kickback: [{ type: 'kickback', from: 'build', to: 'plan', count: 1 }],
  feature_complete: [{ type: 'step_started', step: 'build', index: 0 }, { type: 'feature_complete', featureDesc: 'parity guard' }],
  loop_halt: [{ type: 'step_started', step: 'build', index: 0 }, { type: 'loop_halt', reason: 'parity guard' }],
  build_progress: [{ type: 'build_progress', step: 'build', resolved: 1, total: 2 }],
  unattributed_progress: [{ type: 'unattributed_progress', step: 'build', attempt: 1, resolvedCount: 1, headBefore: 'a', headAfter: 'b' }],
  build_no_progress: [{ type: 'build_no_progress', step: 'build', quietMinutes: 1, resolved: 1, total: 2 }],
  build_stall: [{ type: 'build_stall', step: 'build', reason: 'no_task_progress', resolvedBefore: 1, resolvedAfter: 1 }],
  pipeline_closeout: [{ type: 'pipeline_closeout', obligation: 'evaluator', startedAt: 1, endedAt: 2, ts: 2 }],
};
function eventSequence(type: ConductorEvent['type']): ConductorEvent[] {
  const events = eventSequences[type];
  if (!events) throw new Error(`missing OTel parity fixture for ${type}`);
  return events;
}

interface OtelSignals {
  spans: unknown[];
  metrics: unknown[];
}

function withoutRunIdentity(attributes: Record<string, unknown>): Record<string, unknown> {
  const { project: _project, feature: _feature, ...eventAttributes } = attributes;
  return eventAttributes;
}

function comparableMetricValue(name: string, value: unknown): unknown {
  // Step duration is the only metric whose value is intentionally derived from
  // wall-clock time. The two supported wiring paths do not share a clock, so
  // compare the emitted observation count while retaining exact values for
  // every deterministic metric (especially the cost snapshot gauges).
  if (name === 'conductor.step.duration' && typeof value === 'object' && value !== null && 'count' in value) {
    return { count: value.count };
  }
  return value;
}

function signals(spanExporter: InMemorySpanExporter, metricExporter: InMemoryMetricExporter): OtelSignals {
  return {
    spans: spanExporter.getFinishedSpans().map((span: ReadableSpan) => ({ name: span.name, status: span.status, attributes: span.attributes, events: span.events.map((event) => ({ name: event.name, attributes: event.attributes })) })),
    metrics: metricExporter.getMetrics().flatMap((resourceMetrics) => resourceMetrics.scopeMetrics.flatMap((scopeMetrics) =>
      scopeMetrics.metrics.map((metric) => ({
        name: metric.descriptor.name,
        dataPoints: metric.dataPoints.map((point) => ({
          value: comparableMetricValue(metric.descriptor.name, point.value),
          attributes: withoutRunIdentity(point.attributes),
        })),
      })),
    )),
  };
}
async function throughInteractive(events: ConductorEvent[]): Promise<OtelSignals> {
  const pipelineDir = await mkdtemp(join(tmpdir(), 'interactive-otel-parity-')); dirs.push(pipelineDir);
  const exporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  buildExporters.mockReturnValueOnce({ spanExporter: exporter, metricExporter });
  const emitter = new ConductorEventEmitter();
  const context: VisualizerFactoryContext & { startContext: OtelVisualizerStartContext } = { config, pipelineDir, emitter, startContext: { feature: 'interactive', project: 'test', pipelineDir, branch: undefined, engineVersion: undefined } };
  const visualizers = buildInteractiveVisualizers(new PluginRegistry(), config, context);
  for (const event of events) await emitter.emit(event);
  await Promise.all(visualizers.map((visualizer) => visualizer.stop()));
  return signals(exporter, metricExporter);
}
async function throughDaemonDispatch(events: ConductorEvent[], filteredType?: ConductorEvent['type']): Promise<OtelSignals> {
  const repo = await mkdtemp(join(tmpdir(), 'daemon-otel-parity-')); dirs.push(repo);
  fixture.worktreePath = join(repo, '.worktrees', 'feature-a'); fixture.events = events; fixture.filteredType = filteredType;
  await mkdir(join(fixture.worktreePath, '.pipeline'), { recursive: true }); await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'otel:\n  exporter: otlp\n  endpoint: http://fake-collector:4318\n');
  const exporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  buildExporters.mockReturnValueOnce({ spanExporter: exporter, metricExporter });
  await runDaemonMode({ projectRoot: repo, concurrency: 1, maxItems: 1, baseBranch: 'main', ensureFresh: async () => {}, watch: false, workSource: { discover: async () => [{ slug: 'feature-a' }] } });
  return signals(exporter, metricExporter);
}

function rejectingMetricExporter(): PushMetricExporter {
  return {
    export(_metrics: ResourceMetrics, callback: (result: ExportResult) => void): void {
      fixture.metricExportCalls += 1;
      callback({ code: ExportResultCode.FAILED, error: new Error('collector refused metrics') });
    },
    async forceFlush(): Promise<void> {},
    async shutdown(): Promise<void> {},
  };
}

async function runDaemonExportScenario(metricExporter: PushMetricExporter): Promise<{
  events: ConductorEvent[];
  log: string;
  outcome: { slug: string; status: string; reason: string };
  metricExportCalls: number;
}> {
  const repo = await mkdtemp(join(tmpdir(), 'daemon-otel-export-failure-')); dirs.push(repo);
  fixture.worktreePath = join(repo, '.worktrees', 'feature-a');
  fixture.events = [
    { type: 'step_started', step: 'build', index: 0 },
    { type: 'step_completed', step: 'build', status: 'done' },
  ];
  fixture.metricExportAttempts = 3;
  await mkdir(join(fixture.worktreePath, '.pipeline'), { recursive: true }); await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'otel:\n  exporter: otlp\n  endpoint: http://fake-collector:4318\n');
  buildExporters.mockReturnValueOnce({ spanExporter: new InMemorySpanExporter(), metricExporter });
  await runDaemonMode({ projectRoot: repo, concurrency: 1, maxItems: 1, baseBranch: 'main', ensureFresh: async () => {}, watch: false, workSource: { discover: async () => [{ slug: 'feature-a' }] } });
  const rawEvents = await readFile(join(fixture.worktreePath, '.pipeline/events.jsonl'), 'utf8');
  return {
    events: rawEvents.trim().split('\n').map((line) => JSON.parse(line) as ConductorEvent),
    log: await readFile(join(repo, '.daemon/daemon.log'), 'utf8'),
    outcome: fixture.outcomes.at(-1)!,
    metricExportCalls: fixture.metricExportCalls,
  };
}

function terminalVerdicts(events: ConductorEvent[]): Array<Record<string, unknown>> {
  const verdicts: Array<Record<string, unknown>> = [];
  for (const event of events) {
    switch (event.type) {
      case 'step_completed': verdicts.push({ type: event.type, step: event.step, status: event.status }); break;
      case 'step_failed': verdicts.push({ type: event.type, step: event.step, error: event.error, retryCount: event.retryCount }); break;
      case 'feature_complete': verdicts.push({ type: event.type }); break;
      case 'loop_halt': verdicts.push({ type: event.type, reason: event.reason }); break;
      default: break;
    }
  }
  return verdicts;
}
function missingParityTypes(results: Map<ConductorEvent['type'], { interactive: OtelSignals; daemon: OtelSignals }>): ConductorEvent['type'][] {
  return [...results].flatMap(([type, result]) => JSON.stringify(result.interactive) === JSON.stringify(result.daemon) ? [] : [type]);
}

describe('daemon OTel parity acceptance', () => {
  it('exports every OTel event through daemon dispatch exactly as the interactive helper does', async () => {
    const results = new Map<ConductorEvent['type'], { interactive: OtelSignals; daemon: OtelSignals }>();
    for (const type of otelEventTypes()) results.set(type, { interactive: await throughInteractive(eventSequence(type)), daemon: await throughDaemonDispatch(eventSequence(type)) });
    const missing = missingParityTypes(results);
    expect(missing, `daemon OTel exporter missed: ${missing.join(', ')}`).toEqual([]);
  });
  it('proves the parity assertion detects a filtered metric-only snapshot', async () => {
    const type = 'feature_cost_snapshot' as const;
    const results = new Map<ConductorEvent['type'], { interactive: OtelSignals; daemon: OtelSignals }>([[type, { interactive: await throughInteractive(eventSequence(type)), daemon: await throughDaemonDispatch(eventSequence(type), type) }]]);
    expect(missingParityTypes(results)).toEqual(['feature_cost_snapshot']);
  });

  it('logs one persisted otel export failure without changing the daemon run outcome', async () => {
    vi.useFakeTimers();
    const failed = await runDaemonExportScenario(rejectingMetricExporter());
    vi.useFakeTimers();
    const succeeded = await runDaemonExportScenario(new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE));
    const rendererErrors = failed.events.filter((event) => event.type === 'renderer_error');
    const errorLines = failed.log.split('\n').filter((line) => line.includes('renderer otel failed'));

    expect(rendererErrors).toHaveLength(1);
    expect(failed.metricExportCalls).toBeGreaterThanOrEqual(3);
    expect(errorLines).toHaveLength(1);
    expect(rendererErrors[0]).toMatchObject({ rendererName: 'otel', error: expect.stringContaining('collector refused metrics') });
    expect(errorLines[0]).toContain(rendererErrors[0].error);
    expect(terminalVerdicts(failed.events)).toEqual(terminalVerdicts(succeeded.events));
    expect(failed.outcome).toEqual(succeeded.outcome);
  });
});
