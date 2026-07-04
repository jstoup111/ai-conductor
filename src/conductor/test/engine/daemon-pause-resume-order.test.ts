/**
 * Task 18 (FR-2): resume is ordering-neutral.
 *
 * Assert-only against the T11 pause gate (`isPaused` on `DaemonDeps`) —
 * production must never mutate backlog state anywhere in the pause/resume
 * path. These tests drive the real `runDaemon` core (not a mock) and prove:
 *
 *   1. A control run (never paused) and a pause→enqueue→resume run dispatch
 *      the identical backlog in the identical order.
 *   2. The backlog/ledger inputs handed to `discoverBacklog` are byte-equal
 *      (deep-equal) whether observed before the pause or after the resume —
 *      pausing never rewrites/reorders/filters the underlying backlog.
 *   3. A resume racing a live idle-poll tick never causes an item to be
 *      dispatched more than once.
 */

import { describe, it, expect } from 'vitest';
import { runDaemon, type BacklogItem, type DaemonDeps } from '../../src/engine/daemon.js';

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({ slug: `f${i}` }));
}

describe('resume is ordering-neutral (FR-2 / Task 18)', () => {
  it('control run vs pause→enqueue→resume run: identical dispatch order', async () => {
    const backlog = items(5);

    // Control: never paused.
    const controlOrder: string[] = [];
    const controlResult = await runDaemon(
      {
        discoverBacklog: async () => backlog,
        runFeature: async (item) => {
          controlOrder.push(item.slug);
          return { slug: item.slug, status: 'done' };
        },
      },
      { concurrency: 1, once: true },
    );

    // Pause → enqueue (same backlog discoverable while paused, nothing
    // dispatched) → resume.
    let paused = true;
    const pausedOrder: string[] = [];
    const pausedResult = await runDaemon(
      {
        discoverBacklog: async () => backlog,
        runFeature: async (item) => {
          pausedOrder.push(item.slug);
          return { slug: item.slug, status: 'done' };
        },
        isPaused: async () => paused,
      },
      { concurrency: 1, once: true },
    );
    // While paused, the "once" run drains to backlog_drained with zero dispatch —
    // this simulates "enqueue while paused: nothing moves".
    expect(pausedOrder).toEqual([]);
    expect(pausedResult.stoppedReason).toBe('backlog_drained');

    // Resume: lift the pause and re-run against the SAME untouched backlog.
    paused = false;
    const resumedResult = await runDaemon(
      {
        discoverBacklog: async () => backlog,
        runFeature: async (item) => {
          pausedOrder.push(item.slug);
          return { slug: item.slug, status: 'done' };
        },
        isPaused: async () => paused,
      },
      { concurrency: 1, once: true },
    );

    expect(pausedOrder).toEqual(controlOrder);
    expect(pausedOrder).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
    expect(resumedResult.processed.map((o) => o.slug)).toEqual(controlResult.processed.map((o) => o.slug));
  });

  it('backlog/ledger inputs are byte-equal (deep-equal) before pause vs after resume', async () => {
    // A backlog with every optional field populated so a shallow-equal check
    // could not silently pass while a deep field was mutated/dropped.
    const backlog: BacklogItem[] = [
      { slug: 'a', tier: 'M', sourceRef: 'org/repo#1', track: 'technical', band: 'p1', resolutionMode: 'banded' },
      { slug: 'b', tier: 'S', sourceRef: 'org/repo#2', track: 'product', band: 'p2', resolutionMode: 'banded' },
    ];
    const snapshotBefore = JSON.parse(JSON.stringify(backlog));

    // Snapshot what discovery would hand out BEFORE the pause is ever engaged
    // (a plain, unpaused discovery call — the "ledger input" baseline).
    const seenBeforePause = JSON.parse(JSON.stringify(await Promise.resolve(backlog)));

    let paused = true;
    const seenAfterResume: BacklogItem[][] = [];

    const deps: DaemonDeps = {
      discoverBacklog: async () => {
        // While paused, the fill-pool block short-circuits before ever
        // calling discoverBacklog (Task 11) — so nothing is recorded here
        // until the pause is lifted. Record what's handed out post-resume.
        const clone = JSON.parse(JSON.stringify(backlog));
        if (!paused) seenAfterResume.push(clone);
        return backlog;
      },
      runFeature: async (item) => ({ slug: item.slug, status: 'done' }),
      isPaused: async () => paused,
    };

    // Paused run: dispatch is fully gated, discoverBacklog is never consulted.
    const pausedRun = await runDaemon(deps, { concurrency: 1, once: true });
    expect(pausedRun.processed).toEqual([]);

    // Resume: lift the pause and let the SAME backlog flow through discovery.
    paused = false;
    await runDaemon(deps, { concurrency: 1, once: true });
    expect(seenAfterResume.length).toBeGreaterThan(0);

    // The backlog object itself was never mutated by the pause/resume cycle.
    expect(backlog).toEqual(snapshotBefore);
    // What discovery observed post-resume is deep-equal to what it would have
    // observed pre-pause — pausing never rewrote, reordered, or filtered the
    // underlying backlog/ledger inputs.
    expect(seenAfterResume[0]).toEqual(seenBeforePause);
  });

  it('resume racing a live idle-poll tick dispatches each item at most once', async () => {
    // isPaused flips false exactly once, from inside `sleep` (the idle-poll
    // wait), simulating an operator's resume call landing in the same window
    // the daemon is about to re-poll. The pool must not double-dispatch the
    // item that becomes eligible the instant the pause lifts.
    let paused = true;
    let flips = 0;
    const dispatched: string[] = [];
    const dispatchCounts = new Map<string, number>();

    const deps: DaemonDeps = {
      discoverBacklog: async () => items(3),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        dispatchCounts.set(item.slug, (dispatchCounts.get(item.slug) ?? 0) + 1);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => paused,
      sleep: async () => {
        // Simulate "resume raced a tick": flip the pause off mid-idle-wait,
        // exactly once, so the very next fill-pool check races the lift.
        flips += 1;
        if (flips === 1) paused = false;
      },
    };

    const result = await runDaemon(deps, {
      concurrency: 2,
      once: false,
      idlePollMs: 0,
      maxIdlePolls: 10,
    });

    expect(dispatched.sort()).toEqual(['f0', 'f1', 'f2']);
    for (const [, count] of dispatchCounts) {
      expect(count).toBe(1);
    }
    expect(result.processed).toHaveLength(3);
    expect(result.processed.map((o) => o.slug).sort()).toEqual(['f0', 'f1', 'f2']);
  });

  it('a pause lifted and re-set repeatedly never reorders or duplicates dispatch', async () => {
    const backlog = items(4);
    let paused = false;
    let toggles = 0;
    const dispatched: string[] = [];

    const deps: DaemonDeps = {
      discoverBacklog: async () => backlog,
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => {
        // Toggle the pause on/off a few times across the run's lifetime
        // (simulating rapid operator pause/resume churn) without ever
        // affecting which items get dispatched or in what order.
        toggles += 1;
        if (toggles % 3 === 0) paused = !paused;
        return paused;
      },
      sleep: async () => {
        paused = false; // always resumed by the next idle wait
      },
    };

    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      idlePollMs: 0,
      maxIdlePolls: 20,
    });

    expect(dispatched).toEqual(['f0', 'f1', 'f2', 'f3']);
    expect(new Set(dispatched).size).toBe(4);
    expect(result.processed.map((o) => o.slug)).toEqual(['f0', 'f1', 'f2', 'f3']);
  });
});
