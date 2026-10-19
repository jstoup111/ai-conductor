// Covers: task:25, task:rem-prd-audit-R6
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
import { formatDaemonStartupLog } from '../../src/engine/daemon-command.js';

/**
 * Recorded width-one baseline for the dispatch loop. It deliberately runs
 * continuously (not `once`) so the trace includes the background-maintenance
 * triggers permitted by the dispatch-first ADR alongside three serial feature
 * dispatches.
 */
const RECORDED_N1_TRACE = {
  timeline: [
    'gate:pause',
    'discover:refresh',
    'base:local',
    'gate:build-auth',
    'gate:episode',
    'engine-source-refresh',
    'engine-rebuild',
    'stale',
    'log:▶ start alpha',
    'dispatch:alpha',
    'sleep',
    'gate:pause',
    'sweep',
    'log:■ done alpha: done',
    'gate:pause',
    'gate:pause',
    'base:local',
    'gate:build-auth',
    'gate:episode',
    'discover:local',
    'sweep',
    'engine-source-refresh',
    'engine-rebuild',
    'stale',
    'log:▶ start beta',
    'dispatch:beta',
    'sleep',
    'log:■ done beta: done',
    'gate:pause',
    'gate:pause',
    'base:local',
    'gate:build-auth',
    'gate:episode',
    'discover:local',
    'sweep',
    'engine-source-refresh',
    'engine-rebuild',
    'stale',
    'log:▶ start gamma',
    'dispatch:gamma',
    'sleep',
    'log:■ done gamma: done',
    'gate:pause',
    'gate:pause',
    'base:local',
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
    'sweep',
    'sleep',
    'maintenance:sweep:begin',
    'maintenance:sweep:end',
    'gate:pause',
    'gate:episode',
    'base:local',
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
    'sweep',
    'maintenance:stale-engine:end',
  ],
} as const;

describe('daemon serial equivalence (Task 25)', () => {
  it('keeps both resolved-concurrency-one startup lines byte-for-byte serial', () => {
    expect(formatDaemonStartupLog({ concurrency: 1, source: 'default' }, false))
      .toBe('scanning backlog (concurrency 1)…');
    expect(formatDaemonStartupLog({ concurrency: 1, source: 'flag' }, true))
      .toBe('scanning backlog (concurrency 1, continuous)…');
  });

  // Covers: task:rem-prd-audit-R6.
  it('keeps the recorded N=1 dispatch, refresh, restart, stale, sweep, and lifecycle ordering', async () => {
    serialTrace.entries.length = 0;
    const backlog = [{ slug: 'alpha' }, { slug: 'beta' }, { slug: 'gamma' }];

    const deps: DaemonDeps = {
      discoverBacklog: async ({ refresh }) => {
        serialTrace.entries.push(`discover:${refresh ? 'refresh' : 'local'}`);
        return backlog;
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
    expect(actual.processed).toEqual([
      { slug: 'alpha', status: 'done' },
      { slug: 'beta', status: 'done' },
      { slug: 'gamma', status: 'done' },
    ]);
    expect(actual.stoppedReason).toBe('idle_timeout');
    expect(actual.timeline).toEqual(RECORDED_N1_TRACE.timeline);
  });
});
