// Covers: task:4, task:7, task:9, task:11
import { describe, expect, it, vi } from 'vitest';

import { runDaemon, type BacklogItem, type DaemonDeps, type FeatureOutcome } from '../../src/engine/daemon.js';

const done = (slug: string): FeatureOutcome => ({ slug, status: 'done' });

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

function depsFor(
  calls: string[],
  items: BacklogItem[],
  overrides: Partial<DaemonDeps> = {},
): DaemonDeps {
  return {
    discoverBacklog: async ({ refresh }) => refresh ? items : [],
    runFeature: async (item) => {
      calls.push(`dispatch:${item.slug}`);
      return done(item.slug);
    },
    renderStartupDashboard: async () => { calls.push('dashboard'); },
    readPersistedBaseSha: async () => 'previous-base',
    resolveBaseSha: async () => 'base',
    rekickSweep: async () => { calls.push('rekick'); },
    consumeResumeAuthorizations: async () => { calls.push('resume'); },
    reconcileHaltPrs: async () => { calls.push('halt-prs'); },
    reconcileParkedFeatures: async () => { calls.push('parked'); },
    sweepProviderScratch: async () => { calls.push('scratch'); },
    sweepMergeableLabels: async () => { calls.push('mergeable'); },
    ...overrides,
  };
}

const maintenancePass = ['dashboard', 'rekick', 'resume', 'halt-prs', 'parked', 'scratch', 'mergeable'];

describe('daemon maintenance job wiring', () => {
  it('shares an in-flight resume authorization consumer with the next width-2 fill pass', async () => {
    const calls: string[] = [];
    const firstFeature = deferred<FeatureOutcome>();
    const consume = deferred<void>();
    let halted = true;
    let consumersInFlight = 0;
    let maxConsumersInFlight = 0;

    const daemon = runDaemon(depsFor(calls, [{ slug: 'first' }, { slug: 'resumed' }], {
      discoverBacklog: async () => [{ slug: 'first' }, { slug: 'resumed' }],
      isHalted: async (slug) => slug === 'resumed' && halted,
      runFeature: async (item) => {
        calls.push(`dispatch:${item.slug}`);
        return item.slug === 'first' ? firstFeature.promise : done(item.slug);
      },
      consumeResumeAuthorizations: async () => {
        consumersInFlight++;
        maxConsumersInFlight = Math.max(maxConsumersInFlight, consumersInFlight);
        await consume.promise;
        halted = false;
        consumersInFlight--;
      },
    }), { concurrency: 2, once: true, maxItems: 2, idlePollMs: 0 });

    await vi.waitFor(() => expect(consumersInFlight).toBe(1));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(maxConsumersInFlight).toBe(1);

    consume.resolve();
    await vi.waitFor(() => expect(calls).toContain('dispatch:resumed'));
    firstFeature.resolve(done('first'));
    await daemon;
  });

  it('runs the dashboard only in the first ordered pass and starts a second pass on terminal collection', async () => {
    const calls: string[] = [];

    await runDaemon(depsFor(calls, [{ slug: 'one' }]), {
      concurrency: 1,
      once: true,
      maxItems: 1,
    });

    await vi.waitFor(() => expect(calls).toEqual([
      'dispatch:one',
      ...maintenancePass,
      // The second pass still invokes rekick, but its base has not advanced,
      // so the observable rekick sweep is correctly a no-op.
      'resume', 'halt-prs', 'parked', 'scratch', 'mergeable',
    ]));
  });

  it('skips the dashboard at paused boot but still starts the other maintenance steps', async () => {
    const calls: string[] = [];

    await runDaemon(depsFor(calls, [{ slug: 'one' }], {
      isPaused: async () => true,
    }), { concurrency: 1, once: true });

    await vi.waitFor(() => expect(calls).toEqual([
      // `maybeRekick` remains pause-gated; the job invokes it, while its
      // observable sweep remains a no-op under the paused gate.
      'resume', 'halt-prs', 'parked', 'scratch', 'mergeable',
    ]));
  });

  it('collects a worker and dispatches the next feature while a maintenance job is pending', async () => {
    const calls: string[] = [];
    const firstFeature = deferred<FeatureOutcome>();
    const dashboard = deferred<void>();
    const firstStarted = deferred<void>();

    const daemon = runDaemon(depsFor(calls, [{ slug: 'one' }, { slug: 'two' }], {
      discoverBacklog: async () => [{ slug: 'one' }, { slug: 'two' }],
      runFeature: async (item) => {
        calls.push(`dispatch:${item.slug}`);
        if (item.slug === 'one') {
          firstStarted.resolve();
          return firstFeature.promise;
        }
        return done(item.slug);
      },
      renderStartupDashboard: async () => {
        calls.push('dashboard');
        return dashboard.promise;
      },
    }), { concurrency: 1, once: true, maxItems: 2, idlePollMs: 0 });

    await firstStarted.promise;
    await vi.waitFor(() => expect(calls).toEqual(['dispatch:one', 'dashboard']));
    firstFeature.resolve(done('one'));
    await vi.waitFor(() => expect(calls).toContain('dispatch:two'));
    dashboard.resolve();
    await daemon;
  });

  it('continues the remaining maintenance steps and dispatches after a failed step', async () => {
    const calls: string[] = [];
    let discoveries = 0;

    await runDaemon(depsFor(calls, [], {
      discoverBacklog: async () => {
        discoveries++;
        return discoveries === 1 ? [{ slug: 'one' }] : [{ slug: 'two' }];
      },
      renderStartupDashboard: async () => { throw new Error('dashboard failed'); },
      log: (message) => calls.push(message),
    }), { concurrency: 1, once: true, maxItems: 2, idlePollMs: 0 });

    expect(calls).toContain('[daemon] startup-dashboard error: dashboard failed');
    expect(calls).toEqual(expect.arrayContaining([
      'dispatch:one', 'dispatch:two', 'rekick', 'resume', 'halt-prs', 'parked', 'scratch', 'mergeable',
    ]));
  });

  it('closes a pending maintenance job before a stale-engine drain restart and suppresses later triggers', async () => {
    const calls: string[] = [];
    const feature = deferred<FeatureOutcome>();
    const dashboard = deferred<void>();
    const started = deferred<void>();
    const restart = vi.fn(async () => { calls.push('restart'); return { fired: true }; });
    let checks = 0;

    const daemon = runDaemon(depsFor(calls, [{ slug: 'one' }], {
      runFeature: async (item) => {
        calls.push(`dispatch:${item.slug}`);
        started.resolve();
        return feature.promise;
      },
      renderStartupDashboard: async () => {
        calls.push('dashboard');
        return dashboard.promise;
      },
      staleEngineChecker: {
        check: () => (++checks === 1 ? 'fresh' : 'stale'),
        targetIdentity: () => 'target',
        capturedIdentity: () => 'captured',
      },
      requestRestart: restart,
    }), { concurrency: 2, once: false, isSelfHost: true, autoRestartOnStaleEngine: true, idlePollMs: 0 });

    await started.promise;
    await vi.waitFor(() => expect(calls).toEqual(expect.arrayContaining(['dispatch:one', 'dashboard'])));
    feature.resolve(done('one'));
    await vi.waitFor(() => expect(checks).toBeGreaterThan(1));
    await Promise.resolve();
    expect(restart).not.toHaveBeenCalled();
    dashboard.resolve();
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    expect(calls.indexOf('restart')).toBeGreaterThan(calls.indexOf('mergeable'));
    await daemon;
  });

  it('waits for a running maintenance job during shouldStop teardown without starting another step', async () => {
    const calls: string[] = [];
    const dashboard = deferred<void>();
    let stop = false;

    const daemon = runDaemon(depsFor(calls, [{ slug: 'one' }], {
      runFeature: async (item) => {
        calls.push(`dispatch:${item.slug}`);
        stop = true;
        return done(item.slug);
      },
      renderStartupDashboard: async () => {
        calls.push('dashboard');
        return dashboard.promise;
      },
      shouldStop: () => stop,
    }), { concurrency: 1, once: false, idlePollMs: 0 });

    await vi.waitFor(() => expect(calls).toEqual(['dispatch:one', 'dashboard']));
    let returned = false;
    void daemon.then(() => { returned = true; });
    await Promise.resolve();
    expect(returned).toBe(false);
    dashboard.resolve();
    await daemon;
    expect(calls).toEqual([
      'dispatch:one', 'dashboard', 'rekick', 'resume', 'halt-prs', 'parked', 'scratch', 'mergeable',
    ]);
  });
});
