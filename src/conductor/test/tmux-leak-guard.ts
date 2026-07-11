// Tmux daemon-session leak guard (#377) — suite-level net for the leak class
// no in-process kill-switch can catch: a child process spawned without
// AI_CONDUCTOR_NO_REAL_EXEC in its env, or a test injecting a real runner,
// can create a real `cc-daemon-*` tmux session hosting a full
// `conduct-ts daemon --continuous` that outlives its deleted /tmp fixture
// repo. The global teardown diffs the session list against the suite-start
// snapshot, kills every leaked session (so nothing stays resident), and then
// FAILS the run naming each session and its pane cwd — the cwd's fixture
// prefix (e.g. `loop-test-`, `intake-life-`) attributes the leak to a file.
//
// Sessions that existed BEFORE the suite (the operator's real repo daemon,
// e.g. `cc-daemon-james-stoup-agents-*`) are never touched.
//
// TWO-SIGNAL FAIL-CLOSED CONTRACT (#437, TR-1/TR-2/TR-3):
// A session is only ever killed when BOTH corroborating signals are present:
//   1. Baseline snapshot succeeded (`snapshot.failed === false`) — a failed
//      baseline means "not in before" can't be trusted as "new", so it must
//      never be used to authorize a kill.
//   2. The session's pane cwd resolves AND is tmpdir-rooted
//      (`isTmpdirRooted(cwd)` — see below). A pane cwd outside os.tmpdir()
//      (e.g. the operator's real repo) is never a leak candidate.
// Missing EITHER signal degrades to report-only: the session is left running
// and named in the `indeterminate` bucket, never killed. A failed baseline
// snapshot disables reaping entirely for that run — every live session is
// reported as indeterminate rather than killed, so a transient snapshot
// failure can never take down a production daemon session. Report messages
// use fixed, greppable, mutually non-overlapping prefixes so a killed leak
// and an indeterminate (fail-closed, left running) report are never
// confusable in logs: `tmux-leak-guard: KILLED leaked session…` vs
// `tmux-leak-guard: NOT killed (fail-closed): …`.

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export const DAEMON_SESSION_PREFIX = 'cc-daemon-';

/** TR-2: kill requires pane cwd resolved AND under os.tmpdir(). Lexical
 * resolve only — no realpath, so a deleted /tmp fixture dir still matches.
 * Exact-or-prefix (with trailing separator) check, so
 * `${tmpdir}-evil/x` does NOT falsely match `tmpdir`. */
export function isTmpdirRooted(cwd: string): boolean {
  const tmp = path.resolve(os.tmpdir());
  const resolved = path.resolve(cwd);
  return resolved === tmp || resolved.startsWith(tmp + path.sep);
}

/** Result of a single tmux invocation. `spawnError` means the process never
 * ran at all (e.g. tmux not installed) — distinct from a clean exec that
 * merely returned a non-zero exit code. */
export type TmuxResult = {
  stdout: string;
  stderr: string;
  code: number;
  spawnError?: boolean;
};

/** Injectable seam so tests can assert on exact argv and control results
 * without a real tmux binary. */
export type TmuxRunner = (args: string[]) => TmuxResult;

/** Default runner — the real `spawnSync('tmux', …)` wrapper. */
export const realTmuxRunner: TmuxRunner = (args: string[]): TmuxResult => {
  const result = spawnSync('tmux', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
  if (result.error) {
    // tmux not installed (CI runners), or the spawn itself failed — distinct
    // from a clean exec that returned a non-zero code.
    return { code: 1, stdout: '', stderr: '', spawnError: true };
  }
  return {
    code: result.status ?? 1,
    stdout: (result.stdout as string | null) ?? '',
    stderr: (result.stderr as string | null) ?? '',
  };
};

function tmux(args: string[], runner: TmuxRunner): TmuxResult {
  return runner(args);
}

/** Result of a snapshot attempt — `failed: true` means the classification
 * could not confirm genuine emptiness, so callers must fail closed rather
 * than treat `sessions: []` as "nothing running". */
export type SnapshotResult = {
  sessions: string[];
  failed: boolean;
};

const GENUINE_EMPTY_STDERR_PATTERNS = [
  /no server running/,
  /error connecting to .*no such file or directory/,
];

/**
 * Snapshot live `cc-daemon-*` tmux sessions, distinguishing a genuinely
 * empty tmux server (no server running yet — not a failure) from a true
 * failure to query tmux (spawn error or unrecognized non-zero exit).
 */
export function snapshotDaemonSessions(runner: TmuxRunner = realTmuxRunner): SnapshotResult {
  const result = tmux(['list-sessions', '-F', '#{session_name}'], runner);

  if (result.code === 0) {
    const sessions = result.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.startsWith(DAEMON_SESSION_PREFIX));
    return { sessions, failed: false };
  }

  if (
    !result.spawnError &&
    GENUINE_EMPTY_STDERR_PATTERNS.some((pattern) => pattern.test(result.stderr.toLowerCase()))
  ) {
    return { sessions: [], failed: false };
  }

  return { sessions: [], failed: true };
}

/** Names of live `cc-daemon-*` tmux sessions (empty when tmux is absent/idle). */
export function listDaemonSessions(runner: TmuxRunner = realTmuxRunner): string[] {
  return snapshotDaemonSessions(runner).sessions;
}

/** Pane cwd of a session's active pane — the leak's fixture-dir fingerprint. */
export function sessionPaneCwd(name: string, runner: TmuxRunner = realTmuxRunner): string {
  const result = tmux(['display-message', '-p', '-t', `=${name}:`, '#{pane_current_path}'], runner);
  return result.code === 0 ? result.stdout.trim() : '(unknown)';
}

export function killDaemonSession(name: string, runner: TmuxRunner = realTmuxRunner): void {
  tmux(['kill-session', '-t', `=${name}`], runner);
}

/** Result of a reap pass: sessions actually killed vs. sessions that could
 * not be corroborated as leaks (reported but left alone — fail closed). */
export type ReapResult = {
  killed: string[];
  indeterminate: string[];
};

/**
 * Diff live sessions against the suite-start snapshot; kill only sessions
 * that clear BOTH corroborating signals (TR-2, #437):
 *   1. The baseline snapshot itself succeeded (`snapshot.failed === false`)
 *      — a failed baseline means we can't trust "not in before" as "new".
 *   2. The session is not in the baseline's session list.
 *   3. Its pane cwd resolves.
 *   4. That pane cwd is rooted under os.tmpdir() (`isTmpdirRooted`).
 * The pane cwd is evaluated BEFORE any kill. Anything not meeting all four
 * criteria is reported via `indeterminate` and never killed.
 */
export function reapLeakedDaemonSessions(
  snapshot: SnapshotResult,
  runner: TmuxRunner = realTmuxRunner
): ReapResult {
  const killed: string[] = [];
  const indeterminate: string[] = [];
  const before = new Set(snapshot.sessions);

  for (const name of listDaemonSessions(runner)) {
    if (before.has(name)) continue;

    const cwd = sessionPaneCwd(name, runner);
    const canKill = !snapshot.failed && cwd !== '(unknown)' && isTmpdirRooted(cwd);

    if (canKill) {
      killDaemonSession(name, runner);
      killed.push(`${name} (pane cwd: ${cwd})`);
    } else {
      indeterminate.push(`${name} (pane cwd: ${cwd})`);
    }
  }

  return { killed, indeterminate };
}
