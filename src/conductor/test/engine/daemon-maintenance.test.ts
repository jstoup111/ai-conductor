// Covers: task:11, task:12
import { describe, expect, it, vi } from 'vitest';
import {
  DaemonMaintenance,
  type DaemonMaintenanceOperation,
} from '../../src/engine/daemon-maintenance.js';
import type { FeatureExecutor } from '../../src/engine/feature-executor.js';
import { rekickSweep } from '../../src/engine/daemon-rekick.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

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

  it('refreshes into a free slot while another executor keeps its pinned order', async () => {
    let rootBase = 'base-s1';
    let localDiscoveries = 0;
    let firstRunning = false;
    let firstWorktreeHead: string | undefined;
    let releaseFirst: (() => void) | undefined;
    let secondObservedFirstPinned = false;
    const rekicked: string[] = [];

    const executor: FeatureExecutor = {
      async execute(order) {
        if (order.slug === 'first') {
          firstRunning = true;
          firstWorktreeHead = order.baseSha;
          await new Promise<void>((resolve) => {
            releaseFirst = () => {
              firstRunning = false;
              resolve();
            };
          });
          return { slug: order.slug, status: 'done' };
        }

        secondObservedFirstPinned =
          firstRunning && firstWorktreeHead === 'base-s1' && rootBase === 'base-s2';
        return { slug: order.slug, status: 'done' };
      },
    };
    const createWorkOrder = async (item: { slug: string }): Promise<WorkOrder> => ({
      repository: 'owner/repo',
      slug: item.slug,
      baseSha: rootBase,
      manifest: [],
    });

    const result = await runDaemon(
      {
        discoverBacklog: async ({ refresh }) => {
          if (refresh) {
            rootBase = 'base-s2';
            return [{ slug: 'second' }];
          }
          localDiscoveries++;
          if (localDiscoveries === 1) return [{ slug: 'first' }];
          if (localDiscoveries === 2) {
            setImmediate(() => releaseFirst?.());
          }
          return [];
        },
        runFeature: async () => {
          throw new Error('featureExecution owns this test');
        },
        featureExecution: { createWorkOrder, executor },
        readPersistedBaseSha: async () => 'base-s1',
        resolveBaseSha: async () => rootBase,
        rekickSweep: async (_sha, context) => {
          if (!context) return;
          for (const slug of ['first', 'halted']) {
            if (!context.isFeatureInFlight(slug)) rekicked.push(slug);
          }
        },
      },
      { concurrency: 2, once: true },
    );

    expect(secondObservedFirstPinned).toBe(true);
    expect(rekicked).toEqual(['halted']);
    expect(result.processed.map((outcome) => outcome.slug).sort()).toEqual(['first', 'second']);
  });

  it('rate-limits busy refreshes while preserving their refresh-and-rekick policy', async () => {
    let now = 0;
    const maintenance = new DaemonMaintenance(
      () => 1,
      () => false,
      100,
      () => now,
    );
    const operations: string[] = [];
    const refresh = async () => {
      operations.push('refresh');
      return [] as string[];
    };
    const rekick = async () => {
      operations.push('rekick');
    };

    await maintenance.refreshAndRekick(refresh, rekick);
    now = 99;
    await maintenance.refreshAndRekick(refresh, rekick);
    now = 100;
    await maintenance.refreshAndRekick(refresh, rekick);

    expect(operations).toEqual(['refresh', 'rekick', 'refresh', 'rekick']);
  });

  it('base-advance re-kick skips an in-flight halted slug before it can be rebased', async () => {
    const cleared: string[] = [];
    const rebaseChecks: string[] = [];
    const result = await rekickSweep(
      {
        listHaltedWorktrees: async () => ['in-flight', 'halted'],
        readHaltReason: async () => 'base advanced',
        hasRebaseInProgress: async (slug) => {
          rebaseChecks.push(slug);
          return false;
        },
        abortRebase: async () => {
          throw new Error('an in-flight slug must not reach abort');
        },
        clearMarker: async (slug) => {
          cleared.push(slug);
        },
        lastRekickSha: new Map(),
        isFeatureInFlight: (slug) => slug === 'in-flight',
      },
      'base-s2',
    );

    expect(result).toEqual({ cleared: ['halted'], skipped: ['in-flight'] });
    expect(rebaseChecks).toEqual(['halted']);
    expect(cleared).toEqual(['halted']);
  });

  it('runs the periodic sweep on a busy timer and exposes in-flight slugs to its skip predicate', async () => {
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    let releasePoll: (() => void) | undefined;
    let pollStarted: (() => void) | undefined;
    const pollStartedPromise = new Promise<void>((resolve) => {
      pollStarted = resolve;
    });
    const sweepContexts: Array<{ first: boolean; second: boolean }> = [];

    const run = runDaemon(
      {
        discoverBacklog: async () => [{ slug: 'first' }, { slug: 'second' }],
        runFeature: async (item) => {
          await new Promise<void>((resolve) => {
            if (item.slug === 'first') releaseFirst = resolve;
            else releaseSecond = resolve;
          });
          return { slug: item.slug, status: 'done' };
        },
        sleep: async () => {
          pollStarted?.();
          await new Promise<void>((resolve) => {
            releasePoll = resolve;
          });
        },
        sweepMergeableLabels: async (context) => {
          sweepContexts.push({
            first: context.isFeatureInFlight('first'),
            second: context.isFeatureInFlight('second'),
          });
          releaseFirst?.();
          releaseSecond?.();
        },
      },
      { concurrency: 2, once: true, idlePollMs: 0 },
    );
    await pollStartedPromise;
    releasePoll?.();
    const result = await run;

    expect(sweepContexts).toContainEqual({ first: true, second: true });
    expect(result.processed.map((outcome) => outcome.slug).sort()).toEqual(['first', 'second']);
  });
});
