// Covers: S4.1, S4.3, S4.4, S4.5, task:9
/**
 * Acceptance seam: the daemon's real feature scope wires the OTel warning bus
 * to both the persisted feature ledger and daemon.log. A failing exporter is a
 * faithful third-party-boundary fake; the daemon, event spine, renderer
 * subscription, and log sink are production code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import type { ConductorEvent } from '../../src/types/events.js';

const fixture = vi.hoisted(() => ({
  worktreePath: '',
  terminalOutcomes: [] as Array<{ slug: string; status: string; reason: string }>,
  exportCalls: 0,
}));
const buildExporters = vi.hoisted(() => vi.fn());

vi.mock('../../src/engine/otel/transport.js', () => ({ buildExporters }));
vi.mock('../../src/engine/self-host/daemon-build-token.js', () => ({
  readDaemonBuildToken: vi.fn(async () => ({ state: 'ok' as const, token: 'test-daemon-token' })),
}));
vi.mock('../../src/engine/ci-fix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/ci-fix.js')>()),
  defaultCiFixProbe: vi.fn(async () => ({ exitCode: 0, stdout: 'claude 1.0.0', stderr: '' })),
}));
vi.mock('../../src/engine/daemon-runner.js', () => ({
  makeRunFeature: (deps: {
    beginFeatureRun: (
      worktree: { path: string; branch: string },
      item: { slug: string },
    ) => Promise<Record<string, unknown>>;
  }) => async (item: { slug: string }) => {
    const scope = await deps.beginFeatureRun(
      { path: fixture.worktreePath, branch: `feat/${item.slug}` },
      item,
    );
    const events = scope.events as { emit: (event: ConductorEvent) => Promise<void> };
    for (let attempt = 0; attempt < 3; attempt += 1) {
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
    await (scope.stop as () => Promise<void>)();
    const outcome = { slug: item.slug, status: 'halted', reason: 'test dispatch complete' };
    fixture.terminalOutcomes.push(outcome);
    return outcome;
  },
}));

import { runDaemonMode } from '../../src/daemon-cli.js';

function failingMetricExporter(): PushMetricExporter {
  return {
    export(_metrics: ResourceMetrics, callback: (result: ExportResult) => void): void {
      fixture.exportCalls += 1;
      callback({ code: ExportResultCode.FAILED, error: new Error('collector refused metrics') });
    },
    async forceFlush(): Promise<void> {},
    async shutdown(): Promise<void> {},
  };
}

let dirs: string[] = [];

afterEach(async () => {
  buildExporters.mockReset();
  fixture.terminalOutcomes = [];
  fixture.exportCalls = 0;
  vi.useRealTimers();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function runFailingExportDaemon(): Promise<{ repo: string; events: ConductorEvent[]; log: string }> {
  const repo = await mkdtemp(join(tmpdir(), 'daemon-export-failure-'));
  dirs.push(repo);
  fixture.worktreePath = join(repo, '.worktrees', 'feature-a');
  await mkdir(join(fixture.worktreePath, '.pipeline'), { recursive: true });
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(
    join(repo, '.ai-conductor/config.yml'),
    'otel:\n  exporter: otlp\n  endpoint: http://fake-collector:4318\n',
  );
  buildExporters.mockReturnValueOnce({
    spanExporter: new InMemorySpanExporter(),
    metricExporter: failingMetricExporter(),
  });

  await runDaemonMode({
    projectRoot: repo,
    concurrency: 1,
    maxItems: 1,
    baseBranch: 'main',
    ensureFresh: async () => {},
    watch: false,
    workSource: { discover: async () => [{ slug: 'feature-a' }] },
  });

  const rawEvents = await readFile(join(fixture.worktreePath, '.pipeline/events.jsonl'), 'utf8');
  const events = rawEvents.trim().split('\n').map((line) => JSON.parse(line) as ConductorEvent);
  const log = await readFile(join(repo, '.daemon/daemon.log'), 'utf8');
  return { repo, events, log };
}

describe('acceptance: failed telemetry export is visible without changing daemon outcome', () => {
  it('logs and persists one matching otel failure across repeated export attempts', async () => {
    vi.useFakeTimers();
    const { events, log } = await runFailingExportDaemon();
    const rendererErrors = events.filter((event) => event.type === 'renderer_error');
    const failureLines = log.split('\n').filter((line) => line.includes('renderer otel failed'));

    expect(rendererErrors).toHaveLength(1);
    expect(fixture.exportCalls).toBeGreaterThanOrEqual(3);
    expect(rendererErrors[0]).toMatchObject({
      type: 'renderer_error',
      rendererName: 'otel',
      error: expect.stringContaining('collector refused metrics'),
    });
    expect(failureLines).toHaveLength(1);
    expect(failureLines[0]).toContain('otel');
    expect(failureLines[0]).toContain('collector refused metrics');
    expect(fixture.terminalOutcomes).toEqual([
      { slug: 'feature-a', status: 'halted', reason: 'test dispatch complete' },
    ]);
  });
});
