// Covers: task:10
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { ConductorEvent } from '../../src/types/events.js';

const fixture = vi.hoisted(() => ({ worktreePath: '', events: [] as ConductorEvent[], filteredType: undefined as ConductorEvent['type'] | undefined }));
const buildExporters = vi.hoisted(() => vi.fn());
vi.mock('../../src/engine/otel/transport.js', () => ({ buildExporters }));
vi.mock('../../src/engine/self-host/daemon-build-token.js', () => ({ readDaemonBuildToken: vi.fn(async () => ({ state: 'ok' as const, token: 'test-daemon-token' })) }));
vi.mock('../../src/engine/ci-fix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/ci-fix.js')>()),
  defaultCiFixProbe: vi.fn(async () => ({ exitCode: 0, stdout: 'claude 1.0.0', stderr: '' })),
}));
vi.mock('../../src/engine/daemon-runner.js', () => ({
  makeRunFeature: (deps: { beginFeatureRun: (worktree: { path: string; branch: string }, item: { slug: string }) => Promise<Record<string, unknown>> }) => async (item: { slug: string }) => {
    const scope = await deps.beginFeatureRun({ path: fixture.worktreePath, branch: `feat/${item.slug}` }, item);
    const events = scope.events as { emit: (event: ConductorEvent) => Promise<void> };
    for (const event of fixture.events) if (event.type !== fixture.filteredType) await events.emit(event);
    await (scope.stop as () => Promise<void>)();
    return { slug: item.slug, status: 'halted', reason: 'test dispatch complete' };
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

function signals(exporter: InMemorySpanExporter): unknown[] {
  return exporter.getFinishedSpans().map((span: ReadableSpan) => ({ name: span.name, status: span.status, attributes: span.attributes, events: span.events.map((event) => ({ name: event.name, attributes: event.attributes })) }));
}
async function throughInteractive(events: ConductorEvent[]): Promise<unknown[]> {
  const pipelineDir = await mkdtemp(join(tmpdir(), 'interactive-otel-parity-')); dirs.push(pipelineDir);
  const exporter = new InMemorySpanExporter();
  buildExporters.mockReturnValueOnce({ spanExporter: exporter, metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE) });
  const emitter = new ConductorEventEmitter();
  const context: VisualizerFactoryContext & { startContext: OtelVisualizerStartContext } = { config, pipelineDir, emitter, startContext: { feature: 'interactive', project: 'test', pipelineDir, branch: undefined, engineVersion: undefined } };
  const visualizers = buildInteractiveVisualizers(new PluginRegistry(), config, context);
  for (const event of events) await emitter.emit(event);
  await Promise.all(visualizers.map((visualizer) => visualizer.stop()));
  return signals(exporter);
}
async function throughDaemonDispatch(events: ConductorEvent[], filteredType?: ConductorEvent['type']): Promise<unknown[]> {
  const repo = await mkdtemp(join(tmpdir(), 'daemon-otel-parity-')); dirs.push(repo);
  fixture.worktreePath = join(repo, '.worktrees', 'feature-a'); fixture.events = events; fixture.filteredType = filteredType;
  await mkdir(join(fixture.worktreePath, '.pipeline'), { recursive: true }); await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'otel:\n  exporter: otlp\n  endpoint: http://fake-collector:4318\n');
  const exporter = new InMemorySpanExporter();
  buildExporters.mockReturnValueOnce({ spanExporter: exporter, metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE) });
  await runDaemonMode({ projectRoot: repo, concurrency: 1, maxItems: 1, baseBranch: 'main', ensureFresh: async () => {}, watch: false, workSource: { discover: async () => [{ slug: 'feature-a' }] } });
  return signals(exporter);
}
function missingParityTypes(results: Map<ConductorEvent['type'], { interactive: unknown[]; daemon: unknown[] }>): ConductorEvent['type'][] {
  return [...results].flatMap(([type, result]) => JSON.stringify(result.interactive) === JSON.stringify(result.daemon) ? [] : [type]);
}

describe('daemon OTel parity acceptance', () => {
  it('exports every OTel event through daemon dispatch exactly as the interactive helper does', async () => {
    const results = new Map<ConductorEvent['type'], { interactive: unknown[]; daemon: unknown[] }>();
    for (const type of otelEventTypes()) results.set(type, { interactive: await throughInteractive(eventSequence(type)), daemon: await throughDaemonDispatch(eventSequence(type)) });
    const missing = missingParityTypes(results);
    expect(missing, `daemon OTel exporter missed: ${missing.join(', ')}`).toEqual([]);
  });
  it('proves the parity assertion names a deliberately filtered daemon event', async () => {
    const type = 'pipeline_closeout' as const;
    const results = new Map<ConductorEvent['type'], { interactive: unknown[]; daemon: unknown[] }>([[type, { interactive: await throughInteractive(eventSequence(type)), daemon: await throughDaemonDispatch(eventSequence(type), type) }]]);
    expect(missingParityTypes(results)).toEqual(['pipeline_closeout']);
  });
});
