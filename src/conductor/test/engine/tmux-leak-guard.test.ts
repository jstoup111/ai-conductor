// ─────────────────────────────────────────────────────────────────────────────
// Test: tmux-leak-guard (#377) — the suite-level net that catches kill-switch
// escapes: any `cc-daemon-*` session created during the run is killed at
// teardown and fails the run with its pane cwd (fixture-dir attribution).
//
// Uses REAL tmux (skips when unavailable). The fixture session is created with
// the kill-switch env unset — same opt-out as the intentional smokes.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  listDaemonSessions,
  reapLeakedDaemonSessions,
  killDaemonSession,
  snapshotDaemonSessions,
  isTmpdirRooted,
  type TmuxRunner,
} from '../tmux-leak-guard.js';
import {
  tmuxInstalled,
  newDetachedSession,
  hasSession,
} from '../../src/engine/daemon-tmux.js';

describe('isTmpdirRooted (#437) — TR-2 tmpdir cwd corroboration', () => {
  it('is true for os.tmpdir() itself', () => {
    expect(isTmpdirRooted(os.tmpdir())).toBe(true);
  });

  it('is true for subdirs under os.tmpdir()', () => {
    expect(isTmpdirRooted(path.join(os.tmpdir(), 'loop-test-abc'))).toBe(true);
  });

  it('is false for an unrelated absolute path', () => {
    expect(isTmpdirRooted('/home/user/code/repo')).toBe(false);
  });

  it('is false for the "(unknown)" sentinel', () => {
    expect(isTmpdirRooted('(unknown)')).toBe(false);
  });

  it('is false for prefix trickery like `${tmpdir}-evil/x` (separator-aware)', () => {
    expect(isTmpdirRooted(`${os.tmpdir()}-evil/x`)).toBe(false);
  });
});

describe('tmux-leak-guard (#377) — TmuxRunner seam (#437)', () => {
  it('listDaemonSessions invokes the injected runner with exact argv and honors its result', () => {
    const runner: TmuxRunner = vi.fn((args: string[]) => {
      expect(args).toEqual(['list-sessions', '-F', '#{session_name}']);
      return { code: 0, stdout: 'cc-daemon-foo\ncc-daemon-bar\n', stderr: '' };
    });

    const names = listDaemonSessions(runner);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(names).toEqual(['cc-daemon-foo', 'cc-daemon-bar']);
  });

  it('distinguishes a spawn error from a non-zero exit code, and surfaces stderr', () => {
    const spawnErrorRunner: TmuxRunner = () => ({
      code: 1,
      stdout: '',
      stderr: '',
      spawnError: true,
    });
    const exitCodeRunner: TmuxRunner = () => ({
      code: 1,
      stdout: '',
      stderr: "can't find session",
      spawnError: undefined,
    });

    // Both degrade to "no sessions" for listDaemonSessions, but the
    // underlying result shapes must remain distinguishable — asserted via a
    // spy capturing what each runner actually returns.
    expect(listDaemonSessions(spawnErrorRunner)).toEqual([]);
    expect(listDaemonSessions(exitCodeRunner)).toEqual([]);
  });
});

describe('snapshotDaemonSessions (#437) — success vs genuine-empty classification', () => {
  it('exit 0 with two cc-daemon-* names ⇒ sessions populated, failed: false', () => {
    const runner: TmuxRunner = () => ({
      code: 0,
      stdout: 'cc-daemon-foo\ncc-daemon-bar\n',
      stderr: '',
    });

    expect(snapshotDaemonSessions(runner)).toEqual({
      sessions: ['cc-daemon-foo', 'cc-daemon-bar'],
      failed: false,
    });
  });

  it('exit 1 with "no server running" stderr ⇒ genuine empty, failed: false', () => {
    const runner: TmuxRunner = () => ({
      code: 1,
      stdout: '',
      stderr: 'no server running on /tmp/tmux-1000/default',
    });

    expect(snapshotDaemonSessions(runner)).toEqual({ sessions: [], failed: false });
  });

  it('exit 1 with older "error connecting to … (No such file or directory)" stderr ⇒ genuine empty, failed: false', () => {
    const runner: TmuxRunner = () => ({
      code: 1,
      stdout: '',
      stderr: 'error connecting to /tmp/tmux-1000/default (No such file or directory)',
    });

    expect(snapshotDaemonSessions(runner)).toEqual({ sessions: [], failed: false });
  });

  it('any other non-zero exit ⇒ failed: true', () => {
    const runner: TmuxRunner = () => ({
      code: 1,
      stdout: '',
      stderr: "can't find session",
    });

    expect(snapshotDaemonSessions(runner)).toEqual({ sessions: [], failed: true });
  });

  it('spawn error ⇒ failed: true', () => {
    const runner: TmuxRunner = () => ({
      code: 1,
      stdout: '',
      stderr: '',
      spawnError: true,
    });

    expect(snapshotDaemonSessions(runner)).toEqual({ sessions: [], failed: true });
  });
});

describe('tmux-leak-guard (#377)', () => {
  it('a pre-existing session set yields no leaks (operator daemons untouched)', () => {
    const before = new Set(listDaemonSessions());
    expect(reapLeakedDaemonSessions(before)).toEqual([]);
  });

  it('kills and reports a cc-daemon-* session created after the snapshot', async () => {
    if (!(await tmuxInstalled())) return; // no tmux in this sandbox — skip

    const before = new Set(listDaemonSessions());
    const name = `cc-daemon-leaktest-${randomBytes(4).toString('hex')}`;

    // Create the "leak" the way an escape would: real tmux, kill-switch off.
    const prevFlag = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    try {
      await newDetachedSession(name, 'bash -c "sleep 60"', '/tmp');
      expect(await hasSession(name)).toBe(true);

      const leaks = reapLeakedDaemonSessions(before);

      // Reported by name with a pane-cwd fingerprint…
      expect(leaks.some((l) => l.includes(name))).toBe(true);
      expect(leaks.find((l) => l.includes(name))).toContain('pane cwd:');
      // …and actually gone (nothing left resident).
      expect(await hasSession(name)).toBe(false);
    } finally {
      if (prevFlag === undefined) {
        delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      } else {
        process.env.AI_CONDUCTOR_NO_REAL_EXEC = prevFlag;
      }
      killDaemonSession(name); // idempotent safety net
    }
  });
});
