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

import { spawnSync } from 'node:child_process';

export const DAEMON_SESSION_PREFIX = 'cc-daemon-';

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

/** Names of live `cc-daemon-*` tmux sessions (empty when tmux is absent/idle). */
export function listDaemonSessions(runner: TmuxRunner = realTmuxRunner): string[] {
  const result = tmux(['list-sessions', '-F', '#{session_name}'], runner);
  if (result.code !== 0) return [];
  return result.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(DAEMON_SESSION_PREFIX));
}

/** Pane cwd of a session's active pane — the leak's fixture-dir fingerprint. */
export function sessionPaneCwd(name: string, runner: TmuxRunner = realTmuxRunner): string {
  const result = tmux(['display-message', '-p', '-t', `=${name}:`, '#{pane_current_path}'], runner);
  return result.code === 0 ? result.stdout.trim() : '(unknown)';
}

export function killDaemonSession(name: string, runner: TmuxRunner = realTmuxRunner): void {
  tmux(['kill-session', '-t', `=${name}`], runner);
}

/**
 * Diff live sessions against the suite-start snapshot; kill and describe
 * every leaked one. Returns the leak descriptions (empty = clean run).
 */
export function reapLeakedDaemonSessions(
  before: ReadonlySet<string>,
  runner: TmuxRunner = realTmuxRunner
): string[] {
  const leaks: string[] = [];
  for (const name of listDaemonSessions(runner)) {
    if (before.has(name)) continue;
    const cwd = sessionPaneCwd(name, runner);
    killDaemonSession(name, runner);
    leaks.push(`${name} (pane cwd: ${cwd})`);
  }
  return leaks;
}
