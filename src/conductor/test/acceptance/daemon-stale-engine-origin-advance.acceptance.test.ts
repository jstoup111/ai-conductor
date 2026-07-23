// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "daemon-stale-engine-origin-advance" (intake #598).
//
// Stories: .docs/stories/daemon-stale-engine-origin-advance.md (TI-1, TI-2, TI-4;
//          TI-3 folded minimally into TI-1's SHA-propagation case; TI-6 is docs-only)
// Plan:    .docs/plans/daemon-stale-engine-origin-advance.md (Tasks 1, 3, 4, 6, 7, 9, 10, 12)
// ADR:     .docs/decisions/adr-2026-07-22-origin-refresh-before-engine-rebuild.md
//
// NONE of this feature's production code exists yet:
//   src/engine/engine-refresh.ts — createRefreshThrottle / createStalenessWarner
//     (Tasks 3-4). Loaded via a per-test dynamic import (`load`/`requireFn`
//     pattern, matching daemon-auto-restart-stale-engine.acceptance.test.ts) so a
//     missing module fails only the ONE test that needs it with a real
//     "Cannot find module" error, not a whole-file collection crash.
//   DaemonDeps.refreshEngineSource / DaemonDeps.probeEngineStaleness — new
//     injected deps `daemon.ts` (Task 7, Task 9) does not yet call at any
//     quiescent boundary. These are injected into plain `DaemonDeps` object
//     literals below; because the TypeScript excess-property check is not
//     enforced at vitest's esbuild-transpile runtime, the literal compiles, but
//     `runDaemon` never invokes the extra field today — so every assertion on
//     its call count / call order below fails for the right reason (0 calls,
//     not N).
//   `fastForwardRoot` (src/engine/daemon-backlog.ts) still returns `Promise<void>`
//     today (Task 1 will change it to a structured `{status, cause?, behindOrigin?,
//     originHead?}` outcome) — every scenario below that reads `.status`/`.cause`/
//     `.originHead` off its resolved value throws because that value is
//     `undefined`, which is also a legitimate RED (not yet the outcome contract).
//
// `runDaemon` (src/engine/daemon.ts) and `fastForwardRoot`
// (src/engine/daemon-backlog.ts) ALREADY EXIST and are imported directly — these
// specs drive the REAL quiescent-boundary daemon loop and the REAL git
// fast-forward primitive (writing-system-tests §3b: the real production entry
// point, not a re-implementation). Only `discoverBacklog` and `runFeature` are
// faked (true system boundaries); git state is real (tmp bare-origin + working
// clone repos, mirroring the `fastForwardRoot` heal-integration fixture in
// test/engine/daemon-backlog.test.ts), and `rebuildEngine`/`refreshEngineSource`/
// `probeEngineStaleness` are test-composed thin wrappers around the real
// `fastForwardRoot` — the ONLY thing faked inside them is the heavy `npm run
// build` step itself (Task 10's own e2e test explicitly names "fake build
// command seam" as its intended boundary; a full tsup rebuild is not needed to
// prove the refresh→rebuild→check→restart ORDER and gating this file owns).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { runDaemon, type DaemonDeps } from '../../src/engine/daemon.js';
import { fastForwardRoot } from '../../src/engine/daemon-backlog.js';
import { captureEngineIdentity, createStaleEngineChecker } from '../../src/engine/engine-identity.js';

const execFile = promisify(execFileCb);

const ENGINE_REFRESH_MOD = '../../src/engine/engine-refresh.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  return (await import(modPath)) as Record<string, unknown>;
}
function requireFn(mod: Record<string, unknown>, name: string): (...a: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...a: any[]) => any;
}

const RELOAD_COMMANDS = [
  'git pull --ff-only origin',
  'npm run build',
  'conduct daemon restart',
];

// ── Real-git fixture helpers (mirrors test/engine/daemon-backlog.test.ts's
//    fastForwardRoot heal-integration fixture: bare origin + working clone). ──

async function initGitRepo(): Promise<{ dir: string; originDir: string; tmpBase: string }> {
  const tmpBase = await mkdtemp(join(tmpdir(), 'engine-origin-advance-'));
  const dir = join(tmpBase, 'work');
  const originDir = join(tmpBase, 'origin.git');
  await mkdir(dir, { recursive: true });
  await mkdir(originDir, { recursive: true });
  await execFile('git', ['init', '--bare', '-q', '-b', 'main'], { cwd: originDir });
  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await execFile('git', ['remote', 'add', 'origin', originDir], { cwd: dir });
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'engine-entry.txt'), 'v1\n');
  await writeFile(join(dir, 'README.md'), 'init\n');
  await execFile('git', ['add', '.'], { cwd: dir });
  await execFile('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  await execFile('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: dir });
  return { dir, originDir, tmpBase };
}

/** Simulates a merged PR: a fresh clone commits+pushes to origin/main, WITHOUT
 * touching `dir` (which stays behind — exactly the incident scenario). */
async function advanceOrigin(
  originDir: string,
  tmpBase: string,
  changeKind: 'engine' | 'docs',
  n = 0,
): Promise<string> {
  const otherDir = join(tmpBase, `other-${n}`);
  await execFile('git', ['clone', '-q', originDir, otherDir]);
  await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: otherDir });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: otherDir });
  if (changeKind === 'engine') {
    await writeFile(join(otherDir, 'src', 'engine-entry.txt'), `v2-${n} — a real engine fix\n`);
  } else {
    await writeFile(join(otherDir, 'README.md'), `docs update ${n}\n`);
  }
  await execFile('git', ['add', '.'], { cwd: otherDir });
  await execFile(
    'git',
    ['commit', '-q', '-m', changeKind === 'engine' ? 'fix: engine bug' : 'docs: update'],
    { cwd: otherDir },
  );
  await execFile('git', ['push', '-q', 'origin', 'main'], { cwd: otherDir });
  const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: otherDir });
  return stdout.trim();
}

/** Fakes the heavy `npm run build` step: "rebuild" is a pure function of the
 * checked-out engine-source file, so a docs-only advance produces byte-identical
 * dist and an engine-source advance produces different dist — exactly the
 * content-hash behavior the real `publish-engine.mjs` produces, without paying
 * for a real tsup build on every test. */
async function fakeRebuild(dir: string, distPath: string): Promise<void> {
  const content = await readFile(join(dir, 'src', 'engine-entry.txt'), 'utf-8').catch(() => '');
  await mkdir(dirname(distPath), { recursive: true });
  await writeFile(distPath, content, 'utf-8');
}

async function headSha(dir: string): Promise<string> {
  const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

describe('acceptance: merged engine fix reaches the running daemon without operator action (TI-1)', () => {
  it(
    'HP1+HP2: behind-origin engine-source advance → refresh precedes rebuild precedes check → restart fires with the fast-forwarded (merge) SHA loaded',
    async () => {
      const { dir, originDir, tmpBase } = await initGitRepo();
      try {
        const distPath = join(tmpBase, 'dist', 'index.js');
        await fakeRebuild(dir, distPath); // seed v1 identity (what's "loaded" before the fix)
        const capturedIdentity = await captureEngineIdentity(distPath);
        const checker = createStaleEngineChecker(capturedIdentity as string, distPath);

        const mergeSha = await advanceOrigin(originDir, tmpBase, 'engine');

        const order: string[] = [];
        let outcome: any;
        const requestRestart = vi.fn(async (info: any) => {
          order.push('restart');
          return { fired: true };
        });

        const deps = {
          discoverBacklog: async () => [{ slug: 'pending' }],
          runFeature: async () => {
            throw new Error('must never dispatch a feature: the engine is stale before this item runs');
          },
          sleep: async () => {},
          staleEngineChecker: checker,
          requestRestart,
          // Task 6/7: not yet part of DaemonDeps or called by runDaemon.
          refreshEngineSource: async () => {
            order.push('refresh');
            outcome = await fastForwardRoot(dir);
            return outcome;
          },
          rebuildEngine: async () => {
            order.push('rebuild');
            await fakeRebuild(dir, distPath);
          },
        } as unknown as DaemonDeps;

        await runDaemon(deps, {
          concurrency: 1,
          once: false,
          maxIdlePolls: 0,
          isSelfHost: true,
          autoRestartOnStaleEngine: true,
        });

        // Order: refresh, THEN rebuild, THEN (checker sees drift) restart.
        expect(order).toEqual(['refresh', 'rebuild', 'restart']);
        expect(requestRestart).toHaveBeenCalledTimes(1);

        // Domain alignment (Task 1's outcome contract): fast-forward genuinely
        // advanced, and its reported originHead IS the merge commit.
        expect(outcome).toEqual(
          expect.objectContaining({ status: 'advanced', originHead: mergeSha }),
        );

        // The real checkout's HEAD is now AT the merge commit — "loaded engine's
        // source SHA is the fast-forwarded commit (≥ the merge commit)" (TI-1 HP2),
        // proven against real git state, not a mock.
        expect(await headSha(dir)).toBe(mergeSha);
      } finally {
        await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
      }
    },
  );

  it('HP3: docs-only origin advance → rebuild produces content-unchanged dist → checker reports "current" → no restart', async () => {
    const { dir, originDir, tmpBase } = await initGitRepo();
    try {
      const distPath = join(tmpBase, 'dist', 'index.js');
      await fakeRebuild(dir, distPath);
      const capturedIdentity = await captureEngineIdentity(distPath);
      const checker = createStaleEngineChecker(capturedIdentity as string, distPath);

      const docsMergeSha = await advanceOrigin(originDir, tmpBase, 'docs');

      let dispatched = false;
      let outcome: any;
      const requestRestart = vi.fn(async () => ({ fired: true }));
      const deps = {
        discoverBacklog: async () => (dispatched ? [] : [{ slug: 'pending' }]),
        runFeature: async (item: { slug: string }) => {
          dispatched = true;
          return { slug: item.slug, status: 'done' };
        },
        sleep: async () => {},
        staleEngineChecker: checker,
        requestRestart,
        refreshEngineSource: async () => {
          outcome = await fastForwardRoot(dir);
          return outcome;
        },
        rebuildEngine: async () => fakeRebuild(dir, distPath),
      } as unknown as DaemonDeps;

      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 0,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

      expect(dispatched).toBe(true); // the feature WAS built (engine wasn't stale)
      expect(requestRestart).not.toHaveBeenCalled();
      // The docs-only merge still advanced the checkout via THIS feature's
      // refresh chain (not the pre-existing idle-only discovery ref) — proven
      // against real git state, and outcome carries the structured contract.
      expect(outcome).toEqual(expect.objectContaining({ status: 'advanced', originHead: docsMergeSha }));
      expect(await headSha(dir)).toBe(docsMergeSha);
    } finally {
      await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('NP1: a build in flight (concurrency 2) never runs refreshEngineSource for the overlapping dispatch — only the quiescent first dispatch does', async () => {
    const refreshCalls: number[] = [];
    let calls = 0;
    const deps = {
      discoverBacklog: async () => [{ slug: 'a' }, { slug: 'b' }],
      runFeature: async (item: { slug: string }) => {
        if (item.slug === 'a') {
          await new Promise((r) => setTimeout(r, 30)); // stay in-flight while 'b' is picked
        }
        return { slug: item.slug, status: 'done' };
      },
      sleep: async () => {},
      staleEngineChecker: { check: () => 'current' as const },
      requestRestart: vi.fn(async () => ({ fired: true })),
      refreshEngineSource: async () => {
        refreshCalls.push(++calls);
      },
      rebuildEngine: async () => {},
    } as unknown as DaemonDeps;

    await runDaemon(deps, {
      concurrency: 2,
      once: false,
      maxIdlePolls: 0,
      isSelfHost: true,
      autoRestartOnStaleEngine: true,
    });

    // Exactly one refresh — for 'a's quiescent dispatch. 'b' is picked while
    // 'a' is still in flight, so the refresh chain must not run for it.
    expect(refreshCalls).toEqual([1]);
  });

  it('NP2: refreshEngineSource throwing (fetch failed) is logged and non-fatal — the daemon continues into rebuild/check and still dispatches', async () => {
    let rebuildCalled = false;
    let dispatched = false;
    const log: string[] = [];
    const deps = {
      discoverBacklog: async () => (dispatched ? [] : [{ slug: 'pending' }]),
      runFeature: async (item: { slug: string }) => {
        dispatched = true;
        return { slug: item.slug, status: 'done' };
      },
      sleep: async () => {},
      log: (msg: string) => log.push(msg),
      staleEngineChecker: { check: () => 'current' as const },
      requestRestart: vi.fn(async () => ({ fired: true })),
      refreshEngineSource: async () => {
        throw new Error('fetch origin main failed (offline?)');
      },
      rebuildEngine: async () => {
        rebuildCalled = true;
      },
    } as unknown as DaemonDeps;

    await expect(
      runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 0,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      }),
    ).resolves.not.toThrow();

    expect(rebuildCalled).toBe(true); // chain continued past the throw
    expect(dispatched).toBe(true); // feature still ran on the current engine
    expect(log.some((l) => /fetch origin main failed/.test(l))).toBe(true);
  });

  it('NP3: rebuildEngine failing AFTER a successful refresh stays non-fatal — refresh ran first, no restart, dispatch proceeds', async () => {
    const order: string[] = [];
    let dispatched = false;
    const deps = {
      discoverBacklog: async () => (dispatched ? [] : [{ slug: 'pending' }]),
      runFeature: async (item: { slug: string }) => {
        dispatched = true;
        return { slug: item.slug, status: 'done' };
      },
      sleep: async () => {},
      staleEngineChecker: { check: () => 'current' as const },
      requestRestart: vi.fn(async () => ({ fired: true })),
      refreshEngineSource: async () => {
        order.push('refresh');
      },
      rebuildEngine: async () => {
        order.push('rebuild-attempt');
        throw new Error('npm run build failed: exit 1');
      },
    } as unknown as DaemonDeps;

    await runDaemon(deps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 0,
      isSelfHost: true,
      autoRestartOnStaleEngine: true,
    });

    expect(order).toEqual(['refresh', 'rebuild-attempt']);
    expect(dispatched).toBe(true); // degrades to current engine, feature still built
  });

  it('NP4: refreshEngineSource is self-host + flag gated — runs when armed, never runs when either gate is off (control proves the gate is real, not vacuous)', async () => {
    const makeDeps = (calls: number[]): DaemonDeps =>
      ({
        discoverBacklog: async () => [{ slug: 'x' }],
        runFeature: async (item: { slug: string }) => ({ slug: item.slug, status: 'done' }),
        sleep: async () => {},
        staleEngineChecker: { check: () => 'current' as const },
        requestRestart: vi.fn(async () => ({ fired: true })),
        refreshEngineSource: async () => {
          calls.push(1);
        },
        rebuildEngine: async () => {},
      }) as unknown as DaemonDeps;

    const armedCalls: number[] = [];
    await runDaemon(makeDeps(armedCalls), {
      concurrency: 1,
      once: false,
      maxIdlePolls: 0,
      isSelfHost: true,
      autoRestartOnStaleEngine: true,
    });
    expect(armedCalls).toEqual([1]); // ARMED: refresh runs.

    const nonSelfHostCalls: number[] = [];
    await runDaemon(makeDeps(nonSelfHostCalls), {
      concurrency: 1,
      once: false,
      maxIdlePolls: 0,
      isSelfHost: false,
      autoRestartOnStaleEngine: true,
    });
    expect(nonSelfHostCalls).toEqual([]); // non-self-host: never fetches/rebuilds via this path.

    const flagOffCalls: number[] = [];
    await runDaemon(makeDeps(flagOffCalls), {
      concurrency: 1,
      once: false,
      maxIdlePolls: 0,
      isSelfHost: true,
      autoRestartOnStaleEngine: false,
    });
    expect(flagOffCalls).toEqual([]); // flag off: never fetches/rebuilds via this path.
  });

  it('NP5: existing non-convergence suppression still holds the restart even though refresh+rebuild both ran (unchanged by this feature)', async () => {
    const order: string[] = [];
    const requestRestart = vi.fn(async () => ({ fired: true }));
    const deps = {
      discoverBacklog: async () => [{ slug: 'pending' }],
      runFeature: async () => {
        throw new Error('must not dispatch: checker reports stale');
      },
      sleep: async () => {},
      staleEngineChecker: {
        check: () => 'stale' as const,
        capturedIdentity: () => 'captured-hash',
        targetIdentity: () => 'suppressed-target-hash',
      },
      requestRestart,
      isSuppressed: async (identity: string | null) => {
        order.push('suppression-checked');
        return identity === 'suppressed-target-hash';
      },
      refreshEngineSource: async () => {
        order.push('refresh');
      },
      rebuildEngine: async () => {
        order.push('rebuild');
      },
    } as unknown as DaemonDeps;

    await runDaemon(deps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 0,
      isSelfHost: true,
      autoRestartOnStaleEngine: true,
    });

    // The refresh/rebuild chain runs — this feature does not skip it — but
    // suppression still holds and no restart fires (adr §5: unchanged semantics).
    expect(order).toEqual(['refresh', 'rebuild', 'suppression-checked']);
    expect(requestRestart).not.toHaveBeenCalled();
  });
});

describe('acceptance: origin fetches are throttled at the quiescent boundary, loop-level (TI-2)', () => {
  it('a fetch inside the throttle window is skipped silently; the next boundary after expiry fetches again', async () => {
    const throttleMod = await load(ENGINE_REFRESH_MOD);
    const createRefreshThrottle = requireFn(throttleMod, 'createRefreshThrottle');

    const clock = { now: 0 };
    const throttle = createRefreshThrottle(60_000, () => clock.now); // 60s min interval
    const fetchTimestamps: number[] = [];
    const log: string[] = [];

    const deps = {
      discoverBacklog: async () => {
        const remaining = ['a', 'b', 'c'].filter((s) => !dispatchedSlugs.has(s));
        return remaining.length ? [{ slug: remaining[0] }] : [];
      },
      runFeature: async (item: { slug: string }) => {
        dispatchedSlugs.add(item.slug);
        // Simulate the throttle window elapsing only between 'b' and 'c'.
        if (item.slug === 'b') clock.now = 61_000;
        return { slug: item.slug, status: 'done' };
      },
      sleep: async () => {},
      log: (msg: string) => log.push(msg),
      staleEngineChecker: { check: () => 'current' as const },
      requestRestart: vi.fn(async () => ({ fired: true })),
      refreshEngineSource: async () => {
        if (throttle.shouldRun()) {
          fetchTimestamps.push(clock.now);
          throttle.markRan();
        }
      },
      rebuildEngine: async () => {},
    } as unknown as DaemonDeps;
    const dispatchedSlugs = new Set<string>();

    await runDaemon(deps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 0,
      isSelfHost: true,
      autoRestartOnStaleEngine: true,
    });

    // 'a' fetches (first ever); 'b's pre-dispatch check is still inside the
    // window (clock unchanged) so it is skipped; 'c's check runs after the
    // window elapsed (during 'b's run) so it fetches again — delayed, not
    // permanently suppressed (NP3).
    expect(fetchTimestamps).toEqual([0, 61_000]);
    // A throttled skip is silent — no staleness warning text anywhere in the log.
    expect(log.join('\n')).not.toMatch(/STALE|stale engine/i);
  });
});

describe('acceptance: staleness is loud on every degraded self-heal path (TI-4)', () => {
  async function composeWarningRefresh(
    dir: string,
    log: string[],
    causes: Array<'dirty' | 'diverged' | 'fetch-failed'>,
  ): Promise<() => Promise<any>> {
    const refreshMod = await load(ENGINE_REFRESH_MOD);
    const createStalenessWarner = requireFn(refreshMod, 'createStalenessWarner');
    const warner = createStalenessWarner((msg: string) => log.push(msg));
    return async () => {
      const outcome = await fastForwardRoot(dir);
      if (outcome?.status === 'skipped' && causes.includes(outcome.cause)) {
        warner.warn(outcome.cause, outcome.originHead, 'main');
      }
      return outcome;
    };
  }

  it('dirty tree blocks the fast-forward → one loud warning naming cause "dirty" and all three reload commands', async () => {
    const { dir, originDir, tmpBase } = await initGitRepo();
    try {
      await advanceOrigin(originDir, tmpBase, 'engine');
      // Dirty the tracked README with no matching candidate branch to heal from.
      await writeFile(join(dir, 'README.md'), 'operator was mid-edit\n');

      const log: string[] = [];
      const refreshEngineSource = await composeWarningRefresh(dir, log, ['dirty', 'diverged', 'fetch-failed']);

      const deps = {
        discoverBacklog: async () => [{ slug: 'pending' }],
        runFeature: async (item: { slug: string }) => ({ slug: item.slug, status: 'done' }),
        sleep: async () => {},
        staleEngineChecker: { check: () => 'current' as const },
        requestRestart: vi.fn(async () => ({ fired: true })),
        refreshEngineSource,
        rebuildEngine: async () => {},
      } as unknown as DaemonDeps;

      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 0,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

      const joined = log.join('\n');
      expect(joined).toMatch(/\bdirty\b/);
      for (const cmd of RELOAD_COMMANDS) expect(joined).toContain(cmd);
    } finally {
      await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('diverged local branch (non-fast-forwardable) → one loud warning naming cause "diverged"', async () => {
    const { dir, originDir, tmpBase } = await initGitRepo();
    try {
      await advanceOrigin(originDir, tmpBase, 'engine');
      // Local commit not on origin → after fetch, --ff-only merge fails.
      await writeFile(join(dir, 'src', 'local-only.txt'), 'local work\n');
      await execFile('git', ['add', '.'], { cwd: dir });
      await execFile('git', ['commit', '-q', '-m', 'local: unpushed work'], { cwd: dir });

      const log: string[] = [];
      const refreshEngineSource = await composeWarningRefresh(dir, log, ['dirty', 'diverged', 'fetch-failed']);

      const deps = {
        discoverBacklog: async () => [{ slug: 'pending' }],
        runFeature: async (item: { slug: string }) => ({ slug: item.slug, status: 'done' }),
        sleep: async () => {},
        staleEngineChecker: { check: () => 'current' as const },
        requestRestart: vi.fn(async () => ({ fired: true })),
        refreshEngineSource,
        rebuildEngine: async () => {},
      } as unknown as DaemonDeps;

      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 0,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

      const joined = log.join('\n');
      expect(joined).toMatch(/\bdiverged\b/);
      for (const cmd of RELOAD_COMMANDS) expect(joined).toContain(cmd);
    } finally {
      await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('a persistent dirty condition warns exactly ONCE across repeated boundaries, then re-arms with exactly one NEW warning when origin advances again', async () => {
    const { dir, originDir, tmpBase } = await initGitRepo();
    try {
      await advanceOrigin(originDir, tmpBase, 'engine', 1);
      await writeFile(join(dir, 'README.md'), 'operator mid-edit — stays dirty the whole test\n');

      const log: string[] = [];
      const refreshEngineSource = await composeWarningRefresh(dir, log, ['dirty', 'diverged', 'fetch-failed']);

      let pushedSecondAdvance = false;
      const deps = {
        discoverBacklog: async () => {
          const remaining = ['a', 'b', 'c'].filter((s) => !dispatched.has(s));
          return remaining.length ? [{ slug: remaining[0] }] : [];
        },
        runFeature: async (item: { slug: string }) => {
          dispatched.add(item.slug);
          if (item.slug === 'b' && !pushedSecondAdvance) {
            pushedSecondAdvance = true;
            await advanceOrigin(originDir, tmpBase, 'engine', 2); // origin moves again, still dirty
          }
          return { slug: item.slug, status: 'done' };
        },
        sleep: async () => {},
        staleEngineChecker: { check: () => 'current' as const },
        requestRestart: vi.fn(async () => ({ fired: true })),
        refreshEngineSource,
        rebuildEngine: async () => {},
      } as unknown as DaemonDeps;
      const dispatched = new Set<string>();

      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 0,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

      const dirtyWarnings = log.filter((l) => /\bdirty\b/.test(l));
      // One warning for the first (a, b — same originHead, deduped), one new
      // warning once origin advances again for 'c' (re-arm on new SHA, TI-4 NP2).
      expect(dirtyWarnings).toHaveLength(2);
    } finally {
      await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('self-heal-disabled advisory: non-self-host daemon with a determinably-behind stamped SHA → one warning with cause "self-heal-disabled"', async () => {
    const { dir, originDir, tmpBase } = await initGitRepo();
    try {
      // The "loaded engine's stamped source SHA" — captured BEFORE origin advances.
      const stampedSha = await headSha(dir);
      await advanceOrigin(originDir, tmpBase, 'engine');

      const refreshMod = await load(ENGINE_REFRESH_MOD);
      const createStalenessWarner = requireFn(refreshMod, 'createStalenessWarner');
      const log: string[] = [];
      const warner = createStalenessWarner((msg: string) => log.push(msg));

      const probeCalls: string[] = [];
      const probeEngineStaleness = async () => {
        probeCalls.push('probed');
        await execFile('git', ['fetch', 'origin', 'main'], { cwd: dir });
        const { stdout: originHead } = await execFile('git', ['rev-parse', 'origin/main'], { cwd: dir });
        const behind = await execFile(
          'git',
          ['merge-base', '--is-ancestor', stampedSha, originHead.trim()],
          { cwd: dir },
        )
          .then(() => true)
          .catch(() => false);
        if (behind && stampedSha !== originHead.trim()) {
          warner.warn('self-heal-disabled', originHead.trim(), 'main');
        }
      };

      const deps = {
        discoverBacklog: async () => [{ slug: 'pending' }],
        runFeature: async (item: { slug: string }) => ({ slug: item.slug, status: 'done' }),
        sleep: async () => {},
        // Not wired self-host: staleGatesArmed is false, so the ARMED refresh
        // chain must not run — only the advisory probe branch (Task 9).
        probeEngineStaleness,
      } as unknown as DaemonDeps;

      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 0,
        isSelfHost: false,
        autoRestartOnStaleEngine: false,
      });

      expect(probeCalls).toEqual(['probed']);
      const joined = log.join('\n');
      expect(joined).toMatch(/self-heal-disabled/);
      for (const cmd of RELOAD_COMMANDS) expect(joined).toContain(cmd);
    } finally {
      await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('no-origin repo: fastForwardRoot reports cause "no-origin" and the composed refresh emits NO staleness warning (unknown is never treated as stale)', async () => {
    const tmpBase = await mkdtemp(join(tmpdir(), 'engine-origin-advance-noorigin-'));
    const dir = join(tmpBase, 'work');
    try {
      await mkdir(dir, { recursive: true });
      await execFile('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execFile('git', ['config', 'user.name', 'Test'], { cwd: dir });
      await writeFile(join(dir, 'README.md'), 'local only\n');
      await execFile('git', ['add', '.'], { cwd: dir });
      await execFile('git', ['commit', '-q', '-m', 'init'], { cwd: dir });

      // Task 1's outcome contract, exercised directly against a real no-origin repo.
      const outcome = await fastForwardRoot(dir);
      expect(outcome).toEqual({ status: 'skipped', cause: 'no-origin' });

      const log: string[] = [];
      const refreshEngineSource = await composeWarningRefresh(dir, log, ['dirty', 'diverged', 'fetch-failed']);

      const deps = {
        discoverBacklog: async () => [{ slug: 'pending' }],
        runFeature: async (item: { slug: string }) => ({ slug: item.slug, status: 'done' }),
        sleep: async () => {},
        staleEngineChecker: { check: () => 'current' as const },
        requestRestart: vi.fn(async () => ({ fired: true })),
        refreshEngineSource,
        rebuildEngine: async () => {},
      } as unknown as DaemonDeps;

      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 0,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

      expect(log.join('\n')).not.toMatch(/STALE|self-heal|dirty|diverged/i);
    } finally {
      await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
    }
  });
});
