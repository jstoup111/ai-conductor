import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  hasSession,
  newDetachedSession,
  tmuxInstalled,
} from '../../src/engine/daemon-tmux.js';
import {
  isTmpdirRooted,
  killDaemonSession,
  reapLeakedDaemonSessions,
  sessionPaneCwd,
  snapshotDaemonSessions,
  sweepStaleDaemonSessions,
} from '../tmux-leak-guard.js';

// Capability probe (#437 follow-up): some hosts rewrite a freshly-spawned
// pane's cwd away from the -c start path (e.g. to $HOME) shortly after
// spawn, so `isTmpdirRooted(sessionPaneCwd(...))` is never true even though
// the session was created with `-c os.tmpdir()`. On such hosts the real-tmux
// kill-authorization tests below can never pass — that's not a guard bug
// (the guard's fail-closed refusal per #437's two-signal contract is
// correct), it's an environment capability gap. Skip rather than fail.
async function paneCwdSticky(): Promise<boolean> {
  const name = `cc-daemon-cwdprobe-${randomBytes(4).toString('hex')}`;
  const prevFlag = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
  delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
  try {
    await newDetachedSession(name, 'bash -c "sleep 5"', os.tmpdir());
    const cwd = sessionPaneCwd(name);
    return isTmpdirRooted(cwd);
  } finally {
    if (prevFlag === undefined) {
      delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    } else {
      process.env.AI_CONDUCTOR_NO_REAL_EXEC = prevFlag;
    }
    killDaemonSession(name);
  }
}

describe('tmux leak guard — real tmux smoke', () => {
  it('sweeps a tmpdir-rooted session without baseline involvement', async () => {
    if (!(await tmuxInstalled())) return;
    if (!(await paneCwdSticky())) return;

    const name = `cc-daemon-swtest-${randomBytes(4).toString('hex')}`;
    const prevFlag = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    try {
      await newDetachedSession(name, 'bash -c "sleep 60"', os.tmpdir());
      expect(await hasSession(name)).toBe(true);

      const { killed } = sweepStaleDaemonSessions();

      expect(killed.some((line) => line.includes(name))).toBe(true);
      expect(await hasSession(name)).toBe(false);
    } finally {
      if (prevFlag === undefined) {
        delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      } else {
        process.env.AI_CONDUCTOR_NO_REAL_EXEC = prevFlag;
      }
      killDaemonSession(name);
    }
  });

  it('kills and reports a session created after the snapshot', async () => {
    if (!(await tmuxInstalled())) return;
    if (!(await paneCwdSticky())) return;

    const before = snapshotDaemonSessions();
    const name = `cc-daemon-leaktest-${randomBytes(4).toString('hex')}`;
    const prevFlag = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    try {
      await newDetachedSession(name, 'bash -c "sleep 60"', os.tmpdir());
      expect(await hasSession(name)).toBe(true);

      const { killed, indeterminate } = reapLeakedDaemonSessions(before);

      expect(killed.some((line) => line.includes(name))).toBe(true);
      expect(killed.find((line) => line.includes(name))).toContain('pane cwd:');
      expect(indeterminate).toEqual([]);
      expect(await hasSession(name)).toBe(false);
    } finally {
      if (prevFlag === undefined) {
        delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      } else {
        process.env.AI_CONDUCTOR_NO_REAL_EXEC = prevFlag;
      }
      killDaemonSession(name);
    }
  });
});
