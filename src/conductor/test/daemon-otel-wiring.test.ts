// Covers: task:6, task:7, task:8, task:9
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { resolveOtelConfig } from '../src/engine/otel/otel-config.js';
import { createOtelVisualizer } from '../src/engine/otel/create-otel-visualizer.js';

type WireOtelVisualizer = typeof import('../src/engine/otel/wire.js').wireOtelVisualizer;
type VisualizerPlugin = import('../src/types/plugin.js').VisualizerPlugin;
type HarnessConfig = import('../src/types/config.js').HarnessConfig;
type LoadMergedConfig = typeof import('../src/engine/config.js').loadMergedConfig;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fixture = vi.hoisted(() => ({
  worktreePath: '',
  scopes: [] as Array<Record<string, unknown>>,
  visualizer: null as VisualizerPlugin | null,
  emittedBeforeHalt: [] as string[],
  persistedRendererErrors: [] as Array<{ rendererName: string; error: string }>,
  visualizerConstructions: 0,
  constructorError: null as Error | null,
  sameStopPromise: false,
  emitOtelEvents: false,
}));
const wireOtelVisualizer = vi.hoisted(() => vi.fn<WireOtelVisualizer>(() => null));
const loadMergedConfig = vi.hoisted(() => vi.fn<LoadMergedConfig>());

vi.mock('../src/engine/otel/wire.js', () => ({ wireOtelVisualizer }));
vi.mock('../src/engine/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/config.js')>();
  return { ...actual, loadMergedConfig };
});
vi.mock('../src/engine/self-host/daemon-build-token.js', () => ({
  readDaemonBuildToken: vi.fn(async () => ({ state: 'ok' as const, token: 'test-daemon-token' })),
}));
vi.mock('../src/engine/ci-fix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/ci-fix.js')>();
  return {
    ...actual,
    defaultCiFixProbe: vi.fn(async () => ({ exitCode: 0, stdout: 'claude 1.0.0', stderr: '' })),
  };
});
vi.mock('../src/engine/daemon-runner.js', () => ({
  makeRunFeature: (deps: { beginFeatureRun: (worktree: { path: string; branch: string }, item: { slug: string }) => Promise<Record<string, unknown>> }) =>
    async (item: { slug: string }) => {
      const scope = await deps.beginFeatureRun({ path: fixture.worktreePath, branch: `feat/${item.slug}` }, item);
      fixture.scopes.push(scope);
      const events = scope.events as {
        emit: (event:
          | { type: 'step_started'; step: 'bootstrap'; index: number }
          | { type: 'step_completed'; step: 'bootstrap'; status: 'done' }
          | { type: 'feature_complete'; featureDesc: string }
          | { type: 'loop_halt'; reason: string }
        ) => Promise<void>;
      };
      if (fixture.emitOtelEvents) {
        await events.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
        await events.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
        await events.emit({ type: 'feature_complete', featureDesc: 'fake feature complete' });
      }
      await events.emit({ type: 'loop_halt', reason: 'fake HALT' });
      const stop = scope.stop as () => Promise<void>;
      const firstStop = stop();
      fixture.sameStopPromise = firstStop === stop();
      await firstStop;
      const persisted = await readFile(join(fixture.worktreePath, '.pipeline', 'events.jsonl'), 'utf8');
      fixture.persistedRendererErrors = persisted
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string; rendererName?: string; error?: string })
        .filter((event) => event.type === 'renderer_error')
        .map((event) => ({ rendererName: event.rendererName!, error: event.error! }));
      return { slug: item.slug, status: 'halted', reason: 'fake HALT' };
    },
}));

import { runDaemonMode } from '../src/daemon-cli.js';

let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
  fixture.scopes = [];
  fixture.visualizer = null;
  fixture.emittedBeforeHalt = [];
  fixture.persistedRendererErrors = [];
  fixture.visualizerConstructions = 0;
  fixture.constructorError = null;
  fixture.sameStopPromise = false;
  fixture.emitOtelEvents = false;
  loadMergedConfig.mockClear();
  wireOtelVisualizer.mockClear();
  wireOtelVisualizer.mockImplementation((config, context, events) => {
    if (!resolveOtelConfig(config, context.pipelineDir).enabled) return null;
    fixture.visualizerConstructions += 1;
    if (fixture.constructorError) {
      void events.emit({
        type: 'renderer_error',
        rendererName: 'otel',
        error: fixture.constructorError.message,
      });
      return null;
    }
    fixture.visualizer?.start(events, context);
    return fixture.visualizer;
  });
});

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dispatchWithSessionId(
  sessionId?: string | 'unreadable',
  config: HarnessConfig = { otel: { exporter: 'file' } },
): Promise<{ repo: string; pipelineDir: string }> {
  const repo = await mkdtemp(join(tmpdir(), 'daemon-otel-wiring-'));
  dirs.push(repo);
  fixture.worktreePath = join(repo, '.worktrees', 'feature-a');
  const pipelineDir = join(fixture.worktreePath, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });
  loadMergedConfig.mockResolvedValue({ ok: true, config, warnings: [], deprecatedKeys: [] });
  if (sessionId === 'unreadable') {
    await mkdir(join(pipelineDir, 'conduct-session-id'));
  } else if (sessionId) {
    await writeFile(join(pipelineDir, 'conduct-session-id'), sessionId);
  }

  await runDaemonMode({
    projectRoot: repo,
    concurrency: 1,
    maxItems: 1,
    baseBranch: 'main',
    ensureFresh: async () => {},
    watch: false,
    workSource: { discover: async () => [{ slug: 'feature-a' }] },
  });
  return { repo, pipelineDir };
}

describe('daemon OTel visualizer wiring', () => {
  it('attaches the visualizer to the feature bus using the persisted read-only session ID', async () => {
    const { repo, pipelineDir } = await dispatchWithSessionId('persisted-dispatch-id');

    expect(wireOtelVisualizer).toHaveBeenCalledWith(
      expect.objectContaining({ otel: expect.objectContaining({ exporter: 'file' }) }),
      expect.objectContaining({
        pipelineDir,
        feature: 'feature-a',
        project: repo,
        runId: 'persisted-dispatch-id',
      }),
      fixture.scopes[0]?.events,
    );
  });

  it('uses the scope session ID without creating conduct-session-id when it is absent', async () => {
    const { pipelineDir } = await dispatchWithSessionId();
    const context = wireOtelVisualizer.mock.calls[0]?.[1];
    const scopeSessionId = fixture.scopes[0]?.sessionId;

    expect(scopeSessionId).toMatch(UUID_V4);
    expect(context?.runId).toBe(scopeSessionId);
    expect(existsSync(join(pipelineDir, 'conduct-session-id'))).toBe(false);
  });

  it('falls back to the scope session ID when the persisted ID cannot be read', async () => {
    await dispatchWithSessionId('unreadable');
    const context = wireOtelVisualizer.mock.calls[0]?.[1];
    const scopeSessionId = fixture.scopes[0]?.sessionId;

    expect(scopeSessionId).toMatch(UUID_V4);
    expect(context?.runId).toBe(scopeSessionId);
    expect(context?.runId).not.toBe('unreadable');
  });

  it('flushes once after a HALT, preserving pre-halt events before scope teardown', async () => {
    const flush = vi.fn(async () => undefined);
    fixture.visualizer = {
      name: 'fake-otel',
      start(events) {
        events.on('loop_halt', () => {
          fixture.emittedBeforeHalt.push('loop_halt');
        });
      },
      stop: flush,
    };

    await dispatchWithSessionId();

    expect({
      events: fixture.emittedBeforeHalt,
      flushes: flush.mock.calls.length,
      sameStopPromise: fixture.sameStopPromise,
    }).toEqual({
      events: ['loop_halt'],
      flushes: 1,
      sameStopPromise: true,
    });
  });

  it('leaves an absent OTel configuration as the pre-visualizer feature dispatch', async () => {
    await dispatchWithSessionId(undefined, {});

    expect({
      visualizerConstructions: fixture.visualizerConstructions,
      visualizer: fixture.scopes[0]?.visualizer,
      dispatches: fixture.scopes.length,
      rendererErrors: fixture.persistedRendererErrors,
      stoppedIdempotently: fixture.sameStopPromise,
    }).toEqual({
      visualizerConstructions: 0,
      visualizer: null,
      dispatches: 1,
      rendererErrors: [],
      stoppedIdempotently: true,
    });
  });

  it('treats an invalid OTel block as disabled and completes the same feature dispatch', async () => {
    await dispatchWithSessionId(
      undefined,
      { otel: { exporter: 'unknown' } } as unknown as HarnessConfig,
    );

    expect({
      visualizerConstructions: fixture.visualizerConstructions,
      visualizer: fixture.scopes[0]?.visualizer,
      dispatches: fixture.scopes.length,
      rendererErrors: fixture.persistedRendererErrors,
    }).toEqual({
      visualizerConstructions: 0,
      visualizer: null,
      dispatches: 1,
      rendererErrors: [],
    });
  });

  it('keeps the feature dispatch running when enabled OTel construction reports renderer_error', async () => {
    fixture.constructorError = new Error('fake OTel constructor failure');
    await dispatchWithSessionId();

    expect({
      visualizerConstructions: fixture.visualizerConstructions,
      visualizer: fixture.scopes[0]?.visualizer,
      dispatches: fixture.scopes.length,
      rendererErrors: fixture.persistedRendererErrors,
    }).toEqual({
      visualizerConstructions: 1,
      visualizer: null,
      dispatches: 1,
      rendererErrors: [{ rendererName: 'otel', error: 'fake OTel constructor failure' }],
    });
  });

  it('emits one renderer_error for repeated failed exports and still completes the dispatch', async () => {
    const failingSpanExporter: SpanExporter = {
      export(_spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        resultCallback({ code: ExportResultCode.FAILED, error: new Error('connection refused') });
      },
      async shutdown(): Promise<void> {},
    };
    const metricExporter: PushMetricExporter = {
      export(_metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
        resultCallback({ code: ExportResultCode.SUCCESS });
      },
      async forceFlush(): Promise<void> {},
      async shutdown(): Promise<void> {},
    };
    fixture.emitOtelEvents = true;
    wireOtelVisualizer.mockImplementation((config, context, events) => {
      const visualizer = createOtelVisualizer(
        resolveOtelConfig(config, context.pipelineDir),
        { spanExporter: failingSpanExporter, metricExporter },
        events,
      );
      visualizer?.start(events, context);
      return visualizer;
    });

    await dispatchWithSessionId(undefined, {
      otel: { exporter: 'otlp', endpoint: 'http://fake-collector.invalid:4318' },
    });

    expect({
      rendererErrors: fixture.persistedRendererErrors,
      dispatches: fixture.scopes.length,
      stoppedIdempotently: fixture.sameStopPromise,
    }).toEqual({
      rendererErrors: [{
        rendererName: 'otel',
        error: '[otel] span export failed: connection refused',
      }],
      dispatches: 1,
      stoppedIdempotently: true,
    });
  });

  it('bounds hanging OTel transport warnings and completes daemon scope teardown', async () => {
    const hangingSpanExporter: SpanExporter = {
      export(_spans: ReadableSpan[], _resultCallback: (result: ExportResult) => void): void {
        // Simulate a transport that accepts work but never responds.
      },
      async shutdown(): Promise<void> {},
    };
    const metricExporter: PushMetricExporter = {
      export(_metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
        resultCallback({ code: 0 });
      },
      async forceFlush(): Promise<void> {},
      async shutdown(): Promise<void> {},
    };
    fixture.emitOtelEvents = true;
    wireOtelVisualizer.mockImplementation((config, context, events) => {
      const visualizer = createOtelVisualizer(
        resolveOtelConfig(config, context.pipelineDir),
        {
          spanExporter: hangingSpanExporter,
          metricExporter,
          exportTimeoutMillis: 25,
        },
        events,
      );
      visualizer?.start(events, context);
      return visualizer;
    });

    const start = Date.now();
    await dispatchWithSessionId(undefined, {
      otel: { exporter: 'otlp', endpoint: 'http://fake-collector.invalid:4318' },
    });

    expect({
      rendererErrors: fixture.persistedRendererErrors,
      dispatches: fixture.scopes.length,
      stoppedIdempotently: fixture.sameStopPromise,
    }).toEqual({
      rendererErrors: [
        expect.objectContaining({
          rendererName: 'otel',
          error: expect.stringContaining('[otel] tracer flush error:'),
        }),
      ],
      dispatches: 1,
      stoppedIdempotently: true,
    });
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});
