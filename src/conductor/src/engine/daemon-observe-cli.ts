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
import { basename, join } from 'node:path';
import { isLive, readPidRecord, type KillProbe } from './daemon-lock.js';
import { resolveRegistryPath, readRegistry, type ProjectRecord } from './registry.js';
import { tailDaemonLog, followDaemonLog, daemonLogPath } from './daemon-log.js';
import { hasSession, isPaneDead, sessionNameForRepo } from './daemon-tmux.js';
import { isPaused, readPauseMetadata } from './pause-marker.js';
import { readRestartPending, type RestartIntent } from './restart-marker.js';
import { isEngineVersionId } from './engine-store.js';
import { readGatedSnapshot, type GatedSpecItem, type GatedRepoItem, type Clock } from './gated-snapshot.js';
import { summarizeAccuracyLedger } from './attribution-audit.js';

/** Fallback label when a pidfile record has no `engineDir`, or its basename
 * isn't a recognized version id (legacy record, dev/unpublished run, etc.). */
const VERSION_UNKNOWN = 'version-unknown';

/**
 * Derive a version id label from a pidfile's `engineDir` (FR-14). Pure string
 * inspection only — never stats/reads `engineDir` on disk, so a dangling
 * engineDir (repo stopped, version GC'd) never errors here.
 */
function versionIdFromEngineDir(engineDir: string | undefined): string {
  if (!engineDir) return VERSION_UNKNOWN;
  const id = basename(engineDir);
  return isEngineVersionId(id) ? id : VERSION_UNKNOWN;
}

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

// Default pane-liveness probe (FR-12/FR-21 two-layer liveness) — mirrors
// `Supervisor.isUp`'s composition of hasSession + isPaneDead, but split out here
// so status can render "session-up/process-dead" distinctly from both plain
// running and plain stopped. Only meaningful (and only ever called) when the
// session is already known present; wrapped in try/catch so a missing tmux (or
// any probe failure) never crashes the status sweep — "not dead" is the safe
// default when we can't tell.
async function defaultPaneDeadProbe(repoPath: string): Promise<boolean> {
  try {
    return await isPaneDead(sessionNameForRepo(repoPath));
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
  | 'unreadable'
  /** FR-9: a restart is queued (`.daemon/RESTART-PENDING`), waiting on a busy slug. */
  | 'restart-pending'
  /** FR-12: tmux session exists but its pane has died — process is NOT up, even
   *  though the session persists. Must never be confused with `running`. */
  | 'dead-pane';

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
  /** True when the tmux session is present but its pane has died (FR-12). */
  paneDead?: boolean;
  /** Informational pause metadata (never authoritative — see pause-marker.ts). */
  pausedAt?: string;
  pausedBy?: string;
  /** Present when `.daemon/RESTART-PENDING` is queued (FR-9); never consumed here. */
  restartPending?: RestartIntent;
  /** Engine version id derived from the pidfile's `engineDir` (FR-14). Always
   *  set — "version-unknown" when absent/unrecognized (legacy record, no
   *  pidfile, dangling engineDir). */
  versionId: string;
}

export interface DaemonStatusDeps {
  /** Override registry path (tests). Defaults to resolveRegistryPath(). */
  registryPath?: string;
  /** Injectable liveness probe (tests). Forwarded to isLive. */
  kill?: KillProbe;
  /** Output sink (tests). Defaults to console.log. */
  out?: (line: string) => void;
  /** Injectable clock (tests) — used only for GATED-section freshness ("Nm ago"). */
  clock?: Clock;
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
 * @param paneDeadProbe    — injectable tmux pane-liveness probe `(repoPath) => boolean`
 *                          (FR-12 two-layer liveness). Only consulted when the session
 *                          is present — mirrors `Supervisor.isUp`'s composition.
 */
export async function computeStatusRow(
  record: ProjectRecord,
  kill?: KillProbe,
  hasSessionProbe?: (repoPath: string) => boolean | Promise<boolean>,
  paneDeadProbe?: (repoPath: string) => boolean | Promise<boolean>,
): Promise<DaemonStatusRow> {
  const probe = hasSessionProbe ?? defaultSessionProbe;
  const paneDeadCheck = paneDeadProbe ?? defaultPaneDeadProbe;
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
          versionId: VERSION_UNKNOWN,
        };
      }
      return {
        ...base,
        liveness: 'unreadable',
        state: computeState('unreadable', false),
        detail: (err as Error).message,
        sessionPresent: false,
        versionId: VERSION_UNKNOWN,
      };
    }

    const rec = await readPidRecord(record.path);
    let liveness: DaemonLiveness;
    let pid: number | undefined;
    let startedAt: string | undefined;
    // versionId is derived purely from the string value of engineDir (never
    // stat'd/read from disk) — a dangling engineDir for a stopped repo is
    // just a basename() call, never an fs error (AC3).
    const versionId = versionIdFromEngineDir(rec?.engineDir);
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
    // Pane-dead only means something when a session exists at all (mirrors
    // Supervisor.isUp: hasSession && !isPaneDead) — skip the probe otherwise.
    const paneDead = sessionPresent ? await paneDeadCheck(record.path) : false;

    // Pause is read via the existence-authoritative `isPaused` (fail-closed —
    // a corrupt/unreadable marker is still "paused", never mistaken for "not
    // paused"). Metadata (pausedAt/by) is best-effort informational only —
    // `readPauseMetadata` returns undefined on missing/corrupt content and
    // must never throw or block the row.
    const paused = await isPaused(record.path);
    const pauseMeta = paused ? await readPauseMetadata(record.path) : undefined;

    // Restart-pending (FR-9) and dead-pane (FR-12) are read-only overlays on
    // top of the base pidfile/pause state — they take precedence in the
    // rendered `state` because an operator needs to see them first, but the
    // underlying liveness/pause facts are still carried on the row untouched.
    const restartPending = (await readRestartPending(record.path)) ?? undefined;
    let state = computeState(liveness, paused);
    if (paneDead) state = 'dead-pane';
    if (restartPending) state = 'restart-pending';

    const row: DaemonStatusRow = {
      ...base,
      liveness,
      state,
      pid,
      startedAt,
      sessionPresent,
      paneDead,
      versionId,
      ...(pauseMeta?.pausedAt !== undefined ? { pausedAt: pauseMeta.pausedAt } : {}),
      ...(pauseMeta?.pausedBy !== undefined ? { pausedBy: pauseMeta.pausedBy } : {}),
      ...(restartPending !== undefined ? { restartPending } : {}),
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
      versionId: VERSION_UNKNOWN,
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
  'restart-pending': '⏳ restart-pending',
  'dead-pane': '⚠ session-up/process-dead',
};

function formatStatusRow(row: DaemonStatusRow): string {
  const badge =
    row.state === 'restart-pending' && row.restartPending?.blockingSlug
      ? `⏳ restart-pending (waiting on ${row.restartPending.blockingSlug})`
      : STATE_BADGE[row.state];
  const parts = [`${badge}  ${row.name}`, `  ${row.path}`];
  if (row.pid !== undefined) parts.push(`  pid ${row.pid}`);
  if (row.startedAt) parts.push(`  since ${row.startedAt}`);
  parts.push(`  version:${row.versionId}`);
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

/** Slug + reason + remedy line for a gated spec (owner named for `other-owner`), mirrors daemon-dashboard.ts's gatedSpecLine. */
function gatedSpecLine(g: GatedSpecItem): string {
  const owner = g.reason === 'other-owner' && g.otherOwner ? ` (owner: ${g.otherOwner})` : '';
  return `    • ${g.slug} — ${g.reason}${owner} — ${g.remedy}`;
}

/** Section-level warning line for a repo-scoped gated condition (no slug). */
function gatedRepoLine(g: GatedRepoItem): string {
  return `    ⚠ ${g.warning} — ${g.remedy}`;
}

/** Render a snapshot's `writtenAt` ISO timestamp as "Nm ago" relative to `now`. */
function formatGatedAge(writtenAt: string, now: Date): string {
  const writtenMs = Date.parse(writtenAt);
  if (Number.isNaN(writtenMs)) return 'unknown age';
  const minutes = Math.max(0, Math.floor((now.getTime() - writtenMs) / 60000));
  return `${minutes}m ago`;
}

/**
 * Render the per-repo GATED section (Task 15, S5 HP-1/HP-2/NP-4/NP-5) by
 * reading `.daemon/gated.json` via `readGatedSnapshot` — read-only, no git/gh
 * spawns on this path. `unknown` results (missing/unreadable/version) render
 * explicit "gated state unknown" wording, never an implied all-clear.
 */
async function renderGatedSection(repoPath: string, out: (line: string) => void, clock: Clock): Promise<void> {
  const result = await readGatedSnapshot(repoPath);
  if (result.kind === 'unknown') {
    const reason =
      result.why === 'missing'
        ? 'no scan recorded'
        : result.why === 'unreadable'
          ? 'snapshot unreadable'
          : 'snapshot schema mismatch';
    out(`  GATED: gated state unknown — ${reason}`);
    return;
  }

  const age = formatGatedAge(result.writtenAt, clock());
  if (result.gated.length === 0 && result.repoWarnings.length === 0) {
    out(`  GATED: no specs are gated (as of ${age})`);
    return;
  }

  out(`  GATED (as of ${age}):`);
  for (const w of result.repoWarnings) out(gatedRepoLine(w));
  for (const g of result.gated) out(gatedSpecLine(g));
}

/**
 * Render the rolling attribution agreement rate (Task 18, Story 9) for one
 * repo, reading `.daemon/attribution-accuracy.jsonl` via
 * `summarizeAccuracyLedger`. Absent/empty ledger ⇒ nothing is printed — never
 * fabricate a 100% agreement rate when there is no evidence to compute one
 * from.
 */
async function renderAgreementLine(repoPath: string, out: (line: string) => void): Promise<void> {
  const ledgerPath = join(repoPath, '.daemon', 'attribution-accuracy.jsonl');
  const summary = await summarizeAccuracyLedger(ledgerPath);
  if (summary === null) return;
  const pct = (summary.agreementRate * 100).toFixed(1);
  out(`  attribution agreement: ${pct}% (n=${summary.sampleCount})`);
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
  const clock = deps.clock ?? (() => new Date());

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
    // path-missing repos have no `.daemon/` directory to read from — never
    // attempt the snapshot read for them (AC: "path-missing repo skips the read").
    if (row.liveness !== 'path-missing') {
      await renderGatedSection(record.path, out, clock);
      await renderAgreementLine(record.path, out);
    }
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
    // unref: false — the poll timer is the only thing holding the event loop
    // open while following; a SIGINT listener does not keep node alive, so an
    // unref'd follower would exit immediately after the snapshot.
    const handle = followDaemonLog(target, (l) => out(l), { startOffset, unref: false });
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
  | { kind: 'logs'; repo?: string; follow: boolean; all: boolean; lines?: number };

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
    let lines: number | undefined;
    // A non-numeric or non-positive count is ignored (undefined → whole file)
    // rather than silently truncating the snapshot to nothing.
    const parseLines = (raw: string | undefined): number | undefined => {
      const n = Number(raw);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    };
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--follow' || a === '-f') follow = true;
      else if (a === '--all') all = true;
      else if (a === '--repo') {
        repo = rest[i + 1];
        i++;
      } else if (a.startsWith('--repo=')) {
        repo = a.slice('--repo='.length);
      } else if (a === '--lines' || a === '-n') {
        lines = parseLines(rest[i + 1]);
        i++;
      } else if (a.startsWith('--lines=')) {
        lines = parseLines(a.slice('--lines='.length));
      }
    }
    return { kind: 'logs', repo, follow, all, lines };
  }
  return null;
}

export async function dispatchDaemonObserve(d: DaemonDispatch): Promise<number> {
  if (d.kind === 'status') {
    const { code } = await runDaemonStatus();
    return code;
  }
  return runDaemonLogs({ repo: d.repo, follow: d.follow, all: d.all, lines: d.lines });
}
