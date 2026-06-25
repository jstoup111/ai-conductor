import { describe, it, expect } from 'vitest';
import {
  runDaemon,
  type BacklogItem,
  type DaemonDeps,
} from '../../src/engine/daemon.js';

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `f${i}`,
    storiesPath: `s${i}`,
    planPath: `p${i}`,
  }));
}

/** Backlog that returns the full list every poll; the daemon filters started. */
function staticBacklog(list: BacklogItem[]) {
  return async () => list;
}

describe('engine/daemon — runDaemon', () => {
  it('processes the whole backlog once (concurrency 1) and drains', async () => {
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(3)),
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
    };
    const res = await runDaemon(deps, { concurrency: 1, once: true });
    expect(res.processed.map((o) => o.slug).sort()).toEqual(['f0', 'f1', 'f2']);
    expect(res.stoppedReason).toBe('backlog_drained');
  });

  it('never exceeds the concurrency cap', async () => {
    let current = 0;
    let max = 0;
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(6)),
      runFeature: async (it) => {
        current++;
        max = Math.max(max, current);
        await new Promise((r) => setTimeout(r, 5));
        current--;
        return { slug: it.slug, status: 'done' };
      },
    };
    const res = await runDaemon(deps, { concurrency: 2, once: true });
    expect(res.processed).toHaveLength(6);
    expect(max).toBe(2);
  });

  it('dispatches each feature exactly once', async () => {
    const calls = new Map<string, number>();
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(4)),
      runFeature: async (it) => {
        calls.set(it.slug, (calls.get(it.slug) ?? 0) + 1);
        return { slug: it.slug, status: 'done' };
      },
    };
    await runDaemon(deps, { concurrency: 3, once: true });
    expect([...calls.values()]).toEqual([1, 1, 1, 1]);
  });

  it('stops starting after maxItems', async () => {
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(10)),
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
    };
    const res = await runDaemon(deps, { concurrency: 1, once: true, maxItems: 3 });
    expect(res.processed).toHaveLength(3);
    expect(res.stoppedReason).toBe('max_items');
  });

  it('stops at the global cost ceiling', async () => {
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(10)),
      runFeature: async (it) => ({ slug: it.slug, status: 'done', costTokens: 100 }),
    };
    const res = await runDaemon(deps, {
      concurrency: 1,
      once: true,
      maxTotalCostTokens: 250,
    });
    expect(res.processed).toHaveLength(3); // 100,200,300 → stop at >=250
    expect(res.stoppedReason).toBe('cost_ceiling');
  });

  it('isolates a thrown runFeature as an error outcome; pool continues', async () => {
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(3)),
      runFeature: async (it) => {
        if (it.slug === 'f1') throw new Error('boom');
        return { slug: it.slug, status: 'done' };
      },
    };
    const res = await runDaemon(deps, { concurrency: 1, once: true });
    expect(res.processed).toHaveLength(3);
    const f1 = res.processed.find((o) => o.slug === 'f1');
    expect(f1?.status).toBe('error');
    expect(f1?.reason).toMatch(/boom/);
  });

  it('passes through a halted outcome', async () => {
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(1)),
      runFeature: async (it) => ({ slug: it.slug, status: 'halted', reason: 'needs human' }),
    };
    const res = await runDaemon(deps, { concurrency: 1, once: true });
    expect(res.processed[0].status).toBe('halted');
    expect(res.processed[0].reason).toBe('needs human');
  });

  it('stops at the wall-clock ceiling (injected clock)', async () => {
    let clock = 0;
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(10)),
      runFeature: async (it) => {
        clock += 1; // each completed feature advances the clock 1ms
        return { slug: it.slug, status: 'done' };
      },
      now: () => clock,
    };
    const res = await runDaemon(deps, {
      concurrency: 1,
      once: true,
      maxRuntimeMs: 2,
    });
    expect(res.stoppedReason).toBe('time_ceiling');
    // Stopped early — did NOT drain all 10.
    expect(res.processed.length).toBeGreaterThanOrEqual(1);
    expect(res.processed.length).toBeLessThan(10);
  });

  it('continuous mode picks up a feature that appears after an empty poll', async () => {
    let poll = 0;
    let slept = 0;
    const deps: DaemonDeps = {
      // empty, then one feature, then empty forever
      discoverBacklog: async () => (++poll === 2 ? items(1) : []),
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      sleep: async () => {
        slept++;
      },
    };
    const res = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 3,
    });
    expect(res.processed.map((o) => o.slug)).toEqual(['f0']); // picked up later
    expect(res.stoppedReason).toBe('idle_timeout');
    expect(slept).toBeGreaterThan(0);
  });

  it('idle-polls an empty backlog and stops at maxIdlePolls', async () => {
    let slept = 0;
    const deps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      sleep: async () => {
        slept++;
      },
    };
    const res = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 3,
    });
    expect(res.processed).toHaveLength(0);
    expect(res.stoppedReason).toBe('idle_timeout');
    expect(slept).toBe(3);
  });
});
