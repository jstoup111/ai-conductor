import { forwardedFeatureOf, isForwardedFromFeature } from './event-persister.js';
import { mkdirSync, statSync } from 'node:fs';
import { writeHeapSnapshot } from 'node:v8';
import { join } from 'node:path';
import type { ConductorEvent } from '../types/index.js';
import { ConductorEventEmitter, type EventHandler } from '../ui/events.js';

export const DEFAULT_HEAP_DUMP_THRESHOLD_MB = 3072;

export interface DaemonMemorySamplerOptions {
  memoryUsage?: () => NodeJS.MemoryUsage;
  pid?: number;
  heapDumpThresholdMb?: number;
  heapDumpDir?: string;
  writeHeapSnapshot?: (path: string) => string;
  now?: () => Date;
}

/**
 * Samples the daemon process when a feature lifecycle event reaches the root
 * bus. Samples originate on that bus rather than the feature bus, so the
 * daemon ledger receives them without copying them back into feature ledgers.
 */
export function startDaemonMemorySampler(
  events: ConductorEventEmitter,
  options: DaemonMemorySamplerOptions = {},
): { stop: () => void } {
  const memoryUsage = options.memoryUsage ?? process.memoryUsage;
  const pid = options.pid ?? process.pid;
  const heapDumpThresholdMb = options.heapDumpThresholdMb ?? DEFAULT_HEAP_DUMP_THRESHOLD_MB;
  const heapDumpDir = options.heapDumpDir ?? join(process.cwd(), '.daemon', 'heap');
  const snapshot = options.writeHeapSnapshot ?? writeHeapSnapshot;
  const now = options.now ?? (() => new Date());
  let nextDispatchSeq = 0;
  const activeDispatches = new Map<string, number>();

  const handleBoundary: EventHandler = async (event: ConductorEvent) => {
    if ((event.type !== 'step_started' && event.type !== 'step_completed') || !isForwardedFromFeature(event)) {
      return;
    }
    const slug = forwardedFeatureOf(event);
    if (!slug) return;

    const key = `${slug}\u0000${event.step}`;
    const boundary = event.type === 'step_started' ? 'started' : 'completed';
    const dispatchSeq = event.type === 'step_started'
      ? ++nextDispatchSeq
      : activeDispatches.get(key) ?? ++nextDispatchSeq;
    if (event.type === 'step_started') activeDispatches.set(key, dispatchSeq);
    else activeDispatches.delete(key);

    const usage = memoryUsage();
    await events.emit({
      type: 'daemon_memory_sample',
      rss: usage.rss,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      slug,
      step: event.step,
      boundary,
      pid,
      dispatchSeq,
    });
    if (usage.rss >= heapDumpThresholdMb * 1024 * 1024) {
      mkdirSync(heapDumpDir, { recursive: true });
      const path = join(heapDumpDir, `${now().toISOString()}-${pid}.heapsnapshot`);
      snapshot(path);
      await events.emit({
        type: 'daemon_heap_dump_written', path, bytes: statSync(path).size, rss: usage.rss, pid,
      });
    }
  };

  events.on('step_started', handleBoundary);
  events.on('step_completed', handleBoundary);
  return {
    stop: () => {
      events.off('step_started', handleBoundary);
      events.off('step_completed', handleBoundary);
    },
  };
}
