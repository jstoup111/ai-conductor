/**
 * Tests for FR-1 (Task 11) pause gating at the dispatch boundary.
 *
 * `isPaused` is an OPTIONAL injected dep on `DaemonDeps`. Absent → never
 * paused (byte-for-byte pre-existing behavior for every test that doesn't
 * wire it). When present and returning true, the fill-pool block must not
 * pick/dispatch any NEW item — in-flight work is completely unaffected, and
 * the predicate is re-polled on every loop iteration (including each idle
 * tick) so lifting the pause mid-run resumes dispatch at the next boundary
 * without a restart.
 */

import { describe, it, expect } from 'vitest';
import { runDaemon, type BacklogItem, type DaemonDeps } from '../../src/engine/daemon.js';

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({ slug: `f${i}` }));
}

describe('daemon pause gating (FR-1 / Task 11)', () => {
  it('isPaused true → zero dispatch across ticks though the backlog has eligible items', async () => {
    const dispatched: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(3),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => true,
    };

    const result = await runDaemon(deps, { concurrency: 1, once: true });

    expect(dispatched).toEqual([]);
    expect(result.processed).toEqual([]);
    expect(result.stoppedReason).toBe('backlog_drained');
  });

  it('items already in flight when pause begins complete/park normally', async () => {
    let paused = false;
    let resolveFeature: (() => void) | undefined;
    const dispatched: string[] = [];
    const completed: string[] = [];

    const deps: DaemonDeps = {
      // Only one item ever discoverable — once dispatched, the pause flips on
      // for subsequent polls so we can assert the in-flight one still finishes.
      discoverBacklog: async () => (dispatched.length === 0 ? items(1) : []),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        paused = true; // pause takes effect the moment this feature starts
        await new Promise<void>((resolve) => {
          resolveFeature = resolve;
        });
        completed.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => paused,
    };

    const runPromise = runDaemon(deps, { concurrency: 1, once: true });

    // Give the in-flight feature a tick to start, then let it finish.
    await new Promise((r) => setTimeout(r, 10));
    expect(dispatched).toEqual(['f0']);
    resolveFeature?.();

    const result = await runPromise;

    expect(completed).toEqual(['f0']);
    expect(result.processed).toEqual([{ slug: 'f0', status: 'done' }]);
    // No second item was ever dispatched (none discoverable once dispatched.length > 0
    // AND pause was on for the whole remaining run).
    expect(dispatched).toEqual(['f0']);
  });

  it('idle tick re-polls the pause predicate: lifting it mid-run resumes dispatch at the next boundary', async () => {
    let paused = true;
    const dispatched: string[] = [];
    let polls = 0;

    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => {
        polls++;
        // Lift the pause after a couple of idle polls so we can observe the
        // gated period first, then the resumed dispatch.
        if (polls >= 3) paused = false;
        return paused;
      },
      sleep: async () => {}, // no real waiting in the test
    };

    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      idlePollMs: 0,
      maxIdlePolls: 10,
    });

    expect(dispatched).toEqual(['f0']);
    expect(result.processed).toEqual([{ slug: 'f0', status: 'done' }]);
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it('pause gating prevents dispatch at-most-once per item (never double-counted once resumed)', async () => {
    let paused = true;
    const dispatched: string[] = [];

    const deps: DaemonDeps = {
      discoverBacklog: async () => items(2),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => paused,
      sleep: async () => {
        paused = false; // resume after the first idle wait
      },
    };

    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      idlePollMs: 0,
      maxIdlePolls: 10,
    });

    expect(dispatched).toEqual(['f0', 'f1']);
    expect(dispatched.filter((s) => s === 'f0')).toHaveLength(1);
    expect(dispatched.filter((s) => s === 'f1')).toHaveLength(1);
    expect(result.stoppedReason).toBe('idle_timeout');
  });

  it('absent isPaused dep → unchanged pre-existing behavior (dispatches normally)', async () => {
    const dispatched: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(2),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
    };

    const result = await runDaemon(deps, { concurrency: 1, once: true });

    expect(dispatched).toEqual(['f0', 'f1']);
    expect(result.processed).toHaveLength(2);
  });
});
