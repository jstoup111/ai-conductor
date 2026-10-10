import { describe, it, expect } from 'vitest';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderRootRefreshSection } from '../../src/engine/daemon-observe-cli.js';
import {
  runDaemon,
  type BacklogItem,
  type DaemonDeps,
  type DaemonTickSnapshot,
  type FeatureOutcome,
} from '../../src/engine/daemon.js';

// #2275: a root refresh held by the live-boundary coordinator (an open
// self-host provider window) must not freeze the dispatch loop. The refresh
// boundary here is a deferred promise standing in for
// `coordinatedRootMutation` waiting on a sibling's window.

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Bounded wait: resolves true once `done()` holds, false after `turns` event-loop turns. */
async function eventually(done: () => boolean, turns = 500): Promise<boolean> {
  for (let i = 0; i < turns; i++) {
    if (done()) return true;
    await nextTurn();
  }
  return done();
}

/** One real event-loop turn per poll: the loop stays live with no wall-clock wait. */
const turnSleep = async (): Promise<void> => {
  await nextTurn();
};

interface Harness {
  deps: DaemonDeps;
  dispatched: string[];
  refreshCalls: () => number;
  sibling: ReturnType<typeof deferred<FeatureOutcome>>;
  logs: string[];
  ticks: DaemonTickSnapshot[];
  stop: () => void;
}

function harness(opts: {
  local: () => BacklogItem[];
  refresh: () => Promise<BacklogItem[]>;
  isHalted?: (slug: string) => Promise<boolean>;
  isParked?: (slug: string) => Promise<boolean>;
  extra?: Partial<DaemonDeps>;
}): Harness {
  const dispatched: string[] = [];
  const logs: string[] = [];
  const ticks: DaemonTickSnapshot[] = [];
  const sibling = deferred<FeatureOutcome>();
  let refreshes = 0;
  let stopping = false;
  const deps: DaemonDeps = {
    discoverBacklog: async ({ refresh }) => {
      if (!refresh) return opts.local();
      refreshes++;
      return opts.refresh();
    },
    runFeature: async (item) => {
      dispatched.push(item.slug);
      if (item.slug === 'sibling') return sibling.promise;
      return { slug: item.slug, status: 'done' };
    },
    isHalted: opts.isHalted,
    isParked: opts.isParked,
    sleep: turnSleep,
    log: (msg) => logs.push(msg),
    onTick: (snapshot) => ticks.push(snapshot),
    shouldStop: () => stopping,
    ...opts.extra,
  };
  return {
    deps,
    dispatched,
    refreshCalls: () => refreshes,
    sibling,
    logs,
    ticks,
    stop: () => {
      stopping = true;
    },
  };
}

describe('engine/daemon — background root refresh (#2275)', () => {
  it('dispatches a halt-cleared feature into the free slot while the refresh is held by a sibling window', async () => {
    let halted = true;
    const heldRefresh = deferred<BacklogItem[]>();
    const h = harness({
      local: () => [{ slug: 'sibling' }, { slug: 'cleared' }],
      refresh: () => heldRefresh.promise,
      isHalted: async (slug) => slug === 'cleared' && halted,
    });

    const daemon = runDaemon(h.deps, { concurrency: 2, once: false, idlePollMs: 0 });
    try {
      expect(await eventually(() => h.refreshCalls() === 1)).toBe(true);
      const ticksAtHold = h.ticks.length;
      // The operator removes .pipeline/HALT while the refresh is still held.
      halted = false;

      expect(await eventually(() => h.dispatched.includes('cleared'))).toBe(true);
      // Telemetry kept flowing and the held refresh was never duplicated.
      expect(h.ticks.length).toBeGreaterThan(ticksAtHold);
      expect(h.ticks.at(-1)?.rootRefreshPending).toBe(true);
      expect(h.refreshCalls()).toBe(1);
    } finally {
      h.stop();
      h.sibling.resolve({ slug: 'sibling', status: 'done' });
      heldRefresh.resolve([]);
      await daemon;
    }
    expect(h.dispatched).toEqual(['sibling', 'cleared']);
  });

  it('keeps a feature with a live HALT, or an operator park, out of the free slot', async () => {
    const heldRefresh = deferred<BacklogItem[]>();
    const h = harness({
      local: () => [{ slug: 'sibling' }, { slug: 'still-halted' }, { slug: 'parked' }],
      refresh: () => heldRefresh.promise,
      isHalted: async (slug) => slug === 'still-halted',
      isParked: async (slug) => slug === 'parked',
    });

    const daemon = runDaemon(h.deps, { concurrency: 3, once: false, idlePollMs: 0 });
    try {
      expect(await eventually(() => h.refreshCalls() === 1)).toBe(true);
      const ticksAtHold = h.ticks.length;
      // Many passes run while the refresh is held; none admits either feature.
      expect(await eventually(() => h.ticks.length > ticksAtHold + 20)).toBe(true);
      expect(h.dispatched).toEqual(['sibling']);
    } finally {
      h.stop();
      h.sibling.resolve({ slug: 'sibling', status: 'done' });
      heldRefresh.resolve([]);
      await daemon;
    }
    expect(h.dispatched).toEqual(['sibling']);
  });

  it('clears a failed refresh so a later pass starts a new one', async () => {
    const second = deferred<BacklogItem[]>();
    let calls = 0;
    const h = harness({
      local: () => [{ slug: 'sibling' }],
      refresh: () => (++calls === 1 ? Promise.reject(new Error('fetch failed')) : second.promise),
    });

    const daemon = runDaemon(h.deps, { concurrency: 2, once: false, idlePollMs: 0 });
    try {
      expect(await eventually(() => h.refreshCalls() === 2)).toBe(true);
      expect(h.logs.some((line) => line.includes('background root refresh failed (fetch failed)'))).toBe(true);
    } finally {
      h.stop();
      h.sibling.resolve({ slug: 'sibling', status: 'done' });
      second.resolve([]);
      await daemon;
    }
  });

  it('folds a completed refresh: re-kicks on a base advance, then dispatches from its backlog', async () => {
    const heldRefresh = deferred<BacklogItem[]>();
    const swept: string[] = [];
    let originFetched = false;
    const h = harness({
      local: () => [{ slug: 'sibling' }],
      refresh: () => heldRefresh.promise.then((items) => {
        originFetched = true;
        return items;
      }),
      extra: {
        readPersistedBaseSha: async () => 'aaa',
        resolveBaseSha: async () => (originFetched ? 'bbb' : 'aaa'),
        rekickSweep: async (sha) => {
          swept.push(sha);
        },
      },
    });

    const daemon = runDaemon(h.deps, { concurrency: 2, once: false, idlePollMs: 0 });
    try {
      expect(await eventually(() => h.refreshCalls() === 1)).toBe(true);
      expect(swept).toEqual([]);
      heldRefresh.resolve([{ slug: 'sibling' }, { slug: 'merged-on-origin' }]);
      expect(await eventually(() => h.dispatched.includes('merged-on-origin'))).toBe(true);
    } finally {
      h.stop();
      h.sibling.resolve({ slug: 'sibling', status: 'done' });
      await daemon;
    }
    expect(swept).toEqual(['bbb']);
  });

  it('awaits a refresh still in flight at shutdown instead of orphaning it', async () => {
    const heldRefresh = deferred<BacklogItem[]>();
    let refreshSettled = false;
    const h = harness({
      local: () => [{ slug: 'sibling' }],
      refresh: () => heldRefresh.promise.finally(() => {
        refreshSettled = true;
      }),
    });

    const daemon = runDaemon(h.deps, { concurrency: 2, once: false, idlePollMs: 0 });
    expect(await eventually(() => h.refreshCalls() === 1)).toBe(true);
    h.stop();
    h.sibling.resolve({ slug: 'sibling', status: 'done' });
    let returned = false;
    void daemon.then(() => {
      returned = true;
    });
    // Workers drained, but the daemon has not returned past the held refresh.
    expect(await eventually(() => returned, 50)).toBe(false);
    heldRefresh.resolve([]);
    await daemon;
    expect(refreshSettled).toBe(true);
  });
});

describe('daemon status — root refresh section (#2275)', () => {
  async function render(events: object[]): Promise<string[]> {
    const root = await mkdtemp(join(tmpdir(), 'root-refresh-status-'));
    try {
      await mkdir(join(root, '.daemon'), { recursive: true });
      await writeFile(join(root, '.daemon', 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      const out: string[] = [];
      await renderRootRefreshSection(root, (line) => out.push(line));
      return out;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const tick = (free: number, pending?: boolean) => ({
    type: 'daemon_backlog_snapshot',
    slots: { busy: 1, free },
    ...(pending === undefined ? {} : { rootRefreshPending: pending }),
  });

  it('reports a free slot behind a pending refresh from the newest tick only', async () => {
    expect(await render([tick(1, false), tick(1, true), { type: 'other' }])).toEqual([
      '  ROOT REFRESH: pending — 1 slot(s) free, 1 busy; origin refresh waits for an open provider window, free slots still fill from local discovery',
    ]);
    expect(await render([tick(1, true), tick(1, false)])).toEqual([]);
    expect(await render([tick(0, true)])).toEqual([]);
    expect(await render([tick(1)])).toEqual([]);
  });
});
