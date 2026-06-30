// daemon-supervisor-cli.ts — CLI dispatcher for the `conduct daemon <management-verb>`
// family of commands (start / stop / restart / connect / debug).
//
// The Supervisor port (makeTmuxSupervisor) is injected via DaemonSupervisorDeps so
// tests can supply a spy without spawning a real tmux process.  The default dep
// (makeTmuxSupervisor()) is only resolved at call time to avoid importing the
// supervisor runtime eagerly.

import { makeTmuxSupervisor, TmuxNotInstalledError, type Supervisor } from './daemon-tmux.js';
import type { DaemonSupervisorCommand } from './daemon-command.js';
import { ensureInstallFresh } from './install-freshness.js';

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
  const supervisor = deps.supervisor ?? makeTmuxSupervisor();
  const cwd = deps.cwd ?? process.cwd();
  const out = deps.out ?? ((l: string) => console.log(l));
  const ensureFresh = deps.ensureFresh ?? (() => ensureInstallFresh({ log: out }));
  const isInteractive = deps.isInteractive ?? Boolean(process.stdin.isTTY);

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
      case 'restart':
        await supervisor.restart(cwd);
        break;
      case 'connect':
        await supervisor.attach(cwd, { readOnly: true });
        break;
      case 'debug':
        await supervisor.attach(cwd, { readOnly: false });
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
