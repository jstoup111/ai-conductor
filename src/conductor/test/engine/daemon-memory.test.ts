// Covers: task:2
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { startDaemonEventPersistence, startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { startDaemonMemorySampler } from '../../src/engine/daemon-memory.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('startDaemonMemorySampler', () => {
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
