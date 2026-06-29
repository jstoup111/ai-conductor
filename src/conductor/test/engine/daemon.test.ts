import { describe, it, expect } from 'vitest';
import {
  runDaemon,
  type BacklogItem,
  type DaemonDeps,
} from '../../src/engine/daemon.js';

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `f${i}`,
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

  it('parks a halted feature: dispatched once, then skipped while HALT present', async () => {
    // `halted` models the on-disk `.pipeline/HALT` markers a human would clear.
    const halted = new Set<string>();
    let dispatches = 0;
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(1)), // f0 stays in the backlog (halted ≠ processed)
      isHalted: async (slug) => halted.has(slug),
      runFeature: async (it) => {
        dispatches++;
        halted.add(it.slug); // conductor wrote .pipeline/HALT
        return { slug: it.slug, status: 'halted', reason: 'needs human' };
      },
      sleep: async () => {},
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 4 });
    expect(dispatches).toBe(1); // never re-dispatched while the marker is present
    expect(res.stoppedReason).toBe('idle_timeout');
    expect(res.processed.filter((o) => o.status === 'halted')).toHaveLength(1);
  });

  it('does NOT re-dispatch a feature halted by a PRIOR run (restart honors the durable HALT marker)', async () => {
    // Simulates a daemon restart: `parked`/`started` start empty (in-memory only),
    // the feature's merged spec is still in the backlog (halted ≠ processed), and
    // its worktree already carries a `.pipeline/HALT` marker a human hasn't cleared.
    // The daemon must consult the durable marker at discovery — not just for slugs
    // it parked in THIS process — or it re-enters the conductor over the kept
    // worktree and clobbers its persisted state.
    const halted = new Set<string>(['f0']); // marker present from before this run
    let dispatches = 0;
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(1)),
      isHalted: async (slug) => halted.has(slug),
      runFeature: async (it) => {
        dispatches++;
        return { slug: it.slug, status: 'done' };
      },
      sleep: async () => {},
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 4 });
    expect(dispatches).toBe(0); // never dispatched — the durable HALT marker is honored
    expect(res.processed).toHaveLength(0);
    expect(res.stoppedReason).toBe('idle_timeout');
  });

  it('re-dispatches a prior-run halted feature once a human clears its marker (post-restart resume)', async () => {
    // Same restart setup as above, but the human clears `.pipeline/HALT` mid-run.
    // The feature must then become eligible and resume to completion.
    const halted = new Set<string>(['f0']); // parked by a prior run
    let dispatches = 0;
    let slept = 0;
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(1)),
      isHalted: async (slug) => halted.has(slug),
      runFeature: async (it) => {
        dispatches++;
        return { slug: it.slug, status: 'done' };
      },
      sleep: async () => {
        slept++;
        if (slept === 2) halted.delete('f0'); // human removes the marker
      },
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 6 });
    expect(dispatches).toBe(1); // dispatched exactly once, after the clear
    expect(res.processed.filter((o) => o.slug === 'f0' && o.status === 'done')).toHaveLength(1);
  });

  it('re-dispatches a halted feature after its HALT marker is cleared', async () => {
    const halted = new Set<string>();
    let dispatches = 0;
    let slept = 0;
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(1)),
      isHalted: async (slug) => halted.has(slug),
      runFeature: async (it) => {
        dispatches++;
        if (dispatches === 1) {
          halted.add(it.slug); // first attempt parks
          return { slug: it.slug, status: 'halted', reason: 'needs human' };
        }
        return { slug: it.slug, status: 'done' }; // resumes and finishes on retry
      },
      sleep: async () => {
        slept++;
        if (slept === 2) halted.delete('f0'); // human removes .pipeline/HALT
      },
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 6 });
    expect(dispatches).toBe(2); // parked, then re-dispatched after the clear
    expect(res.processed.filter((o) => o.slug === 'f0' && o.status === 'done')).toHaveLength(1);
  });

  it('re-parks a feature that halts again until cleared (no tight re-dispatch loop)', async () => {
    const halted = new Set<string>();
    let dispatches = 0;
    let slept = 0;
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(1)),
      isHalted: async (slug) => halted.has(slug),
      runFeature: async (it) => {
        dispatches++;
        halted.add(it.slug); // halts again, re-writing .pipeline/HALT each time
        return { slug: it.slug, status: 'halted' };
      },
      sleep: async () => {
        slept++;
        if (slept === 2) halted.delete('f0'); // human clears exactly once
      },
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 10 });
    // Initial dispatch + exactly one retry after the single clear. If the marker
    // gate were missing this would re-dispatch on every poll (≫ 2).
    expect(dispatches).toBe(2);
    expect(res.stoppedReason).toBe('idle_timeout');
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

  // ── refresh gating: fetch only between work, never while a build runs ─────────

  it('discovers local work WITHOUT requesting a remote refresh (local-first)', async () => {
    const seq: Array<{ refresh: boolean; returned: number }> = [];
    let started = false;
    const deps: DaemonDeps = {
      discoverBacklog: async ({ refresh }) => {
        const out = started ? [] : items(1); // work is already local
        seq.push({ refresh, returned: out.length });
        return out;
      },
      runFeature: async (it) => {
        started = true;
        return { slug: it.slug, status: 'done' };
      },
    };
    const res = await runDaemon(deps, { concurrency: 1, once: true });
    expect(res.processed).toHaveLength(1);
    // The dispatched item was found on a refresh:false call — the daemon does not
    // fetch from origin to discover work that is already local.
    const dispatchCall = seq.find((s) => s.returned > 0)!;
    expect(dispatchCall.refresh).toBe(false);
  });

  it('reaches out to origin (refresh) only when idle with no local work, and still finds the merged spec', async () => {
    const seq: boolean[] = [];
    let started = false;
    const deps: DaemonDeps = {
      discoverBacklog: async ({ refresh }) => {
        // Nothing is visible locally; the merged spec only appears after a refresh.
        const out = refresh && !started ? items(1) : [];
        seq.push(refresh);
        return out;
      },
      runFeature: async (it) => {
        started = true;
        return { slug: it.slug, status: 'done' };
      },
    };
    const res = await runDaemon(deps, { concurrency: 1, once: true });
    // The remote-only spec WAS discovered — via the idle refresh, not a local scan.
    expect(res.processed).toHaveLength(1);
    expect(seq).toContain(false); // local-first was always attempted
    expect(seq).toContain(true); // then an idle refresh found the merged spec
  });
});
