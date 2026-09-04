// Covers: task:11, task:12, task:14
import { describe, expect, it, vi } from 'vitest';
import {
  DaemonMaintenance,
  type DaemonMaintenanceOperation,
} from '../../src/engine/daemon-maintenance.js';
import type { FeatureExecutor } from '../../src/engine/feature-executor.js';
import { rekickSweep } from '../../src/engine/daemon-rekick.js';
import type { WorkClaims } from '../../src/engine/work-claims.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

const maintenanceTrace = vi.hoisted(() => ({ operations: [] as DaemonMaintenanceOperation[] }));

function trackedClaims(attempts: string[]): WorkClaims {
  const active = new Set<string>();
  return {
    claim(slug) {
      attempts.push(slug);
      if (active.has(slug)) return false;
      active.add(slug);
      return true;
    },
    release(slug) {
      active.delete(slug);
    },
    list() {
      return [...active];
    },
  };
}

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

  it('drains two stale-engine workers before rebuilding and restarting exactly once', async () => {
    const claimAttempts: string[] = [];
    const started: string[] = [];
    const logs: string[] = [];
    const events: string[] = [];
    let releaseWorkers: (() => void) | undefined;
    let staleChecks = 0;
    let rebuildCalls = 0;
    const workersReleased = new Promise<void>((resolve) => {
      releaseWorkers = resolve;
    });
    const rebuildEngine = vi.fn(async () => {
      rebuildCalls++;
      // The serial pre-dispatch freshness check is outside this drain test.
      // Only the stale-detected drain rebuild is part of the required order.
      if (rebuildCalls > 1) events.push('rebuild');
    });
    const requestRestart = vi.fn(async () => {
      events.push('restart');
      return { fired: true };
    });

    const result = await runDaemon(
      {
        discoverBacklog: async () => [
          { slug: 'first' },
          { slug: 'second' },
          { slug: 'later' },
        ],
        runFeature: async (item) => {
          started.push(item.slug);
          if (item.slug === 'later') return { slug: item.slug, status: 'done' as const };
          await workersReleased;
          events.push(`finished:${item.slug}`);
          return { slug: item.slug, status: 'done' as const };
        },
        claims: trackedClaims(claimAttempts),
        staleEngineChecker: {
          check: () => (staleChecks++ === 0 ? 'current' : 'stale'),
          capturedIdentity: () => 'engine-before',
          targetIdentity: () => 'engine-after',
        },
        rebuildEngine,
        requestRestart,
        sleep: async () => {
          releaseWorkers?.();
        },
        log: (line) => logs.push(line),
      },
      {
        concurrency: 2,
        once: false,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
        maxIdlePolls: 1,
      },
    );

    expect({
      started,
      claimAttempts,
      events,
      restarts: requestRestart.mock.calls.length,
      stopReason: result.stoppedReason,
      drainLogs: logs.filter((line) => line.startsWith('[daemon] drain started:')),
    }).toEqual({
      started: ['first', 'second'],
      restarts: 1,
      stopReason: 'engine_restart',
      claimAttempts: ['first', 'second'],
      events: ['finished:first', 'finished:second', 'rebuild', 'restart'],
      drainLogs: ['[daemon] drain started: stale-engine'],
    });
  });

  it('drains a busy queued restart before consuming its marker and exiting', async () => {
    const claimAttempts: string[] = [];
    const started: string[] = [];
    const events: string[] = [];
    const recordedDrainSets: string[][] = [];
    let releaseWorkers: (() => void) | undefined;
    const workersReleased = new Promise<void>((resolve) => {
      releaseWorkers = resolve;
    });

    const result = await runDaemon(
      {
        discoverBacklog: async () => [
          { slug: 'first' },
          { slug: 'second' },
          { slug: 'later' },
        ],
        runFeature: async (item) => {
          started.push(item.slug);
          if (item.slug === 'later') return { slug: item.slug, status: 'done' as const };
          await workersReleased;
          events.push(`finished:${item.slug}`);
          return { slug: item.slug, status: 'done' as const };
        },
        claims: trackedClaims(claimAttempts),
        hasRestartPending: async () => true,
        recordRestartPendingDrain: async (slugs) => {
          recordedDrainSets.push([...slugs]);
        },
        consumeRestartPending: async () => {
          events.push('marker-consumed');
        },
        sleep: async () => {
          releaseWorkers?.();
        },
        log: (line) => events.push(line),
      },
      { concurrency: 2, once: false, maxIdlePolls: 1 },
    );

    expect({
      started,
      claimAttempts,
      recordedDrainSets,
      stopReason: result.stoppedReason,
      restartPendingConsumed: result.restartPendingConsumed,
      markerAfterWorkers: events.indexOf('marker-consumed') > events.lastIndexOf('finished:second'),
      drainLogs: events.filter((line) => line.startsWith('[daemon] drain started:')),
    }).toEqual({
      started: ['first', 'second'],
      claimAttempts: ['first', 'second'],
      recordedDrainSets: [['first', 'second']],
      stopReason: 'backlog_drained',
      restartPendingConsumed: true,
      markerAfterWorkers: true,
      drainLogs: ['[daemon] drain started: restart-pending'],
    });
  });

  it('suppresses every root-mutating restart action until the busy drain reaches zero claims', async () => {
    const rootMutationsWhileDraining: string[] = [];
    const rootMutationsAfterDrain: string[] = [];
    let phase: 'before-drain' | 'draining' | 'after-drained' = 'before-drain';
    const logs: string[] = [];
    let releaseWorkers: (() => void) | undefined;
    let observeDrain: (() => void) | undefined;
    let observeBusyPoll: (() => void) | undefined;
    let staleChecks = 0;
    const drainObserved = new Promise<void>((resolve) => {
      observeDrain = resolve;
    });
    const busyPollObserved = new Promise<void>((resolve) => {
      observeBusyPoll = resolve;
    });
    const workersReleased = new Promise<void>((resolve) => {
      releaseWorkers = resolve;
    });
    const recordRootMutation = (operation: string) => {
      if (phase === 'draining') rootMutationsWhileDraining.push(operation);
      if (phase === 'after-drained') rootMutationsAfterDrain.push(operation);
    };

    const run = runDaemon(
      {
        discoverBacklog: async () => [{ slug: 'first' }, { slug: 'second' }],
        runFeature: async (item) => {
          await workersReleased;
          return { slug: item.slug, status: 'done' as const };
        },
        staleEngineChecker: {
          check: () => (staleChecks++ === 0 ? 'current' : 'stale'),
          capturedIdentity: () => 'engine-before',
          targetIdentity: () => 'engine-after',
        },
        refreshEngineSource: async () => {
          recordRootMutation('refresh');
        },
        rebuildEngine: async () => {
          recordRootMutation('rebuild');
        },
        requestRestart: async () => {
          recordRootMutation('relink');
          recordRootMutation('restart');
          return { fired: true };
        },
        log: (line) => {
          logs.push(line);
          if (line === '[daemon] drain started: stale-engine') {
            phase = 'draining';
            observeDrain?.();
          }
        },
        sleep: async () => {
          observeBusyPoll?.();
          await workersReleased;
        },
      },
      {
        concurrency: 2,
        once: false,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
        idlePollMs: 0,
        maxIdlePolls: 0,
      },
    );

    const firstBoundary = await Promise.race([
      drainObserved.then(() => 'drain-started' as const),
      busyPollObserved.then(() => 'busy-poll' as const),
    ]);
    try {
      expect(firstBoundary).toBe('drain-started');
      expect(rootMutationsWhileDraining).toEqual([]);
    } finally {
      phase = 'after-drained';
      releaseWorkers?.();
      await run;
    }

    expect({ rootMutationsAfterDrain, logs }).toEqual({
      rootMutationsAfterDrain: ['refresh', 'rebuild', 'relink', 'restart'],
      logs: expect.arrayContaining(['[daemon] drain started: stale-engine']),
    });
  });

  it('refuses a feature that becomes eligible during drain, then lets the restarted daemon claim it', async () => {
    const firstRunClaimAttempts: string[] = [];
    const firstRunStarted: string[] = [];
    let laterEligible = false;
    let releaseWorkers: (() => void) | undefined;
    let observeDrain: (() => void) | undefined;
    let restartFired: (() => void) | undefined;
    const drainObserved = new Promise<void>((resolve) => {
      observeDrain = resolve;
    });
    const workersReleased = new Promise<void>((resolve) => {
      releaseWorkers = resolve;
    });
    const restartFiredPromise = new Promise<void>((resolve) => {
      restartFired = resolve;
    });

    const firstRun = runDaemon(
      {
        discoverBacklog: async () => [
          { slug: 'first' },
          { slug: 'second' },
          ...(laterEligible ? [{ slug: 'newly-eligible' }] : []),
        ],
        runFeature: async (item) => {
          firstRunStarted.push(item.slug);
          await workersReleased;
          return { slug: item.slug, status: 'done' as const };
        },
        claims: trackedClaims(firstRunClaimAttempts),
        hasRestartPending: async () => true,
        triggerSelfRestart: async () => {
          restartFired?.();
        },
        log: (line) => {
          if (line === '[daemon] drain started: restart-pending') observeDrain?.();
        },
      },
      { concurrency: 2, once: false, idlePollMs: 0, maxIdlePolls: 0 },
    );

    await drainObserved;
    laterEligible = true;
    releaseWorkers?.();
    await Promise.all([firstRun, restartFiredPromise]);

    const restartedRunClaimAttempts: string[] = [];
    const restartedRunStarted: string[] = [];
    await runDaemon(
      {
        discoverBacklog: async () => [{ slug: 'newly-eligible' }],
        runFeature: async (item) => {
          restartedRunStarted.push(item.slug);
          return { slug: item.slug, status: 'done' as const };
        },
        claims: trackedClaims(restartedRunClaimAttempts),
      },
      { concurrency: 1, once: true },
    );

    expect({ firstRunClaimAttempts, firstRunStarted, restartedRunClaimAttempts, restartedRunStarted }).toEqual({
      firstRunClaimAttempts: ['first', 'second'],
      firstRunStarted: ['first', 'second'],
      restartedRunClaimAttempts: ['newly-eligible'],
      restartedRunStarted: ['newly-eligible'],
    });
  });

  it('retries one failed restart firing, logs the retry once, then keeps the successful firing one-shot', async () => {
    const logs: string[] = [];
    let triggerCalls = 0;

    const result = await runDaemon(
      {
        discoverBacklog: async () => [],
        runFeature: async () => {
          throw new Error('empty backlog must not dispatch');
        },
        hasRestartPending: async () => true,
        triggerSelfRestart: async () => {
          triggerCalls++;
          if (triggerCalls === 1) throw new Error('tmux respawn unavailable');
        },
        log: (line) => logs.push(line),
      },
      { concurrency: 1, once: false, idlePollMs: 0, maxIdlePolls: 3 },
    );

    expect({
      triggerCalls,
      stopReason: result.stoppedReason,
      retryLogs: logs.filter((line) => line.includes('self-restart trigger failed')),
      firingLogs: logs.filter((line) => line.includes('self-restart marker found at idle boundary; firing trigger')),
      completionLogs: logs.filter((line) => line.includes('self-restart trigger completed')),
    }).toEqual({
      triggerCalls: 2,
      stopReason: 'idle_timeout',
      retryLogs: ['[daemon] self-restart trigger failed: tmux respawn unavailable; will retry at next idle boundary'],
      firingLogs: [
        '[daemon] self-restart marker found at idle boundary; firing trigger',
        '[daemon] self-restart marker found at idle boundary; firing trigger',
      ],
      completionLogs: ['[daemon] self-restart trigger completed (no respawn yet)'],
    });
  });
});
