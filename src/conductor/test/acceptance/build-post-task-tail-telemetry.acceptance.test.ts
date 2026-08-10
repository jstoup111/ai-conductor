/**
 * RED acceptance specs for `.docs/stories/build-post-task-tail-telemetry.md`.
 *
 * These scenarios exercise the three genuinely multi-operation story flows:
 *
 * 1. mutate task state across watcher ticks and observe provenance on the real bus;
 * 2. invoke the real pipeline-owned closeout primitive twice, then observe the
 *    resulting sibling ledger in append order without touching the engine ledger.
 * 3. tail a pipeline-owned closeout record onto the real event bus and observe
 *    the daemon, terminal, and OTel production consumer paths without adding a
 *    second persistence writer.
 *
 * The rollup, gate, and report stories each expose one operation and remain owned
 * by their scoped TDD tests under plan Tasks 12-17 (writing-system-tests §3a).
 * No third-party boundary is contacted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from '@opentelemetry/sdk-metrics';

import { BuildProgressWatcher } from '../../src/engine/build-progress-watcher.js';
import { dispatchCloseoutEventCommand } from '../../src/engine/closeout-cli.js';
import { CloseoutEventTail } from '../../src/engine/closeout-tail.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import {
  persistedEventTypes,
  renderedEventTypes,
} from '../../src/engine/event-sinks.js';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../src/engine/otel/otel-visualizer.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';
import { createLiveRegion } from '../../src/ui/live-region.js';
import { createRenderer } from '../../src/ui/create-renderer.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { TerminalSubscriber } from '../../src/ui/subscriber.js';
import type { ConductorEvent } from '../../src/types/index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');

type BuildProgress = Extract<ConductorEvent, { type: 'build_progress' }> & {
  tickReason?: 'task-delta' | 'head-moved' | 'heartbeat';
  headMoved?: boolean;
};

class CaptureStream extends Writable {
  private readonly chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: string, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  output(): string {
    return this.chunks.join('');
  }
}

describe('BUILD post-task tail telemetry acceptance', () => {
  let projectRoot: string;
  let emitter: ConductorEventEmitter;
  let received: BuildProgress[];

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'build-post-task-tail-'));
    emitter = new ConductorEventEmitter();
    received = [];
    emitter.on('build_progress', (event) => {
      received.push(event as BuildProgress);
    });
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeTasks(resolved: number, total: number): Promise<void> {
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    const tasks = Array.from({ length: total }, (_, index) => ({
      id: String(index + 1),
      status: index < resolved ? 'completed' : 'pending',
    }));
    await writeFile(
      join(projectRoot, '.pipeline/task-status.json'),
      JSON.stringify({ tasks }),
      'utf8',
    );
  }

  function tick(watcher: BuildProgressWatcher): Promise<void> {
    return (watcher as unknown as { tick(): Promise<void> }).tick();
  }

  it('distinguishes a task delta from a heartbeat and records failed HEAD probes explicitly', async () => {
    await writeTasks(1, 3);
    let clock = 0;
    const watcher = new BuildProgressWatcher({
      projectRoot,
      events: emitter,
      step: 'build',
      featureSlug: 'build-post-task-tail-telemetry',
      config: { build_progress: { heartbeat_minutes: 1 } },
      now: () => clock,
    });
    watcher.start();

    // This scratch directory is intentionally not a Git repository. The real
    // HEAD probe therefore fails while the watcher must continue emitting.
    await tick(watcher);
    received = [];

    await writeTasks(2, 3);
    await tick(watcher);
    expect(received.at(-1)).toMatchObject({
      type: 'build_progress',
      resolved: 2,
      total: 3,
      tickReason: 'task-delta',
      headMoved: false,
    });

    received = [];
    clock += 61_000;
    await tick(watcher);
    watcher.stop();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'build_progress',
      tickReason: 'heartbeat',
      headMoved: false,
    });
    expect(received[0]).toHaveProperty('headMoved');
  });

  it('appends closeout events through the real CLI without a conductor and preserves ledger isolation', async () => {
    vi.useRealTimers();
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    const engineLedger = join(projectRoot, '.pipeline/events.jsonl');
    const originalEngineLedger = '{"type":"step_started","step":"build","ts":1}\n';
    await writeFile(engineLedger, originalEngineLedger, 'utf8');

    const first = spawnSync(
      REAL_CONDUCT_TS,
      ['closeout-event', 'evaluator', '100', '140'],
      { cwd: projectRoot, encoding: 'utf8', timeout: 10_000 },
    );
    const second = spawnSync(
      REAL_CONDUCT_TS,
      ['closeout-event', 'summary', '150', '180'],
      { cwd: projectRoot, encoding: 'utf8', timeout: 10_000 },
    );

    expect({ first: first.status, second: second.status }).toEqual({ first: 0, second: 0 });

    const [engineAfter, pipelineRaw] = await Promise.all([
      readFile(engineLedger, 'utf8'),
      readFile(join(projectRoot, '.pipeline/pipeline-events.jsonl'), 'utf8'),
    ]);
    const pipelineEvents = pipelineRaw.trim().split('\n').map((line) => JSON.parse(line));

    expect(engineAfter).toBe(originalEngineLedger);
    expect(pipelineEvents).toHaveLength(2);
    expect(pipelineEvents.map((event) => event.obligation)).toEqual(['evaluator', 'summary']);
    expect(pipelineEvents.every((event) => typeof event.ts === 'number')).toBe(true);
  }, 30_000);

  it('rejects an unknown closeout obligation without writing either ledger', async () => {
    vi.useRealTimers();
    const errors: string[] = [];
    const result = await dispatchCloseoutEventCommand(
      {
        kind: 'closeout-event',
        obligation: 'not-a-closeout-obligation',
        startedAt: 100,
        endedAt: 140,
      },
      projectRoot,
      () => 0,
      (message) => errors.push(message),
    );

    expect(result).not.toBe(0);
    expect(errors.join('\n')).toMatch(/accepted|valid|obligation/i);
    await expect(
      readFile(join(projectRoot, '.pipeline/pipeline-events.jsonl'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(projectRoot, '.pipeline/events.jsonl'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it('re-emits closeout telemetry to daemon, terminal, and OTel consumers without a second writer', async () => {
    vi.useRealTimers();
    const pipelineDir = join(projectRoot, '.pipeline');
    const engineLedger = join(pipelineDir, 'events.jsonl');
    await mkdir(pipelineDir, { recursive: true });

    const spanExporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const otelConfig = resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      pipelineDir,
    );
    const otel = new OtelVisualizer(otelConfig, {
      runId: 'build-post-task-tail-acceptance',
      feature: 'build-post-task-tail-telemetry',
      project: 'ai-conductor',
      spanExporter,
      metricExporter,
    });
    otel.start(emitter);
    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });

    const originalEngineLedger = '{"type":"step_started","step":"build","ts":1}\n';
    await writeFile(engineLedger, originalEngineLedger, 'utf8');
    const persister = new EventPersister(engineLedger, emitter);
    persister.start();

    const daemonLines: string[] = [];
    for (const type of renderedEventTypes()) {
      emitter.on(type, (event) => renderDaemonEvent(event, (line) => daemonLines.push(line)));
    }

    const terminalStream = new CaptureStream();
    const renderer = createRenderer({
      stateFilePath: join(pipelineDir, 'conduct-state.json'),
      steps: [],
      readStateFn: async () => ({ ok: true, value: {} }),
      liveRegion: createLiveRegion({ stream: terminalStream, forceTTY: false }),
    });
    const terminal = new TerminalSubscriber(emitter, renderer);
    terminal.start();

    const closeout = {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 100,
      endedAt: 140,
      ts: 150,
    } as const;
    await writeFile(
      join(pipelineDir, 'pipeline-events.jsonl'),
      `${JSON.stringify(closeout)}\n`,
      'utf8',
    );

    const tail = new CloseoutEventTail({ projectRoot, events: emitter });
    try {
      await tail.poll();
    } finally {
      tail.stop();
      terminal.stop();
      persister.stop();
      await otel.stop();
    }

    const buildSpan = spanExporter.getFinishedSpans().find((span) => span.name === 'build');
    const closeoutMetric = metricExporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .find((metric) =>
        metric.descriptor.name.includes('closeout')
        && metric.dataPoints.some((point) => point.attributes.obligation === 'evaluator'),
      );
    const engineAfter = await readFile(engineLedger, 'utf8');

    expect({
      daemonRendered: /evaluator/i.test(daemonLines.join('\n')),
      terminalRendered: /evaluator/i.test(terminalStream.output()),
      otelSpanEvent: buildSpan?.events.some((event) => event.name === 'pipeline_closeout') ?? false,
      otelDurationMetric: closeoutMetric !== undefined,
      renderRouted: renderedEventTypes().includes('pipeline_closeout'),
      persistRouted: persistedEventTypes().includes('pipeline_closeout'),
      engineLedgerChanged: engineAfter !== originalEngineLedger,
    }).toEqual({
      daemonRendered: true,
      terminalRendered: true,
      otelSpanEvent: true,
      otelDurationMetric: true,
      renderRouted: true,
      persistRouted: false,
      engineLedgerChanged: false,
    });
  }, 30_000);
});
