import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
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
function captureScrollback(name: string): string {
  const result = defaultTmuxRunner(
    ['capture-pane', '-p', '-S', '-', '-t', `=${name}:`],
    { inherit: false },
  );
  return result.code === 0 ? result.stdout : '';
}

/** Pid of the daemon's pane process (window 0 / pane 0) — the pid daemon-tmux.ts
 * itself never needs to read, but which this smoke test needs to prove changes
 * across a respawn. */
function panePid(name: string): string {
  const result = defaultTmuxRunner(
    ['list-panes', '-t', `=${name}:0.0`, '-F', '#{pane_pid}'],
    { inherit: false },
  );
  return result.stdout.trim();
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

      // Dummy "daemon" command: prints a boot marker containing its own pid
      // ($$), then idles. Because tmux respawn-pane re-launches the pane's
      // ORIGINAL command in place, a real restart re-runs this exact script —
      // giving us a fresh BOOT_<newpid> marker appended after the first,
      // while the pane's scrollback retains the original BOOT_<oldpid> line.
      const dummyDaemonCommand =
        'bash -c \'echo "BOOT_$$"; while true; do sleep 1; done\'';

      try {
        // 1. Real session + dummy daemon command → capture scrollback.
        await newDetachedSession(name, dummyDaemonCommand, cwd);
        expect(await hasSession(name)).toBe(true);

        await waitFor(() => /BOOT_\d+/.test(captureScrollback(name)));
        const preRestartScrollback = captureScrollback(name);
        const preMatch = preRestartScrollback.match(/BOOT_(\d+)/);
        expect(preMatch).not.toBeNull();
        const prePid = preMatch![1];
        const prePidFromTmux = panePid(name);
        expect(prePid).toBe(prePidFromTmux);

        // 5. Exact-`=` targeting verified against a near-name session, BEFORE
        // the restart mutates anything — proves respawn-pane/capture-pane
        // below can't accidentally address the near-name session instead.
        const nearMarker = `NEAR_${suffix}`;
        await newDetachedSession(nearName, `bash -c 'echo ${nearMarker}; while true; do sleep 1; done'`, cwd);
        try {
          expect(await hasSession(nearName)).toBe(true);
          await waitFor(() => captureScrollback(nearName).includes(nearMarker));

          // capture-pane on the short name must see ONLY its own boot marker,
          // never the near-name session's output (would happen if the target
          // were unanchored, e.g. a bare prefix match instead of `=name:`).
          const shortNameCapture = captureScrollback(name);
          expect(shortNameCapture).toContain(`BOOT_${prePid}`);
          expect(shortNameCapture).not.toContain(nearMarker);

          // capture-pane on the near-name session must see only its own
          // marker, never the short session's.
          const nearNameCapture = captureScrollback(nearName);
          expect(nearNameCapture).toContain(nearMarker);
          expect(nearNameCapture).not.toContain(`BOOT_${prePid}`);

          // 2. Real respawn-in-place restart → same session name preserved.
          await setRemainOnExit(name);
          await respawnPane(name);

          // The near-name session must be completely unaffected by the
          // respawn targeted at `name` — proves respawn-pane's `=name:0.0`
          // target didn't spill over onto the near-name session's pane.
          expect(await hasSession(nearName)).toBe(true);
          expect(captureScrollback(nearName)).toContain(nearMarker);
        } finally {
          await killSession(nearName);
        }

        // Session name preserved (respawn-pane never renames/recreates).
        expect(await hasSession(name)).toBe(true);

        // 4. New pid assigned after restart.
        await waitFor(() => {
          const scrollback = captureScrollback(name);
          const matches = [...scrollback.matchAll(/BOOT_(\d+)/g)];
          return matches.length >= 2 && matches[matches.length - 1][1] !== prePid;
        });

        const postRestartScrollback = captureScrollback(name);
        const allMatches = [...postRestartScrollback.matchAll(/BOOT_(\d+)/g)];
        expect(allMatches.length).toBeGreaterThanOrEqual(2);
        const postPid = allMatches[allMatches.length - 1][1];
        expect(postPid).not.toBe(prePid);
        expect(postPid).toBe(panePid(name));

        // 3. Pre-restart scrollback still present ABOVE the new boot output —
        // same window/layout (single window, pane 0), scrollback not wiped.
        const firstBootIdx = postRestartScrollback.indexOf(`BOOT_${prePid}`);
        const lastBootIdx = postRestartScrollback.lastIndexOf(`BOOT_${postPid}`);
        expect(firstBootIdx).toBeGreaterThanOrEqual(0);
        expect(lastBootIdx).toBeGreaterThan(firstBootIdx);

        // Same window layout: still exactly one window, one pane (0.0) — the
        // in-place respawn never split/created windows.
        const windowList = defaultTmuxRunner(
          ['list-windows', '-t', `=${name}`, '-F', '#{window_index}'],
          { inherit: false },
        );
        expect(windowList.stdout.trim().split('\n').filter(Boolean)).toEqual(['0']);
        const paneList = defaultTmuxRunner(
          ['list-panes', '-t', `=${name}:0`, '-F', '#{pane_index}'],
          { inherit: false },
        );
        expect(paneList.stdout.trim().split('\n').filter(Boolean)).toEqual(['0']);
      } finally {
        await killSession(name);
        await rm(cwd, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
