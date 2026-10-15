// Covers: task:4
// Covers: task:5
// Covers: task:6
import { describe, expect, it } from 'vitest';
import { runDaemon, type BacklogItem, type DaemonDeps, type FeatureOutcome } from '../../src/engine/daemon.js';
import { DaemonMaintenance } from '../../src/engine/daemon-maintenance.js';

const done = (slug: string): FeatureOutcome => ({ slug, status: 'done' });

function depsFor(
  log: string[],
  startup: BacklogItem[],
  overrides: Partial<DaemonDeps> = {},
): DaemonDeps {
  return {
    discoverBacklog: async ({ refresh }) => {
      log.push(`discover:${refresh}`);
      return refresh ? startup : [];
    },
    runFeature: async (item) => {
      log.push(`dispatch:${item.slug}`);
      return done(item.slug);
    },
    isPaused: async () => { log.push('gate:pause'); return false; },
    isBuildAuthMissing: async () => { log.push('gate:build-auth'); return false; },
    getGhVersionFloorDiagnostic: async () => { log.push('gate:gh-version'); return null; },
    isHalted: async (slug) => { log.push(`halted:${slug}`); return false; },
    isParked: async (slug) => { log.push(`parked:${slug}`); return false; },
    probeEngineStaleness: async () => { log.push('stale-engine'); },
    renderStartupDashboard: async () => { log.push('dashboard'); },
    consumeResumeAuthorizations: async () => { log.push('resume-auth'); },
    reconcileHaltPrs: async () => { log.push('halt-prs'); },
    reconcileParkedFeatures: async () => { log.push('parked-reconcile'); },
    sweepProviderScratch: async () => { log.push('provider-scratch'); },
    sweepMergeableLabels: async () => { log.push('mergeable-sweep'); },
    log: (message) => { log.push(message); },
    ...overrides,
  };
}

describe('dispatch-first startup maintenance', () => {
  it('logs a failed startup refresh once and claims from local discovery before maintenance', async () => {
    const log: string[] = [];
    let atFirstDispatch: string[] = [];

    await runDaemon(depsFor(log, [], {
      discoverBacklog: async ({ refresh }) => {
        log.push(`discover:${refresh}`);
        if (refresh) throw new Error('origin unavailable');
        return [{ slug: 'local-first' }];
      },
      runFeature: async (item) => {
        atFirstDispatch = [...log];
        log.push(`dispatch:${item.slug}`);
        return done(item.slug);
      },
    }), { concurrency: 1, once: true, maxItems: 1 });

    expect(log.filter((entry) => entry.includes('startup origin refresh failed'))).toEqual([
      '[daemon] startup origin refresh failed: origin unavailable',
    ]);
    expect(atFirstDispatch).toContain('discover:false');
    expect(atFirstDispatch).not.toEqual(expect.arrayContaining([
      'dashboard', 'resume-auth', 'halt-prs', 'parked-reconcile', 'provider-scratch', 'mergeable-sweep',
    ]));
    expect(log).toContain('dispatch:local-first');
  });

  it('reuses the startup base for rekick without a second refresh', async () => {
    const log: string[] = [];
    let startupRefreshes = 0;
    const rekicks: string[] = [];

    await runDaemon(depsFor(log, [{ slug: 'first' }], {
      discoverBacklog: async ({ refresh }) => {
        log.push(`discover:${refresh}`);
        if (refresh) startupRefreshes++;
        return refresh ? [{ slug: 'first' }] : [];
      },
      readPersistedBaseSha: async () => 'A',
      resolveBaseSha: async ({ refresh }) => {
        log.push(`base:${refresh}`);
        return 'S';
      },
      rekickSweep: async (sha) => { rekicks.push(sha); },
    }), { concurrency: 1, once: true, maxItems: 1 });

    expect(startupRefreshes).toBe(1);
    expect(rekicks).toEqual(['S']);
    expect(log).toContain('base:false');
    expect(log).not.toContain('base:true');
  });

  it('seeds a missing persisted base without a rekick sweep', async () => {
    const log: string[] = [];
    const rekicks: string[] = [];
    const persisted: string[] = [];

    await runDaemon(depsFor(log, [{ slug: 'first' }], {
      readPersistedBaseSha: async () => null,
      writePersistedBaseSha: async (sha) => { persisted.push(sha); },
      resolveBaseSha: async ({ refresh }) => {
        log.push(`base:${refresh}`);
        return 'S';
      },
      rekickSweep: async (sha) => { rekicks.push(sha); },
    }), { concurrency: 1, once: true, maxItems: 1 });

    expect(rekicks).toEqual([]);
    expect(persisted).toEqual(['S']);
    expect(log).toContain('base:false');
    expect(log).not.toContain('base:true');
  });

  it('starts the later refresh interval at the startup refresh', () => {
    let now = 100;
    const maintenance = new DaemonMaintenance(() => 0, () => false, 50, () => now);

    maintenance.recordRefresh(now);
    now = 149;
    expect(maintenance.refreshStartable()).toBe(false);
    now = 150;
    expect(maintenance.refreshStartable()).toBe(true);
  });

  it.each([1, 3])('claims before maintenance at width %i', async (concurrency) => {
    const log: string[] = [];
    let atFirstDispatch: string[] = [];
    const deps = depsFor(log, [{ slug: 'first' }], {
      runFeature: async (item) => {
        atFirstDispatch = [...log];
        log.push(`dispatch:${item.slug}`);
        return done(item.slug);
      },
    });

    await runDaemon(deps, { concurrency, once: true, maxItems: 1 });

    expect(atFirstDispatch).toContain('gate:pause');
    expect(atFirstDispatch).toContain('gate:build-auth');
    expect(atFirstDispatch).toContain('gate:gh-version');
    expect(atFirstDispatch).toContain('discover:true');
    expect(atFirstDispatch).toContain('halted:first');
    expect(atFirstDispatch.filter((entry) => entry === 'parked:first')).toHaveLength(2);
    expect(atFirstDispatch).toContain('stale-engine');
    expect(atFirstDispatch).not.toEqual(expect.arrayContaining([
      'dashboard', 'resume-auth', 'halt-prs', 'parked-reconcile', 'provider-scratch', 'mergeable-sweep',
    ]));
    expect(log.indexOf('dashboard')).toBeGreaterThan(log.indexOf('dispatch:first'));
  });

  it('uses refreshed discovery as the first candidate source, excluding shipped records', async () => {
    const log: string[] = [];
    const discovered: Array<{ refresh: boolean }> = [];
    const deps = depsFor(log, [{ slug: 'eligible' }], {
      discoverBacklog: async ({ refresh }) => {
        discovered.push({ refresh });
        // The refreshed-main discovery has already removed `already-shipped`.
        return refresh ? [{ slug: 'eligible' }] : [{ slug: 'already-shipped' }];
      },
    });

    await runDaemon(deps, { concurrency: 1, once: true, maxItems: 1 });

    expect(discovered[0]).toEqual({ refresh: true });
    expect(log).toContain('dispatch:eligible');
    expect(log).not.toContain('dispatch:already-shipped');
  });

  it('refuses a slug parked after selection without creating feature work', async () => {
    const log: string[] = [];
    let parkReads = 0;
    const deps = depsFor(log, [{ slug: 'race' }], {
      isParked: async (slug) => {
        parkReads++;
        log.push(`parked:${slug}:${parkReads}`);
        return parkReads === 2;
      },
    });

    await runDaemon(deps, { concurrency: 1, once: true });

    expect(log).toContain('park: skipped dispatch of race — operator-parked');
    expect(log).not.toContain('dispatch:race');
  });

  it('leaves a live HALT ineligible until background authorization consumption', async () => {
    const log: string[] = [];
    let halted = true;
    const deps = depsFor(log, [{ slug: 'halted' }], {
      discoverBacklog: async ({ refresh }) => {
        log.push(`discover:${refresh}`);
        return [{ slug: 'halted' }];
      },
      isHalted: async (slug) => {
        log.push(`halted:${slug}:${halted}`);
        return halted;
      },
      consumeResumeAuthorizations: async () => {
        log.push('resume-auth');
        halted = false;
      },
      sleep: async () => {},
    });

    await runDaemon(deps, { concurrency: 1, maxItems: 1, maxIdlePolls: 20 });

    expect(log.indexOf('resume-auth')).toBeGreaterThan(log.indexOf('halted:halted:true'));
    expect(log).toContain('dispatch:halted');
  });
});
