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

function tmux(args: string[]): { code: number; stdout: string } {
  const result = spawnSync('tmux', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
  if (result.error) {
    // tmux not installed (CI runners) — report "no sessions" so the guard
    // degrades to a no-op instead of failing environments without tmux.
    return { code: 1, stdout: '' };
  }
  return { code: result.status ?? 1, stdout: (result.stdout as string | null) ?? '' };
}

/** Names of live `cc-daemon-*` tmux sessions (empty when tmux is absent/idle). */
export function listDaemonSessions(): string[] {
  const result = tmux(['list-sessions', '-F', '#{session_name}']);
  if (result.code !== 0) return [];
  return result.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(DAEMON_SESSION_PREFIX));
}

/** Pane cwd of a session's active pane — the leak's fixture-dir fingerprint. */
export function sessionPaneCwd(name: string): string {
  const result = tmux(['display-message', '-p', '-t', `=${name}:`, '#{pane_current_path}']);
  return result.code === 0 ? result.stdout.trim() : '(unknown)';
}

export function killDaemonSession(name: string): void {
  tmux(['kill-session', '-t', `=${name}`]);
}

/**
 * Diff live sessions against the suite-start snapshot; kill and describe
 * every leaked one. Returns the leak descriptions (empty = clean run).
 */
export function reapLeakedDaemonSessions(before: ReadonlySet<string>): string[] {
  const leaks: string[] = [];
  for (const name of listDaemonSessions()) {
    if (before.has(name)) continue;
    const cwd = sessionPaneCwd(name);
    killDaemonSession(name);
    leaks.push(`${name} (pane cwd: ${cwd})`);
  }
  return leaks;
}
