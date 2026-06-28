import { describe, it, expect } from 'vitest';
import {
  runDaemon,
  type BacklogItem,
  type DaemonDeps,
} from '../../src/engine/daemon.js';

const X = 'a'.repeat(40);
const Y = 'b'.repeat(40);

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `f${i}`,
    storiesPath: `s${i}`,
    planPath: `p${i}`,
  }));
}

// ── Task 7: startup orchestration (dashboard + first-run + downtime-advance) ──

describe('runDaemon — startup halt-reconciliation (FR-1/FR-5)', () => {
  it('renders the startup dashboard BEFORE any dispatch (FR-1)', async () => {
    const order: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      runFeature: async (it) => {
        order.push(`dispatch:${it.slug}`);
        return { slug: it.slug, status: 'done' };
      },
      renderStartupDashboard: async () => {
        order.push('dashboard');
      },
    };
    await runDaemon(deps, { concurrency: 1, once: true });
    expect(order[0]).toBe('dashboard');
    expect(order).toContain('dispatch:f0');
    expect(order.indexOf('dashboard')).toBeLessThan(order.indexOf('dispatch:f0'));
  });

  it('first run (absent persisted SHA) initializes without re-kicking (FR-5)', async () => {
    const sweeps: string[] = [];
    const persisted: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      readPersistedBaseSha: async () => null, // absent
      resolveBaseSha: async () => X,
      writePersistedBaseSha: async (sha) => {
        persisted.push(sha);
      },
      rekickSweep: async (sha) => {
        sweeps.push(sha);
      },
    };
    await runDaemon(deps, { concurrency: 1, once: true });
    expect(sweeps).toEqual([]); // no re-kick on first run
    expect(persisted).toEqual([X]); // initialized to the current SHA
  });

  it('downtime advance (persisted != current) triggers exactly one sweep then persists (FR-5/FR-7)', async () => {
    const sweeps: string[] = [];
    const persisted: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      readPersistedBaseSha: async () => X, // base moved while down: persisted X, current Y
      resolveBaseSha: async () => Y,
      writePersistedBaseSha: async (sha) => {
        persisted.push(sha);
      },
      rekickSweep: async (sha) => {
        sweeps.push(sha);
      },
    };
    await runDaemon(deps, { concurrency: 1, once: true });
    expect(sweeps).toEqual([Y]); // exactly one sweep at the advanced SHA
    expect(persisted).toEqual([Y]); // advanced to current
  });

  it('no advance (persisted == current) → no sweep, markers intact (PR #109)', async () => {
    const sweeps: string[] = [];
    const persisted: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      readPersistedBaseSha: async () => X,
      resolveBaseSha: async () => X,
      writePersistedBaseSha: async (sha) => {
        persisted.push(sha);
      },
      rekickSweep: async (sha) => {
        sweeps.push(sha);
      },
    };
    await runDaemon(deps, { concurrency: 1, once: true });
    expect(sweeps).toEqual([]);
    expect(persisted).toEqual([]); // nothing to advance
  });

  it('unresolved base SHA on first run → no persist, no re-kick (FR-5 negative)', async () => {
    const sweeps: string[] = [];
    const persisted: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      readPersistedBaseSha: async () => null,
      resolveBaseSha: async () => null, // unresolved (offline)
      writePersistedBaseSha: async (sha) => {
        persisted.push(sha);
      },
      rekickSweep: async (sha) => {
        sweeps.push(sha);
      },
    };
    const res = await runDaemon(deps, { concurrency: 1, once: true });
    expect(sweeps).toEqual([]);
    expect(persisted).toEqual([]);
    expect(res.stoppedReason).toBe('backlog_drained');
  });
});

// ── Task 8: live base-advance wiring (FR-6/FR-10) ─────────────────────────────

describe('runDaemon — live base-advance re-kick (FR-6/FR-10)', () => {
  it('a live SHA advance triggers exactly one sweep + persist; same-SHA refreshes do not', async () => {
    const sweeps: string[] = [];
    const persisted: string[] = [];
    let shaCalls = 0;
    const deps: DaemonDeps = {
      discoverBacklog: async () => [], // always idle → idle-refresh branch each poll
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      readPersistedBaseSha: async () => X, // seed lastSeen = X (no startup advance)
      // startup(refresh:true)=X, idle polls: X, X, then Y (advance), then Y…
      resolveBaseSha: async () => {
        shaCalls++;
        return shaCalls >= 4 ? Y : X;
      },
      writePersistedBaseSha: async (sha) => {
        persisted.push(sha);
      },
      rekickSweep: async (sha) => {
        sweeps.push(sha);
      },
      sleep: async () => {},
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 8 });
    expect(sweeps).toEqual([Y]); // advance observed once → exactly one sweep
    expect(persisted).toEqual([Y]);
    expect(res.stoppedReason).toBe('idle_timeout');
  });

  it('an unresolved SHA mid-run is treated as no-advance; loop continues (FR-10)', async () => {
    const sweeps: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      readPersistedBaseSha: async () => X,
      resolveBaseSha: async () => null, // offline mid-run
      writePersistedBaseSha: async () => {},
      rekickSweep: async (sha) => {
        sweeps.push(sha);
      },
      sleep: async () => {},
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 3 });
    expect(sweeps).toEqual([]);
    expect(res.stoppedReason).toBe('idle_timeout'); // loop survived
  });

  it('a throwing resolveBaseSha is caught (no-advance); the loop survives (FR-10)', async () => {
    const sweeps: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      readPersistedBaseSha: async () => X,
      resolveBaseSha: async () => {
        throw new Error('git exploded');
      },
      writePersistedBaseSha: async () => {},
      rekickSweep: async (sha) => {
        sweeps.push(sha);
      },
      sleep: async () => {},
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 3 });
    expect(sweeps).toEqual([]);
    expect(res.stoppedReason).toBe('idle_timeout');
  });
});

// ── Task 10: PR #109 no-advance invariant under the re-kick path (FR-8) ───────

describe('runDaemon — PR #109 no-advance invariant under re-kick (FR-8)', () => {
  it('restart with a halted worktree + persisted == current clears nothing and dispatches nothing', async () => {
    const halted = new Set<string>(['f0']); // durable HALT from a prior run
    const sweeps: string[] = [];
    let dispatches = 0;
    const starts: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1), // f0 still merged (halted ≠ processed)
      isHalted: async (slug) => halted.has(slug),
      runFeature: async (it) => {
        dispatches++;
        return { slug: it.slug, status: 'done' };
      },
      readPersistedBaseSha: async () => X,
      resolveBaseSha: async () => X, // no advance
      writePersistedBaseSha: async () => {},
      rekickSweep: async (sha) => {
        sweeps.push(sha);
      },
      log: (m) => {
        if (m.includes('start')) starts.push(m);
      },
      sleep: async () => {},
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 4 });
    expect(sweeps).toEqual([]); // no marker cleared
    expect(dispatches).toBe(0); // halted feature never dispatched
    expect(starts).toEqual([]); // no ▶ start line for the halted feature
    expect(res.stoppedReason).toBe('idle_timeout');
  });

  it('an advance clears the marker; the feature then re-dispatches via the un-park path only (FR-8)', async () => {
    // The sweep clears f0's marker as a side effect (mirrors the real impl).
    const halted = new Set<string>(['f0']);
    const sweeps: string[] = [];
    let dispatches = 0;
    let shaCalls = 0;
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      isHalted: async (slug) => halted.has(slug),
      runFeature: async (it) => {
        dispatches++;
        return { slug: it.slug, status: 'done' };
      },
      readPersistedBaseSha: async () => X,
      resolveBaseSha: async () => {
        shaCalls++;
        return shaCalls >= 3 ? Y : X; // advance after a couple of idle polls
      },
      writePersistedBaseSha: async () => {},
      rekickSweep: async (sha) => {
        sweeps.push(sha);
        halted.delete('f0'); // clearing the marker is the ONLY thing the sweep does
      },
      sleep: async () => {},
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 8 });
    expect(sweeps).toEqual([Y]);
    // Re-dispatched exactly once — through the existing un-park path (the sweep
    // issued no dispatch; clearing the marker let pickEligible un-park it).
    expect(dispatches).toBe(1);
    expect(res.processed.filter((o) => o.slug === 'f0' && o.status === 'done')).toHaveLength(1);
  });
});
