// brain-supervisor-cli.ts — `conduct-ts brain start|stop|status` CLI dispatcher
// (Task 18, background-intake-conduct-loop).
//
// Hosts the background intake loop (`conduct-ts intake-loop --continuous`,
// Task 17) under a dedicated tmux session — NO cron, no external scheduler.
// Reuses the existing tmux adapter primitives (hasSession / newDetachedSession
// / killSession from daemon-tmux.ts) rather than duplicating tmux argv/session
// handling; only the session-name prefix and foreground command differ from
// the per-repo daemon sessions.
//
// The brain loop is a single, host-wide singleton (unlike the per-repo daemon
// sessions keyed by sessionNameForRepo) — one `cc-brain-*` session serves every
// registered repo's intake, so brainStart/brainStop/brainStatus take no repo
// argument.
//
// `status` reads the durable status surface written by the notifier (Task 9)
// at `<engineerDir>/intake-status.json` and reports the most recent queued
// idea count alongside tmux-session liveness.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  hasSession,
  newDetachedSession,
  killSession,
  defaultTmuxRunner,
  type TmuxRunner,
} from './daemon-tmux.js';
import { resolveEngineerDir } from './engineer-store.js';

/** Session-name prefix for the brain loop's tmux session (ADR Q2 liveness gate). */
export const BRAIN_SESSION_PREFIX = 'cc-brain-';

/** Stable, host-wide session name — the brain loop is a singleton, not per-repo. */
export const BRAIN_SESSION_NAME = `${BRAIN_SESSION_PREFIX}conductor`;

/** Foreground command run inside the brain session (Task 17's entry point). */
export const BRAIN_FOREGROUND_COMMAND = 'conduct-ts intake-loop --continuous';

/** Shape of the status surface written by the notifier (Task 9); only the
 * fields this CLI reports are declared here. */
interface IntakeStatusSurface {
  count?: number;
}

/** Injectable dependencies — all optional so callers/tests can supply spies. */
export interface BrainCliDeps {
  /** Injectable tmux runner (tests supply a fake; default: defaultTmuxRunner). */
  run?: TmuxRunner;
  /** Working directory for the tmux session (start only). Default: process.cwd(). */
  cwd?: string;
  /** Output sink (tests capture lines; default: console.log). */
  out?: (line: string) => void;
  /** Directory containing intake-status.json (status only). Default: resolveEngineerDir({}). */
  engineerDir?: string;
  /**
   * Reads the raw status-surface file contents, or null when absent/unreadable.
   * Tests inject a fake; default reads the real file via fs.
   */
  readStatus?: (path: string) => Promise<string | null>;
}

async function defaultReadStatus(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * `conduct-ts brain start` — creates the `cc-brain-*` tmux session running the
 * intake loop, or reuses it if already up (idempotent: a second call never
 * creates a second session).
 */
export async function brainStart(deps: BrainCliDeps = {}): Promise<number> {
  const run = deps.run ?? defaultTmuxRunner;
  const cwd = deps.cwd ?? process.cwd();
  const out = deps.out ?? ((l: string) => console.log(l));

  try {
    if (await hasSession(BRAIN_SESSION_NAME, run)) {
      out('brain loop already running.');
      return 0;
    }
    await newDetachedSession(BRAIN_SESSION_NAME, BRAIN_FOREGROUND_COMMAND, cwd, run);
    out('brain loop started.');
    return 0;
  } catch (err) {
    out((err as Error).message);
    return 1;
  }
}

/**
 * `conduct-ts brain stop` — kills the brain session. Idempotent/graceful when
 * no session is running (killSession is a no-op on an absent session).
 */
export async function brainStop(deps: BrainCliDeps = {}): Promise<number> {
  const run = deps.run ?? defaultTmuxRunner;
  const out = deps.out ?? ((l: string) => console.log(l));

  try {
    await killSession(BRAIN_SESSION_NAME, run);
    out('brain loop stopped.');
    return 0;
  } catch (err) {
    out((err as Error).message);
    return 1;
  }
}

/**
 * `conduct-ts brain status` — reports liveness (running/stopped, from the
 * `cc-brain-*` tmux session) and the queued-work count from the durable
 * status surface written by the notifier (Task 9).
 */
export async function brainStatus(deps: BrainCliDeps = {}): Promise<number> {
  const run = deps.run ?? defaultTmuxRunner;
  const out = deps.out ?? ((l: string) => console.log(l));
  const engineerDir = deps.engineerDir ?? resolveEngineerDir({});
  const readStatus = deps.readStatus ?? defaultReadStatus;
  const statusPath = join(engineerDir, 'intake-status.json');

  try {
    const running = await hasSession(BRAIN_SESSION_NAME, run);
    out(`brain loop: ${running ? 'running' : 'stopped'}`);

    const raw = await readStatus(statusPath);
    let count = 0;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as IntakeStatusSurface;
        count = typeof parsed.count === 'number' ? parsed.count : 0;
      } catch {
        // Malformed status surface — best-effort, report 0 rather than crash.
        count = 0;
      }
    }
    out(`queued: ${count}`);
    return 0;
  } catch (err) {
    out((err as Error).message);
    return 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI wiring — argv detection + dispatch (mirrors daemon-command.ts's pattern).
// ─────────────────────────────────────────────────────────────────────────────

export type BrainCommand = { verb: 'start' | 'stop' | 'status' };

const BRAIN_VERBS = new Set(['start', 'stop', 'status']);

/**
 * Parse `process.argv` into a BrainCommand descriptor, or return null when
 * argv[2] is not `brain` or argv[3] is not a recognized verb.
 *
 * argv is process.argv: [node, entry, 'brain', verb].
 */
export function detectBrainCommand(argv: string[]): BrainCommand | null {
  if (argv[2] !== 'brain') return null;
  const verb = argv[3];
  if (!verb || !BRAIN_VERBS.has(verb)) return null;
  return { verb: verb as BrainCommand['verb'] };
}

/** Dispatch a parsed BrainCommand to the matching verb function. */
export async function dispatchBrain(cmd: BrainCommand, deps: BrainCliDeps = {}): Promise<number> {
  switch (cmd.verb) {
    case 'start':
      return brainStart(deps);
    case 'stop':
      return brainStop(deps);
    case 'status':
      return brainStatus(deps);
  }
}
