import { forwardedFeatureOf, isForwardedFromFeature } from './event-persister.js';
import { appendFileSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { writeHeapSnapshot } from 'node:v8';
import { join } from 'node:path';
import type { ConductorEvent } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';
import { ConductorEventEmitter, type EventHandler } from '../ui/events.js';

export const DEFAULT_HEAP_DUMP_THRESHOLD_MB = 3072;
export const DEFAULT_HEAP_DUMP_RETENTION = 3;

/** The operator-configured heap-dump threshold and retention; absent keys keep the defaults. */
export function heapDumpOptionsFromConfig(
  config: Partial<Pick<HarnessConfig, 'daemon_heap_dump_threshold_mb' | 'daemon_heap_dump_retention'>> | null | undefined,
): Pick<DaemonMemorySamplerOptions, 'heapDumpThresholdMb' | 'heapDumpRetention'> {
  return {
    ...(config?.daemon_heap_dump_threshold_mb !== undefined ? { heapDumpThresholdMb: config.daemon_heap_dump_threshold_mb } : {}),
    ...(config?.daemon_heap_dump_retention !== undefined ? { heapDumpRetention: config.daemon_heap_dump_retention } : {}),
  };
}

export interface DaemonMemorySamplerOptions {
  memoryUsage?: () => NodeJS.MemoryUsage;
  pid?: number;
  heapDumpThresholdMb?: number;
  heapDumpDir?: string;
  writeHeapSnapshot?: (path: string) => string;
  now?: () => Date;
  heapDumpRetention?: number;
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
  const heapDumpRetention = options.heapDumpRetention ?? DEFAULT_HEAP_DUMP_RETENTION;
  let dumped = false;
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
    if (!dumped && usage.rss >= heapDumpThresholdMb * 1024 * 1024) {
      const path = join(heapDumpDir, `${now().toISOString()}-${pid}.heapsnapshot`);
      const tempPath = `${path}.tmp`;
      try {
        mkdirSync(heapDumpDir, { recursive: true });
        const snapshots = readdirSync(heapDumpDir)
          .filter((name) => name.endsWith('.heapsnapshot'))
          .map((name) => ({ name, mtime: statSync(join(heapDumpDir, name)).mtimeMs }))
          .sort((a, b) => a.mtime - b.mtime);
        // Make room before the atomic rename: the directory must never have
        // more than the configured retention cap, even briefly.
        const retainedBeforeWrite = Math.max(0, heapDumpRetention - 1);
        for (const old of snapshots.slice(0, Math.max(0, snapshots.length - retainedBeforeWrite))) {
          unlinkSync(join(heapDumpDir, old.name));
        }
        snapshot(tempPath);
        renameSync(tempPath, path);
        dumped = true;
        await events.emit({ type: 'daemon_heap_dump_written', path, bytes: statSync(path).size, rss: usage.rss, pid });
      } catch (error) {
        try { unlinkSync(tempPath); } catch { /* absent temp is fine */ }
        try { appendFileSync(join(heapDumpDir, '..', 'daemon.log'), `[daemon] heap snapshot failed: ${String(error)}\n`); } catch { /* best effort */ }
        dumped = true;
      }
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
