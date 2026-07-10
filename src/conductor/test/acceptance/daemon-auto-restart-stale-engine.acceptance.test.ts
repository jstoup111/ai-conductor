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
import { PUBLISH_WRAPPER_ENV_VAR } from '../../scripts/publish-guard.mjs';

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
  // This fixture build is not the real engine `dist/` (it targets a scratch
  // workDir), so it's exempt from the versioned dist-versions/<id> guard —
  // tsup loads the repo's tsup.config.ts regardless of outDir, so the wrapper
  // marker must be set for every direct build() call from a test.
  const previous = process.env[PUBLISH_WRAPPER_ENV_VAR];
  process.env[PUBLISH_WRAPPER_ENV_VAR] = '1';
  try {
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
  } finally {
    if (previous === undefined) {
      delete process.env[PUBLISH_WRAPPER_ENV_VAR];
    } else {
      process.env[PUBLISH_WRAPPER_ENV_VAR] = previous;
    }
  }
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

  it('capture of an unreadable entry disables the checker: always "current", one warning at construction', async () => {
    const mod = await load(IDENTITY_MOD);
    const captureEngineIdentity = requireFn(mod, 'captureEngineIdentity');
    const createStaleEngineChecker = requireFn(mod, 'createStaleEngineChecker');

    const missing = join(await mkdtemp(join(tmpdir(), 'engine-identity-missing-')), 'no-such-dist.js');
    const captured = await captureEngineIdentity(missing);
    expect(captured).toBeNull();

    // As-built contract (adr §1): capture failure ⇒ permanently disabled checker
    // that warns exactly once at construction and never touches the filesystem.
    const warn = vi.fn();
    const checker = createStaleEngineChecker(captured, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(checker.check()).toBe('current');
    expect(checker.check()).toBe('current'); // sticky across calls
    expect(checker.capturedIdentity()).toBeNull();
    expect(checker.targetIdentity()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1); // no further warnings on checks
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
      const { writeRestartMarker, readRestartMarkerWithStatus } = {
        writeRestartMarker: requireFn(await load(RESTART_MOD), 'writeRestartMarker'),
        readRestartMarkerWithStatus: requireFn(await load(RESTART_MOD), 'readRestartMarkerWithStatus'),
      };
      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');
      const createStaleEngineChecker = requireFn(identityMod, 'createStaleEngineChecker');
      const lock = await holdLock(repoPath);
      expect(lock).not.toBeNull();

      // REAL staleness: capture V1's identity, then genuinely rebuild the same
      // entry with a source change — the checker must derive 'stale' from content.
      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-happy-'));
      const dist = await buildFixtureDist(workDir, FIXTURE_V1);
      const captured = await captureEngineIdentity(dist);
      await buildFixtureDist(workDir, FIXTURE_V2); // same dist path, real change
      const checker = createStaleEngineChecker(captured, dist);

      const requestRestart = vi.fn(
        async (info: { fromIdentity: string | null; targetIdentity: string | null }) => {
          await writeRestartMarker({
            reason: 'stale-engine',
            fromIdentity: info.fromIdentity,
            targetIdentity: info.targetIdentity,
            at: Date.now(),
          }, repoPath);
          await lock!.release();
          return { fired: true };
        },
      );

      const deps: DaemonDeps = {
        discoverBacklog: async () => [],
        runFeature: async () => {
          throw new Error('must never dispatch a feature in this scenario');
        },
        sleep: async () => {},
        staleEngineChecker: checker,
        requestRestart,
      };

      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 0,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

      expect(requestRestart).toHaveBeenCalledTimes(1);
      await rm(workDir, { recursive: true, force: true });
      const result = await readRestartMarkerWithStatus(repoPath);
      expect(result.kind).toBe('present');
      expect(result.marker).not.toBeNull();
      expect(result.marker!.reason).toBe('stale-engine');
      expect(result.marker!.fromIdentity).toBeTruthy();
      expect(result.marker!.targetIdentity).toBeTruthy();
      expect(result.marker!.at).toBeTruthy();

      // The lock this process held is released — the pidfile is gone.
      expect(existsSync(join(repoPath, '.daemon', 'daemon.pid'))).toBe(false);
    });
  });

  // ── #369 Story 2: stale verdict logs carry both identities ────────────────
  it('idle-tick stale verdict: the log line carries BOTH the captured and target identities, logged before the restart request', async () => {
    await withLockedRepo(async (repoPath) => {
      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');
      const createStaleEngineChecker = requireFn(identityMod, 'createStaleEngineChecker');

      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-verdict-log-'));
      const dist = await buildFixtureDist(workDir, FIXTURE_V1);
      const captured = await captureEngineIdentity(dist);
      await buildFixtureDist(workDir, FIXTURE_V2); // real content change ⇒ 'stale'
      const target = await captureEngineIdentity(dist);
      const checker = createStaleEngineChecker(captured, dist);

      const log: string[] = [];
      const callOrder: string[] = [];
      const requestRestart = vi.fn(async () => {
        callOrder.push('restart');
        return { fired: true };
      });

      const deps: DaemonDeps = {
        discoverBacklog: async () => [],
        runFeature: async () => {
          throw new Error('must never dispatch a feature in this scenario');
        },
        sleep: async () => {},
        log: (msg) => {
          if (/stale engine detected/.test(msg)) callOrder.push('verdict-log');
          log.push(msg);
        },
        staleEngineChecker: checker,
        requestRestart,
      };

      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 0,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

      const verdictLines = log.filter((l) => /stale engine detected/.test(l));
      expect(verdictLines).toHaveLength(1);
      expect(verdictLines[0]).toContain(captured);
      expect(verdictLines[0]).toContain(target);
      // Verdict is logged before the restart is requested.
      expect(callOrder).toEqual(['verdict-log', 'restart']);
      await rm(workDir, { recursive: true, force: true });
    });
  });

  it('idle-tick: a "current" verdict emits NO identity-pair verdict log line (no noise on healthy ticks)', async () => {
    await withLockedRepo(async (repoPath) => {
      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');
      const createStaleEngineChecker = requireFn(identityMod, 'createStaleEngineChecker');
      const { readRestartMarkerWithStatus } = { readRestartMarkerWithStatus: requireFn(await load(RESTART_MOD), 'readRestartMarkerWithStatus') };

      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-verdict-nolog-'));
      const distA = await buildFixtureDist(workDir, FIXTURE_V1);
      const captured = await captureEngineIdentity(distA);
      const distA2 = await buildFixtureDist(workDir, FIXTURE_V1); // byte-identical ⇒ 'current'
      const checker = createStaleEngineChecker(captured, distA2);

      const log: string[] = [];
      const requestRestart = vi.fn(async () => ({ fired: true }));
      const deps: DaemonDeps = {
        discoverBacklog: async () => [],
        runFeature: async () => ({ slug: 'never', status: 'done' }),
        sleep: async () => {},
        log: (msg) => log.push(msg),
        staleEngineChecker: checker,
        requestRestart,
      };

      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 1,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

      expect(requestRestart).not.toHaveBeenCalled();
      expect(log.filter((l) => /stale engine detected/.test(l))).toHaveLength(0);
      const result = await readRestartMarkerWithStatus(repoPath);
      expect(result.kind).toBe('absent');
      await rm(workDir, { recursive: true, force: true });
    });
  });

  it('byte-identical rebuild: checker reports "current" — no marker is ever written, requestRestart never called', async () => {
    await withLockedRepo(async (repoPath) => {
      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');
      const createStaleEngineChecker = requireFn(identityMod, 'createStaleEngineChecker');
      const { readRestartMarkerWithStatus } = { readRestartMarkerWithStatus: requireFn(await load(RESTART_MOD), 'readRestartMarkerWithStatus') };

      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-identical-'));
      const distA = await buildFixtureDist(workDir, FIXTURE_V1);
      const captured = await captureEngineIdentity(distA);
      // Byte-identical rebuild — same source recompiled.
      const distA2 = await buildFixtureDist(workDir, FIXTURE_V1);
      const checker = createStaleEngineChecker(captured, distA2);

      const requestRestart = vi.fn(async () => ({ fired: true }));
      const deps: DaemonDeps = {
        discoverBacklog: async () => [],
        runFeature: async () => ({ slug: 'never', status: 'done' }),
        sleep: async () => {},
        staleEngineChecker: checker,
        requestRestart,
      };

      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 1,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

      expect(requestRestart).not.toHaveBeenCalled();
      const result = await readRestartMarkerWithStatus(repoPath);
      expect(result.kind).toBe('absent');
      await rm(workDir, { recursive: true, force: true });
    });
  });

  it('stale verdict with a pending feature: restart fires at the dispatch boundary BEFORE the stale engine builds it', async () => {
    await withLockedRepo(async () => {
      let dispatched = false;
      const requestRestart = vi.fn(async () => ({ fired: true }));

      const deps: DaemonDeps = {
        // A feature is always available → the daemon takes the dispatch branch,
        // never the drained-idle branch. Pre-fix this built `pending` on the
        // stale engine and only restarted after draining; the fix restarts first
        // so a feature is never built on stale code.
        discoverBacklog: async () => [{ slug: 'pending' }],
        runFeature: async (item) => {
          dispatched = true;
          return { slug: item.slug, status: 'done' };
        },
        sleep: async () => {},
        staleEngineChecker: {
          check: () => 'stale' as const,
          capturedIdentity: () => 'captured-hash',
          targetIdentity: () => 'target-hash',
        },
        requestRestart,
      };

      const res = await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 0,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

      // Restart requested once, at the dispatch boundary, with both identities —
      // and the pending feature is never built on the stale engine.
      expect(requestRestart).toHaveBeenCalledTimes(1);
      expect(requestRestart).toHaveBeenCalledWith({
        fromIdentity: 'captured-hash',
        targetIdentity: 'target-hash',
      });
      expect(dispatched).toBe(false);
      expect(res.stoppedReason).toBe('engine_restart');
    });
  });

  // ── #369 Story 2: rebuild-path verdict logs carry both identities ─────────
  it('rebuild-path stale verdict ("engine stale after rebuild"): the log line carries both identities', async () => {
    await withLockedRepo(async () => {
      let dispatched = false;
      const log: string[] = [];
      const requestRestart = vi.fn(async () => ({ fired: true }));

      const deps: DaemonDeps = {
        discoverBacklog: async () => [{ slug: 'pending' }],
        runFeature: async (item) => {
          dispatched = true;
          return { slug: item.slug, status: 'done' };
        },
        sleep: async () => {},
        log: (msg) => log.push(msg),
        staleEngineChecker: {
          check: () => 'stale' as const,
          capturedIdentity: () => 'captured-hash',
          targetIdentity: () => 'target-hash',
        },
        requestRestart,
      };

      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 0,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

      expect(dispatched).toBe(false);
      const rebuildVerdictLines = log.filter((l) => /engine stale after rebuild/.test(l));
      expect(rebuildVerdictLines).toHaveLength(1);
      expect(rebuildVerdictLines[0]).toContain('captured-hash');
      expect(rebuildVerdictLines[0]).toContain('target-hash');
    });
  });

  it('rebuild-path stale verdict with a null identity: the log line renders "null" and never throws', async () => {
    await withLockedRepo(async () => {
      const log: string[] = [];
      const requestRestart = vi.fn(async () => ({ fired: true }));

      const deps: DaemonDeps = {
        discoverBacklog: async () => [{ slug: 'pending' }],
        runFeature: async (item) => ({ slug: item.slug, status: 'done' }),
        sleep: async () => {},
        log: (msg) => log.push(msg),
        staleEngineChecker: {
          check: () => 'stale' as const,
          capturedIdentity: () => null,
          targetIdentity: () => null,
        },
        requestRestart,
      };

      await expect(
        runDaemon(deps, {
          concurrency: 1,
          once: false,
          maxIdlePolls: 0,
          isSelfHost: true,
          autoRestartOnStaleEngine: true,
        }),
      ).resolves.not.toThrow();

      const rebuildVerdictLines = log.filter((l) => /engine stale after rebuild/.test(l));
      expect(rebuildVerdictLines).toHaveLength(1);
      expect(rebuildVerdictLines[0]).toContain('null');
    });
  });

  it('never requests a restart while a build is in flight: a mid-run stale verdict waits for the quiescent boundary (control: it DOES fire once idle)', async () => {
    await withLockedRepo(async () => {
      const events: string[] = [];
      let inFlight = false;
      let checks = 0;
      let served = false;
      const requestRestart = vi.fn(async () => {
        // The restart must never fire while a feature build is running.
        expect(inFlight).toBe(false);
        events.push('restart');
        return { fired: true };
      });

      const deps: DaemonDeps = {
        discoverBacklog: async () => {
          if (served) return [];
          served = true;
          return [{ slug: 'busy' }];
        },
        runFeature: async (item) => {
          inFlight = true;
          await new Promise((r) => setTimeout(r, 10));
          inFlight = false;
          events.push('built');
          return { slug: item.slug, status: 'done' };
        },
        sleep: async () => {},
        staleEngineChecker: {
          // Fresh for the first dispatch (so `busy` builds), stale thereafter so
          // the restart is requested only once the daemon is quiescent again.
          check: () => (checks++ === 0 ? 'current' : 'stale') as const,
          capturedIdentity: () => 'captured-hash',
          targetIdentity: () => 'target-hash',
        },
        requestRestart,
      };

      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 0,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

      // The build completes first; the restart is requested only afterward, at a
      // quiescent boundary — never interleaved with an in-flight build.
      expect(requestRestart).toHaveBeenCalledTimes(1);
      expect(events).toEqual(['built', 'restart']);
    });
  });

  it('negative: non-continuous ("once") mode never requests a restart, even with a stale verdict and an empty backlog (control: continuous mode DOES)', async () => {
    const staleChecker = {
      check: () => 'stale' as const,
      capturedIdentity: () => 'captured-hash',
      targetIdentity: () => 'target-hash',
    };
    const onceRequestRestart = vi.fn(async () => ({ fired: false }));
    const onceDeps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async () => ({ slug: 'never', status: 'done' }),
      staleEngineChecker: staleChecker,
      requestRestart: onceRequestRestart,
    };

    const res = await runDaemon(onceDeps, {
      concurrency: 1,
      once: true,
      isSelfHost: true,
      autoRestartOnStaleEngine: true,
    });
    expect(res.stoppedReason).toBe('backlog_drained');
    expect(onceRequestRestart).not.toHaveBeenCalled();

    // Control: the identical checker verdict, in continuous mode, over an
    // otherwise-idle backlog, MUST request a restart — proving the once-mode
    // guard above is an actual gate, not an unimplemented no-op passing vacuously.
    const continuousRequestRestart = vi.fn(async () => ({ fired: true }));
    const continuousDeps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async () => ({ slug: 'never', status: 'done' }),
      sleep: async () => {},
      staleEngineChecker: staleChecker,
      requestRestart: continuousRequestRestart,
    };
    await runDaemon(continuousDeps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 0,
      isSelfHost: true,
      autoRestartOnStaleEngine: true,
    });
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
      const checker = createStaleEngineChecker(captured, dist, warn);
      const requestRestart = vi.fn(async () => ({ fired: true }));

      const deps: DaemonDeps = {
        discoverBacklog: async () => [],
        runFeature: async () => ({ slug: 'never', status: 'done' }),
        sleep: async () => {},
        staleEngineChecker: checker,
        requestRestart,
      };

      // Two idle ticks see the SAME repeated failure — one warning, not two.
      await runDaemon(deps, {
        concurrency: 1,
        once: false,
        maxIdlePolls: 1,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      });

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
      const writeRestartMarker = requireFn(restartMod, 'writeRestartMarker');
      const initStaleEngineState = requireFn(await load(INIT_MOD), 'initStaleEngineState');

      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');
      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-handshake-dist-'));
      const dist = await buildFixtureDist(workDir, FIXTURE_V2);
      const freshIdentity = await captureEngineIdentity(dist);

      await writeRestartMarker({
        reason: 'stale-engine',
        fromIdentity: 'aaa',
        targetIdentity: freshIdentity,
        at: Date.now(),
      }, repoPath);

      const log: string[] = [];
      const identity = await initStaleEngineState({
        repoPath,
        entryPath: dist,
        flag: true,
        log: (msg: string) => log.push(msg),
      });

      expect(log.join('\n')).toMatch(/restarted for engine refresh/);
      expect(log.join('\n')).toContain('aaa');
      // Stays armed: capture succeeded (identity returned) and the flag is on.
      expect(identity).toBe(freshIdentity);
      expect(log.join('\n')).toMatch(/\bARMED\b/);
      // Converged (fresh === target): NO suppression state is created.
      const getSuppression = requireFn(restartMod, 'getSuppression');
      expect(await getSuppression(repoPath)).toBeNull();
      const { readRestartMarkerWithStatus } = { readRestartMarkerWithStatus: requireFn(restartMod, 'readRestartMarkerWithStatus') };
      const result = await readRestartMarkerWithStatus(repoPath);
      expect(result.kind).toBe('absent');
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
      const restartMod = await load(RESTART_MOD);
      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');
      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-corrupt-'));
      const dist = await buildFixtureDist(workDir, FIXTURE_V1);
      const expectedIdentity = await captureEngineIdentity(dist);

      const log: string[] = [];
      const identity = await initStaleEngineState({
        repoPath,
        entryPath: dist,
        flag: true,
        log: (msg: string) => log.push(msg),
      });

      // Exactly one corruption warning, marker removed, boot proceeds armed.
      expect(log.filter((l) => /corrupt/i.test(l))).toHaveLength(1);
      expect(identity).toBe(expectedIdentity);
      expect(log.join('\n')).toMatch(/\bARMED\b/);
      // No suppression state derives from a corrupt marker.
      const getSuppression = requireFn(restartMod, 'getSuppression');
      expect(await getSuppression(repoPath)).toBeNull();
      expect(existsSync(join(repoPath, '.daemon', 'RESTART_PENDING'))).toBe(false);
      await rm(workDir, { recursive: true, force: true });
    });
  });

  it('non-convergence: fresh identity ≠ marker target ⇒ suppression recorded, one warning naming both identities', async () => {
    await withRepo(async (repoPath) => {
      const restartMod = await load(RESTART_MOD);
      const writeRestartMarker = requireFn(restartMod, 'writeRestartMarker');
      const initStaleEngineState = requireFn(await load(INIT_MOD), 'initStaleEngineState');
      const identityMod = await load(IDENTITY_MOD);
      const captureEngineIdentity = requireFn(identityMod, 'captureEngineIdentity');

      const workDir = await mkdtemp(join(tmpdir(), 'stale-engine-nonconverge-'));
      const dist = await buildFixtureDist(workDir, FIXTURE_V1); // we come back on THIS identity
      const freshIdentity = await captureEngineIdentity(dist);

      // Marker's target was a DIFFERENT identity we never actually reached.
      const markerTarget = 'a-target-we-never-reached';
      await writeRestartMarker({
        reason: 'stale-engine',
        fromIdentity: 'zzz',
        targetIdentity: markerTarget,
        at: Date.now(),
      }, repoPath);

      const log: string[] = [];
      await initStaleEngineState({
        repoPath,
        entryPath: dist,
        flag: true,
        log: (msg: string) => log.push(msg),
      });

      // Suppression recorded against the marker target (the identity we were trying to reach).
      const getSuppression = requireFn(restartMod, 'getSuppression');
      const suppression = await getSuppression(repoPath);
      expect(suppression).not.toBeNull();
      expect(suppression!.suppressedTarget).toBe(markerTarget);
      expect(log.filter((l) => /suppress/i.test(l))).toHaveLength(1);
      expect(log.join('\n')).toContain(markerTarget);
      expect(log.join('\n')).toContain(freshIdentity);
      await rm(workDir, { recursive: true, force: true });
    });
  });
});
