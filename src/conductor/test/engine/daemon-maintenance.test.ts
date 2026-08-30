// Covers: task:11
import { describe, expect, it, vi } from 'vitest';
import type { DaemonMaintenanceOperation } from '../../src/engine/daemon-maintenance.js';

const maintenanceTrace = vi.hoisted(() => ({ operations: [] as DaemonMaintenanceOperation[] }));

vi.mock('../../src/engine/daemon-maintenance.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/daemon-maintenance.js')>();

  return {
    ...actual,
    DaemonMaintenance: class extends actual.DaemonMaintenance {
      override async run<T>(
        operation: DaemonMaintenanceOperation,
        work: () => Promise<T>,
      ): Promise<T | undefined> {
        maintenanceTrace.operations.push(operation);
        return super.run(operation, work);
      }
    },
  };
});

import { runDaemon, type DaemonDeps } from '../../src/engine/daemon.js';

describe('engine/daemon-maintenance', () => {
  it('preserves the recorded N=1 idle-maintenance evaluation trace through the scheduler', async () => {
    const trace: string[] = [];
    let stop = false;
    const episodeStates = [false, true, false];
    const deps: DaemonDeps = {
      discoverBacklog: async ({ refresh }) => {
        trace.push(refresh ? 'refresh' : 'local-discovery');
        return [];
      },
      runFeature: async () => {
        throw new Error('the empty backlog must not dispatch');
      },
      resolveBaseSha: async ({ refresh }) => {
        trace.push(refresh ? 'rekick:startup' : 'rekick');
        return 'base-sha';
      },
      hasRestartPending: async () => {
        trace.push('restart-pending');
        return false;
      },
      staleEngineChecker: {
        check: () => {
          trace.push('stale-engine');
          return 'current';
        },
      },
      sweepMergeableLabels: async () => {
        trace.push('sweep');
      },
      sweepEpisodeHalts: async () => {
        trace.push('episode-end-sweep');
      },
      rateLimitEpisode: {
        active: () => episodeStates.shift() ?? false,
      } as DaemonDeps['rateLimitEpisode'],
      sleep: async () => {
        stop = true;
      },
      shouldStop: () => stop,
    };

    await runDaemon(deps, {
      concurrency: 1,
      once: false,
      isSelfHost: true,
      autoRestartOnStaleEngine: true,
    });

    expect({ maintenance: maintenanceTrace.operations, trace }).toEqual({
      maintenance: [
        'rekick',
        'sweep',
        'refresh',
        'rekick',
        'restart-pending',
        'stale-engine',
        'sweep',
        'episode-end-sweep',
      ],
      trace: [
        'rekick:startup',
        'sweep',
        'local-discovery',
        'refresh',
        'rekick',
        'restart-pending',
        'stale-engine',
        'sweep',
        'episode-end-sweep',
      ],
    });
  });
});
