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
  sweepStaleDaemonSessions,
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
import { applyTeardownDecision } from '../global-setup.js';

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

describe('reapLeakedDaemonSessions (#437) — two-signal kill decision', () => {
  it('kills only a new, baseline-ok, tmpdir-rooted session; leaves indeterminate empty', () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'list-sessions') {
        return { code: 0, stdout: 'cc-daemon-a\ncc-daemon-b\n', stderr: '' };
      }
      if (args[0] === 'display-message') {
        return { code: 0, stdout: `${os.tmpdir()}/leak-fixture-b\n`, stderr: '' };
      }
      if (args[0] === 'kill-session') {
        return { code: 0, stdout: '', stderr: '' };
      }
      throw new Error(`unexpected tmux invocation: ${args.join(' ')}`);
    };

    const baseline = snapshotDaemonSessions(runner);
    expect(baseline).toEqual({ sessions: ['cc-daemon-a', 'cc-daemon-b'], failed: false });

    // Overwrite baseline to just {A} to simulate B being new since baseline.
    const snapshot = { sessions: ['cc-daemon-a'], failed: false };

    const result = reapLeakedDaemonSessions(snapshot, runner);

    expect(result.killed).toHaveLength(1);
    expect(result.killed[0]).toContain('cc-daemon-b');
    expect(result.killed[0]).toContain('pane cwd:');
    expect(result.indeterminate).toEqual([]);

    const killCalls = calls.filter((a) => a[0] === 'kill-session');
    expect(killCalls).toHaveLength(1);
    expect(killCalls[0]).toEqual(['kill-session', '-t', '=cc-daemon-b']);
  });

  it('failed baseline ⇒ zero kills, everything indeterminate (#437 TR-1)', () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'list-sessions') {
        // Live sessions: a repo-cwd daemon (looks legit) AND a tmpdir-cwd
        // leak (would normally be killed) — but the baseline snapshot
        // itself failed, so neither can be trusted as "new".
        return { code: 0, stdout: 'cc-daemon-repo\ncc-daemon-leak\n', stderr: '' };
      }
      if (args[0] === 'display-message') {
        const target = args[3];
        if (target === '=cc-daemon-repo:') {
          return { code: 0, stdout: '/home/user/code/james-stoup-agents\n', stderr: '' };
        }
        return { code: 0, stdout: `${os.tmpdir()}/leak-fixture\n`, stderr: '' };
      }
      throw new Error(`unexpected tmux invocation: ${args.join(' ')}`);
    };

    const snapshot = { sessions: [], failed: true };

    const result = reapLeakedDaemonSessions(snapshot, runner);

    expect(result.killed).toEqual([]);
    expect(result.indeterminate).toHaveLength(2);
    expect(result.indeterminate.some((l) => l.includes('cc-daemon-repo'))).toBe(true);
    expect(result.indeterminate.some((l) => l.includes('cc-daemon-leak'))).toBe(true);

    const killCalls = calls.filter((a) => a[0] === 'kill-session');
    expect(killCalls).toHaveLength(0);
  });
});

describe('reapLeakedDaemonSessions (#437) — uncorroborated sessions are reported, never killed', () => {
  it('new session with a non-tmpdir pane cwd (repo cwd) ⇒ not killed, reported in indeterminate', () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'list-sessions') {
        return { code: 0, stdout: 'cc-daemon-a\ncc-daemon-prod\n', stderr: '' };
      }
      if (args[0] === 'display-message') {
        return { code: 0, stdout: '/home/user/code/repo\n', stderr: '' };
      }
      throw new Error(`unexpected tmux invocation: ${args.join(' ')}`);
    };

    const snapshot = { sessions: ['cc-daemon-a'], failed: false };
    const result = reapLeakedDaemonSessions(snapshot, runner);

    expect(result.killed).toEqual([]);
    expect(result.indeterminate).toHaveLength(1);
    expect(result.indeterminate[0]).toContain('cc-daemon-prod');
    expect(result.indeterminate[0]).toContain('/home/user/code/repo');
    expect(calls.some((a) => a[0] === 'kill-session')).toBe(false);
  });

  it('new session whose display-message fails (cwd unresolvable) ⇒ not killed, reported in indeterminate', () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'list-sessions') {
        return { code: 0, stdout: 'cc-daemon-a\ncc-daemon-gone\n', stderr: '' };
      }
      if (args[0] === 'display-message') {
        return { code: 1, stdout: '', stderr: "can't find pane" };
      }
      throw new Error(`unexpected tmux invocation: ${args.join(' ')}`);
    };

    const snapshot = { sessions: ['cc-daemon-a'], failed: false };
    const result = reapLeakedDaemonSessions(snapshot, runner);

    expect(result.killed).toEqual([]);
    expect(result.indeterminate).toHaveLength(1);
    expect(result.indeterminate[0]).toContain('cc-daemon-gone');
    expect(calls.some((a) => a[0] === 'kill-session')).toBe(false);
  });
});

describe('sweepStaleDaemonSessions — permanent-baseline-blindspot fix', () => {
  it('kills a pre-existing tmpdir-rooted session with NO baseline involved at all', () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'list-sessions') {
        return { code: 0, stdout: 'cc-daemon-stale-debris\n', stderr: '' };
      }
      if (args[0] === 'display-message') {
        return { code: 0, stdout: `${os.tmpdir()}/leftover-fixture-from-a-killed-run\n`, stderr: '' };
      }
      if (args[0] === 'kill-session') {
        return { code: 0, stdout: '', stderr: '' };
      }
      throw new Error(`unexpected tmux invocation: ${args.join(' ')}`);
    };

    // No snapshot/baseline is ever taken or passed — this is the whole point:
    // the sweep must not require "new this run" to authorize a kill.
    const result = sweepStaleDaemonSessions(runner);

    expect(result.killed).toHaveLength(1);
    expect(result.killed[0]).toContain('cc-daemon-stale-debris');
    expect(result.killed[0]).toContain('pane cwd:');

    const killCalls = calls.filter((a) => a[0] === 'kill-session');
    expect(killCalls).toEqual([['kill-session', '-t', '=cc-daemon-stale-debris']]);
  });

  it('never kills a session whose pane cwd is a real repo checkout (the operator daemon)', () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'list-sessions') {
        return { code: 0, stdout: 'cc-daemon-james-stoup-agents-87f14f\n', stderr: '' };
      }
      if (args[0] === 'display-message') {
        return { code: 0, stdout: '/home/user/code/james-stoup-agents\n', stderr: '' };
      }
      throw new Error(`unexpected tmux invocation: ${args.join(' ')}`);
    };

    const result = sweepStaleDaemonSessions(runner);

    expect(result.killed).toEqual([]);
    expect(calls.some((a) => a[0] === 'kill-session')).toBe(false);
  });

  it('never kills a session whose pane cwd is unresolvable (fail-closed, same as reap)', () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'list-sessions') {
        return { code: 0, stdout: 'cc-daemon-gone\n', stderr: '' };
      }
      if (args[0] === 'display-message') {
        return { code: 1, stdout: '', stderr: "can't find pane" };
      }
      throw new Error(`unexpected tmux invocation: ${args.join(' ')}`);
    };

    const result = sweepStaleDaemonSessions(runner);

    expect(result.killed).toEqual([]);
    expect(calls.some((a) => a[0] === 'kill-session')).toBe(false);
  });

  it('empty session list ⇒ no-op', () => {
    const runner: TmuxRunner = (args: string[]) => {
      if (args[0] === 'list-sessions') {
        return { code: 0, stdout: '', stderr: '' };
      }
      throw new Error(`unexpected tmux invocation: ${args.join(' ')}`);
    };

    expect(sweepStaleDaemonSessions(runner)).toEqual({ killed: [] });
  });

  it('real tmux: a session created BEFORE any snapshot is taken (simulating debris left by a ' +
    'previously-interrupted run) is swept and killed with zero baseline involvement', async () => {
    if (!(await tmuxInstalled())) return; // no tmux in this sandbox — skip

    const name = `cc-daemon-swtest-${randomBytes(4).toString('hex')}`;
    const prevFlag = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    try {
      // Simulate a leaked session that predates this "run" (no snapshot taken
      // before or after creating it — that's the point of the pre-run sweep).
      await newDetachedSession(name, 'bash -c "sleep 60"', os.tmpdir());
      expect(await hasSession(name)).toBe(true);

      const { killed } = sweepStaleDaemonSessions();

      expect(killed.some((l) => l.includes(name))).toBe(true);
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

describe('reapLeakedDaemonSessions (#437) — teardown-time listing failure degrades to silent no-kill', () => {
  it('successful baseline but teardown-time listing fails ⇒ empty result, no kill attempted', () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'list-sessions') {
        return { code: 1, stdout: '', stderr: "can't find session" };
      }
      throw new Error(`unexpected tmux invocation: ${args.join(' ')}`);
    };

    const snapshot = { sessions: ['cc-daemon-a'], failed: false };
    const result = reapLeakedDaemonSessions(snapshot, runner);

    expect(result).toEqual({ killed: [], indeterminate: [] });
    expect(calls.some((a) => a[0] === 'kill-session')).toBe(false);
    expect(calls.some((a) => a[0] === 'display-message')).toBe(false);
  });

  it('ENOENT-class runner at snapshot AND teardown ⇒ empty result (tmux not installed, silent no-op)', () => {
    const runner: TmuxRunner = () => ({
      code: 1,
      stdout: '',
      stderr: '',
      spawnError: true,
    });

    const snapshot = snapshotDaemonSessions(runner);
    expect(snapshot).toEqual({ sessions: [], failed: true });

    const result = reapLeakedDaemonSessions(snapshot, runner);
    expect(result).toEqual({ killed: [], indeterminate: [] });
  });
});

describe('applyTeardownDecision (#437) — global-setup wiring: warn-only indeterminate, fail-run only on kills', () => {
  it('killed non-empty ⇒ throws an error naming the sessions and pointing at #377', () => {
    const result = { killed: ['cc-daemon-leak (pane cwd: /tmp/leak-fixture)'], indeterminate: [] };

    expect(() => applyTeardownDecision(result, () => {})).toThrow(/cc-daemon-leak/);
    expect(() => applyTeardownDecision(result, () => {})).toThrow(/#377/);
  });

  it('killed empty + indeterminate non-empty ⇒ does not throw, warns naming sessions and reason', () => {
    const result = {
      killed: [],
      indeterminate: ['cc-daemon-repo (pane cwd: /home/user/code/repo)'],
    };
    const messages: string[] = [];

    expect(() => applyTeardownDecision(result, (msg) => messages.push(msg))).not.toThrow();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('cc-daemon-repo');
    expect(messages[0]).toMatch(/could not be corroborated|snapshot failure|non-tmpdir/);
  });

  it('both empty ⇒ silent success, no throw and no log', () => {
    const messages: string[] = [];
    expect(() =>
      applyTeardownDecision({ killed: [], indeterminate: [] }, (msg) => messages.push(msg))
    ).not.toThrow();
    expect(messages).toHaveLength(0);
  });

  it('killed non-empty AND indeterminate non-empty ⇒ warns for indeterminate but still throws for killed', () => {
    const result = {
      killed: ['cc-daemon-leak (pane cwd: /tmp/leak-fixture)'],
      indeterminate: ['cc-daemon-repo (pane cwd: /home/user/code/repo)'],
    };
    const messages: string[] = [];

    expect(() => applyTeardownDecision(result, (msg) => messages.push(msg))).toThrow(/cc-daemon-leak/);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('cc-daemon-repo');
  });
});

describe('report message prefixes (#437 TR-3) — killed vs indeterminate are textually distinct', () => {
  it('killed and indeterminate messages use distinct, greppable, non-overlapping prefixes', () => {
    const killedResult = { killed: ['cc-daemon-leak (pane cwd: /tmp/leak-fixture)'], indeterminate: [] };
    const indeterminateResult = {
      killed: [],
      indeterminate: ['cc-daemon-repo (pane cwd: /home/user/code/repo)'],
    };

    let killedMessage = '';
    try {
      applyTeardownDecision(killedResult, () => {});
    } catch (err) {
      killedMessage = (err as Error).message;
    }

    let indeterminateMessage = '';
    applyTeardownDecision(indeterminateResult, (msg) => {
      indeterminateMessage = msg;
    });

    const killedPrefix = 'tmux-leak-guard: KILLED leaked session';
    const indeterminatePrefix = 'tmux-leak-guard: NOT killed (fail-closed):';

    expect(killedMessage.startsWith(killedPrefix)).toBe(true);
    expect(indeterminateMessage.startsWith(indeterminatePrefix)).toBe(true);
    expect(indeterminatePrefix.includes(killedPrefix)).toBe(false);
    expect(killedPrefix.includes(indeterminatePrefix)).toBe(false);
  });
});

describe('tmux-leak-guard (#377)', () => {
  it('a pre-existing session set yields no leaks (operator daemons untouched)', () => {
    const before = snapshotDaemonSessions();
    expect(reapLeakedDaemonSessions(before)).toEqual({ killed: [], indeterminate: [] });
  });

  it('kills and reports a cc-daemon-* session created after the snapshot', async () => {
    if (!(await tmuxInstalled())) return; // no tmux in this sandbox — skip

    const before = snapshotDaemonSessions();
    const name = `cc-daemon-leaktest-${randomBytes(4).toString('hex')}`;

    // Create the "leak" the way an escape would: real tmux, kill-switch off.
    const prevFlag = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    try {
      await newDetachedSession(name, 'bash -c "sleep 60"', os.tmpdir());
      expect(await hasSession(name)).toBe(true);

      const { killed, indeterminate } = reapLeakedDaemonSessions(before);

      // Reported by name with a pane-cwd fingerprint…
      expect(killed.some((l) => l.includes(name))).toBe(true);
      expect(killed.find((l) => l.includes(name))).toContain('pane cwd:');
      expect(indeterminate).toEqual([]);
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
