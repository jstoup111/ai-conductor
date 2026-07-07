// daemon-supervisor-cli.ts — CLI dispatcher for the `conduct daemon <management-verb>`
// family of commands (start / stop / restart / connect / debug).
//
// The Supervisor port (makeTmuxSupervisor) is injected via DaemonSupervisorDeps so
// tests can supply a spy without spawning a real tmux process.  The default dep
// (makeTmuxSupervisor()) is only resolved at call time to avoid importing the
// supervisor runtime eagerly.

import { makeTmuxSupervisor, TmuxNotInstalledError, type Supervisor } from './daemon-tmux.js';
import type { DaemonSupervisorCommand } from './daemon-command.js';
import { ensureInstallFresh, relinkSkillsForSelfBuild } from './install-freshness.js';
import { clearStaleLockForRestart, readPidRecord, reclaim, isLive, type KillProbe } from './daemon-lock.js';
import { isPaused, writePauseMarker, removePauseMarker } from './pause-marker.js';
import { writeRestartPending } from './restart-marker.js';
import { runFleetAction, type FleetSelection } from './daemon-fleet.js';
import type { ProjectRecord } from './registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// Orphaned-process reconciliation (FR-21 negative path, Task 34).
// ─────────────────────────────────────────────────────────────────────────────

// Default kill implementation for orphan process termination.
const defaultKillForOrphan = (pid: number, signal: NodeJS.Signals | number): void => {
  process.kill(pid, signal);
};

/**
 * reconcileOrphan — detect and cleanup orphaned daemon process.
 *
 * Orphan scenario: pidfile exists with a live pid, but tmux session is gone
 * (session killed externally, but process survived).
 *
 * Algorithm:
 *   1. Read pidfile; if absent/dead, no orphan — return null
 *   2. Check if tmux session exists for this repo
 *      - if session exists, no orphan — return null
 *      - if session absent, check if the pid is live
 *        - if dead, no orphan (stale pidfile) — return null
 *        - if live, orphan detected! → terminate the process and reclaim lock
 *
 * Returns: the original (now-dead) pid when an orphan was cleaned up, null otherwise.
 *
 * On TmuxNotInstalledError (no tmux available), rethrows so the caller can
 * surface the actionable message.
 */
async function reconcileOrphan(
  repoPath: string,
  supervisor: Supervisor,
  kill: KillProbe = defaultKillForOrphan,
): Promise<number | null> {
  try {
    // Read the pidfile to check if a daemon is recorded
    const pidRecord = await readPidRecord(repoPath);
    if (!pidRecord || pidRecord.pid <= 0) {
      return null; // No pidfile or invalid pid — no orphan to reconcile
    }

    // Check if the tmux session exists for this repo
    let hasSession: boolean;
    try {
      hasSession = await supervisor.hasSession(repoPath);
    } catch (err) {
      // TmuxNotInstalledError or other tmux error — rethrow so caller can handle
      throw err;
    }

    if (hasSession) {
      return null; // Session exists — not an orphan
    }

    // Session is absent; check if the recorded process is still alive
    if (!isLive(pidRecord.pid, kill)) {
      return null; // Process is dead; not an orphan (stale pidfile)
    }

    // Orphan detected: session gone but process still alive.
    // Terminate the process using SIGTERM → SIGKILL flow.
    try {
      kill(pidRecord.pid, 15); // SIGTERM
      // Give it a moment to exit gracefully
      await new Promise((r) => setTimeout(r, 100));
      // Check if it's still alive; if so, force kill
      if (isLive(pidRecord.pid, kill)) {
        kill(pidRecord.pid, 9); // SIGKILL
      }
    } catch {
      // Process kill failed (e.g. EPERM, ESRCH) — best-effort
      // Proceed to reclaim the lock; the process may be dead or unreachable
    }

    // Reclaim the lock so the fresh daemon claims a clean lock
    const reclaimResult = await reclaim(repoPath, kill);
    if (reclaimResult.reclaimed) {
      return pidRecord.pid; // Orphan was cleaned up
    }

    return null; // Reclaim lost to a concurrent process; no-op
  } catch (err) {
    // TmuxNotInstalledError or other errors — rethrow for caller handling
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependencies — all optional so callers can inject spies in tests.
// ─────────────────────────────────────────────────────────────────────────────

export interface DaemonSupervisorDeps {
  /** Supervisor port to use (tests inject a spy; default: makeTmuxSupervisor()). */
  supervisor?: Supervisor;
  /** Working directory used as the repo path (tests inject a tmp dir). */
  cwd?: string;
  /** Output sink (tests capture lines; default: console.log). */
  out?: (line: string) => void;
  /**
   * Guard that ensures the harness install is fresh before a `start` launches a
   * daemon (tests inject a spy; default: ensureInstallFresh). Throws
   * InstallStaleError when the install is stale and not refreshed — the catch
   * below surfaces it and returns 1, so a stale install never starts a daemon.
   */
  ensureFresh?: () => Promise<void>;
  /**
   * Whether there is an interactive terminal to attach to. Controls the `start`
   * auto-attach: only when interactive (and not detached) does `start` hand the
   * terminal to the daemon's tmux session. Defaults to `process.stdin.isTTY` so
   * scripts / the engineer auto-launch (no TTY) never block on `tmux attach`.
   */
  isInteractive?: boolean;
  /**
   * Busy probe consulted by `restart` (FR-9): reports whether the daemon is
   * currently mid-feature and, when so, which slug it is working on. Tests
   * inject a fake to exercise the busy/queued branch; the default is
   * conservative (`{ busy: false }`) — no cross-process in-flight signal is
   * wired yet at this call site (that lands with the daemon-loop's own
   * sweep-boundary self-restart), so an un-injected `restart` behaves exactly
   * as before: immediate respawn. A paused daemon is NEVER treated as busy —
   * paused counts as idle (FR-11) — so `isBusy` is not even consulted when
   * `isPaused(cwd)` is true.
   */
  isBusy?: (cwd: string) => Promise<{ busy: boolean; blockingSlug?: string }>;
  /**
   * Registry path override (tests) for `pause`/`resume` fleet selectors
   * (`names`/`all` on the command — FR-3/FR-17/FR-18). Forwarded to
   * `runFleetAction`; unused for the single-repo (cwd) path.
   */
  registryPath?: string;
  /**
   * Injectable kill probe (tests) for orphan process termination.
   * Passed to reconcileOrphan; defaults to process.kill.
   */
  kill?: KillProbe;
  /**
   * Injectable skill-relink function (tests) for self-build restart (TR-4).
   * Called before supervisor.restart in the idle restart path. Defaults to
   * relinkSkillsForSelfBuild. When relink fails, the error is propagated to
   * the caller (Task 12).
   */
  relinkSkills?: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// dispatchDaemonSupervisor — verb → Supervisor method routing.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a management verb against the Supervisor port.
 *
 * Verb → method mapping:
 *   start   → supervisor.start(cwd), then auto-attach read-only (see below)
 *   stop    → supervisor.stop(cwd)
 *   restart → supervisor.restart(cwd)
 *   connect → supervisor.attach(cwd, { readOnly: true })
 *   debug   → supervisor.attach(cwd, { readOnly: false })
 *
 * `start` auto-attaches the terminal (read-only) to the freshly-started session
 * so the operator lands in the live daemon, UNLESS `-D`/`--detach` was passed or
 * there is no interactive terminal (scripts / auto-launch) — in which case it
 * starts detached and notes how to attach later.
 *
 * Returns 0 on success; writes an actionable message to `out` and returns 1 on
 * any error (TmuxNotInstalledError or any other Error) so the caller can
 * process.exit(code) without a thrown escape.
 */
export async function dispatchDaemonSupervisor(
  cmd: DaemonSupervisorCommand,
  deps: DaemonSupervisorDeps = {},
): Promise<number> {
  // When supervisor is not provided (bare-run mode), create the default only when needed.
  // This allows bare-run paths to avoid tmux operations entirely.
  const bareRun = !deps.supervisor;
  const supervisor = deps.supervisor ?? makeTmuxSupervisor();
  const cwd = deps.cwd ?? process.cwd();
  const out = deps.out ?? ((l: string) => console.log(l));
  const ensureFresh = deps.ensureFresh ?? (() => ensureInstallFresh({ log: out }));
  const isInteractive = deps.isInteractive ?? Boolean(process.stdin.isTTY);
  const isBusy = deps.isBusy ?? (async () => ({ busy: false }));
  const kill = deps.kill ?? defaultKillForOrphan;
  const relinkSkills = deps.relinkSkills ?? (() => relinkSkillsForSelfBuild({ log: out }));

  // Fleet dispatch (FR-3/FR-17/FR-18): pause/resume/restart accept a named subset or
  // `--all` and iterate the registry instead of acting on `cwd` alone. This
  // branch returns directly — it has its own per-repo try/catch inside
  // runFleetAction, so failures there never escape as a thrown exception.
  if ((cmd.verb === 'pause' || cmd.verb === 'resume') && (cmd.all || cmd.names)) {
    const selection: FleetSelection = cmd.all ? { all: true } : { names: cmd.names ?? [] };
    const action = async (record: ProjectRecord): Promise<string> => {
      if (cmd.verb === 'pause') {
        if (await isPaused(record.path)) return 'already paused';
        await writePauseMarker(record.path);
        return 'daemon paused';
      }
      if (!(await isPaused(record.path))) return 'not paused';
      await removePauseMarker(record.path);
      return 'daemon resumed';
    };
    const { code } = await runFleetAction(selection, action, {
      registryPath: deps.registryPath,
      out,
    });
    return code;
  }

  // Fleet dispatch for restart (FR-3/FR-17/FR-18, Task T32): restart accept a named subset or
  // `--all` and iterate the registry. Each repo can have a different outcome:
  // - paused → immediate respawn (paused counts as idle)
  // - idle → immediate respawn via supervisor.restart
  // - busy → queue restart with writeRestartPending, return immediately
  // - stopped (no session) → supervisor.start instead, report as "started"
  // - error → report error and continue with other repos
  if (cmd.verb === 'restart' && (cmd.all || cmd.names)) {
    const selection: FleetSelection = cmd.all ? { all: true } : { names: cmd.names ?? [] };
    const action = async (record: ProjectRecord): Promise<string> => {
      const paused = await isPaused(record.path);
      const busyCheck = paused ? { busy: false as const } : await isBusy(record.path);

      if (busyCheck.busy) {
        await writeRestartPending(record.path, { blockingSlug: busyCheck.blockingSlug });
        return `restart queued: daemon is busy on ${busyCheck.blockingSlug ?? '(unknown feature)'}`;
      }

      // Handoff (FR-8): proactively clear any stale (dead-pid) or absent
      // lock BEFORE the tmux-level respawn, using ONLY the existing
      // acquire/reclaim primitives (daemon-lock.ts, no new lock semantics).
      await clearStaleLockForRestart(record.path, kill);

      // Orphan reconciliation (FR-21 neg, Task 34): detect and cleanup any orphaned
      // process (pidfile alive, session gone) before respawn. Skipped in bare-run
      // mode (no supervisor provided) since bare-run has no tmux sessions.
      if (!bareRun) {
        try {
          const orphanPid = await reconcileOrphan(record.path, supervisor, kill);
          if (orphanPid) {
            out(`orphaned daemon process (pid ${orphanPid}) terminated; lock reclaimed.`);
          }
        } catch (err) {
          // TmuxNotInstalledError or other tmux error — rethrow so runFleetAction
          // catches it and reports per-repo.
          throw err;
        }
      }

      try {
        const outcome = await supervisor.restart(record.path);
        return outcome.message;
      } catch (err) {
        // Restart failed — likely "no session". Try starting instead.
        // This handles the case where the daemon was stopped.
        try {
          await supervisor.start(record.path);
          return 'daemon started (was stopped)';
        } catch (startErr) {
          // Both restart and start failed — propagate the error so
          // runFleetAction catches it and reports per-repo.
          throw startErr;
        }
      }
    };
    const { code } = await runFleetAction(selection, action, {
      registryPath: deps.registryPath,
      out,
    });
    return code;
  }

  try {
    switch (cmd.verb) {
      case 'start':
        // Refuse to launch a daemon on a stale install — otherwise newly-added
        // skills are unregistered and daemon-dispatched skills fail silently.
        await ensureFresh();
        await supervisor.start(cwd);
        // Auto-attach (read-only) so `start` drops the operator into the live
        // session. Skipped when detached (-D) or there's no TTY to attach to —
        // `tmux attach` errors without a controlling terminal, which would turn
        // a successful start into a non-zero exit for scripts.
        if (cmd.detach) {
          out("daemon started (detached). Attach with 'conduct daemon connect'.");
        } else if (!isInteractive) {
          out(
            "daemon started (no interactive terminal to attach to). Attach with 'conduct daemon connect'.",
          );
        } else {
          await supervisor.attach(cwd, { readOnly: true });
        }
        break;
      case 'stop':
        await supervisor.stop(cwd);
        break;
      case 'restart': {
        // FR-9/FR-11 (adr-2026-07-04-pending-restart-queue): idle or paused →
        // respawn immediately (paused counts as idle — the pause marker is
        // repo state and is never touched by restart). Busy → this command
        // never blocks/polls; it durably queues the intent and returns at
        // once, naming the in-flight feature it is waiting behind. The
        // daemon fires the queued restart itself at its next idle boundary
        // (a later call site consumes the marker on boot either way).
        const paused = await isPaused(cwd);
        const busyCheck = paused ? { busy: false as const } : await isBusy(cwd);

        if (busyCheck.busy) {
          await writeRestartPending(cwd, { blockingSlug: busyCheck.blockingSlug });
          out(
            `restart queued: daemon is busy on ${busyCheck.blockingSlug ?? '(unknown feature)'}; ` +
              'it will restart automatically once idle.',
          );
          break;
        }

        // Handoff (FR-8): proactively clear any stale (dead-pid) or absent
        // lock BEFORE the tmux-level respawn, using ONLY the existing
        // acquire/reclaim primitives (daemon-lock.ts, no new lock semantics).
        // A live owner is left untouched — that's the process the respawn is
        // about to kill; its own next-boot holdLock() reclaims once it is
        // actually dead. This also closes the FR-8 race window: a concurrent
        // ensureRunning racing the same repo is arbitrated by the same O_EXCL
        // primitive, so restart + ensureRunning never yield two daemons.
        await clearStaleLockForRestart(cwd, kill);

        // Orphan reconciliation (FR-21 neg, Task 34): detect and cleanup any orphaned
        // process (pidfile alive, session gone) before respawn. Skipped in bare-run
        // mode (no supervisor provided) since bare-run has no tmux sessions.
        if (!bareRun) {
          const orphanPid = await reconcileOrphan(cwd, supervisor, kill);
          if (orphanPid) {
            out(`orphaned daemon process (pid ${orphanPid}) terminated; lock reclaimed.`);
          }
        }

        const outcome = await supervisor.restart(cwd);
        // Always surface the outcome — degraded restarts (fallback kill+recreate)
        // MUST be reported explicitly so the operator knows scrollback/session
        // continuity was lost (FR-20 neg, Task 24).
        out(outcome.message);
        break;
      }
      case 'connect':
        await supervisor.attach(cwd, { readOnly: true });
        break;
      case 'debug':
        await supervisor.attach(cwd, { readOnly: false });
        break;
      case 'pause':
        if (await isPaused(cwd)) {
          out('already paused');
        } else {
          await writePauseMarker(cwd);
          out('daemon paused');
        }
        break;
      case 'resume':
        if (!(await isPaused(cwd))) {
          out('not paused');
        } else {
          await removePauseMarker(cwd);
          out('daemon resumed');
        }
        break;
    }
    return 0;
  } catch (err) {
    // Both TmuxNotInstalledError and generic errors get the same treatment:
    // surface the message and return non-zero so the caller can process.exit.
    out((err as Error).message);
    return 1;
  }
}
