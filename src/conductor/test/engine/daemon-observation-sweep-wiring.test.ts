/**
 * Wiring test for Story "The sweep is wired into the production daemon and can
 * never block it" (.docs/stories/issues-close-on-first-production-observation-of-th.md).
 *
 * Mirrors the FR-14 "sweep cadence in daemon.ts" pattern in
 * test/engine/daemon-runner-mergeable.test.ts for sweepMergeableLabels: asserts
 * the CORE runDaemon loop invokes an injected sweepObservationWatch dep inside
 * sweepBestEffort (not just that the sweepObservationWatch primitive works
 * standalone), on the SAME cadence (startup + idle-poll ticks), and that a
 * throw from it never disrupts reconcileHaltPrs / sweepMergeableLabels / the
 * dispatch loop — the anti-orphaning lesson this story exists to enforce
 * (#462: merged != loaded != exercised, see feedback_merged_loaded_exercised).
 *
 * Pre-implementation: `DaemonDeps` has no `sweepObservationWatch` field yet, so
 * runDaemon never calls it — RED for the right reason (assertion failure, not
 * a crash) until daemon.ts's sweepBestEffort gains the third best-effort call.
 */

import { describe, it, expect } from 'vitest';
import { runDaemon, type DaemonDeps } from '../../src/engine/daemon.js';

describe('wiring: observation sweep runs inside sweepBestEffort', () => {
  it('startup sweepBestEffort invokes sweepObservationWatch alongside reconcileHaltPrs and sweepMergeableLabels', async () => {
    const order: string[] = [];

    const deps = {
      discoverBacklog: async () => [],
      runFeature: async (it: { slug: string }) => ({ slug: it.slug, status: 'done' }),
      reconcileHaltPrs: async () => {
        order.push('reconcileHaltPrs');
      },
      sweepMergeableLabels: async () => {
        order.push('sweepMergeableLabels');
      },
      sweepObservationWatch: async () => {
        order.push('sweepObservationWatch');
      },
    } as unknown as DaemonDeps;

    await runDaemon(deps, { concurrency: 1, once: true });

    expect(order).toContain('sweepObservationWatch');
  });

  it('runs once per idle-poll tick, same cadence as sweepMergeableLabels (startup + one per sleep)', async () => {
    let sleptCount = 0;
    let observationSweepCount = 0;

    const deps = {
      discoverBacklog: async () => [],
      runFeature: async (it: { slug: string }) => ({ slug: it.slug, status: 'done' }),
      sleep: async () => {
        sleptCount++;
      },
      sweepObservationWatch: async () => {
        observationSweepCount++;
      },
    } as unknown as DaemonDeps;

    await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 3 });

    expect(sleptCount).toBe(3);
    // 1 startup sweep + 3 idle-poll sweeps (one per sleep/tick).
    expect(observationSweepCount).toBe(4);
  });

  it('a throw from sweepObservationWatch is caught and logged; reconcileHaltPrs, sweepMergeableLabels, and dispatch still run', async () => {
    const order: string[] = [];
    const logs: string[] = [];

    const deps = {
      discoverBacklog: async () => [{ slug: 'f0' }],
      runFeature: async (it: { slug: string }) => {
        order.push(`dispatch:${it.slug}`);
        return { slug: it.slug, status: 'done' };
      },
      log: (m: string) => logs.push(m),
      reconcileHaltPrs: async () => {
        order.push('reconcileHaltPrs');
      },
      sweepMergeableLabels: async () => {
        order.push('sweepMergeableLabels');
      },
      sweepObservationWatch: async () => {
        throw new Error('observation sweep failed');
      },
    } as unknown as DaemonDeps;

    const res = await runDaemon(deps, { concurrency: 1, once: true });

    expect(order).toEqual(['reconcileHaltPrs', 'sweepMergeableLabels', 'dispatch:f0']);
    expect(res.processed).toHaveLength(1);
    expect(res.processed[0].status).toBe('done');
    expect(
      logs.some((l) => l.includes('[daemon]') && /sweepObservationWatch/i.test(l) && /observation sweep failed/.test(l)),
    ).toBe(true);
  });

  it('absent sweepObservationWatch dep: no crash, no log noise mentioning it (feature stays disableable)', async () => {
    const logs: string[] = [];

    const deps = {
      discoverBacklog: async () => [],
      runFeature: async (it: { slug: string }) => ({ slug: it.slug, status: 'done' }),
      log: (m: string) => logs.push(m),
    } as unknown as DaemonDeps;

    await expect(runDaemon(deps, { concurrency: 1, once: true })).resolves.toBeDefined();
    expect(logs.some((l) => /sweepObservationWatch/i.test(l))).toBe(false);
  });
});
