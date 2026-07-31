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
  } finally {
    if (previous === undefined) delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    else process.env.AI_CONDUCTOR_NO_REAL_EXEC = previous;
    await killDaemonSession(name, runner);
  }
}

async function isolatedTmuxRunner(): Promise<TmuxRunner | undefined> {
  if (!(await tmuxInstalled())) return undefined;

  const socket = `leaktest-${randomBytes(8).toString('hex')}`;
  const runner: TmuxRunner = (args) => realTmuxRunner(['-L', socket, ...args]);
  return runner(['start-server']).code === 0 ? runner : undefined;
}

describe('smoke/tmux-leak-guard — real tmux', () => {
  it('sweeps a tmpdir-rooted daemon session that predates the snapshot', async () => {
    const runner = await isolatedTmuxRunner();
    if (!runner || !(await paneCwdSticky(runner))) return;

    const name = `cc-daemon-swtest-${randomBytes(4).toString('hex')}`;
    const previous = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    try {
      await newDetachedSession(name, 'bash -c "sleep 60"', os.tmpdir(), runner);
      expect(await hasSession(name, runner)).toBe(true);
      expect(sweepStaleDaemonSessions(runner).killed.some((line) => line.includes(name))).toBe(true);
      expect(await hasSession(name, runner)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      else process.env.AI_CONDUCTOR_NO_REAL_EXEC = previous;
      await killDaemonSession(name, runner);
    }
  });

  it('reaps a newly-created session on an isolated tmux server', async () => {
    const runner = await isolatedTmuxRunner();
    if (!runner) return;
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
