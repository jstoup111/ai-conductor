// brain-liveness.ts — detect whether a background brain loop is currently running.
//
// The single-writer gate (ADR Q2): when a brain loop is live, the interactive
// launcher's pre-poll MUST be skipped so the brain loop remains the sole writer
// to the durable intake inbox. Liveness is determined by either signal:
//   1. A pidfile at ~/.ai-conductor/brain-loop.pid exists.
//   2. A tmux session named `cc-brain-*` exists.
// Either signal alone is sufficient; both absent means the brain loop is not running.

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_BRAIN_PIDFILE = join(homedir(), '.ai-conductor', 'brain-loop.pid');
export const BRAIN_TMUX_SESSION_PREFIX = 'cc-brain-';

export interface BrainLoopAliveDeps {
  /** Override the pidfile path (for tests). Default: ~/.ai-conductor/brain-loop.pid */
  pidfilePath?: string;
  /** Override pidfile-existence check (for tests). Default: fs existsSync. */
  pidfileExists?: (path: string) => boolean;
  /**
   * Override the tmux session lookup (for tests). Given the session-name prefix,
   * returns true if a matching session is running. Default: shells out to
   * `tmux list-sessions` and checks for a session name starting with the prefix;
   * returns false (not an error) when tmux is unavailable or has no sessions.
   */
  tmuxHasSession?: (prefix: string) => boolean;
}

function defaultTmuxHasSession(prefix: string): boolean {
  try {
    const out = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\n')
      .map((line) => line.trim())
      .some((line) => line.startsWith(prefix));
  } catch {
    // tmux not installed, no server running, or no sessions — treat as "no session".
    return false;
  }
}

/**
 * Returns true if a brain loop appears to be running (pidfile present OR a
 * `cc-brain-*` tmux session exists), false otherwise. Best-effort: any lookup
 * failure is treated as "not alive" rather than thrown.
 */
export function brainLoopAlive(deps: BrainLoopAliveDeps = {}): boolean {
  const pidfilePath = deps.pidfilePath ?? DEFAULT_BRAIN_PIDFILE;
  const pidfileExists = deps.pidfileExists ?? existsSync;
  if (pidfileExists(pidfilePath)) return true;

  const tmuxHasSession = deps.tmuxHasSession ?? defaultTmuxHasSession;
  return tmuxHasSession(BRAIN_TMUX_SESSION_PREFIX);
}
