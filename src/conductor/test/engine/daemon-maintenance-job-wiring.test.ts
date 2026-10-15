// Covers: task:7
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

  it('starts maintenance from a width-1 busy poll without awaiting a pending job', async () => {
    const calls: string[] = [];
    const feature = deferred<FeatureOutcome>();
    const dashboard = deferred<void>();
    const poll = deferred<void>();
    const firstStarted = deferred<void>();

    const daemon = runDaemon(depsFor(calls, [{ slug: 'one' }], {
      runFeature: async (item) => {
        calls.push(`dispatch:${item.slug}`);
        firstStarted.resolve();
        return feature.promise;
      },
      renderStartupDashboard: async () => {
        calls.push('dashboard');
        return dashboard.promise;
      },
      sleep: async () => poll.promise,
    }), { concurrency: 1, once: true, idlePollMs: 1 });

    await firstStarted.promise;
    await vi.waitFor(() => expect(calls).toEqual(['dispatch:one', 'dashboard']));
    poll.resolve();
    await vi.waitFor(() => expect(calls).toEqual(['dispatch:one', 'dashboard']));

    dashboard.resolve();
    await vi.waitFor(() => expect(calls).toContain('mergeable'));
    feature.resolve(done('one'));
    await daemon;
  });
});
