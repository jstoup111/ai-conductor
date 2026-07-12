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
//
// PERMANENT-BASELINE-BLINDSPOT FIX (2026-07-12, ~400-session incident):
// `reapLeakedDaemonSessions` only ever inspects sessions ABSENT from the
// suite-start baseline (`before.has(name) ⇒ skip, no inspection at all`).
// That is correct for distinguishing "new this run" from "the operator's
// long-lived daemon" WHEN the run's own teardown gets to execute — but
// vitest's `globalTeardown` is a normal-exit-only hook: it never fires on
// SIGKILL, an external `timeout`-style SIGTERM, or a crashed/OOM-killed
// worker. When a run is interrupted before teardown runs, any session it
// leaked survives into the NEXT run's baseline snapshot — at which point
// `before.has(name)` is true FOREVER, and the diff-based reaper never even
// looks at its pane cwd again. Repeat across enough interrupted runs (this
// harness is driven by many short-lived agent invocations against a 2-minute
// default Bash timeout) and leaked sessions accumulate without bound — this
// is exactly how ~400 stale `cc-daemon-*` sessions piled up in production.
//
// `sweepStaleDaemonSessions` (below) closes the hole with an orthogonal,
// unconditional check that runs BEFORE the baseline is taken: any
// `cc-daemon-*` session whose pane cwd is tmpdir-rooted is, by construction,
// never the operator's real per-repo daemon (a real daemon's cwd is always a
// real repo checkout, never `os.tmpdir()`) — so tmpdir-rootedness alone is
// sufficient kill authority here, with no "new this run" requirement, because
// at sweep time EVERYTHING found necessarily predates this run. This makes
// the guard self-healing: even a session that leaked past every prior run's
// teardown gets swept the next time ANY vitest invocation starts.

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

/** Result of a pre-run sweep: sessions killed because they are unconditionally
 * proven leaks (tmpdir-rooted pane cwd), regardless of baseline membership. */
export type SweepResult = {
  killed: string[];
};

/**
 * Pre-run sweep — closes the permanent-baseline-blindspot (see header):
 * kills every currently-running `cc-daemon-*` session whose pane cwd is
 * tmpdir-rooted, BEFORE any baseline snapshot is taken.
 *
 * Unlike `reapLeakedDaemonSessions`, this does NOT require "absent from
 * baseline" as a precondition — at sweep time there IS no baseline yet, and
 * everything found is necessarily pre-existing. That is exactly the class
 * `reapLeakedDaemonSessions` can never see again once it lands in a baseline.
 * The single signal used here (pane cwd resolves AND is tmpdir-rooted) is the
 * same TR-2 corroboration `reapLeakedDaemonSessions` uses, and is sufficient
 * on its own: a real per-repo production daemon's pane cwd is always a real
 * repo checkout path, never `os.tmpdir()`, so tmpdir-rootedness alone can
 * never misidentify `cc-daemon-james-stoup-agents-*` or any other live
 * operator daemon as a leak.
 *
 * An unresolvable pane cwd (`(unknown)`) is left alone (fail-closed, same as
 * `reapLeakedDaemonSessions`) — an unresolvable signal is never treated as a
 * "yes".
 */
export function sweepStaleDaemonSessions(runner: TmuxRunner = realTmuxRunner): SweepResult {
  const killed: string[] = [];

  for (const name of listDaemonSessions(runner)) {
    const cwd = sessionPaneCwd(name, runner);
    if (cwd !== '(unknown)' && isTmpdirRooted(cwd)) {
      killDaemonSession(name, runner);
      killed.push(`${name} (pane cwd: ${cwd})`);
    }
  }

  return { killed };
}
