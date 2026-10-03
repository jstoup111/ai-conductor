// Covers: task:8
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDaemonEvent } from '../../../src/daemon-cli.js';
import { AuditTrailWriter } from '../../../src/engine/audit-trail.js';
import { computeCostRollup } from '../../../src/engine/cost-rollup.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { EVENT_SINKS } from '../../../src/engine/event-sinks.js';
import { MetricsListener } from '../../../src/engine/otel/metrics-listener.js';
import { MetricsRecorder } from '../../../src/engine/otel/metrics.js';
import { computeTimingRollup } from '../../../src/engine/timing-rollup.js';
import type { ConductorEvent } from '../../../src/types/events.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';

const spoolEvents = [
  { type: 'otel_spool_drop', signal: 'traces', reason: 'rejected', batches: 1, items: 3, status: 400 },
  { type: 'otel_spool_backlog', signal: 'metrics', files: 2, bytes: 128, oldestAgeMs: 1_000, lastFailureClass: 'network' },
] satisfies ConductorEvent[];

describe('OTel spool events', () => {
  it('are persisted-only spine events, not daemon-log rendering or metric projections', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'otel-spool-events-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(directory, '.pipeline', 'events.jsonl'), events);
    const auditTrail = new AuditTrailWriter(directory);
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const meterProvider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 })],
    });
    const metrics = new MetricsListener(
      new MetricsRecorder(meterProvider.getMeter('otel-spool-events'), { project: 'project', worker: 'worker' }),
      undefined,
      'feature',
    );
    const daemonLog: string[] = [];

    try {
      expect({ drop: EVENT_SINKS.otel_spool_drop, backlog: EVENT_SINKS.otel_spool_backlog }).toEqual({
        drop: { render: false, persist: true, audit: false, otel: false, otelTrace: false },
        backlog: { render: false, persist: true, audit: false, otel: false, otelTrace: false },
      });

      persister.start();
      auditTrail.subscribe(events);
      metrics.start(events);
      for (const event of spoolEvents) {
        renderDaemonEvent(event, (line) => daemonLog.push(line));
        await events.emit(event);
      }
      persister.stop();
      await meterProvider.forceFlush();

      const ledger = await readFile(join(directory, '.pipeline', 'events.jsonl'), 'utf8');
      expect(ledger.split('\n').filter(Boolean).map((line) => JSON.parse(line))).toEqual([
        { ...spoolEvents[0], ts: expect.any(String) },
        { ...spoolEvents[1], ts: expect.any(String) },
      ]);
      expect(daemonLog).toEqual([]);
      expect(await readdir(join(directory, '.pipeline'))).toEqual(['events.jsonl']);
      expect(metricExporter.getMetrics()).toEqual([]);
    } finally {
      metrics.stop();
      persister.stop();
      await meterProvider.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not change cost or timing rollups when interleaved in a persisted ledger', async () => {
    const base = await mkdtemp(join(tmpdir(), 'otel-spool-rollup-base-'));
    const withSpool = await mkdtemp(join(tmpdir(), 'otel-spool-rollup-interleaved-'));
    const accountingEvents = [
      { type: 'step_started', step: 'build' },
      {
        type: 'provider_attempt', step: 'build', provider: 'codex', model: 'gpt', outcome: 'success', invoked: true,
        tokenUsage: { input: 100, output: 10, costUsd: 0.25, costSource: 'provider' },
      },
      { type: 'step_completed', step: 'build', activeInterval: { startedAtMs: 0, durationMs: 100 } },
    ];
    const serialize = (events: readonly object[]) => `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;

    try {
      await Promise.all([base, withSpool].map(async (directory) => {
        await mkdir(join(directory, '.pipeline'));
        return writeFile(join(directory, '.pipeline', 'events.jsonl'), serialize(directory === base
          ? accountingEvents
          : [accountingEvents[0], spoolEvents[0], spoolEvents[1], ...accountingEvents.slice(1)]));
      }));
      const [baseCost, spoolCost, baseTiming, spoolTiming] = await Promise.all([
        computeCostRollup(base),
        computeCostRollup(withSpool),
        computeTimingRollup(base),
        computeTimingRollup(withSpool),
      ]);
      expect(baseCost).toMatchObject({ costUsd: 0.25, dispatches: 1 });
      expect(spoolCost).toEqual(baseCost);
      expect(spoolTiming).toEqual(baseTiming);
    } finally {
      await Promise.all([base, withSpool].map((directory) => rm(directory, { recursive: true, force: true })));
    }
  });
});
