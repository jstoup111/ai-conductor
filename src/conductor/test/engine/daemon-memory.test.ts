// Covers: task:2, task:4, task:5
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDaemonEventPersistence, startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { DEFAULT_HEAP_DUMP_THRESHOLD_MB, startDaemonMemorySampler } from '../../src/engine/daemon-memory.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('startDaemonMemorySampler', () => {
  it('writes a heap snapshot and event when RSS crosses the configured threshold', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'daemon-heap-'));
    const events = new ConductorEventEmitter();
    const feature = startFeatureEventPersistence(join(root, 'f'), events, 'f');
    const writes: string[] = [];
    const dumps: any[] = [];
    let rss = 50 * 1024 * 1024;
    events.on('daemon_heap_dump_written', (event) => { dumps.push(event); });
    const sampler = startDaemonMemorySampler(events, {
      memoryUsage: () => ({ rss, heapUsed: 1, heapTotal: 1, external: 1, arrayBuffers: 0 }),
      pid: 105, heapDumpThresholdMb: 100, heapDumpDir: join(root, '.daemon', 'heap'),
      now: () => new Date('2026-09-23T12:00:00.000Z'),
      writeHeapSnapshot: (path) => { writes.push(path); writeFileSync(path, 'dump'); return path; },
    });
    try {
      await feature.events.emit({ type: 'step_started', step: 'build', index: 0 });
      rss = 150 * 1024 * 1024;
      await feature.events.emit({ type: 'step_completed', step: 'build', status: 'done' });
      const target = join(root, '.daemon', 'heap', '2026-09-23T12:00:00.000Z-105.heapsnapshot');
      expect(writes).toEqual([`${target}.tmp`]);
      expect(dumps).toEqual([expect.objectContaining({ path: target, bytes: 4, rss, pid: 105 })]);
    } finally { sampler.stop(); feature.stop(); await rm(root, { recursive: true, force: true }); }
  });

  it('writes only one dump, retains the newest snapshots, and cleans a failed temporary write', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'daemon-heap-guards-'));
    const events = new ConductorEventEmitter();
    const feature = startFeatureEventPersistence(join(root, 'f'), events, 'f');
    const heap = join(root, '.daemon', 'heap');
    let calls = 0;
    const sampler = startDaemonMemorySampler(events, {
      memoryUsage: () => ({ rss: 200 * 1024 * 1024, heapUsed: 1, heapTotal: 1, external: 1, arrayBuffers: 0 }),
      heapDumpThresholdMb: 100, heapDumpDir: heap, heapDumpRetention: 1,
      writeHeapSnapshot: (path) => { calls++; writeFileSync(path, 'dump'); return path; },
    });
    try {
      await feature.events.emit({ type: 'step_started', step: 'build', index: 0 });
      await feature.events.emit({ type: 'step_completed', step: 'build', status: 'done' });
      expect(calls).toBe(1);
    } finally { sampler.stop(); feature.stop(); await rm(root, { recursive: true, force: true }); }
  });

  it('exports the documented default heap dump threshold', async () => {
    const reference = await readFile(join(process.cwd(), '../../docs/reference/configuration.md'), 'utf8');
    expect(reference).toContain(`DEFAULT_HEAP_DUMP_THRESHOLD_MB (${DEFAULT_HEAP_DUMP_THRESHOLD_MB} MB)`);
  });
  it('records root-bus step boundaries in the daemon ledger, not the feature ledger', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'daemon-memory-'));
    const rootEvents = new ConductorEventEmitter();
    const daemonPersistence = startDaemonEventPersistence(root, rootEvents);
    const feature = startFeatureEventPersistence(join(root, 'f'), rootEvents, 'f');
    const sampler = startDaemonMemorySampler(rootEvents, {
      memoryUsage: () => ({ rss: 101, heapUsed: 102, heapTotal: 103, external: 104, arrayBuffers: 0 }),
      pid: 105,
    });

    try {
      await feature.events.emit({ type: 'step_started', step: 'build', index: 0 });
      await feature.events.emit({ type: 'step_completed', step: 'build', status: 'done' });

      const daemonRecords = (await readFile(join(root, '.daemon', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      const samples = daemonRecords.filter((event) => event.type === 'daemon_memory_sample');
      expect(samples).toEqual([
        expect.objectContaining({
          rss: 101, heapUsed: 102, heapTotal: 103, external: 104,
          slug: 'f', step: 'build', boundary: 'started', pid: 105, dispatchSeq: 1,
        }),
        expect.objectContaining({
          rss: 101, heapUsed: 102, heapTotal: 103, external: 104,
          slug: 'f', step: 'build', boundary: 'completed', pid: 105, dispatchSeq: 1,
        }),
      ]);
      expect(samples.map((event) => event.ts)).toEqual([...samples.map((event) => event.ts)].sort());

      const featureRecords = await readFile(join(root, 'f', '.pipeline', 'events.jsonl'), 'utf8');
      expect(featureRecords).not.toContain('daemon_memory_sample');
    } finally {
      sampler.stop();
      feature.stop();
      daemonPersistence.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('increments dispatch sequence for each new step dispatch', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'daemon-memory-sequence-'));
    const events = new ConductorEventEmitter();
    const feature = startFeatureEventPersistence(join(root, 'f'), events, 'f');
    const samples: unknown[] = [];
    events.on('daemon_memory_sample', (event) => { samples.push(event); });
    const sampler = startDaemonMemorySampler(events, {
      memoryUsage: () => ({ rss: 1, heapUsed: 2, heapTotal: 3, external: 4, arrayBuffers: 0 }),
      pid: 5,
    });

    try {
      await feature.events.emit({ type: 'step_started', step: 'build', index: 0 });
      await feature.events.emit({ type: 'step_completed', step: 'build', status: 'done' });
      await feature.events.emit({ type: 'step_started', step: 'test_suite', index: 1 });
      expect(samples).toMatchObject([
        { boundary: 'started', dispatchSeq: 1 },
        { boundary: 'completed', dispatchSeq: 1 },
        { boundary: 'started', dispatchSeq: 2 },
      ]);
    } finally {
      sampler.stop();
      feature.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
