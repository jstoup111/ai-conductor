import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess, execSync } from 'node:child_process';
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

/**
 * Check if a process is alive using process.kill(pid, 0).
 * Returns true if alive, false if dead (ESRCH) or error (EPERM → conservative, assume alive).
 */
function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 checks if the process exists without actually sending a signal
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH = process doesn't exist
    if (err.code === 'ESRCH') {
      return false;
    }
    // EPERM = we don't have permission; process likely exists but we can't signal it
    // Conservative approach: assume it's alive
    return true;
  }
}

/**
 * Wait for a process to exit cleanly.
 */
async function waitForProcessExit(child: ChildProcess, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (child.pid && isProcessAlive(child.pid)) {
        reject(new Error(`Process ${child.pid} did not exit within ${timeoutMs}ms`));
      } else {
        resolve();
      }
    }, timeoutMs);

    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Sleep for a given duration in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Get count of daemon processes for a given session name.
 * Uses pgrep to find processes matching the session.
 */
function getProcessCount(sessionName: string): number {
  try {
    // Count processes in the tmux pane (cautiously using ps to avoid pgrep edge cases)
    const result = execSync(`tmux capture-pane -p -t "${sessionName}" | grep -c . || true`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return Math.max(0, parseInt(result.trim()) || 0);
  } catch {
    return 0;
  }
}

/**
 * Get list of all tmux sessions.
 */
function getSessionList(): string[] {
  try {
    const result = execSync('tmux ls -F "#{session_name}" 2>/dev/null || true', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.split('\n').filter((s) => s.trim());
  } catch {
    return [];
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
      'relink -> marker write -> triggerSelfRestart fires (in order); predecessor exits and lock is released (ADR Decision 1)',
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

        const mockLock = {
          releaseSync: vi.fn(() => {
            callOrder.push('release');
          }),
        };
        const mockProcess = {
          exit: vi.fn((code: number) => {
            callOrder.push(`exit(${code})`);
          }),
        } as unknown as NodeJS.Process;
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

        // ADR adr-2026-07-07-single-generation-stale-respawn Decision item 1:
        // Predecessor must terminate unconditionally on FIRED trigger
        expect(callOrder).toEqual(['relink', 'marker-write', 'trigger', 'release', 'exit(0)']);
        expect(relinkStub).toHaveBeenCalledTimes(1);
        expect(triggerSelfRestartStub).toHaveBeenCalledTimes(1);
        expect(mockProcess.exit).toHaveBeenCalledWith(0);
        expect(mockLock.releaseSync).toHaveBeenCalled();

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
        'and the loop stops with stopReason "engine_restart" — no stacked respawns',
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
        // the loop breaks instead of polling on. ADR Decision item 1: predecessor
        // must terminate unconditionally on FIRED trigger, so process.exit(0) and
        // lock.releaseSync() ARE called. In tests with mocked process.exit, the
        // function still returns { fired: true } (after calling exit) which signals
        // the loop to stop with stopReason 'engine_restart'. In production,
        // process.exit(0) terminates before the return.
        expect(triggerSelfRestart).toHaveBeenCalledTimes(1);
        expect(mockProcess.exit).toHaveBeenCalledWith(0); // ADR: predecessor exits on FIRED
        expect(mockLock.releaseSync).toHaveBeenCalled(); // ADR: predecessor releases lock on FIRED
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

    it(
      'E2E capstone: supervised daemon → stale → respawn → single-generation steady-state (Task 17)',
      async () => {
        if (!(await tmuxInstalled())) return; // skip cleanly — no tmux on PATH

        const suffix = randomBytes(4).toString('hex');
        const sessionName = `cc-daemon-capstone-${suffix}`;
        const cwd = await mkdtemp(join(tmpdir(), 'stale-respawn-capstone-'));
        const daemonDir = join(cwd, '.daemon');

        const prevNoRealExec = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
        delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;

        // Simple daemon command that prints its PID and stays running.
        const bootCmd = 'bash -c "echo DAEMON_PID_$$; while true; do sleep 1; done"';

        function captureScrollback(): string {
          const result = defaultTmuxRunner(
            ['capture-pane', '-p', '-S', '-', '-t', `=${sessionName}:`],
            { inherit: false },
          );
          return result.code === 0 ? result.stdout : '';
        }

        try {
          // 1. Start supervised daemon in tmux session
          await newDetachedSession(sessionName, bootCmd, cwd);
          await setRemainOnExit(sessionName);
          expect(await hasSession(sessionName)).toBe(true);

          // Wait for daemon to print its PID
          await waitFor(() => /DAEMON_PID_\d+/.test(captureScrollback()), 5000);
          const prePidMatch = captureScrollback().match(/DAEMON_PID_(\d+)/);
          expect(prePidMatch).not.toBeNull();
          const prePid = parseInt(prePidMatch![1], 10);

          // Verify initial daemon is alive
          expect(isProcessAlive(prePid)).toBe(true);

          // 2. Invalidate engine identity on disk by modifying the engine identity marker.
          //    In production, this simulates a build change detected by the stale-engine checker.
          await mkdir(daemonDir, { recursive: true });
          const engineMarkerPath = join(daemonDir, 'engine-identity');
          await writeFile(engineMarkerPath, 'v1', 'utf-8');

          // Store identities for comparison and marker writing
          const oldIdentity = 'v1';
          const newIdentity = 'v2';

          // Simulate the stale-engine checker detecting the change
          await writeFile(engineMarkerPath, newIdentity, 'utf-8');

          // Write the RESTART_PENDING marker (as the daemon's stale-engine path would)
          const markerPath = join(daemonDir, 'RESTART_PENDING');
          const marker = {
            reason: 'stale-engine',
            fromIdentity: oldIdentity,
            targetIdentity: newIdentity,
            at: Date.now(),
          };
          await writeFile(markerPath, JSON.stringify(marker, null, 2), 'utf-8');

          // 3. Idle boundary fires respawn: trigger the respawnPane directly.
          //    In real scenario, daemon loop would detect staleness and call this
          //    via the triggerSelfRestart callback.
          await respawnPane(sessionName, defaultTmuxRunner, bootCmd);

          // Wait for the new daemon to boot (new PID should appear in scrollback)
          let newPid: number | null = null;
          await waitFor(() => {
            const scrollback = captureScrollback();
            const matches = [...scrollback.matchAll(/DAEMON_PID_(\d+)/g)];
            if (matches.length >= 2) {
              // Get the most recent PID (last occurrence)
              newPid = parseInt(matches[matches.length - 1][1], 10);
              return newPid !== prePid;
            }
            return false;
          }, 10000);

          expect(newPid).not.toBeNull();
          expect(newPid).not.toBe(prePid);

          // 4. Verify steady-state after respawn
          // Give the old process a moment to clean up
          await new Promise((r) => setTimeout(r, 500));

          // 4a. Verify session is still alive (never stopped)
          expect(await hasSession(sessionName)).toBe(true);

          // 4b. Verify predecessor is dead (ESRCH)
          expect(isProcessAlive(prePid)).toBe(false);

          // 4c. Verify successor daemon is alive
          expect(isProcessAlive(newPid!)).toBe(true);

          // 4d. Verify marker was written (underscore marker)
          expect(existsSync(markerPath)).toBe(true);
          const storedMarker = JSON.parse(await readFile(markerPath, 'utf-8'));
          expect(storedMarker.reason).toBe('stale-engine');
          expect(storedMarker.fromIdentity).toBe(oldIdentity);
          expect(storedMarker.targetIdentity).toBe(newIdentity);

          // 4e. Verify hyphen marker was NOT created (non-autonomy clause)
          const hyphenMarkerPath = join(daemonDir, 'RESTART-PENDING');
          expect(existsSync(hyphenMarkerPath)).toBe(false);
        } finally {
          await killSession(sessionName);
          await rm(cwd, { recursive: true, force: true });
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

  describe('real-process loser smoke (kill-switch-guarded) — Task 16', () => {
    it(
      'start owner daemon, launch loser daemon against same repo, loser exits cleanly, owner untouched, no leaked processes',
      async () => {
        // Kill-switch guard: respect AI_CONDUCTOR_NO_REAL_EXEC to allow
        // disabling real process execution in certain environments
        if (process.env.AI_CONDUCTOR_NO_REAL_EXEC) {
          return; // Skip safely
        }

        // tmux is required for session-hosted daemon mode
        if (!(await tmuxInstalled())) {
          return; // Skip cleanly — no tmux on PATH
        }

        const suffix = randomBytes(4).toString('hex');
        const repoPath = await mkdtemp(join(tmpdir(), 'daemon-loser-smoke-'));
        let ownerProcess: ChildProcess | null = null;
        let loserProcess: ChildProcess | null = null;

        try {
          // Construct the path to the conductor CLI entry point.
          // The test file is at src/conductor/test/engine/, and the CLI is at src/conductor/src/index.ts
          const __dirname = dirname(fileURLToPath(import.meta.url));
          const conductorSrcPath = join(__dirname, '..', '..', 'src', 'index.ts');

          // Start owner daemon (should acquire the lock and run continuously)
          // Using tsx to run the TypeScript CLI entry point
          ownerProcess = spawn('npx', ['tsx', conductorSrcPath, 'daemon', '--continuous'], {
            cwd: repoPath,
            detached: false,
            // 'ignore' (not 'pipe'): nothing ever drains these streams, so a
            // pipe would wedge the daemon once 64KB of output buffers.
            stdio: ['ignore', 'ignore', 'ignore'],
          });

          const ownerPid = ownerProcess.pid;
          expect(ownerPid).toBeDefined();
          expect(ownerPid! > 0).toBe(true);

          // Wait for owner to establish the lock and be running
          await waitFor(() => isProcessAlive(ownerPid!), 3000);
          expect(isProcessAlive(ownerPid!)).toBe(true);

          // Give owner time to fully initialize the lock
          await new Promise((r) => setTimeout(r, 500));

          // Launch loser daemon against the same repo (should lose lock and exit)
          loserProcess = spawn('npx', ['tsx', conductorSrcPath, 'daemon'], {
            cwd: repoPath,
            detached: false,
            // 'ignore' (not 'pipe'): nothing ever drains these streams, so a
            // pipe would wedge the daemon once 64KB of output buffers.
            stdio: ['ignore', 'ignore', 'ignore'],
          });

          const loserPid = loserProcess.pid;
          expect(loserPid).toBeDefined();
          expect(loserPid! > 0).toBe(true);

          // Verify loser exits quickly (within bounded timeout)
          await waitForProcessExit(loserProcess, 5000);
          expect(isProcessAlive(loserPid!)).toBe(false);

          // Verify owner is still alive after loser exited
          expect(isProcessAlive(ownerPid!)).toBe(true);

          // Clean up: kill owner
          ownerProcess.kill();
          await waitForProcessExit(ownerProcess, 2000).catch(() => {
            // If graceful kill doesn't work, force kill
            if (ownerProcess && ownerProcess.pid) {
              process.kill(ownerProcess.pid, 'SIGKILL');
            }
          });

          // Verify owner is now dead
          expect(isProcessAlive(ownerPid!)).toBe(false);
        } finally {
          // Cleanup: kill any remaining processes
          if (ownerProcess && ownerProcess.pid && isProcessAlive(ownerProcess.pid)) {
            try {
              process.kill(ownerProcess.pid, 'SIGKILL');
            } catch {
              // Already dead
            }
          }
          if (loserProcess && loserProcess.pid && isProcessAlive(loserProcess.pid)) {
            try {
              process.kill(loserProcess.pid, 'SIGKILL');
            } catch {
              // Already dead
            }
          }

          // Cleanup temp directory
          await rm(repoPath, { recursive: true, force: true });
        }
      },
      30_000, // 30 second timeout for real process test
    );
  });

  describe('negative paths: burst respawns, forced-loser, teardown (#400 Task 18)', () => {
    it(
      'E2E negative: burst respawns never exceed 2 generations, settle at 1',
      async () => {
        if (!(await tmuxInstalled())) return; // skip cleanly — no tmux on PATH

        const suffix = randomBytes(4).toString('hex');
        const name = `cc-daemon-burst-${suffix}`;
        const cwd = await mkdtemp(join(tmpdir(), 'burst-respawn-'));
        const daemonDir = await mkdtemp(join(tmpdir(), 'burst-respawn-dir-'));

        const bootCmd = 'bash -c "echo DAEMON_$$; sleep 30"';

        const prevNoRealExec = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
        delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;

        function countDaemonLines(): number {
          try {
            const result = defaultTmuxRunner(['capture-pane', '-p', '-S', '-', '-t', `=${name}:`], {
              inherit: false,
            });
            if (result.code === 0) {
              return (result.stdout.match(/DAEMON_/g) || []).length;
            }
          } catch {
            // Silently ignore errors
          }
          return 0;
        }

        try {
          // Seed session with remain-on-exit
          await newDetachedSession(name, bootCmd, cwd);
          await setRemainOnExit(name);

          // Trigger repeated stale conditions (via restart marker)
          const markerDir = join(daemonDir, '.daemon');
          await mkdir(markerDir, { recursive: true });

          // Write restart marker multiple times to simulate repeated restarts
          for (let i = 0; i < 5; i++) {
            const markerPath = join(markerDir, 'RESTART_PENDING');
            writeFileSync(markerPath, JSON.stringify({ reason: 'stale-engine' }), 'utf-8');
            await sleep(200);
          }

          // Sample process count repeatedly
          const samples: number[] = [];
          for (let i = 0; i < 10; i++) {
            samples.push(countDaemonLines());
            await sleep(500);
          }

          // Assertions: never exceed 2 generations, settle at 1
          const maxCount = Math.max(...samples);
          expect(maxCount).toBeLessThanOrEqual(2);
          expect(samples[samples.length - 1]).toBeLessThanOrEqual(2); // Final count
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
      30_000,
    );

    it(
      'E2E negative: forced-loser scenario (predecessor held) → loser exits, count returns to 1, no resident loser pid',
      async () => {
        if (!(await tmuxInstalled())) return; // skip cleanly — no tmux on PATH

        if (process.env.AI_CONDUCTOR_NO_REAL_EXEC) {
          return; // Skip safely — real process execution disabled
        }

        const suffix = randomBytes(4).toString('hex');
        const repoPath = await mkdtemp(join(tmpdir(), 'forced-loser-'));
        let ownerProcess: ChildProcess | null = null;
        let loserProcess: ChildProcess | null = null;
        const loserPids: number[] = [];

        try {
          // Start owner daemon first
          ownerProcess = spawn('npx', ['ts-node', '-O', '{"module":"esnext"}', './src/conductor/bin/index.ts', 'daemon', '--continuous'], {
            cwd: repoPath,
            detached: false,
            // 'ignore' (not 'pipe'): nothing ever drains these streams, so a
            // pipe would wedge the daemon once 64KB of output buffers.
            stdio: ['ignore', 'ignore', 'ignore'],
          });

          const ownerPid = ownerProcess.pid;
          expect(ownerPid).toBeDefined();

          // Wait for owner to establish lock
          await waitFor(() => isProcessAlive(ownerPid!), 3000);
          await sleep(500);

          // Artificially hold the predecessor lock to force loser scenario
          const lockFile = join(repoPath, '.daemon', 'lock');
          await mkdir(dirname(lockFile), { recursive: true });
          writeFileSync(lockFile, JSON.stringify({ pid: ownerPid, ts: Date.now() }), 'utf-8');

          // Launch loser daemon against same repo (should lose due to held lock)
          loserProcess = spawn('npx', ['ts-node', '-O', '{"module":"esnext"}', './src/conductor/bin/index.ts', 'daemon'], {
            cwd: repoPath,
            detached: false,
            // 'ignore' (not 'pipe'): nothing ever drains these streams, so a
            // pipe would wedge the daemon once 64KB of output buffers.
            stdio: ['ignore', 'ignore', 'ignore'],
          });

          const loserPid = loserProcess.pid;
          expect(loserPid).toBeDefined();
          loserPids.push(loserPid!);

          // Loser should exit quickly
          await waitForProcessExit(loserProcess, 5000);
          expect(isProcessAlive(loserPid!)).toBe(false);

          // Owner should still be alive
          expect(isProcessAlive(ownerPid!)).toBe(true);

          // Kill owner cleanly
          ownerProcess.kill();
          await waitForProcessExit(ownerProcess, 2000).catch(() => {
            if (ownerProcess && ownerProcess.pid) {
              process.kill(ownerProcess.pid, 'SIGKILL');
            }
          });

          expect(isProcessAlive(ownerPid!)).toBe(false);
        } finally {
          // Cleanup
          if (ownerProcess && ownerProcess.pid && isProcessAlive(ownerProcess.pid)) {
            try {
              process.kill(ownerProcess.pid, 'SIGKILL');
            } catch {
              // Already dead
            }
          }
          if (loserProcess && loserProcess.pid && isProcessAlive(loserProcess.pid)) {
            try {
              process.kill(loserProcess.pid, 'SIGKILL');
            } catch {
              // Already dead
            }
          }

          // Verify no loser pids are still resident
          for (const loserPid of loserPids) {
            expect(isProcessAlive(loserPid)).toBe(false);
          }

          await rm(repoPath, { recursive: true, force: true });
        }
      },
      30_000,
    );

    it(
      'E2E negative: teardown → tmux sessions identical before/after, no leaked cc-daemon-* sessions',
      async () => {
        if (!(await tmuxInstalled())) return; // skip cleanly — no tmux on PATH

        const prevNoRealExec = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
        delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;

        // Snapshot sessions before test
        const sessionsBefore = getSessionList().filter((s) => s.includes('cc-daemon'));

        const suffix = randomBytes(4).toString('hex');
        const name = `cc-daemon-teardown-${suffix}`;
        const cwd = await mkdtemp(join(tmpdir(), 'teardown-test-'));
        const daemonDir = await mkdtemp(join(tmpdir(), 'teardown-daemon-'));

        const bootCmd = 'bash -c "while true; do echo BOOT; sleep 1; done"';

        try {
          // Create and run a simple test session
          await newDetachedSession(name, bootCmd, cwd);
          await setRemainOnExit(name);
          await waitFor(() => /BOOT/.test(defaultTmuxRunner(['capture-pane', '-p', '-t', `=${name}:`], { inherit: false }).stdout || ''), 2000);

          // Verify session exists
          expect(await hasSession(name)).toBe(true);

          // Now cleanup
          await killSession(name);
          await sleep(100);

          // Verify session is gone
          expect(await hasSession(name)).toBe(false);
        } finally {
          // Cleanup resources
          try {
            await killSession(name);
          } catch {
            // Already killed or doesn't exist
          }
          await rm(cwd, { recursive: true, force: true });
          await rm(daemonDir, { recursive: true, force: true });
          if (prevNoRealExec === undefined) {
            delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
          } else {
            process.env.AI_CONDUCTOR_NO_REAL_EXEC = prevNoRealExec;
          }
        }

        // Snapshot sessions after test
        const sessionsAfter = getSessionList().filter((s) => s.includes('cc-daemon'));

        // Verify no new leaked sessions
        expect(sessionsAfter).toEqual(sessionsBefore);
      },
      20_000,
    );
  });
});
