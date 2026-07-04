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

  it('isPaused raising a non-ENOENT error is treated as paused: zero dispatch while the error persists', async () => {
    const dispatched: string[] = [];
    let polls = 0;

    const deps: DaemonDeps = {
      discoverBacklog: async () => items(2),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => {
        polls++;
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      },
      sleep: async () => {},
    };

    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      idlePollMs: 0,
      maxIdlePolls: 3,
    });

    expect(dispatched).toEqual([]);
    expect(result.processed).toEqual([]);
    expect(result.stoppedReason).toBe('idle_timeout');
    expect(polls).toBeGreaterThan(0);
  });

  it('warns once per transition into the error state (not once per poll), and once on recovery', async () => {
    const dispatched: string[] = [];
    const logs: string[] = [];
    let polls = 0;

    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => {
        polls++;
        // Error on polls 1-3, then recover.
        if (polls <= 3) {
          throw new Error('EIO: i/o error');
        }
        return false;
      },
      sleep: async () => {},
      log: (msg) => logs.push(msg),
    };

    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      idlePollMs: 0,
      maxIdlePolls: 10,
    });

    expect(dispatched).toEqual(['f0']);
    expect(result.processed).toEqual([{ slug: 'f0', status: 'done' }]);
    expect(polls).toBeGreaterThanOrEqual(4);

    const failClosedWarnings = logs.filter((l) => l.includes('failing closed'));
    const recoveryLogs = logs.filter((l) => l.includes('recovered'));
    expect(failClosedWarnings).toHaveLength(1);
    expect(recoveryLogs).toHaveLength(1);
  });

  it('FR-1 (Task 12): paused daemon + HALT-parked item + base-SHA advance → no re-kick dispatch', async () => {
    const dispatched: string[] = [];
    let rekickCalls = 0;
    let writeCalls = 0;

    const deps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => true,
      isHalted: async () => true,
      resolveBaseSha: async () => 'sha-2',
      readPersistedBaseSha: async () => 'sha-1', // prior SHA present → a genuine advance
      writePersistedBaseSha: async () => {
        writeCalls++;
      },
      rekickSweep: async () => {
        rekickCalls++;
      },
    };

    const result = await runDaemon(deps, { concurrency: 1, once: true });

    // Paused throughout: the base-SHA advance is never observed/acted on.
    expect(rekickCalls).toBe(0);
    expect(writeCalls).toBe(0);
    expect(dispatched).toEqual([]);
    expect(result.processed).toEqual([]);
  });

  it('FR-1 (Task 12): resume → re-kick eligible again', async () => {
    let paused = true;
    let rekickCalls = 0;
    let current = 'sha-1';

    const deps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async (item) => ({ slug: item.slug, status: 'done' as const }),
      isPaused: async () => paused,
      isHalted: async () => true,
      resolveBaseSha: async () => current,
      readPersistedBaseSha: async () => 'sha-0', // prior SHA present → genuine advances count
      writePersistedBaseSha: async () => {},
      rekickSweep: async () => {
        rekickCalls++;
      },
      sleep: async () => {
        // Resume, and advance the base SHA again, on the first idle wait.
        paused = false;
        current = 'sha-2';
      },
    };

    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      idlePollMs: 0,
      maxIdlePolls: 3,
    });

    // While paused (startup + first idle tick before resume) no sweep ran;
    // once resumed, the subsequent advance triggers the sweep.
    expect(rekickCalls).toBeGreaterThanOrEqual(1);
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
