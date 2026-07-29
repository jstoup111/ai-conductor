import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  defaultTmuxRunner,
  hasSession,
  killSession,
  newDetachedSession,
  tmuxInstalled,
  type TmuxRunner as EngineTmuxRunner,
} from '../../src/engine/daemon-tmux.js';
import {
  isTmpdirRooted,
  reapLeakedDaemonSessions,
  sessionPaneCwd,
  snapshotDaemonSessions,
  sweepStaleDaemonSessions,
  type TmuxRunner as LeakGuardTmuxRunner,
} from '../tmux-leak-guard.js';

// Real-process smoke coverage uses a private tmux server. The default tmux
// server is per-user global, so an ordinary parallel suite can otherwise reap
// this fixture between hasSession() and the leak guard's own list operation.
const socketName = `cc-leak-smoke-${process.pid}-${randomBytes(4).toString('hex')}`;
const engineRunner: EngineTmuxRunner = (args, opts) =>
  defaultTmuxRunner(['-L', socketName, ...args], opts);
const leakGuardRunner: LeakGuardTmuxRunner = (args) =>
  defaultTmuxRunner(['-L', socketName, ...args], { inherit: false });

async function paneCwdSticky(): Promise<boolean> {
  const name = `cc-daemon-cwdprobe-${randomBytes(4).toString('hex')}`;
  try {
    await newDetachedSession(name, 'bash -c "sleep 5"', os.tmpdir(), engineRunner);
    return isTmpdirRooted(sessionPaneCwd(name, leakGuardRunner));
  } catch {
    return false;
  } finally {
    await killSession(name, engineRunner);
  }
}

describe('tmux-leak-guard — real tmux smoke (#377, #437)', () => {
  it('sweeps and reports pre-existing tmpdir-rooted debris without a baseline', async () => {
    if (!(await tmuxInstalled())) return;
    if (!(await paneCwdSticky())) return;

    const name = `cc-daemon-swtest-${randomBytes(4).toString('hex')}`;
    try {
      await newDetachedSession(name, 'bash -c "sleep 60"', os.tmpdir(), engineRunner);
      expect(await hasSession(name, engineRunner)).toBe(true);

      const { killed } = sweepStaleDaemonSessions(leakGuardRunner);

      expect(killed.some((line) => line.includes(name))).toBe(true);
      expect(await hasSession(name, engineRunner)).toBe(false);
    } finally {
      await killSession(name, engineRunner);
    }
  });

  it('reaps and reports a tmpdir-rooted session created after the snapshot', async () => {
    if (!(await tmuxInstalled())) return;
    if (!(await paneCwdSticky())) return;

    const before = snapshotDaemonSessions(leakGuardRunner);
    const name = `cc-daemon-leaktest-${randomBytes(4).toString('hex')}`;
    try {
      await newDetachedSession(name, 'bash -c "sleep 60"', os.tmpdir(), engineRunner);
      expect(await hasSession(name, engineRunner)).toBe(true);

      const { killed, indeterminate } = reapLeakedDaemonSessions(before, leakGuardRunner);

      expect(killed.some((line) => line.includes(name))).toBe(true);
      expect(killed.find((line) => line.includes(name))).toContain('pane cwd:');
      expect(indeterminate).toEqual([]);
      expect(await hasSession(name, engineRunner)).toBe(false);
    } finally {
      await killSession(name, engineRunner);
    }
  });
});
