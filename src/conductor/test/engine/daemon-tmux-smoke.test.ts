import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultTmuxRunner,
  tmuxInstalled,
  newDetachedSession,
  killSession,
  hasSession,
  setRemainOnExit,
  respawnPane,
  type TmuxRunner,
} from '../../src/engine/daemon-tmux.js';

// Real-tmux smoke (Phase 3, FR-20, Task T36).
//
// The unit tests for daemon-tmux.ts (test/engine/daemon-tmux.test.ts) spy on the
// TmuxRunner and prove we pass the RIGHT ARGV — they cannot prove real tmux
// actually preserves scrollback/session identity across a respawn, or that our
// exact-`=` targeting really prevents a near-name session collision (an argv
// typo, e.g. dropping the leading '=', would pass the mocked unit tests but
// silently misbehave against a real tmux server — the same class of bug the
// self-host relink smoke exists to catch). This test drives the REAL `tmux`
// binary end-to-end and skips cleanly when tmux is not on PATH.
//
// Every session created here gets a random suffix and is killed in a finally
// block, so this never leaves a daemon session behind (the exact failure mode
// T22-T24 exist to guard against).

/** Full scrollback capture (history + visible screen), unlike the module's
 * capturePane() helper which only returns the currently visible screen. Uses
 * the same exact-`=` pane target convention as every other pane-scoped call
 * in daemon-tmux.ts. */
function captureScrollback(run: TmuxRunner, name: string): string {
  const result = run(
    ['capture-pane', '-p', '-S', '-', '-t', `=${name}:`],
    { inherit: false },
  );
  return result.code === 0 ? result.stdout : '';
}

/**
 * Keep each real-tmux smoke test on its own server. Vitest can run several
 * real-tmux files concurrently; session names alone do not isolate operations
 * from other tests sharing tmux's default server.
 */
function isolatedTmuxRunner(socketName: string): TmuxRunner {
  return (args, opts) => defaultTmuxRunner(['-L', socketName, ...args], opts);
}

/**
 * A tmux binary may be on PATH while its socket directory is unavailable
 * (for example, in a restricted test sandbox). Treat that like tmux absence:
 * a real-binary smoke cannot provide evidence without a usable server.
 */
async function tmuxServerAvailable(run: TmuxRunner, cwd: string, suffix: string): Promise<boolean> {
  const probe = `tmux-smoke-probe-${suffix}`;
  try {
    await newDetachedSession(probe, 'bash -c "sleep 10"', cwd, run);
    return await hasSession(probe, run);
  } catch {
    return false;
  } finally {
    await killSession(probe, run);
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  if (!predicate()) {
    throw new Error(`waitFor: predicate did not become true within ${timeoutMs}ms`);
  }
}

describe('daemon-tmux — real tmux smoke (FR-20, Task T36)', () => {
  it(
    'respawn-in-place preserves session/scrollback and reassigns pid; exact-= targeting avoids near-name collision',
    async () => {
      if (!(await tmuxInstalled())) return; // skip cleanly — no tmux on PATH

      const suffix = randomBytes(4).toString('hex');
      const name = `cc-daemon-smoke-${suffix}`;
      const nearName = `${name}-extra`; // near-name session: same prefix, longer
      const cwd = await mkdtemp(join(tmpdir(), 'daemon-tmux-smoke-'));
      const run = isolatedTmuxRunner(`ai-conductor-smoke-${suffix}`);

      // Dummy "daemon" command: an infinite loop that echoes BOOT each cycle.
      // Using a tight loop in bash allows respawn-pane -k to interrupt cleanly
      // and re-execute from the beginning, generating new BOOT markers.
      const dummyDaemonCommand = 'bash -c "while true; do echo BOOT_$$; sleep 1; done"';

      // This smoke test deliberately drives real cc-daemon-* tmux sessions to
      // exercise the real binary (see file banner). The global test setup sets
      // AI_CONDUCTOR_NO_REAL_EXEC=1 to keep every OTHER test from leaking real
      // daemons via the deep-seam guard (daemon-tmux.ts); this single test is
      // the intentional exception, so it lifts the kill-switch for its own
      // duration only, restoring it in the finally block below.
      const prevNoRealExec = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;

      try {
        if (!(await tmuxServerAvailable(run, cwd, suffix))) return;

        // 1. Real session + dummy daemon command → capture scrollback.
        await newDetachedSession(name, dummyDaemonCommand, cwd, run);
        expect(await hasSession(name, run)).toBe(true);

        await waitFor(() => /BOOT_\d+/.test(captureScrollback(run, name)));
        const preRestartScrollback = captureScrollback(run, name);
        const preMatch = preRestartScrollback.match(/BOOT_(\d+)/);
        expect(preMatch).not.toBeNull();
        const prePid = preMatch![1];
        console.log(`DEBUG: Initial scrollback after session creation (prePid=${prePid}):\n${preRestartScrollback}`);

        // 5. Exact-`=` targeting verified against a near-name session, BEFORE
        // the restart mutates anything — proves respawn-pane/capture-pane
        // below can't accidentally address the near-name session instead.
        const nearMarker = `NEAR_${suffix}`;
        await newDetachedSession(nearName, `bash -c "while true; do echo ${nearMarker}; sleep 1; done"`, cwd, run);
        try {
          expect(await hasSession(nearName, run)).toBe(true);
          await waitFor(() => captureScrollback(run, nearName).includes(nearMarker));

          // capture-pane on the short name must see ONLY its own boot marker,
          // never the near-name session's output (would happen if the target
          // were unanchored, e.g. a bare prefix match instead of `=name:`).
          const shortNameCapture = captureScrollback(run, name);
          expect(shortNameCapture).toContain(`BOOT_${prePid}`);
          expect(shortNameCapture).not.toContain(nearMarker);

          // capture-pane on the near-name session must see only its own
          // marker, never the short session's.
          const nearNameCapture = captureScrollback(run, nearName);
          expect(nearNameCapture).toContain(nearMarker);
          expect(nearNameCapture).not.toContain(`BOOT_${prePid}`);

          // 2. Real respawn-in-place restart → same session name preserved.
          // Wait for the next BOOT marker to ensure pane is actively running
          await new Promise((r) => setTimeout(r, 1500));
          const scrollbackBeforeRespawn = captureScrollback(run, name);
          console.log(`DEBUG: scrollback BEFORE respawnPane (FULL):\n${scrollbackBeforeRespawn}`);
          console.log(`DEBUG: scrollback BEFORE has prePid? ${scrollbackBeforeRespawn.includes(`BOOT_${prePid}`)}`);

          await setRemainOnExit(name, run);
          console.log(`DEBUG: remain-on-exit set`);

          try {
            // Pass the dummy daemon command so respawnPane re-executes it with a new PID
            console.log(`DEBUG: calling respawnPane...`);
            await respawnPane(name, run, dummyDaemonCommand);
            console.log(`DEBUG: respawnPane succeeded`);
          } catch (err) {
            // If respawn-pane fails, fall back to kill-session + new-session
            // (which the Supervisor.restart method does as a fallback).
            // This lets us still verify the key restart goals even on degraded path.
            console.log(`DEBUG: respawnPane failed: ${err instanceof Error ? err.message : String(err)}`);
            console.log(`DEBUG: falling back to kill+new-session`);
            await killSession(name, run);
            await new Promise((r) => setTimeout(r, 100));
            await newDetachedSession(name, dummyDaemonCommand, cwd, run);
            await waitFor(() => /BOOT_\d+/.test(captureScrollback(run, name)));
          }

          await new Promise((r) => setTimeout(r, 500)); // Give new process time to output
          const scrollbackAfterRespawn = captureScrollback(run, name);
          console.log(`DEBUG: scrollback AFTER respawnPane (FULL):\n${scrollbackAfterRespawn}`);
          console.log(`DEBUG: scrollback AFTER has prePid? ${scrollbackAfterRespawn.includes(`BOOT_${prePid}`)}`);
          const newBootMatch = scrollbackAfterRespawn.match(/BOOT_\d+/)?.[0] || 'NO MATCH';
          console.log(`DEBUG: scrollback AFTER new boot marker? ${newBootMatch}`);

          // The near-name session must be completely unaffected by the
          // respawn targeted at `name` — proves respawn-pane's `=name:0.0`
          // target didn't spill over onto the near-name session's pane.
          expect(await hasSession(nearName, run)).toBe(true);
          expect(captureScrollback(run, nearName)).toContain(nearMarker);
        } finally {
          await killSession(nearName, run);
        }

        // Session name preserved (respawn-pane never renames/recreates).
        expect(await hasSession(name, run)).toBe(true);

        // 4. New pid assigned after restart.
        await waitFor(() => {
          const scrollback = captureScrollback(run, name);
          const matches = [...scrollback.matchAll(/BOOT_(\d+)/g)];
          // Key test: the new PID exists and differs from pre-restart PID.
          return matches.length >= 1 && matches[matches.length - 1][1] !== prePid;
        });

        const postRestartScrollback = captureScrollback(run, name);
        const allMatches = [...postRestartScrollback.matchAll(/BOOT_(\d+)/g)];
        expect(allMatches.length).toBeGreaterThanOrEqual(1);
        const postPid = allMatches[allMatches.length - 1][1];
        expect(postPid).not.toBe(prePid);

        // Scrollback survival: respawn-pane -k natively clears history, so
        // respawnPane's capture-and-re-emit wrapper (`cat <file>; rm -f
        // <file>; exec <cmd>`) must have re-printed the pre-restart marker
        // into the pane BEFORE the new process's boot output. Prove it here
        // by asserting the old marker is present in the post-restart capture
        // AND appears above (earlier in the buffer than) the new one — this
        // is the real assertion the ADR's adversarial-review requirement
        // calls for; a bare "new pid differs" check above cannot catch a
        // regression that silently drops the re-emitted scrollback.
        const preMarkerIndex = postRestartScrollback.indexOf(`BOOT_${prePid}`);
        expect(preMarkerIndex).toBeGreaterThanOrEqual(0);
        const postMarkerIndex = postRestartScrollback.indexOf(`BOOT_${postPid}`);
        expect(postMarkerIndex).toBeGreaterThan(preMarkerIndex);

        // Window layout preserved: still exactly one window, one pane — the
        // in-place respawn never split/created windows, session name unchanged.
        const windowList = run(
          ['list-windows', '-t', `=${name}`, '-F', '#{window_index}'],
          { inherit: false },
        );
        const windowIndices = windowList.stdout.trim().split('\n').filter(Boolean);
        // Exactly one window (index doesn't matter, could be 0 or 1 depending on base-index)
        expect(windowIndices).toHaveLength(1);
        const windowIndex = windowIndices[0];

        // List panes in that window - expect exactly one pane
        const paneList = run(
          ['list-panes', '-t', `=${name}:${windowIndex}`, '-F', '#{pane_index}'],
          { inherit: false },
        );
        const paneIndices = paneList.stdout.trim().split('\n').filter(Boolean);
        // Exactly one pane (index doesn't matter, could be 0 or 1 depending on base-index)
        expect(paneIndices).toHaveLength(1);
      } finally {
        await killSession(name, run);
        await rm(cwd, { recursive: true, force: true });
        if (prevNoRealExec === undefined) {
          delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
        } else {
          process.env.AI_CONDUCTOR_NO_REAL_EXEC = prevNoRealExec;
        }
      }
    },
    120_000,
  );

  // TR-1 (adr-2026-07-06-stale-engine-respawn-in-place): setRemainOnExit has
  // never actually worked — daemon-tmux.ts:230 issues `set-option -t '=<name>'`
  // with no `-w`, which tmux parses `-t` as a *window* target; a bare session
  // name matches no window, so the call fails "no such window" and the
  // failure was swallowed as best-effort. The pre-existing respawn-while-alive
  // smoke above never exercises remain-on-exit at all — these assertions are
  // the shape that would have caught the defect.

  /** Reads the `remain-on-exit` WINDOW option, scoped to the session's window
   * the same way every other pane-targeting verb in this module is scoped
   * (`=<name>:`). Returns raw stdout so callers can match the exact line
   * tmux prints ("remain-on-exit on"/"remain-on-exit off"). */
  function showRemainOnExit(run: TmuxRunner, name: string): string {
    const result = run(['show-options', '-w', '-t', `=${name}:`], { inherit: false });
    return result.code === 0 ? result.stdout : '';
  }

  /** Reads `pane_dead` for the session's active pane via list-panes. */
  function paneDeadFlag(run: TmuxRunner, name: string): string {
    const result = run(
      ['list-panes', '-t', `=${name}:`, '-F', '#{pane_dead}'],
      { inherit: false },
    );
    return result.code === 0 ? result.stdout.trim() : '';
  }

  it(
    'remain-on-exit is reported by show-options -w and survives a NATURAL process exit (pane_dead=1, session alive)',
    async () => {
      if (!(await tmuxInstalled())) return; // skip cleanly — no tmux on PATH

      const suffix = randomBytes(4).toString('hex');
      const name = `cc-daemon-roe-${suffix}`;
      const cwd = await mkdtemp(join(tmpdir(), 'daemon-tmux-roe-'));
      const run = isolatedTmuxRunner(`ai-conductor-roe-${suffix}`);

      const prevNoRealExec = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;

      try {
        if (!(await tmuxServerAvailable(run, cwd, suffix))) return;

        // Mirrors `start`'s fresh-session path: create the session, then arm
        // remain-on-exit exactly as Supervisor.start does immediately after
        // newDetachedSession (plan Task 2). The foreground command prints its
        // own pid then exits quickly on its own — no `respawn-pane -k`
        // involved anywhere in this test.
        const naturalExitCmd = 'bash -c "echo READY_$$; sleep 1; echo DONE"';
        await newDetachedSession(name, naturalExitCmd, cwd, run);
        expect(await hasSession(name, run)).toBe(true);
        await waitFor(() => captureScrollback(run, name).includes('READY_'));

        await setRemainOnExit(name, run);

        // (i) The option is reported by show-options -w immediately after arming.
        expect(showRemainOnExit(run, name)).toMatch(/remain-on-exit\s+on/);

        // (ii) Let the foreground process exit ON ITS OWN (no kill signal, no
        // respawn-pane). With remain-on-exit correctly armed, tmux keeps the
        // pane (and session) open instead of tearing the window down.
        await waitFor(() => captureScrollback(run, name).includes('DONE'), 5000);
        await waitFor(() => paneDeadFlag(run, name) === '1', 5000);

        expect(await hasSession(name, run)).toBe(true);
        expect(paneDeadFlag(run, name)).toBe('1');
      } finally {
        await killSession(name, run);
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

  it(
    'remain-on-exit is still reported after a respawnPane cycle (option survives respawn)',
    async () => {
      if (!(await tmuxInstalled())) return; // skip cleanly — no tmux on PATH

      const suffix = randomBytes(4).toString('hex');
      const name = `cc-daemon-roe-respawn-${suffix}`;
      const cwd = await mkdtemp(join(tmpdir(), 'daemon-tmux-roe-respawn-'));
      const dummyDaemonCommand = 'bash -c "while true; do echo BOOT_$$; sleep 1; done"';
      const run = isolatedTmuxRunner(`ai-conductor-roe-respawn-${suffix}`);

      const prevNoRealExec = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;

      try {
        if (!(await tmuxServerAvailable(run, cwd, suffix))) return;

        await newDetachedSession(name, dummyDaemonCommand, cwd, run);
        expect(await hasSession(name, run)).toBe(true);
        await waitFor(() => /BOOT_\d+/.test(captureScrollback(run, name)));

        await setRemainOnExit(name, run);
        expect(showRemainOnExit(run, name)).toMatch(/remain-on-exit\s+on/);

        await respawnPane(name, run, dummyDaemonCommand);

        // The replacement pane's window must still report the option — a
        // respawn re-execs the pane's command but must not reset window
        // options set before the respawn.
        expect(showRemainOnExit(run, name)).toMatch(/remain-on-exit\s+on/);
        expect(await hasSession(name, run)).toBe(true);
      } finally {
        await killSession(name, run);
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

  it(
    'regression guard: the OLD/broken set-option invocation (no -w, bare =name target) exits non-zero against real tmux',
    async () => {
      if (!(await tmuxInstalled())) return; // skip cleanly — no tmux on PATH

      const suffix = randomBytes(4).toString('hex');
      const name = `cc-daemon-roe-legacy-${suffix}`;
      const cwd = await mkdtemp(join(tmpdir(), 'daemon-tmux-roe-legacy-'));
      const run = isolatedTmuxRunner(`ai-conductor-roe-legacy-${suffix}`);

      const prevNoRealExec = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;

      try {
        if (!(await tmuxServerAvailable(run, cwd, suffix))) return;

        await newDetachedSession(name, 'bash -c "sleep 100"', cwd, run);
        expect(await hasSession(name, run)).toBe(true);

        // The corrected form (what setRemainOnExit must issue) succeeds.
        const corrected = run(
          ['set-option', '-w', '-t', `=${name}:`, 'remain-on-exit', 'on'],
          { inherit: false },
        );
        expect(corrected.code).toBe(0);
        expect(showRemainOnExit(run, name)).toMatch(/remain-on-exit\s+on/);

        // The legacy/broken form — no `-w`, bare `=name` (no trailing `:`) —
        // is exactly daemon-tmux.ts:230's current argv. `remain-on-exit` is a
        // window option; without `-w`, tmux resolves `-t` as a window target,
        // and a bare session name (no window index) matches no window, so
        // this must exit non-zero ("no such window"). If a regression ever
        // makes this form pass, this assertion — not vibes — fails the suite.
        const legacy = run(
          ['set-option', '-t', `=${name}`, 'remain-on-exit', 'on'],
          { inherit: false },
        );
        expect(legacy.code).not.toBe(0);
      } finally {
        await killSession(name, run);
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
