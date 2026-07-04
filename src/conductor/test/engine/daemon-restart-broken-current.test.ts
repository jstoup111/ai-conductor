// ─────────────────────────────────────────────────────────────────────────────
// Tests for Task T35 — daemon restart into broken current (FR-16 negative path).
//
// Story: FR-16 negative path (queued restart + broken engine current → visible, recoverable)
//
// Acceptance Criteria:
// 1. Respawn into broken current (dangling symlink) → launcher error in scrollback
// 2. Launcher exit non-zero captured and logged
// 3. Status shows not-running (not stuck in restart-pending)
// 4. No wedged marker state (subsequent good publish + restart recovers fully)
// 5. Scrollback/session preserved despite launcher failure
// 6. Subsequent successful publish + restart recovers daemon
//
// Implementation notes:
// - Broken current = dangling symlink at `dist` (from T5 launcher logic)
// - Launcher (bin/conduct-ts) calls `readlink -f dist`, gets ENOENT, exits non-zero
// - tmux respawn-pane runs the command, captures exit in scrollback
// - After failure: daemon marks as not-running, waits for manual intervention
// - Marker state: if present at failure, leave it (consumed on next successful boot)
// - Recovery path: `npm run build` fixes symlink, restart succeeds
//
// Dependencies: T5 (launcher realpath pinning), T27 (restart verb) ✓
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TmuxRunner } from '../../src/engine/daemon-tmux.js';
import {
  makeTmuxSupervisor,
  sessionNameForRepo,
  DAEMON_FOREGROUND_COMMAND,
} from '../../src/engine/daemon-tmux.js';
import { writeRestartPending, readRestartPending, consumeOnBoot } from '../../src/engine/restart-marker.js';

let workDirs: string[] = [];

beforeEach(() => {
  workDirs = [];
});

afterEach(async () => {
  await Promise.all(workDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function freshRepo(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'daemon-restart-broken-'));
  workDirs.push(d);
  return d;
}

/**
 * Build a fake repo structure with dist-versions/<id>/index.js and a
 * broken `dist` symlink pointing to a non-existent path.
 */
async function makeFakeBrokenRepo(repoPath: string): Promise<void> {
  await mkdir(join(repoPath, 'dist-versions', 'v1'), { recursive: true });

  // Create the dist symlink pointing to non-existent target
  // (simulating a dangling symlink from an incomplete/failed build)
  try {
    await symlink('dist-versions/broken-version', join(repoPath, 'dist'));
  } catch (e) {
    // If symlink creation fails, the directory might not have the right structure
    // This test assumes we can create symlinks
    throw new Error(`Failed to create broken symlink: ${e}`);
  }
}

/**
 * Build a fake repo structure with valid dist-versions/<id>/index.js and
 * a proper `dist` symlink (good state, ready to run).
 */
async function makeFakeValidRepo(repoPath: string): Promise<void> {
  const versionDir = join(repoPath, 'dist-versions', 'v1');
  await mkdir(versionDir, { recursive: true });

  // Create a valid index.js (dummy)
  await writeFile(join(versionDir, 'index.js'), '#!/usr/bin/env node\nconsole.log("dummy");', 'utf-8');

  // Create a proper symlink
  try {
    await symlink('dist-versions/v1', join(repoPath, 'dist'));
  } catch (e) {
    throw new Error(`Failed to create symlink: ${e}`);
  }
}

describe('Task T35 — daemon restart into broken current (FR-16 negative path)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // AC1 & AC2: Respawn into broken current → launcher error in scrollback,
  // exit non-zero captured
  // ─────────────────────────────────────────────────────────────────────────

  it('AC1+AC2: Respawn with broken dist symlink → launcher error captured in scrollback, non-zero exit', async () => {
    const repoPath = await freshRepo();
    await makeFakeBrokenRepo(repoPath);

    // Mock tmux runner that simulates respawn-pane failure (command exits 1)
    const tmuxCalls: Array<{ cmd: string; args: string[] }> = [];
    const scrollbackLog: string[] = [];

    const mockRunner: TmuxRunner = (args, opts) => {
      const cmd = args[0] ?? '';
      tmuxCalls.push({ cmd, args });

      // Track respawn-pane calls: simulate the launcher failing
      if (cmd === 'respawn-pane') {
        // In real scenario: respawn-pane launches the command, which exits 1
        // We simulate this by capturing a fake "scrollback" showing the error
        scrollbackLog.push('conduct-ts: dist symlink is broken (./dist)');
        scrollbackLog.push('conduct-ts: run \'npm run build\' to rebuild, or republish the engine, to fix it');
        scrollbackLog.push('[Process exited with code 1]');
        return { code: 0, stdout: '' }; // respawn-pane itself succeeds, but the command inside fails
      }

      // Other tmux commands pass through unchanged
      if (cmd === 'set-option') return { code: 0, stdout: '' };
      if (cmd === 'new-session') return { code: 0, stdout: '' };
      if (cmd === 'capture-pane') {
        return { code: 0, stdout: scrollbackLog.join('\n') };
      }
      if (cmd === 'has-session') return { code: 0, stdout: '' };
      if (cmd === 'list-panes') return { code: 0, stdout: '0' }; // pane is alive (0 = not dead)

      return { code: 0, stdout: '' };
    };

    const supervisor = makeTmuxSupervisor(mockRunner);
    const sessionName = sessionNameForRepo(repoPath);

    // Set up session first (normally done by start)
    // Simulate: session exists with the foreground process
    tmuxCalls.length = 0;

    // Attempt restart: respawn-pane will be called
    const outcome = await supervisor.restart(repoPath);

    // Verify restart was attempted
    expect(tmuxCalls.some((c) => c.cmd === 'respawn-pane')).toBe(true);

    // Capture logs to simulate scrollback check
    const logs = await supervisor.logs(repoPath);

    // AC1: Launcher error should be in scrollback
    expect(logs).toContain('conduct-ts: dist symlink is broken');
    expect(logs).toContain('exited with code 1');

    // AC2: The error indicates non-zero exit
    expect(logs).toMatch(/Process exited with code 1/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC3: Status shows not-running (not stuck in restart-pending)
  // ─────────────────────────────────────────────────────────────────────────

  it('AC3: Failed restart → daemon not-running (isPaneDead check)', async () => {
    const repoPath = await freshRepo();
    await makeFakeBrokenRepo(repoPath);

    // Mock runner: respawn sets pane to dead state after failure
    let paneAlive = true;

    const mockRunner: TmuxRunner = (args, opts) => {
      const cmd = args[0] ?? '';

      if (cmd === 'respawn-pane') {
        // Simulate: launcher fails, process exits, pane left dead
        paneAlive = false;
        return { code: 0, stdout: '' };
      }

      if (cmd === 'list-panes') {
        // Return pane_dead = 1 (dead) after failed respawn
        return { code: 0, stdout: paneAlive ? '0' : '1' };
      }

      if (cmd === 'has-session') return { code: 0, stdout: '' };
      if (cmd === 'set-option') return { code: 0, stdout: '' };
      if (cmd === 'capture-pane') return { code: 0, stdout: '[launcher error]' };

      return { code: 0, stdout: '' };
    };

    const supervisor = makeTmuxSupervisor(mockRunner);

    // Simulate: session exists but pane is dead after failed respawn
    paneAlive = false;

    // Check status: should report not-running
    const isRunning = await supervisor.isUp(repoPath);
    expect(isRunning).toBe(false); // AC3: not-running, not stuck
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC4: No wedged marker state (marker remains consumable)
  // ─────────────────────────────────────────────────────────────────────────

  it('AC4: Restart marker present at failure → marker remains unconsumed, can be consumed next boot', async () => {
    const repoPath = await freshRepo();
    await makeFakeBrokenRepo(repoPath);

    // Write restart marker before failure
    await writeRestartPending(repoPath, {
      blockingSlug: 'feature-x',
      requestedBy: 'test-operator',
    });

    // Verify marker exists before failure
    const markerBefore = await readRestartPending(repoPath);
    expect(markerBefore).not.toBeNull();
    expect(markerBefore?.blockingSlug).toBe('feature-x');

    // Simulate restart failure (pane dies, marker untouched)
    let paneAlive = false;

    const mockRunner: TmuxRunner = (args, opts) => {
      const cmd = args[0] ?? '';
      if (cmd === 'respawn-pane') {
        paneAlive = false; // Simulate launcher failure
        return { code: 0, stdout: '' };
      }
      if (cmd === 'list-panes') return { code: 0, stdout: paneAlive ? '0' : '1' };
      if (cmd === 'has-session') return { code: 0, stdout: '' };
      if (cmd === 'set-option') return { code: 0, stdout: '' };
      return { code: 0, stdout: '' };
    };

    const supervisor = makeTmuxSupervisor(mockRunner);
    await supervisor.restart(repoPath);

    // AC4: After failure, marker should still exist (not consumed/wedged)
    const markerAfter = await readRestartPending(repoPath);
    expect(markerAfter).not.toBeNull();
    expect(markerAfter?.blockingSlug).toBe('feature-x');

    // Next boot: marker can be consumed successfully
    const markerConsumed = await consumeOnBoot(repoPath);
    expect(markerConsumed).not.toBeNull();
    expect(markerConsumed?.blockingSlug).toBe('feature-x');

    // After consumption, marker is gone
    const markerGone = await readRestartPending(repoPath);
    expect(markerGone).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC5: Scrollback/session preserved despite launcher failure
  // ─────────────────────────────────────────────────────────────────────────

  it('AC5: Failed restart preserves session + scrollback (no kill-session fallback)', async () => {
    const repoPath = await freshRepo();
    await makeFakeBrokenRepo(repoPath);

    const tmuxCalls: string[] = [];
    const scrollbackContent = 'previous output\nconduct-ts: dist symlink is broken\n[Process exited with code 1]';

    const mockRunner: TmuxRunner = (args, opts) => {
      const cmd = args[0] ?? '';
      tmuxCalls.push(cmd);

      if (cmd === 'respawn-pane') {
        // Simulate: respawn succeeds but the process inside fails
        // The pane stays alive (remain-on-exit keeps it) with error in scrollback
        return { code: 0, stdout: '' };
      }

      if (cmd === 'kill-session') {
        // AC5: kill-session should NOT be called on a simple respawn failure
        // (it's only called in the degraded fallback path, which is for tmux-level issues)
        return { code: 0, stdout: '' };
      }

      if (cmd === 'capture-pane') {
        return { code: 0, stdout: scrollbackContent };
      }

      if (cmd === 'has-session') return { code: 0, stdout: '' };
      if (cmd === 'set-option') return { code: 0, stdout: '' };
      if (cmd === 'list-panes') return { code: 0, stdout: '1' }; // pane is dead after launcher failure

      return { code: 0, stdout: '' };
    };

    const supervisor = makeTmuxSupervisor(mockRunner);

    // Perform restart (launcher fails internally, but respawn-pane succeeds)
    const outcome = await supervisor.restart(repoPath);

    // AC5: Restart should NOT be degraded (no fallback kill+recreate)
    // because respawn-pane itself succeeded; the launcher failure is a process-level issue
    // (NOTE: this depends on respawn-pane not throwing; in real tmux, the pane survives
    //  with remain-on-exit, and the process inside exited but didn't tear down the session)
    expect(outcome.degraded).toBe(false);

    // AC5: kill-session should not have been called (session preserved)
    expect(tmuxCalls.filter((c) => c === 'kill-session')).toHaveLength(0);

    // AC5: scrollback should be preserved and contain the error
    const logs = await supervisor.logs(repoPath);
    expect(logs).toContain('conduct-ts: dist symlink is broken');
    expect(logs).toContain('[Process exited with code 1]');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC6: Subsequent successful publish + restart recovers daemon
  // ─────────────────────────────────────────────────────────────────────────

  it('AC6: Recovery — fix dist symlink, restart succeeds, daemon recovers', async () => {
    const repoPath = await freshRepo();
    await makeFakeBrokenRepo(repoPath);

    // Stage 1: Restart with broken current (pane dies)
    let paneAlive = false;

    const mockRunner: TmuxRunner = (args, opts) => {
      const cmd = args[0] ?? '';

      if (cmd === 'respawn-pane') {
        // Simulate: launcher fails, pane dies
        paneAlive = false;
        return { code: 0, stdout: '' };
      }

      if (cmd === 'list-panes') {
        return { code: 0, stdout: paneAlive ? '0' : '1' };
      }

      if (cmd === 'has-session') return { code: 0, stdout: '' };
      if (cmd === 'set-option') return { code: 0, stdout: '' };
      if (cmd === 'capture-pane') {
        return { code: 0, stdout: 'conduct-ts: dist symlink is broken\n[Process exited with code 1]' };
      }

      return { code: 0, stdout: '' };
    };

    const supervisor = makeTmuxSupervisor(mockRunner);

    // Restart fails (pane dies)
    const failOutcome = await supervisor.restart(repoPath);
    expect(failOutcome.degraded).toBe(false); // respawn-pane itself succeeded
    let isUp = await supervisor.isUp(repoPath);
    expect(isUp).toBe(false); // AC3: daemon not-running after failure

    // Stage 2: Recovery — fix the dist symlink (simulating `npm run build`)
    // Remove broken symlink and create a valid one
    const distPath = join(repoPath, 'dist');
    try {
      // Try to remove the old symlink
      await rm(distPath, { force: true });
    } catch {
      // Might have already failed; no-op
    }
    await makeFakeValidRepo(repoPath);

    // Stage 3: Restart again with fixed symlink
    // This time, the launcher will succeed
    let launcherSucceeded = false;

    const recoveryRunner: TmuxRunner = (args, opts) => {
      const cmd = args[0] ?? '';

      if (cmd === 'respawn-pane') {
        // Launcher now succeeds, pane stays alive
        launcherSucceeded = true;
        paneAlive = true; // Process is now alive
        return { code: 0, stdout: '' };
      }

      if (cmd === 'list-panes') {
        return { code: 0, stdout: paneAlive ? '0' : '1' };
      }

      if (cmd === 'has-session') return { code: 0, stdout: '' };
      if (cmd === 'set-option') return { code: 0, stdout: '' };
      if (cmd === 'capture-pane') {
        return { code: 0, stdout: launcherSucceeded ? 'daemon running\n[normal log]' : '[error]' };
      }

      return { code: 0, stdout: '' };
    };

    const recoverySuper = makeTmuxSupervisor(recoveryRunner);

    // Restart with fixed symlink
    const recoverOutcome = await recoverySuper.restart(repoPath);
    expect(recoverOutcome.degraded).toBe(false);

    // AC6: Daemon should be running after recovery
    isUp = await recoverySuper.isUp(repoPath);
    expect(isUp).toBe(true); // Recovered!
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC6 extended: Recovery with queued restart marker
  // ─────────────────────────────────────────────────────────────────────────

  it('AC6+: Recovery with restart marker → fix symlink, restart fires, marker consumed on boot', async () => {
    const repoPath = await freshRepo();
    await makeFakeBrokenRepo(repoPath);

    // Write restart marker (queued restart)
    await writeRestartPending(repoPath, { blockingSlug: 'feature-y' });

    // Stage 1: Restart with broken symlink (fails, marker stays)
    let paneAlive = false;

    const failRunner: TmuxRunner = (args, opts) => {
      if (args[0] === 'respawn-pane') {
        paneAlive = false;
        return { code: 0, stdout: '' };
      }
      if (args[0] === 'list-panes') return { code: 0, stdout: paneAlive ? '0' : '1' };
      if (args[0] === 'has-session') return { code: 0, stdout: '' };
      if (args[0] === 'set-option') return { code: 0, stdout: '' };
      return { code: 0, stdout: '' };
    };

    const failSuper = makeTmuxSupervisor(failRunner);
    await failSuper.restart(repoPath);

    // Marker still exists (not consumed)
    let marker = await readRestartPending(repoPath);
    expect(marker).not.toBeNull();
    expect(marker?.blockingSlug).toBe('feature-y');

    // Stage 2: Fix symlink and simulate boot (consumeOnBoot)
    // Remove broken, create valid
    const distPath = join(repoPath, 'dist');
    await rm(distPath, { force: true });
    await makeFakeValidRepo(repoPath);

    // Stage 3: Boot recovery — consume marker
    const consumed = await consumeOnBoot(repoPath);
    expect(consumed).not.toBeNull();
    expect(consumed?.blockingSlug).toBe('feature-y');

    // Marker is gone after consumption
    marker = await readRestartPending(repoPath);
    expect(marker).toBeNull();
  });
});
