import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  tmuxInstalled,
  newDetachedSession,
  killSession,
  hasSession,
  setRemainOnExit,
  respawnPane,
  defaultTmuxRunner,
} from '../../src/engine/daemon-tmux.js';
import { createRestartRequester } from '../../src/daemon-cli.js';
import * as restartIntent from '../../src/engine/restart-intent.js';
import { runDaemon, type DaemonDeps } from '../../src/engine/daemon.js';

// Capstone acceptance spec for #353 / adr-2026-07-06-stale-engine-respawn-in-place
// (TR-2, TR-3, TR-4). The production wiring this drives — createRestartRequester
// accepting injected `relink`/`triggerSelfRestart` deps, daemon-supervisor-cli's
// restart path relinking before respawn, daemon.ts's idle-boundary relink — does
// NOT exist yet (plan Tasks 4, 9, 11, 13 are unimplemented). This file composes
// the REAL primitives (createRestartRequester, respawnPane, hasSession,
// setRemainOnExit, the restart-intent marker functions) the way the ADR says the
// finished feature will compose them, with a scripted relink stub and a
// triggerSelfRestart backed by the real respawnPane. It is expected to fail for
// the RIGHT reason: the real createRestartRequester signature does not accept
// these deps, so it still exits instead of respawning — an assertion failure,
// not a syntax error or a skip.
//
// Split into two sub-tests per the skill's guidance: a tmux-gated one (full
// session-survives / never-stopped / marker-consumed observable outcome) and a
// non-tmux-gated one (the requester's dependency-injection contract alone, so
// RED evidence exists even on a host without tmux on PATH).

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  if (!(await predicate())) {
    throw new Error(`waitFor: predicate did not become true within ${timeoutMs}ms`);
  }
}

describe('daemon-stale-respawn-e2e — #353 capstone (TR-2/TR-3/TR-4)', () => {
  describe('requester dependency-injection contract (no tmux required)', () => {
    let daemonDir: string;

    beforeEach(async () => {
      daemonDir = await mkdtemp(join(tmpdir(), 'stale-respawn-contract-'));
    });

    afterEach(async () => {
      await rm(daemonDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it(
      'relink -> marker write -> triggerSelfRestart fires (in order); lock is NOT released and process does NOT exit when session-hosted',
      async () => {
        const callOrder: string[] = [];

        const relinkStub = vi.fn(async () => {
          callOrder.push('relink');
        });
        const triggerSelfRestartStub = vi.fn(async () => {
          callOrder.push('trigger');
        });

        const writeSpy = vi.spyOn(restartIntent, 'writeRestartMarker').mockImplementation(
          async (marker, dir) => {
            callOrder.push('marker-write');
            // Write the file directly (avoids re-entering the mocked module)
            // so downstream assertions about marker content stay meaningful.
            const target = join(dir, '.daemon', 'RESTART_PENDING');
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, JSON.stringify(marker, null, 2), 'utf-8');
          },
        );

        const mockLock = { releaseSync: vi.fn() };
        const mockProcess = { exit: vi.fn() } as unknown as NodeJS.Process;
        const mockLog = () => {};

        // The ADR's finished shape (plan Task 4): createRestartRequester gains
        // a 5th, optional `deps` argument carrying `relink` and
        // `triggerSelfRestart`. That parameter does not exist on the real
        // function today, so it is silently ignored at runtime (TS type
        // erasure under vitest's esbuild transform) — the requester still
        // executes today's write-marker -> release -> exit(0) contract, which
        // is exactly the bug (#353) this feature fixes.
        const requester = createRestartRequester(
          daemonDir,
          mockLog,
          mockLock,
          mockProcess,
          // @ts-expect-error — 5th param does not exist yet (Task 4, RED)
          { relink: relinkStub, triggerSelfRestart: triggerSelfRestartStub },
        );

        await requester({ fromIdentity: 'old-hash', targetIdentity: 'new-hash' });

        // Desired (post-fix) ordering and outcome — FAILS today.
        expect(callOrder).toEqual(['relink', 'marker-write', 'trigger']);
        expect(relinkStub).toHaveBeenCalledTimes(1);
        expect(triggerSelfRestartStub).toHaveBeenCalledTimes(1);
        expect(mockProcess.exit).not.toHaveBeenCalled();
        expect(mockLock.releaseSync).not.toHaveBeenCalled();

        writeSpy.mockRestore();
      },
    );
  });

  describe('single-generation invariant: real runDaemon idle loop drives the real requester (#400, ADR-2026-07-07)', () => {
    let daemonDir: string;

    beforeEach(async () => {
      daemonDir = await mkdtemp(join(tmpdir(), 'single-gen-'));
    });

    afterEach(async () => {
      await rm(daemonDir, { recursive: true, force: true });
    });

    it(
      'a permanently-stale checker across repeated idle polls fires the requester exactly once, ' +
        'exits exactly once, and the loop stops with stopReason "engine_restart" — no stacked respawns',
      async () => {
        const mockLock = { releaseSync: vi.fn() };
        const mockProcess = { exit: vi.fn() } as unknown as NodeJS.Process;
        const triggerSelfRestart = vi.fn(async () => {});

        // The REAL production requester (daemon-cli.ts), session-hosted (a
        // triggerSelfRestart dep is supplied) — not a mock of the requester
        // itself. Composed with the REAL idle loop (daemon.ts runDaemon)
        // below: this is the cross-module seam #400 broke (the requester
        // fired repeatedly because neither module stopped the loop).
        const requestRestart = createRestartRequester(daemonDir, () => {}, mockLock, mockProcess, {
          triggerSelfRestart,
        });

        const deps: DaemonDeps = {
          discoverBacklog: async () => [],
          runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
          staleEngineChecker: {
            check: () => 'stale',
            capturedIdentity: () => 'old-hash',
            targetIdentity: () => 'new-hash',
          },
          sleep: async () => {},
          requestRestart,
        };

        const res = await runDaemon(deps, {
          concurrency: 1,
          once: false,
          isSelfHost: true,
          autoRestartOnStaleEngine: true,
          maxIdlePolls: 5,
        });

        // Single-generation invariant (ADR Decisions 1 + 2): exactly one fire,
        // exactly one exit, the loop breaks instead of polling on. Today the
        // requester returns without exiting and the loop has no backstop, so
        // triggerSelfRestart fires on every idle poll (the #400 burst) and
        // stoppedReason is 'idle_timeout' — this fails for that reason, not a
        // type/collection error.
        expect(triggerSelfRestart).toHaveBeenCalledTimes(1);
        expect(mockProcess.exit).toHaveBeenCalledTimes(1);
        expect(mockProcess.exit).toHaveBeenCalledWith(0);
        expect(mockLock.releaseSync).toHaveBeenCalledTimes(1);
        expect(res.stoppedReason).toBe('engine_restart');
      },
    );
  });

  describe('real tmux: session survives, new pid, marker consumed, hyphen marker untouched', () => {
    it(
      'session-hosted stale-engine restart never leaves the daemon stopped',
      async () => {
        if (!(await tmuxInstalled())) return; // skip cleanly — no tmux on PATH

        const suffix = randomBytes(4).toString('hex');
        const name = `cc-daemon-e2e-${suffix}`;
        const cwd = await mkdtemp(join(tmpdir(), 'stale-respawn-e2e-'));
        const daemonDir = await mkdtemp(join(tmpdir(), 'stale-respawn-e2e-dir-'));

        const bootCmd = 'bash -c "while true; do echo BOOT_$$; sleep 1; done"';

        const prevNoRealExec = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
        delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;

        function captureScrollback(): string {
          const result = defaultTmuxRunner(['capture-pane', '-p', '-S', '-', '-t', `=${name}:`], {
            inherit: false,
          });
          return result.code === 0 ? result.stdout : '';
        }

        try {
          // Seed a session-hosted daemon (mirrors Supervisor.start's
          // fresh-session path) with remain-on-exit armed, exactly as TR-1
          // requires on every creation path.
          await newDetachedSession(name, bootCmd, cwd);
          await setRemainOnExit(name);
          expect(await hasSession(name)).toBe(true);
          await waitFor(() => /BOOT_\d+/.test(captureScrollback()));
          const prePidMatch = captureScrollback().match(/BOOT_(\d+)/);
          expect(prePidMatch).not.toBeNull();
          const prePid = prePidMatch![1];

          const relinkStub = vi.fn(async () => {});
          const triggerSelfRestart = vi.fn(async () => {
            // The real production shape (index.ts buildDaemonModeOptions):
            // triggerSelfRestart = () => respawnPane(sessionName).
            await respawnPane(name, defaultTmuxRunner, bootCmd);
          });

          const mockLock = { releaseSync: vi.fn() };
          const mockProcess = { exit: vi.fn() } as unknown as NodeJS.Process;
          const mockLog = () => {};

          const requester = createRestartRequester(
            daemonDir,
            mockLog,
            mockLock,
            mockProcess,
            // @ts-expect-error — 5th param does not exist yet (Task 4, RED)
            { relink: relinkStub, triggerSelfRestart },
          );

          // Force the stale verdict: the requester is invoked as the daemon's
          // stale-engine path does today (opts carry the two identities).
          await requester({ fromIdentity: prePid, targetIdentity: `${prePid}-fresh` });

          // Never stopped: `daemon status` proxy — session still up, pane alive.
          expect(await hasSession(name)).toBe(true);

          // New pid: only true once triggerSelfRestart actually fires
          // respawnPane — which requires the requester to have called it.
          await waitFor(() => {
            const matches = [...captureScrollback().matchAll(/BOOT_(\d+)/g)];
            return matches.length >= 1 && matches[matches.length - 1][1] !== prePid;
          }, 3000).catch(() => {
            // Allowed to time out here — the point of this RED test is that
            // the trigger was never wired, so no new pid ever appears. The
            // explicit expectation below is what actually fails the suite.
          });
          expect(triggerSelfRestart).toHaveBeenCalledTimes(1);
          expect(relinkStub).toHaveBeenCalledTimes(1);

          // Underscore marker consumed-once handshake: written by this
          // attempt, and still readable (successor hasn't booted in this
          // synthetic scenario, so it should still be present pre-consume).
          const markerPath = join(daemonDir, '.daemon', 'RESTART_PENDING');
          expect(existsSync(markerPath)).toBe(true);
          const marker = JSON.parse(await readFile(markerPath, 'utf-8'));
          expect(marker.reason).toBe('stale-engine');

          // Non-autonomy clause: the hyphen (human-queued) marker must never
          // be created or modified by the stale-engine path.
          const hyphenMarkerPath = join(daemonDir, '.daemon', 'RESTART-PENDING');
          expect(existsSync(hyphenMarkerPath)).toBe(false);
        } finally {
          await killSession(name);
          await rm(cwd, { recursive: true, force: true });
          await rm(daemonDir, { recursive: true, force: true });
          if (prevNoRealExec === undefined) {
            delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
          } else {
            process.env.AI_CONDUCTOR_NO_REAL_EXEC = prevNoRealExec;
          }
        }
      },
      60_000,
    );
  });
});
