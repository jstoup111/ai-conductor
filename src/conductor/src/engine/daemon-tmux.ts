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
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';

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

/** High-level lifecycle port for managing a per-repo daemon tmux session. */
export interface Supervisor {
  /** Returns true when a session for this repo is currently alive. */
  isUp(repo: string): Promise<boolean>;
  /** Ensures a daemon session exists (idempotent — no-op when already running). */
  start(repo: string): Promise<void>;
  /** Kills the daemon session (no-op when not running). */
  stop(repo: string): Promise<void>;
  /** Kills then re-creates the daemon session. */
  restart(repo: string): Promise<void>;
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
      try {
        return await hasSession(sessionNameForRepo(repo), run);
      } catch {
        return false;
      }
    },

    async start(repo: string): Promise<void> {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      if (await hasSession(name, run)) {
        return; // already running — idempotent
      }
      await newDetachedSession(name, DAEMON_FOREGROUND_COMMAND, repo, run);
    },

    async stop(repo: string): Promise<void> {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      await killSession(name, run);
    },

    async restart(repo: string): Promise<void> {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      await killSession(name, run);
      await newDetachedSession(name, DAEMON_FOREGROUND_COMMAND, repo, run);
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
