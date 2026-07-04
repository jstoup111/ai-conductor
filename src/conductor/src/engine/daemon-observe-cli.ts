// daemon-observe-cli.ts — Read-only daemon observability: `conduct daemon status`
// and `conduct daemon logs`.
//
//   status — iterate the project registry; for each repo report pidfile liveness
//            (running / stale / stopped), pid, start time, and last log activity.
//   logs   — print or `--follow` a repo's `.daemon/daemon.log` (one repo, or
//            `--all` registered repos).
//
// Both are non-interactive subcommands dispatched before the pipeline boots
// (mirroring registry-cli's detect/dispatch). They reuse the daemon-lock pidfile
// primitives (`isLive`, `readPidRecord`) and the daemon-log readers — they never
// re-encode the pidfile path or write anything.

import { stat } from 'node:fs/promises';
import { isLive, readPidRecord, type KillProbe } from './daemon-lock.js';
import { resolveRegistryPath, readRegistry, type ProjectRecord } from './registry.js';
import { tailDaemonLog, followDaemonLog, daemonLogPath } from './daemon-log.js';
import { hasSession, sessionNameForRepo } from './daemon-tmux.js';
import { isPaused, readPauseMetadata } from './pause-marker.js';

// Default session probe — routed through daemon-tmux's `hasSession` so ALL tmux
// argv + session-name encoding stays inside daemon-tmux.ts (ADR-014 boundary).
// Wrapped in try/catch: a missing tmux throws TmuxNotInstalledError, which must
// surface as "no session" (false), never crash the status sweep or the bare-run path.
async function defaultSessionProbe(repoPath: string): Promise<boolean> {
  try {
    return await hasSession(sessionNameForRepo(repoPath));
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// status
// ─────────────────────────────────────────────────────────────────────────────

export type DaemonLiveness =
  | 'running' // pidfile present, owner pid alive
  | 'stale' // pidfile present, owner pid dead (reclaimable)
  | 'stopped' // no pidfile (or corrupt → treated as absent)
  | 'path-missing' // registered repo dir no longer exists
  | 'unreadable'; // could not inspect the repo (permission, etc.)

/**
 * Explicit fleet-state enum (FR-5). Derived from `DaemonLiveness` × the durable
 * pause marker (`pause-marker.ts`). `paused_dead` is the composite: the marker
 * is present AND the pidfile owner is dead (`stale`) — an operator needs to see
 * BOTH facts (paused intent + a reclaimable pidfile), not just one.
 */
export type DaemonState =
  | 'running'
  | 'paused'
  | 'paused_dead'
  | 'stopped'
  | 'stale'
  | 'path-missing'
  | 'unreadable';

/**
 * Total, exhaustive mapping from liveness + pause flag to state. No `default`
 * arm: if `DaemonLiveness` ever gains a member, this switch fails to compile
 * until handled here (AC5).
 */
function computeState(liveness: DaemonLiveness, paused: boolean): DaemonState {
  switch (liveness) {
    case 'running':
      return paused ? 'paused' : 'running';
    case 'stale':
      return paused ? 'paused_dead' : 'stale';
    case 'stopped':
      return paused ? 'paused' : 'stopped';
    case 'path-missing':
      return 'path-missing';
    case 'unreadable':
      return 'unreadable';
  }
}

export interface DaemonStatusRow {
  name: string;
  path: string;
  liveness: DaemonLiveness;
  /** Explicit fleet state (FR-5) — see `DaemonState`. */
  state: DaemonState;
  pid?: number;
  startedAt?: string;
  lastActivity?: string;
  lastActivityAt?: string;
  detail?: string;
  /** True when a tmux session for this repo is currently alive (FR-10). */
  sessionPresent: boolean;
  /** Informational pause metadata (never authoritative — see pause-marker.ts). */
  pausedAt?: string;
  pausedBy?: string;
}

export interface DaemonStatusDeps {
  /** Override registry path (tests). Defaults to resolveRegistryPath(). */
  registryPath?: string;
  /** Injectable liveness probe (tests). Forwarded to isLive. */
  kill?: KillProbe;
  /** Output sink (tests). Defaults to console.log. */
  out?: (line: string) => void;
}

/**
 * Compute one status row for a registered project. Never throws.
 *
 * @param record          — project registry entry.
 * @param kill            — injectable kill probe (forwarded to isLive; tests inject a spy).
 * @param hasSessionProbe — injectable tmux session probe `(repoPath) => boolean`.
 *                          Defaults to a spawnSync tmux has-session check.
 *                          sessionPresent is INDEPENDENT of liveness — the probe is always
 *                          called so stale+session and stale+no-session are distinguishable.
 */
export async function computeStatusRow(
  record: ProjectRecord,
  kill?: KillProbe,
  hasSessionProbe?: (repoPath: string) => boolean | Promise<boolean>,
): Promise<DaemonStatusRow> {
  const probe = hasSessionProbe ?? defaultSessionProbe;
  const base = { name: record.name, path: record.path };
  try {
    // The registry can outlive the repo it points at (deleted / moved).
    try {
      await stat(record.path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return {
          ...base,
          liveness: 'path-missing',
          state: computeState('path-missing', false),
          sessionPresent: false,
        };
      }
      return {
        ...base,
        liveness: 'unreadable',
        state: computeState('unreadable', false),
        detail: (err as Error).message,
        sessionPresent: false,
      };
    }

    const rec = await readPidRecord(record.path);
    let liveness: DaemonLiveness;
    let pid: number | undefined;
    let startedAt: string | undefined;
    if (rec === null) {
      // No pidfile, or a corrupt one (readPidRecord shape-guards → null). Both
      // mean "no live daemon owns this repo" from an observer's standpoint.
      liveness = 'stopped';
    } else {
      pid = rec.pid;
      startedAt = rec.startedAt;
      liveness = isLive(rec.pid, kill) ? 'running' : 'stale';
    }

    // sessionPresent is independent of liveness — probe always runs so that a
    // stale pidfile with a live orphaned tmux session is distinguishable from
    // a stale pidfile with no session (operator can inspect/adopt the former).
    const sessionPresent = await probe(record.path);

    // Pause is read via the existence-authoritative `isPaused` (fail-closed —
    // a corrupt/unreadable marker is still "paused", never mistaken for "not
    // paused"). Metadata (pausedAt/by) is best-effort informational only —
    // `readPauseMetadata` returns undefined on missing/corrupt content and
    // must never throw or block the row.
    const paused = await isPaused(record.path);
    const pauseMeta = paused ? await readPauseMetadata(record.path) : undefined;
    const state = computeState(liveness, paused);

    const row: DaemonStatusRow = {
      ...base,
      liveness,
      state,
      pid,
      startedAt,
      sessionPresent,
      ...(pauseMeta?.pausedAt !== undefined ? { pausedAt: pauseMeta.pausedAt } : {}),
      ...(pauseMeta?.pausedBy !== undefined ? { pausedBy: pauseMeta.pausedBy } : {}),
    };
    const tail = await tailDaemonLog(record.path, 1);
    if (tail.status === 'ok' && tail.lines.length > 0) {
      row.lastActivity = tail.lines[tail.lines.length - 1];
      row.lastActivityAt = tail.mtime.toISOString();
    } else if (tail.status === 'unreadable') {
      row.detail = `log unreadable: ${tail.error}`;
    }
    return row;
  } catch (err) {
    // Defensive: a single bad repo must never crash the whole sweep.
    return {
      ...base,
      liveness: 'unreadable',
      state: computeState('unreadable', false),
      detail: (err as Error).message,
      sessionPresent: false,
    };
  }
}

const STATE_BADGE: Record<DaemonState, string> = {
  running: '● running',
  paused: '⏸ paused',
  paused_dead: '⏸ paused (process dead)',
  stale: '○ stale',
  stopped: '· stopped',
  'path-missing': '✗ path missing',
  unreadable: '✗ unreadable',
};

function formatStatusRow(row: DaemonStatusRow): string {
  const parts = [`${STATE_BADGE[row.state]}  ${row.name}`, `  ${row.path}`];
  if (row.pid !== undefined) parts.push(`  pid ${row.pid}`);
  if (row.startedAt) parts.push(`  since ${row.startedAt}`);
  if (row.pausedAt) {
    const by = row.pausedBy ? ` by ${row.pausedBy}` : '';
    parts.push(`  paused ${row.pausedAt}${by}`);
  }
  if (row.lastActivity) {
    const at = row.lastActivityAt ? ` (${row.lastActivityAt})` : '';
    parts.push(`  last${at}: ${row.lastActivity}`);
  }
  parts.push(`  session:${row.sessionPresent ? 'up' : 'down'}`);
  if (row.detail) parts.push(`  — ${row.detail}`);
  return parts.join('');
}

/**
 * `conduct daemon status` — read-only sweep of the registry. Always exits 0
 * (stale/missing entries are reported, not errors). Returns the rows for testing.
 */
export async function runDaemonStatus(
  deps: DaemonStatusDeps = {},
): Promise<{ code: number; rows: DaemonStatusRow[] }> {
  const out = deps.out ?? ((l: string) => console.log(l));
  const registryPath = deps.registryPath ?? resolveRegistryPath();

  let records: ProjectRecord[];
  try {
    records = await readRegistry(registryPath);
  } catch (err) {
    out(`Could not read registry at ${registryPath}: ${(err as Error).message}`);
    return { code: 1, rows: [] };
  }

  if (records.length === 0) {
    out('No projects registered. Use `conduct register [path]` to add one.');
    return { code: 0, rows: [] };
  }

  const rows: DaemonStatusRow[] = [];
  for (const record of records) {
    const row = await computeStatusRow(record, deps.kill);
    rows.push(row);
    out(formatStatusRow(row));
  }
  return { code: 0, rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// logs
// ─────────────────────────────────────────────────────────────────────────────

export interface DaemonLogsArgs {
  /** Target repo path; defaults to cwd. Ignored when `all` is set. */
  repo?: string;
  follow: boolean;
  all: boolean;
  /** Lines to show (non-follow). Defaults to all current-file lines. */
  lines?: number;
}

export interface DaemonLogsDeps {
  registryPath?: string;
  cwd?: string;
  out?: (line: string) => void;
  /** Resolve when following should stop (tests). Defaults to a SIGINT promise. */
  untilStop?: Promise<void>;
}

/** Print the tail of one repo's log to `out`. Returns an exit-code contribution. */
async function printRepoTail(
  repoPath: string,
  lines: number,
  out: (l: string) => void,
  withHeader: boolean,
): Promise<number> {
  if (withHeader) out(`==> ${repoPath} <==`);
  const res = await tailDaemonLog(repoPath, lines);
  if (res.status === 'missing') {
    out(`(no daemon log yet for ${repoPath})`);
    return 0;
  }
  if (res.status === 'unreadable') {
    out(`Could not read daemon log for ${repoPath}: ${res.error}`);
    return 1;
  }
  for (const line of res.lines) out(line);
  return 0;
}

/**
 * `conduct daemon logs [--repo <p>] [--follow] [--all]`. Reads `.daemon/daemon.log`
 * for one repo (default cwd) or every registered repo (`--all`). `--follow`
 * streams appended lines (single repo only) until interrupted.
 */
export async function runDaemonLogs(
  args: DaemonLogsArgs,
  deps: DaemonLogsDeps = {},
): Promise<number> {
  const out = deps.out ?? ((l: string) => console.log(l));
  const cwd = deps.cwd ?? process.cwd();
  const lines = args.lines ?? 0; // 0 → all current-file lines

  if (args.all) {
    const registryPath = deps.registryPath ?? resolveRegistryPath();
    let records: ProjectRecord[];
    try {
      records = await readRegistry(registryPath);
    } catch (err) {
      out(`Could not read registry at ${registryPath}: ${(err as Error).message}`);
      return 1;
    }
    if (records.length === 0) {
      out('No projects registered.');
      return 0;
    }
    if (args.follow) {
      out('--follow is not supported with --all; showing a static snapshot.');
    }
    let code = 0;
    for (const record of records) {
      code = (await printRepoTail(record.path, lines, out, true)) || code;
    }
    return code;
  }

  const target = args.repo ?? cwd;
  const code = await printRepoTail(target, lines, out, false);

  if (args.follow) {
    // Follow from current EOF so only newly-appended lines stream.
    let startOffset = 0;
    try {
      startOffset = (await stat(daemonLogPath(target))).size;
    } catch {
      startOffset = 0; // log not created yet — follow from the top
    }
    const handle = followDaemonLog(target, (l) => out(l), { startOffset });
    const stop = deps.untilStop ?? waitForSigint();
    await stop;
    handle.stop();
  }

  return code;
}

/** Resolve when the user presses Ctrl-C (SIGINT). Used to end `logs --follow`. */
function waitForSigint(): Promise<void> {
  return new Promise<void>((resolve) => {
    process.once('SIGINT', () => resolve());
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// dispatch — mirrors registry-cli's detect/dispatch (hand-rolled argv parsing)
// ─────────────────────────────────────────────────────────────────────────────

export type DaemonDispatch =
  | { kind: 'status' }
  | { kind: 'logs'; repo?: string; follow: boolean; all: boolean };

/**
 * Detect a `conduct daemon <status|logs …>` observability sub-subcommand. Returns
 * null for anything else — including the bare `conduct daemon …` *run* command
 * (handled by `detectDaemonCommand` in daemon-command.ts), which has no
 * `status`/`logs` second positional. index.ts checks this BEFORE the run command
 * so `daemon status`/`logs` are never dispatched as a daemon launch.
 */
export function detectDaemonObserveCommand(argv: string[]): DaemonDispatch | null {
  const args = argv.slice(2);
  if (args[0] !== 'daemon') return null;
  const sub = args[1];
  if (sub === 'status') return { kind: 'status' };
  if (sub === 'logs') {
    const rest = args.slice(2);
    let repo: string | undefined;
    let follow = false;
    let all = false;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--follow' || a === '-f') follow = true;
      else if (a === '--all') all = true;
      else if (a === '--repo') {
        repo = rest[i + 1];
        i++;
      } else if (a.startsWith('--repo=')) {
        repo = a.slice('--repo='.length);
      }
    }
    return { kind: 'logs', repo, follow, all };
  }
  return null;
}

export async function dispatchDaemonObserve(d: DaemonDispatch): Promise<number> {
  if (d.kind === 'status') {
    const { code } = await runDaemonStatus();
    return code;
  }
  return runDaemonLogs({ repo: d.repo, follow: d.follow, all: d.all });
}
