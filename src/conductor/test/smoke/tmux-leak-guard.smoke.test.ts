import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import {
  isTmpdirRooted,
  killDaemonSession,
  reapLeakedDaemonSessions,
  realTmuxRunner,
  sessionPaneCwd,
  snapshotDaemonSessions,
  sweepStaleDaemonSessions,
  type TmuxRunner,
} from '../tmux-leak-guard.js';
import { hasSession, newDetachedSession, tmuxInstalled } from '../../src/engine/daemon-tmux.js';

async function paneCwdSticky(runner?: TmuxRunner): Promise<boolean> {
  const name = `cc-daemon-cwdprobe-${randomBytes(4).toString('hex')}`;
  const previous = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
  delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
  try {
    await newDetachedSession(name, 'bash -c "sleep 5"', os.tmpdir(), runner);
    return isTmpdirRooted(sessionPaneCwd(name, runner));
  } catch {
    return false;
  } finally {
    if (previous === undefined) delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    else process.env.AI_CONDUCTOR_NO_REAL_EXEC = previous;
    await killDaemonSession(name, runner);
  }
}

describe('smoke/tmux-leak-guard — real tmux', () => {
  it('sweeps a tmpdir-rooted daemon session that predates the snapshot', async () => {
    if (!(await tmuxInstalled()) || !(await paneCwdSticky())) return;

    const name = `cc-daemon-swtest-${randomBytes(4).toString('hex')}`;
    const previous = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    try {
      await newDetachedSession(name, 'bash -c "sleep 60"', os.tmpdir());
      expect(await hasSession(name)).toBe(true);
      expect(sweepStaleDaemonSessions().killed.some((line) => line.includes(name))).toBe(true);
      expect(await hasSession(name)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      else process.env.AI_CONDUCTOR_NO_REAL_EXEC = previous;
      await killDaemonSession(name);
    }
  });

  it('reaps a newly-created session on an isolated tmux server', async () => {
    if (!(await tmuxInstalled())) return;

    const socket = `leaktest-${randomBytes(8).toString('hex')}`;
    const runner: TmuxRunner = (args) => realTmuxRunner(['-L', socket, ...args]);
    if (!(await paneCwdSticky(runner))) return;

    const before = snapshotDaemonSessions(runner);
    const name = `cc-daemon-leaktest-${randomBytes(4).toString('hex')}`;
    const previous = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    try {
      await newDetachedSession(name, 'bash -c "sleep 60"', os.tmpdir(), runner);
      expect(await hasSession(name, runner)).toBe(true);
      const { killed, indeterminate } = reapLeakedDaemonSessions(before, runner);
      expect(killed.some((line) => line.includes(name))).toBe(true);
      expect(indeterminate).toEqual([]);
      expect(await hasSession(name, runner)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      else process.env.AI_CONDUCTOR_NO_REAL_EXEC = previous;
      await killDaemonSession(name, runner);
    }
  });
});
