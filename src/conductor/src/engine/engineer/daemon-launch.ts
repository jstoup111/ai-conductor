// daemon-launch.ts — Fire-and-forget daemon launch helper (FR-8; ADR-005 intent,
// ADR-014 mechanism).
//
// launchDaemon starts a build daemon for a repo and retains NO handle,
// IPC channel, or supervision over it. ADR-014 changes the MECHANISM (not the
// non-management guarantee): instead of a detached `stdio:'ignore'` node spawn,
// the daemon is hosted as a FOREGROUND process inside a per-repo tmux session
// (via the Supervisor port's idempotent `start`). The session owns an attachable
// PTY so an OPERATOR can connect/debug/restart it — but the engineer that calls
// this helper still cannot: it gets no handle, no IPC, no control connection, and
// writes no supervision state. "Launch ≠ manage" (ADR-005 FR-8) is preserved.
//
// Design decisions:
//   - Delegates to the Supervisor port (tmux adapter) — all tmux argv + session
//     naming live in daemon-tmux.ts; this helper never shells out to tmux.
//   - `supervisor.start` is idempotent (no-op when a session already exists), so
//     a duplicate nudge never spawns a second daemon.
//   - Returns void/Promise<void> — the caller receives NO process handle. Returning
//     a ChildProcess (or anything with kill/on) would be a contract violation
//     (launch ≠ manage). The tmux session is owned by the tmux server, not us.
//   - supervisor is injectable via opts.supervisor — tests pass a spy; production
//     builds a tmux supervisor.

import { makeTmuxSupervisor } from '../daemon-tmux.js';

/** Minimal launch-only view of the Supervisor — start only, never manage. */
export interface DaemonStarter {
  start(repoPath: string): void | Promise<void>;
}

/** Options accepted by launchDaemon. */
export interface LaunchDaemonOpts {
  /**
   * Injectable launcher. Defaults to a tmux Supervisor. Provide a spy in tests to
   * assert the launch delegates to `start(repoPath)` without spawning real tmux.
   * Deliberately typed `start`-only so a test (or caller) can never reach a
   * stop/restart/attach method through this seam (ADR-005 launch ≠ manage).
   */
  supervisor?: DaemonStarter;
}

/**
 * Launch a build daemon for `project`, fire-and-forget, hosted in an
 * operator-attachable tmux session (ADR-014). Retains no handle/IPC/control over
 * the daemon — strictly launch, never manage (ADR-005 FR-8).
 *
 * @param project - Absolute path to the project root (the daemon's repo + cwd).
 * @param opts    - Optional supervisor injection (tests).
 * @returns void / Promise<void> — intentionally no handle is retained or returned.
 */
export function launchDaemon(project: string, opts: LaunchDaemonOpts = {}): void | Promise<void> {
  const supervisor = opts.supervisor ?? makeTmuxSupervisor();
  // Idempotent start: a live session ⇒ no-op (no duplicate daemon). We return the
  // start() result (void/Promise) so the caller can await + swallow errors, but we
  // never hand back a process handle.
  return supervisor.start(project);
}
