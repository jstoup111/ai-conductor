// daemon-tmux.ts — Tmux adapter and Supervisor port for per-repo daemon hosting.
//
// ALL tmux subcommand calls and session-name encoding live exclusively in this
// module. Callers use ONLY the exported Supervisor port and the low-level helpers
// listed below; they never build tmux argv or session names directly.
//
// Design (ADR-014):
//   - TmuxRunner  — injectable function that calls tmux; default uses spawnSync.
//   - sessionNameForRepo — deterministic, collision-resistant name from repo path.
//   - Low-level helpers (hasSession, newDetachedSession, killSession, attachSession,
//     capturePane, sendKeys) — one helper per tmux subcommand; no logic, no state.
//   - tmuxInstalled / requireTmux — availability probes; gate every Supervisor call.
//   - makeTmuxSupervisor — factory returning a Supervisor port over the injected runner.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Constants — only place that encodes the session prefix and foreground command.
// ─────────────────────────────────────────────────────────────────────────────
export const SESSION_PREFIX = 'cc-daemon-';
export const DAEMON_FOREGROUND_COMMAND = 'conduct-ts daemon --continuous';

// ─────────────────────────────────────────────────────────────────────────────
// TmuxRunner — injectable execution boundary (allows deterministic unit tests).
// ─────────────────────────────────────────────────────────────────────────────

/** Callable that executes tmux with the given argv and returns exit code + stdout. */
export type TmuxRunner = (
  args: string[],
  opts: { inherit: boolean },
) => { code: number; stdout: string };

// ─────────────────────────────────────────────────────────────────────────────
// TmuxNotInstalledError — exported so callers can instanceof-check without
// coupling to the error message string.
// ─────────────────────────────────────────────────────────────────────────────

export class TmuxNotInstalledError extends Error {
  constructor() {
    super('tmux is not installed or not found on PATH. Please install tmux to use daemon hosting.');
    this.name = 'TmuxNotInstalledError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// defaultTmuxRunner — real tmux execution via spawnSync.
// ─────────────────────────────────────────────────────────────────────────────

export const defaultTmuxRunner: TmuxRunner = (args, opts) => {
  const result = spawnSync('tmux', args, {
    stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new TmuxNotInstalledError();
    }
    throw result.error;
  }
  // When stdio is 'inherit', stdout is not captured (null) — that is expected for
  // attach-session where the terminal takes over. Callers that pass inherit:true
  // never inspect stdout.
  return { code: result.status ?? 1, stdout: (result.stdout as string | null) ?? '' };
};

// ─────────────────────────────────────────────────────────────────────────────
// sessionNameForRepo — deterministic, collision-resistant tmux session name.
//
// Format: cc-daemon-<slug>-<6hexhash>
//   slug    = lowercased basename of the absolute repo path; non-alphanumerics → '-';
//             leading/trailing '-' trimmed.
//   6hexhash = first 6 hex chars of sha1(absolutePath) — distinguishes two repos
//              that share the same basename (e.g. /alice/app vs /bob/app).
//
// The resulting name never contains ':' (tmux target separator) or '.'
// (tmux window separator) because the slug replaces them with '-' and the hash
// is pure lowercase hex.
// ─────────────────────────────────────────────────────────────────────────────

export function sessionNameForRepo(repoPath: string): string {
  const abs = resolve(repoPath);
  const slug = basename(abs)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const hash = createHash('sha1').update(abs).digest('hex').slice(0, 6);
  return `${SESSION_PREFIX}${slug}-${hash}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level helpers — one thin wrapper per tmux subcommand. No logic, no state.
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true when the named tmux session exists. */
export async function hasSession(
  name: string,
  run: TmuxRunner = defaultTmuxRunner,
): Promise<boolean> {
  return run(['has-session', '-t', `=${name}`], { inherit: false }).code === 0;
}

/**
 * Creates a new detached tmux session running `command` in `cwd`.
 * Throws if tmux exits non-zero (session name conflict, invalid cwd, etc.).
 */
export async function newDetachedSession(
  name: string,
  command: string,
  cwd: string,
  run: TmuxRunner = defaultTmuxRunner,
): Promise<void> {
  const result = run(
    ['new-session', '-d', '-s', name, '-c', cwd, command],
    { inherit: false },
  );
  if (result.code !== 0) {
    throw new Error(`tmux new-session exited with code ${result.code} for session "${name}"`);
  }
}

/**
 * Kills the named tmux session. Never throws on non-zero — an absent session
 * is treated as a no-op (idempotent kill).
 */
export async function killSession(
  name: string,
  run: TmuxRunner = defaultTmuxRunner,
): Promise<void> {
  run(['kill-session', '-t', `=${name}`], { inherit: false });
  // Non-zero exit (absent session) is silently ignored — callers must not throw.
}

/**
 * Attaches the current terminal to the named tmux session.
 * Pass `readOnly: true` to append '-r' (watch-only, no input).
 * Uses inherit:true so the terminal hands over to tmux.
 */
export async function attachSession(
  name: string,
  opts: { readOnly?: boolean } = {},
  run: TmuxRunner = defaultTmuxRunner,
): Promise<void> {
  const args = ['attach-session', '-t', `=${name}`];
  if (opts.readOnly) {
    args.push('-r');
  }
  run(args, { inherit: true });
}

/**
 * Captures the visible pane content of the named session.
 * Returns stdout on success; empty string when the session is absent or
 * tmux exits non-zero (never throws).
 */
export async function capturePane(
  name: string,
  run: TmuxRunner = defaultTmuxRunner,
): Promise<string> {
  // Pane-targeting verbs need `=<session>:` (exact session match + active window/
  // pane). A bare `=<session>` is a session target — accepted by has-session /
  // kill-session / attach but REJECTED by capture-pane ("can't find pane") against
  // real tmux. The trailing ':' resolves to the session's active pane.
  const result = run(['capture-pane', '-p', '-t', `=${name}:`], { inherit: false });
  return result.code === 0 ? result.stdout : '';
}

/**
 * Sends `command` followed by Enter to the named tmux session's active pane.
 * Equivalent to typing the command in the session.
 */
export async function sendKeys(
  name: string,
  command: string,
  run: TmuxRunner = defaultTmuxRunner,
): Promise<void> {
  // Pane-targeting verb: `=<session>:` (active pane), not the bare session target.
  run(['send-keys', '-t', `=${name}:`, command, 'Enter'], { inherit: false });
}

/**
 * Returns true when the daemon's pane (window 0 / pane 0 — the single pane
 * created by newDetachedSession) is dead, i.e. the tmux session still exists
 * but the foreground process inside it has exited (and remain-on-exit kept
 * the pane open instead of tearing down the session).
 *
 * Distinguishes "session up" from "process alive" (FR-12, FR-21): a session
 * can be up with a dead pane, which callers must treat differently from both
 * a fully-running daemon and a fully-absent session.
 *
 * Returns false — never throws — when the pane can't be queried (e.g. the
 * session/pane doesn't exist); callers only invoke this after confirming
 * hasSession is true, so a non-zero exit here is treated as "not dead" rather
 * than surfacing a spurious error.
 */
export async function isPaneDead(
  name: string,
  run: TmuxRunner = defaultTmuxRunner,
): Promise<boolean> {
  // Use =${name}: to target the session's active pane (works regardless of base-index).
  const result = run(
    ['list-panes', '-t', `=${name}:`, '-F', '#{pane_dead}'],
    { inherit: false },
  );
  return result.code === 0 && result.stdout.trim() === '1';
}

/**
 * Sets the `remain-on-exit` window option so the daemon pane survives after its
 * foreground process exits, instead of the window/session closing out from
 * under us. Session-scoped target (`=<name>`) — never touches other sessions.
 */
export async function setRemainOnExit(
  name: string,
  run: TmuxRunner = defaultTmuxRunner,
): Promise<void> {
  run(['set-option', '-t', `=${name}`, 'remain-on-exit', 'on'], { inherit: false });
  // Non-zero exit is not fatal here — remain-on-exit is best-effort hardening;
  // the respawn-pane call below is the operation that must succeed or throw.
}

/**
 * Result of a respawnPane call. `scrollbackPreserved` is true when the prior
 * pane history was successfully captured and will be re-emitted above the
 * relaunched daemon's boot output; false when capture failed (or returned
 * nothing) and the pane was respawned bare — callers must not claim
 * scrollback preservation in that case (FR-20).
 */
export interface RespawnOutcome {
  scrollbackPreserved: boolean;
}

/**
 * Respawns the daemon pane in place (terminates the foreground process and
 * relaunches `cmd` in the SAME pane) without touching the session, window
 * layout, or any other pane. Targets the session's active pane (which is the
 * single pane created by newDetachedSession) so operator windows opened
 * later in the same session are never addressed.
 *
 * Uses respawn-pane -k to kill the existing process and re-run the command.
 * The -k flag handles killing the process; remain-on-exit (already set)
 * prevents the pane/window/session from closing.
 *
 * `respawn-pane -k` clears the pane's terminal scrollback (ADR-2026-07-04).
 * To preserve continuity, the pane's current history is captured via
 * `capture-pane -S - -p` into a temp file BEFORE respawning, and the
 * respawned command is wrapped so it re-emits that file's contents (then
 * deletes it) before exec'ing the real daemon command. This keeps the prior
 * output visible above the new process's boot messages. If capture fails for
 * any reason (tmux error, fs write error, empty scrollback), the pane is
 * respawned with the bare `cmd` — never a crash, but the caller is told via
 * the returned `scrollbackPreserved: false` so it can report the degradation
 * honestly instead of claiming scrollback was kept.
 *
 * Throws if the respawn-pane call itself exits non-zero (e.g. the targeted
 * pane no longer exists) — that is a real restart failure, distinct from a
 * scrollback-capture failure, which only degrades the outcome.
 */
export async function respawnPane(
  name: string,
  run: TmuxRunner = defaultTmuxRunner,
  cmd: string = DAEMON_FOREGROUND_COMMAND,
): Promise<RespawnOutcome> {
  let wrappedCmd = cmd;
  let scrollbackPreserved = false;
  let scrollbackFile: string | undefined;

  try {
    const capture = run(['capture-pane', '-S', '-', '-p', '-t', `=${name}:`], { inherit: false });
    if (capture.code === 0 && capture.stdout.length > 0) {
      scrollbackFile = join(
        tmpdir(),
        `cc-daemon-scrollback-${name}-${randomBytes(6).toString('hex')}.txt`,
      );
      writeFileSync(scrollbackFile, capture.stdout, 'utf-8');
      // Re-emit the captured history, remove the temp file, then exec the
      // real daemon command — all inside the respawned pane's own process,
      // so cleanup happens regardless of how the daemon itself behaves.
      wrappedCmd = `cat ${scrollbackFile}; rm -f ${scrollbackFile}; exec ${cmd}`;
      scrollbackPreserved = true;
    }
  } catch {
    // Capture or temp-file write failed — degrade gracefully to a bare
    // respawn rather than aborting the restart over a non-essential step.
    scrollbackPreserved = false;
    wrappedCmd = cmd;
    if (scrollbackFile) {
      try {
        unlinkSync(scrollbackFile);
      } catch {
        // best-effort cleanup only
      }
    }
  }

  const result = run(['respawn-pane', '-k', '-t', `=${name}:`, wrappedCmd], { inherit: false });
  if (result.code !== 0) {
    // The wrapped command never ran, so its inline `rm` never fired — clean
    // up here instead of leaking the temp file.
    if (scrollbackFile) {
      try {
        unlinkSync(scrollbackFile);
      } catch {
        // best-effort cleanup only
      }
    }
    throw new Error(`tmux respawn-pane exited with code ${result.code} for session "${name}"`);
  }
  return { scrollbackPreserved };
}

// ─────────────────────────────────────────────────────────────────────────────
// tmuxInstalled / requireTmux — availability probes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when `tmux -V` exits 0 (tmux is on PATH and responsive).
 * Returns false — never throws — when the runner throws TmuxNotInstalledError.
 * Re-throws any other error.
 */
export async function tmuxInstalled(run: TmuxRunner = defaultTmuxRunner): Promise<boolean> {
  try {
    return run(['-V'], { inherit: false }).code === 0;
  } catch (err) {
    if (err instanceof TmuxNotInstalledError) {
      return false;
    }
    throw err;
  }
}

/**
 * Throws TmuxNotInstalledError when tmux is not available.
 * Called at the top of every Supervisor method that needs tmux.
 */
export async function requireTmux(run: TmuxRunner = defaultTmuxRunner): Promise<void> {
  if (!(await tmuxInstalled(run))) {
    throw new TmuxNotInstalledError();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supervisor port — the stable interface callers program against.
// makeTmuxSupervisor returns an implementation backed by the injected runner.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Outcome of a `restart` call. `degraded: true` means the in-place respawn
 * failed and the Supervisor fell back to kill-session + new-session — the
 * daemon is running again, but tmux scrollback/session continuity was lost.
 * `message` is a human-readable explanation, always present so callers can
 * surface it verbatim regardless of `degraded`.
 */
export interface RestartOutcome {
  degraded: boolean;
  message: string;
}

/** High-level lifecycle port for managing a per-repo daemon tmux session. */
export interface Supervisor {
  /** Returns true when a session for this repo is currently alive. */
  isUp(repo: string): Promise<boolean>;
  /**
   * Returns true when a tmux session for this repo currently exists, WITHOUT
   * regard to whether the pane inside it is alive (distinct from `isUp`,
   * which also checks pane liveness). Used by orphan reconciliation (FR-21
   * neg, Task 34) to detect "daemon process alive, tmux session gone" —
   * a different case from the dead-pane revival handled by `start`/`isUp`
   * (Task 23), where the session still exists but its pane does not.
   * Throws TmuxNotInstalledError when tmux is unavailable, same as every
   * other management verb — callers must not swallow that as "no session".
   */
  hasSession(repo: string): Promise<boolean>;
  /** Ensures a daemon session exists (idempotent — no-op when already running). */
  start(repo: string): Promise<void>;
  /** Kills the daemon session (no-op when not running). */
  stop(repo: string): Promise<void>;
  /**
   * Kills then re-creates the daemon session. Prefers an in-place pane
   * respawn (preserves session/window and any operator panes); falls back to
   * kill-session + new-session, with an explicit degraded outcome, when the
   * respawn tooling fails.
   */
  restart(repo: string): Promise<RestartOutcome>;
  /** Attaches the terminal to the daemon session. Pass readOnly:true to watch. */
  attach(repo: string, opts?: { readOnly?: boolean }): Promise<void>;
  /** Returns a snapshot of the session's visible pane output (the daemon log). */
  logs(repo: string): Promise<string>;
  /** Sends a shell command to the running daemon session. */
  exec(repo: string, cmd: string): Promise<void>;
}

/**
 * makeTmuxSupervisor — factory that binds the Supervisor port to the injected runner.
 *
 * All methods:
 *   1. Derive the session name from the repo path via sessionNameForRepo.
 *   2. Call requireTmux to gate on tmux availability (fails fast with actionable error).
 *   3. Delegate to the appropriate low-level helper.
 *
 * @param run - Injectable TmuxRunner (default: defaultTmuxRunner). Inject a spy in tests.
 */
export function makeTmuxSupervisor(run: TmuxRunner = defaultTmuxRunner): Supervisor {
  return {
    async isUp(repo: string): Promise<boolean> {
      // Crash-safe: a tmux-less host throws TmuxNotInstalledError from the runner.
      // "no tmux ⇒ no session ⇒ not up" is the correct answer and must never throw
      // out of a caller (bare-run invariant — isUp is a read, not a management verb).
      //
      // "Up" means the daemon process is actually alive, not merely that the
      // tmux session exists (FR-12/FR-21): a session can persist with a dead
      // pane after the foreground process exits, and that must read as down.
      try {
        const name = sessionNameForRepo(repo);
        if (!(await hasSession(name, run))) {
          return false;
        }
        return !(await isPaneDead(name, run));
      } catch {
        return false;
      }
    },

    async hasSession(repo: string): Promise<boolean> {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      return hasSession(name, run);
    },

    async start(repo: string): Promise<void> {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      if (await hasSession(name, run)) {
        // Session exists but the process inside it may have died while
        // remain-on-exit kept the pane (and session) open. Revive in place
        // rather than creating a second session or silently no-op'ing.
        if (await isPaneDead(name, run)) {
          await setRemainOnExit(name, run);
          await respawnPane(name, run);
        }
        return; // already running (or just revived) — idempotent
      }
      await newDetachedSession(name, DAEMON_FOREGROUND_COMMAND, repo, run);
    },

    async stop(repo: string): Promise<void> {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      await killSession(name, run);
    },

    async restart(repo: string): Promise<RestartOutcome> {
      // Respawn-in-place (ADR-014, FR-20): the session and its window are left
      // alone — only the daemon's own pane is torn down and relaunched. This
      // preserves any operator windows/panes attached to the same session and
      // avoids the kill+recreate churn (and the brief window where the session
      // does not exist) of the old implementation. NO kill-session in the
      // happy path.
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      await setRemainOnExit(name, run);
      try {
        const { scrollbackPreserved } = await respawnPane(name, run);
        return {
          degraded: false,
          message: scrollbackPreserved
            ? 'daemon restarted in place (session preserved, scrollback preserved).'
            : 'daemon restarted in place (session preserved); scrollback unavailable ' +
              '(history capture failed, prior pane output was not carried forward).',
        };
      } catch (err) {
        // Respawn tooling failed (e.g. the pane/window tmux expected no longer
        // exists). Fall back to a full kill+recreate so the daemon still ends
        // up running — but this loses the old session's scrollback/history,
        // so callers MUST be told explicitly (FR-20 neg, Task 24).
        await killSession(name, run);
        await newDetachedSession(name, DAEMON_FOREGROUND_COMMAND, repo, run);
        const reason = err instanceof Error ? err.message : String(err);
        return {
          degraded: true,
          message:
            `daemon restarted via fallback (kill-session + new-session): session continuity ` +
            `(scrollback/history) was lost because in-place respawn failed: ${reason}`,
        };
      }
    },

    async attach(repo: string, opts: { readOnly?: boolean } = {}): Promise<void> {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      if (!(await hasSession(name, run))) {
        throw new Error(
          `No daemon session found for "${repo}". Run 'conduct-ts daemon start' first.`,
        );
      }
      await attachSession(name, opts, run);
    },

    async logs(repo: string): Promise<string> {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      return capturePane(name, run);
    },

    async exec(repo: string, cmd: string): Promise<void> {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      await sendKeys(name, cmd, run);
    },
  };
}
