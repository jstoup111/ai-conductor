/**
 * Tests for Task 7: rate-limit episode dispatch gate.
 *
 * When a rate-limit episode is active (via `DaemonDeps.rateLimitEpisode?.active?.()`)
 * the dispatch loop skips NEW feature dispatch but leaves in-flight work untouched.
 * The gate is completely optional: absence of `rateLimitEpisode` or when `active()`
 * returns false behaves identically to today (zero-cost abstraction).
 */

import { describe, it, expect } from 'vitest';
import { runDaemon, type BacklogItem, type DaemonDeps } from '../../src/engine/daemon.js';

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({ slug: `f${i}` }));
}

describe('daemon rate-limit episode dispatch gate (Task 7)', () => {
  it('active episode blocks dispatch for otherwise-eligible items', async () => {
    const dispatched: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(3),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      rateLimitEpisode: {
        enter: () => {},
        active: () => true,
        clear: async () => {},
        nextWaitSeconds: () => 60,
      },
    };

    const result = await runDaemon(deps, { concurrency: 1, once: true });

    // The episode is active for the whole run — no new feature should ever be
    // picked, even though 3 eligible items exist in the backlog.
    expect(dispatched).toEqual([]);
    expect(result.processed).toEqual([]);
    expect(result.stoppedReason).toBe('backlog_drained');
  });

  it('inactive episode allows normal dispatch', async () => {
    const dispatched: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(2),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      rateLimitEpisode: {
        enter: () => {},
        active: () => false,
        clear: async () => {},
        nextWaitSeconds: () => 60,
      },
    };

    const result = await runDaemon(deps, { concurrency: 1, once: true });

    // Episode is inactive — dispatch should proceed normally.
    expect(dispatched).toEqual(['f0', 'f1']);
    expect(result.processed).toHaveLength(2);
    expect(result.stoppedReason).toBe('backlog_drained');
  });

  it('undefined episode (absent dep) behaves as today (backward compatible)', async () => {
    const dispatched: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(2),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      // No rateLimitEpisode provided
    };

    const result = await runDaemon(deps, { concurrency: 1, once: true });

    // Zero-cost abstraction: no episode = dispatch as normal.
    expect(dispatched).toEqual(['f0', 'f1']);
    expect(result.processed).toHaveLength(2);
    expect(result.stoppedReason).toBe('backlog_drained');
  });

  it('items already in flight when episode activates complete/park normally', async () => {
    let episodeActive = false;
    let resolveFeature: (() => void) | undefined;
    const dispatched: string[] = [];
    const completed: string[] = [];

    const deps: DaemonDeps = {
      // Only one item ever discoverable — once dispatched, the episode activates
      // for subsequent polls so we can assert the in-flight one still finishes.
      discoverBacklog: async () => (dispatched.length === 0 ? items(1) : []),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        episodeActive = true; // episode activates the moment this feature starts
        await new Promise<void>((resolve) => {
          resolveFeature = resolve;
        });
        completed.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      rateLimitEpisode: {
        enter: () => {},
        active: () => episodeActive,
        clear: async () => {},
        nextWaitSeconds: () => 60,
      },
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
    // AND episode was active for the whole remaining run).
    expect(dispatched).toEqual(['f0']);
  });

  it('episode gate re-polls active() on each loop iteration: lifting it mid-run resumes dispatch', async () => {
    let episodeActive = true;
    const dispatched: string[] = [];
    let polls = 0;

    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      rateLimitEpisode: {
        enter: () => {},
        active: () => {
          polls++;
          // Lift the episode gate after a couple of idle polls so we can observe
          // the gated period first, then the resumed dispatch.
          if (polls >= 3) episodeActive = false;
          return episodeActive;
        },
        clear: async () => {},
        nextWaitSeconds: () => 60,
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

  it('episode gate prevents dispatch at-most-once per item (never double-counted once cleared)', async () => {
    let episodeActive = true;
    const dispatched: string[] = [];

    const deps: DaemonDeps = {
      discoverBacklog: async () => items(2),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      rateLimitEpisode: {
        enter: () => {},
        active: () => episodeActive,
        clear: async () => {},
        nextWaitSeconds: () => 60,
      },
      sleep: async () => {
        episodeActive = false; // clear episode after the first idle wait
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

  it('episode gate blocks dispatch when pause is not active', async () => {
    const dispatched: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => false,
      rateLimitEpisode: {
        enter: () => {},
        active: () => true, // episode active, pause not
        clear: async () => {},
        nextWaitSeconds: () => 60,
      },
    };

    await runDaemon(deps, { concurrency: 1, once: true });
    expect(dispatched).toEqual([]);
  });

  it('pause gate blocks dispatch when episode is not active', async () => {
    const dispatched: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => true, // pause active, episode not
      rateLimitEpisode: {
        enter: () => {},
        active: () => false,
        clear: async () => {},
        nextWaitSeconds: () => 60,
      },
    };

    await runDaemon(deps, { concurrency: 1, once: true });
    expect(dispatched).toEqual([]);
  });

  it('both gates active block dispatch', async () => {
    const dispatched: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => true,
      rateLimitEpisode: {
        enter: () => {},
        active: () => true, // both active
        clear: async () => {},
        nextWaitSeconds: () => 60,
      },
    };

    await runDaemon(deps, { concurrency: 1, once: true });
    expect(dispatched).toEqual([]);
  });

  it('both gates inactive allow dispatch', async () => {
    const dispatched: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => false,
      rateLimitEpisode: {
        enter: () => {},
        active: () => false, // both inactive
        clear: async () => {},
        nextWaitSeconds: () => 60,
      },
    };

    const result = await runDaemon(deps, { concurrency: 1, once: true });
    expect(dispatched).toEqual(['f0']);
  });
});
