// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Daemon auto-restart on stale engine code".
//
// Stories: .docs/stories/2026-07-03-daemon-auto-restart-stale-engine.md
// Plan:    .docs/plans/2026-07-03-daemon-auto-restart-stale-engine.md
// ADR:     .docs/decisions/adr-2026-07-03-daemon-auto-restart-stale-engine.md
//
// NONE of this feature's production code exists yet:
//   src/engine/engine-identity.ts   — captureEngineIdentity / createStaleEngineChecker (Tasks 1-4)
//   src/engine/restart-intent.ts    — RESTART_PENDING + suppression record (Tasks 5-6, 10-11)
//   src/engine/stale-engine-init.ts — startup capture + handshake + ARMED/DISARMED (Tasks 8-10)
// are all new modules named directly in the plan and are loaded via a per-test
// dynamic import (writing-system-tests §6/daemon-supervised-hosting.test.ts
// pattern) so a missing module fails the ONE test that needs it with a real
// "Cannot find module" error, not a whole-file collection crash.
//
// `runDaemon` (src/engine/daemon.ts) and `holdLock` (src/engine/daemon-lock.ts)
// ALREADY EXIST and are imported directly — these acceptance specs drive the
// REAL idle-boundary loop and the REAL 1-per-repo pidfile lock (writing-system-tests
// §3b: the real production entry point, not a re-implementation). `runDaemon`
// does not yet accept the two new deps these tests inject (`checkStaleEngine`,
// `requestRestart`) — until Task 12/13 widen `DaemonDeps`, TypeScript itself
// (and the currently-unused deps at runtime) makes every stale/restart
// assertion below fail for the right reason.
//
// Only these are faked at the runDaemon layer: `discoverBacklog` (an empty/
// static in-memory list — no real git/worktree needed to reach the idle
// boundary) and `runFeature` (never invoked in these scenarios). The engine
// identity, the RESTART_PENDING marker, and the pidfile lock are ALL real:
// captured/compared/written/released against a genuinely rebuilt dist file
// produced by tsup's build() API (a "minimal tsup fixture" per the plan,
// Task 15) — a hand-written hash comparison could pass while the real content
// hash primitive was wired wrong.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { build } from 'tsup';
import { mkdtemp, rm, writeFile, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDaemon, type DaemonDeps } from '../../src/engine/daemon.js';
import { holdLock } from '../../src/engine/daemon-lock.js';

const IDENTITY_MOD = '../../src/engine/engine-identity.js';
const RESTART_MOD = '../../src/engine/restart-intent.js';
const INIT_MOD = '../../src/engine/stale-engine-init.js';

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

/** Builds a REAL ESM bundle from `source` via tsup and returns its dist path. */
async function buildFixtureDist(workDir: string, source: string): Promise<string> {
  const entry = join(workDir, 'entry.ts');
  await writeFile(entry, source, 'utf-8');
  const outDir = join(workDir, 'dist');
  await build({
    entry: [entry],
    outDir,
    format: ['esm'],
    clean: true,
    silent: true,
    dts: false,
    sourcemap: false,
    skipNodeModulesBundle: true,
  });
  return join(outDir, 'entry.js');
}

const FIXTURE_V1 = 'export const marker = "v1";\n';
const FIXTURE_V2 = 'export const marker = "v2 — a real source change";\n';

describe('acceptance: engine identity capture over a REAL rebuilt dist fixture (Story 1)', () => {
  it(
    'two builds of byte-identical source hash equal; a rebuild with a real source change hashes different',
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), 'engine-identity-fixture-'));
      try {
        const { captureEngineIdentity } = { captureEngineIdentity: requireFn(await load(IDENTITY_MOD), 'captureEngineIdentity') };
        const distA = await buildFixtureDist(workDir, FIXTURE_V1);
        const idA1 = await captureEngineIdentity(distA);
        // Rebuild byte-identically (same source, same tsup options) — content-derived
        // identity must compare equal, not time-derived (mtime necessarily changed).
        const distA2 = await buildFixtureDist(workDir, FIXTURE_V1);
        const idA2 = await captureEngineIdentity(distA2);
        expect(idA1).toBe(idA2);

        // Rebuild with a genuine source change — identity must differ.
        const distB = await buildFixtureDist(workDir, FIXTURE_V2);
        const idB = await captureEngineIdentity(distB);
        expect(idB).not.toBe(idA1);
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('capture of an unreadable entry disables the checker: always "current", zero fs reads, one warning', async () => {
    const mod = await load(IDENTITY_MOD);
    const captureEngineIdentity = requireFn(mod, 'captureEngineIdentity');
    const createStaleEngineChecker = requireFn(mod, 'createStaleEngineChecker');

    const missing = join(await mkdtemp(join(tmpdir(), 'engine-identity-missing-')), 'no-such-dist.js');
    const captured = await captureEngineIdentity(missing);
    expect(captured).toBeNull();

    const warn = vi.fn();
    const checker = createStaleEngineChecker(captured, { warn });
    // Feed the disabled checker a path that DOES exist — proves it takes zero fs
    // reads rather than merely happening to fail the same way as `missing`.
    const workDir = await mkdtemp(join(tmpdir(), 'engine-identity-disabled-'));
    try {
      const realDist = await buildFixtureDist(workDir, FIXTURE_V1);
      expect(await checker.check(realDist)).toBe('current');
      expect(await checker.check(realDist)).toBe('current'); // sticky across calls
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});

describe('acceptance: idle-boundary stale detection + restart request over the REAL runDaemon loop (Story 2)', () => {
  async function withLockedRepo<T>(fn: (repoPath: string) => Promise<T>): Promise<T> {
    const repoPath = await mkdtemp(join(tmpdir(), 'stale-engine-repo-'));
    try {
      return await fn(repoPath);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  }

  it('happy path: stale verdict at idle boundary writes RESTART_PENDING (reason/identities/timestamp) and releases the real pidfile lock', async () => {
    await withLockedRepo(async (repoPath) => {
      const { writeRestartPending, readRestartPending } = {
        writeRestartPending: requireFn(await load(RESTART_MOD), 'writeRestartPending'),
        readRestartPending: requireFn(await load(RESTART_MOD), 'readRestartPending'),
      };
      const lock = await holdLock(repoPath);
      expect(lock).not.toBeNull();

      const requestRestart = vi.fn(
        async (info: { fromIdentity: string; targetIdentity: string }) => {
          await writeRestartPending(repoPath, {
            reason: 'stale-engine',
            fromIdentity: info.fromIdentity,
            targetIdentity: info.targetIdentity,
            at: new Date().toISOString(),
          });
          await lock!.release();
        },
      );

      const deps: DaemonDeps = {
        discoverBacklog: async () => [],
        runFeature: async () => {
          throw new Error('must never dispatch a feature in this scenario');
        },
        sleep: async () => {},
        checkStaleEngine: async () => 'stale',
        requestRestart,
      } as DaemonDeps & { checkStaleEngine: () => Promise<string>; requestRestart: typeof requestRestart };

      await runDaemon(deps as DaemonDeps, { concurrency: 1, once: false, maxIdlePolls: 1 });

      expect(requestRestart).toHaveBeenCalledTimes(1);
      const marker = await readRestartPending(repoPath);
      expect(marker.status).toBe('present');
      expect(marker.reason).toBe('stale-engine');
      expect(marker.fromIdentity).toBeTruthy();
      expect(marker.targetIdentity).toBeTruthy();
      expect(marker.at).toBeTruthy();

      // The lock this process held is released — the pidfile is gone.
      expect(existsSync(join(repoPath, '.daemon', 'daemon.pid'))).toBe(false);
    });
  });

  it('byte-identical rebuild: checker reports "current" — no marker is ever written, requestRestart never called', async () => {
    await withLockedRepo(async (repoPath) => {
      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');
      const createStaleEngineChecker = requireFn(identityMod, 'createStaleEngineChecker');
      const { readRestartPending } = { readRestartPending: requireFn(await load(RESTART_MOD), 'readRestartPending') };

      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-identical-'));
      const distA = await buildFixtureDist(workDir, FIXTURE_V1);
      const captured = await captureEngineIdentity(distA);
      // Byte-identical rebuild — same source recompiled.
      const distA2 = await buildFixtureDist(workDir, FIXTURE_V1);
      const checker = createStaleEngineChecker(captured);

      const requestRestart = vi.fn(async () => {});
      const deps: DaemonDeps = {
        discoverBacklog: async () => [],
        runFeature: async () => ({ slug: 'never', status: 'done' }),
        sleep: async () => {},
        checkStaleEngine: () => checker.check(distA2),
        requestRestart,
      } as DaemonDeps & { checkStaleEngine: () => Promise<string>; requestRestart: typeof requestRestart };

      await runDaemon(deps as DaemonDeps, { concurrency: 1, once: false, maxIdlePolls: 1 });

      expect(requestRestart).not.toHaveBeenCalled();
      expect((await readRestartPending(repoPath)).status).toBe('absent');
      await rm(workDir, { recursive: true, force: true });
    });
  });

  it('negative: a stale verdict during in-flight work never requests a restart this pass, but the SAME checker fires once truly idle (control)', async () => {
    await withLockedRepo(async (repoPath) => {
      const requestRestart = vi.fn(async () => {});
      let backlogDrained = false;

      const deps: DaemonDeps = {
        discoverBacklog: async () => (backlogDrained ? [] : [{ slug: 'busy' }]),
        runFeature: async (item) => {
          // A short REAL delay (not gated by `sleep`, which the pool only
          // consults once truly idle) so `collectOne()`'s Promise.race resolves
          // on its own — inFlight is non-empty for at least one whole loop pass.
          await new Promise((r) => setTimeout(r, 10));
          backlogDrained = true;
          return { slug: item.slug, status: 'done' };
        },
        sleep: async () => {},
        checkStaleEngine: async () => 'stale',
        requestRestart,
      } as DaemonDeps & { checkStaleEngine: () => Promise<string>; requestRestart: typeof requestRestart };

      // Two idle-poll budget: one pass while `busy` is still in flight (must NOT
      // request), one pass once it has drained and the pool is truly idle (MUST
      // request exactly once). Without this control the negative half would pass
      // vacuously against an unimplemented gate chain that never calls
      // `requestRestart` in ANY scenario.
      await runDaemon(deps as DaemonDeps, { concurrency: 1, once: false, maxIdlePolls: 2 });
      expect(requestRestart).toHaveBeenCalledTimes(1);
    });
  });

  it('negative: non-continuous ("once") mode never requests a restart, even with a stale verdict and an empty backlog (control: continuous mode DOES)', async () => {
    const onceRequestRestart = vi.fn(async () => {});
    const onceDeps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async () => ({ slug: 'never', status: 'done' }),
      checkStaleEngine: async () => 'stale',
      requestRestart: onceRequestRestart,
    } as DaemonDeps & { checkStaleEngine: () => Promise<string>; requestRestart: typeof onceRequestRestart };

    const res = await runDaemon(onceDeps as DaemonDeps, { concurrency: 1, once: true });
    expect(res.stoppedReason).toBe('backlog_drained');
    expect(onceRequestRestart).not.toHaveBeenCalled();

    // Control: the identical checker verdict, in continuous mode, over an
    // otherwise-idle backlog, MUST request a restart — proving the once-mode
    // guard above is an actual gate, not an unimplemented no-op passing vacuously.
    const continuousRequestRestart = vi.fn(async () => {});
    const continuousDeps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async () => ({ slug: 'never', status: 'done' }),
      sleep: async () => {},
      checkStaleEngine: async () => 'stale',
      requestRestart: continuousRequestRestart,
    } as DaemonDeps & { checkStaleEngine: () => Promise<string>; requestRestart: typeof continuousRequestRestart };
    await runDaemon(continuousDeps as DaemonDeps, { concurrency: 1, once: false, maxIdlePolls: 1 });
    expect(continuousRequestRestart).toHaveBeenCalledTimes(1);
  });

  it('negative: an indeterminate verdict (re-hash failure) never requests a restart and never spams the warning', async () => {
    await withLockedRepo(async (repoPath) => {
      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');
      const createStaleEngineChecker = requireFn(identityMod, 'createStaleEngineChecker');

      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-indeterminate-'));
      const dist = await buildFixtureDist(workDir, FIXTURE_V1);
      const captured = await captureEngineIdentity(dist);
      await unlink(dist); // genuinely removed between capture and check (mid-rebuild ENOENT)

      const warn = vi.fn();
      const checker = createStaleEngineChecker(captured, { warn });
      const requestRestart = vi.fn(async () => {});

      const deps: DaemonDeps = {
        discoverBacklog: async () => [],
        runFeature: async () => ({ slug: 'never', status: 'done' }),
        sleep: async () => {},
        checkStaleEngine: () => checker.check(dist),
        requestRestart,
      } as DaemonDeps & { checkStaleEngine: () => Promise<string>; requestRestart: typeof requestRestart };

      // Two idle ticks see the SAME repeated failure — one warning, not two.
      await runDaemon(deps as DaemonDeps, { concurrency: 1, once: false, maxIdlePolls: 2 });

      expect(requestRestart).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      await rm(workDir, { recursive: true, force: true });
    });
  });

  it('parity: with the new deps entirely ABSENT (non-self-host / flag-off proxy), idle-poll behavior is byte-for-byte unchanged from today', async () => {
    const log: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async () => ({ slug: 'never', status: 'done' }),
      sleep: async () => {},
      log: (msg) => log.push(msg),
      // checkStaleEngine / requestRestart deliberately NOT wired — mirrors a
      // non-self-host daemon or `auto_restart_on_stale_engine: false`, where
      // the CLI wiring never passes these deps at all.
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 2 });
    expect(res.stoppedReason).toBe('idle_timeout');
    expect(log.join('\n')).not.toMatch(/stale|restart/i);
  });
});

describe('acceptance: startup restart handshake + suppression (Stories 3 & 4)', () => {
  async function withRepo<T>(fn: (repoPath: string) => Promise<T>): Promise<T> {
    const repoPath = await mkdtemp(join(tmpdir(), 'stale-engine-handshake-'));
    try {
      return await fn(repoPath);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  }

  it('marker present + converged identity: logs "restarted for engine refresh", removes the marker, stays armed', async () => {
    await withRepo(async (repoPath) => {
      const restartMod = await load(RESTART_MOD);
      const writeRestartPending = requireFn(restartMod, 'writeRestartPending');
      const initStaleEngineState = requireFn(await load(INIT_MOD), 'initStaleEngineState');

      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');
      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-handshake-dist-'));
      const dist = await buildFixtureDist(workDir, FIXTURE_V2);
      const freshIdentity = await captureEngineIdentity(dist);

      await writeRestartPending(repoPath, {
        reason: 'stale-engine',
        fromIdentity: 'aaa',
        targetIdentity: freshIdentity,
        at: new Date().toISOString(),
      });

      const log: string[] = [];
      const state = await initStaleEngineState({
        repoPath,
        entryPath: dist,
        flag: true,
        log: (msg: string) => log.push(msg),
      });

      expect(log.join('\n')).toMatch(/restarted for engine refresh/);
      expect(log.join('\n')).toContain('aaa');
      expect(state.armed).toBe(true);
      expect((await load(RESTART_MOD)).readRestartPending).toBeDefined();
      const { readRestartPending } = { readRestartPending: requireFn(restartMod, 'readRestartPending') };
      expect((await readRestartPending(repoPath)).status).toBe('absent');
      await rm(workDir, { recursive: true, force: true });
    });
  });

  it('no marker present: no handshake log line at all (no noise on ordinary boots)', async () => {
    await withRepo(async (repoPath) => {
      const initStaleEngineState = requireFn(await load(INIT_MOD), 'initStaleEngineState');
      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');
      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-nomarker-'));
      const dist = await buildFixtureDist(workDir, FIXTURE_V1);
      await captureEngineIdentity(dist);

      const log: string[] = [];
      await initStaleEngineState({
        repoPath,
        entryPath: dist,
        flag: true,
        log: (msg: string) => log.push(msg),
      });

      expect(log.join('\n')).not.toMatch(/restarted for engine refresh/);
      await rm(workDir, { recursive: true, force: true });
    });
  });

  it('corrupt marker: one warning, marker removed, boot proceeds armed with no suppression state', async () => {
    await withRepo(async (repoPath) => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(repoPath, '.daemon'), { recursive: true });
      await writeFile(join(repoPath, '.daemon', 'RESTART_PENDING'), '{not json', 'utf-8');

      const initStaleEngineState = requireFn(await load(INIT_MOD), 'initStaleEngineState');
      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');
      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-corrupt-'));
      const dist = await buildFixtureDist(workDir, FIXTURE_V1);
      await captureEngineIdentity(dist);

      const log: string[] = [];
      const state = await initStaleEngineState({
        repoPath,
        entryPath: dist,
        flag: true,
        log: (msg: string) => log.push(msg),
      });

      expect(log.filter((l) => /warn/i.test(l))).toHaveLength(1);
      expect(state.armed).toBe(true);
      expect(state.suppressed).toBeFalsy();
      expect(existsSync(join(repoPath, '.daemon', 'RESTART_PENDING'))).toBe(false);
      await rm(workDir, { recursive: true, force: true });
    });
  });

  it('non-convergence: fresh identity ≠ marker target ⇒ suppression recorded, one warning naming both identities', async () => {
    await withRepo(async (repoPath) => {
      const restartMod = await load(RESTART_MOD);
      const writeRestartPending = requireFn(restartMod, 'writeRestartPending');
      const initStaleEngineState = requireFn(await load(INIT_MOD), 'initStaleEngineState');
      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');

      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-nonconverge-'));
      const dist = await buildFixtureDist(workDir, FIXTURE_V1); // we come back on THIS identity
      const freshIdentity = await captureEngineIdentity(dist);

      // Marker's target was a DIFFERENT identity we never actually reached.
      await writeRestartPending(repoPath, {
        reason: 'stale-engine',
        fromIdentity: 'zzz',
        targetIdentity: 'a-target-we-never-reached',
        at: new Date().toISOString(),
      });

      const log: string[] = [];
      const state = await initStaleEngineState({
        repoPath,
        entryPath: dist,
        flag: true,
        log: (msg: string) => log.push(msg),
      });

      expect(state.suppressed).toBe(true);
      expect(log.filter((l) => /suppress/i.test(l))).toHaveLength(1);
      expect(log.join('\n')).toContain('a-target-we-never-reached');
      expect(log.join('\n')).toContain(freshIdentity);
      await rm(workDir, { recursive: true, force: true });
    });
  });
});
