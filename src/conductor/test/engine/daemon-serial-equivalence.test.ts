// Covers: task:25
import { describe, expect, it, vi } from 'vitest';
import type { DaemonMaintenanceOperation } from '../../src/engine/daemon-maintenance.js';

const serialTrace = vi.hoisted(() => ({ entries: [] as string[] }));

vi.mock('../../src/engine/daemon-maintenance.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/daemon-maintenance.js')>();

  return {
    ...actual,
    DaemonMaintenance: class extends actual.DaemonMaintenance {
      override async run<T>(
        operation: DaemonMaintenanceOperation,
        work: () => Promise<T>,
      ): Promise<T | undefined> {
        serialTrace.entries.push(`maintenance:${operation}:begin`);
        const result = await super.run(operation, work);
        serialTrace.entries.push(`maintenance:${operation}:end`);
        return result;
      }
    },
  };
});

import { runDaemon, type DaemonDeps } from '../../src/engine/daemon.js';

/**
 * Recorded serial baseline for the full dispatch loop before the pool became
 * concurrent. It deliberately runs continuously (not `once`) so the trace
 * includes the scheduler-owned idle path as well as three serial dispatches.
 */
const RECORDED_N1_TRACE = {
  timeline: [
    'maintenance:rekick:begin',
    'gate:pause',
    'base:refresh',
    'maintenance:rekick:end',
    'maintenance:sweep:begin',
    'sweep',
    'maintenance:sweep:end',
    'gate:pause',
    'gate:build-auth',
    'gate:episode',
    'discover:local',
    'engine-source-refresh',
    'engine-rebuild',
    'stale',
    'log:▶ start alpha',
    'dispatch:alpha',
    'sleep',
    'log:■ done alpha: done',
    'gate:pause',
    'gate:build-auth',
    'gate:episode',
    'discover:local',
    'engine-source-refresh',
    'engine-rebuild',
    'stale',
    'log:▶ start beta',
    'dispatch:beta',
    'sleep',
    'log:■ done beta: done',
    'gate:pause',
    'gate:build-auth',
    'gate:episode',
    'discover:local',
    'engine-source-refresh',
    'engine-rebuild',
    'stale',
    'log:▶ start gamma',
    'dispatch:gamma',
    'sleep',
    'log:■ done gamma: done',
    'gate:pause',
    'gate:build-auth',
    'gate:episode',
    'discover:local',
    'maintenance:refresh:begin',
    'discover:refresh',
    'maintenance:refresh:end',
    'maintenance:rekick:begin',
    'gate:pause',
    'base:local',
    'maintenance:rekick:end',
    'gate:episode',
    'maintenance:restart-pending:begin',
    'restart-pending',
    'maintenance:restart-pending:end',
    'maintenance:stale-engine:begin',
    'stale',
    'maintenance:stale-engine:end',
    'sleep',
    'maintenance:sweep:begin',
    'sweep',
    'maintenance:sweep:end',
    'gate:episode',
    'gate:pause',
    'gate:build-auth',
    'gate:episode',
    'discover:local',
    'gate:episode',
    'maintenance:restart-pending:begin',
    'restart-pending',
    'maintenance:restart-pending:end',
    'maintenance:stale-engine:begin',
    'stale',
    'maintenance:stale-engine:end',
  ],
} as const;

describe('daemon serial equivalence (Task 25)', () => {
  it('keeps the recorded N=1 dispatch, refresh, restart, stale, sweep, and lifecycle ordering', async () => {
    serialTrace.entries.length = 0;
    const backlog = [{ slug: 'alpha' }, { slug: 'beta' }, { slug: 'gamma' }];

    const deps: DaemonDeps = {
      discoverBacklog: async ({ refresh }) => {
        serialTrace.entries.push(`discover:${refresh ? 'refresh' : 'local'}`);
        return refresh ? [] : backlog;
      },
      runFeature: async (item) => {
        serialTrace.entries.push(`dispatch:${item.slug}`);
        return { slug: item.slug, status: 'done' as const };
      },
      isPaused: async () => {
        serialTrace.entries.push('gate:pause');
        return false;
      },
      isBuildAuthMissing: async () => {
        serialTrace.entries.push('gate:build-auth');
        return false;
      },
      isParked: async () => false,
      rateLimitEpisode: {
        active: () => {
          serialTrace.entries.push('gate:episode');
          return false;
        },
      } as DaemonDeps['rateLimitEpisode'],
      resolveBaseSha: async ({ refresh }) => {
        serialTrace.entries.push(`base:${refresh ? 'refresh' : 'local'}`);
        return 'base-s1';
      },
      sweepMergeableLabels: async () => {
        serialTrace.entries.push('sweep');
      },
      hasRestartPending: async () => {
        serialTrace.entries.push('restart-pending');
        return false;
      },
      refreshEngineSource: async () => {
        serialTrace.entries.push('engine-source-refresh');
      },
      rebuildEngine: async () => {
        serialTrace.entries.push('engine-rebuild');
      },
      staleEngineChecker: {
        check: () => {
          serialTrace.entries.push('stale');
          return 'current';
        },
      },
      sleep: async () => {
        serialTrace.entries.push('sleep');
      },
      now: () => 0,
      featureLog: () => (line) => serialTrace.entries.push(`log:${line.replace(/\x1B\[[0-9;]*m/g, '')}`),
    };

    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      isSelfHost: true,
      autoRestartOnStaleEngine: true,
      idlePollMs: 1,
      maxIdlePolls: 1,
    });

    const actual = {
      timeline: serialTrace.entries,
      processed: result.processed.map(({ slug, status }) => ({ slug, status })),
      stoppedReason: result.stoppedReason,
    };
    expect(actual).toEqual({
      ...RECORDED_N1_TRACE,
      processed: [
        { slug: 'alpha', status: 'done' },
        { slug: 'beta', status: 'done' },
        { slug: 'gamma', status: 'done' },
      ],
      stoppedReason: 'idle_timeout',
    });
  });
});
