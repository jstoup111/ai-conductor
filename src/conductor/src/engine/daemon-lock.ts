// daemon-lock.ts — Pidfile O_EXCL lock primitive for the 1-per-repo daemon mutex.
//
// ALL references to `.daemon/daemon.pid` and O_EXCL file-creation live exclusively
// in this module. Callers use ONLY the exported `acquire`, `isLive`, `reclaim`, and
// `ensureRunning` symbols — never raw fs open / unlink / kill logic.
//
// Design (ADR-010):
//   - Lock = mutex (FR-17/20): `.daemon/daemon.pid` created via O_EXCL (atomic
//     create-only-if-absent). The kernel arbitrates a single winner; the loser
//     no-ops/exits 0, never a second builder.
//   - Liveness (FR-18): process.kill(pid, 0) → ESRCH = dead (reclaimable);
//     success or EPERM = alive (never reclaimed — conservative).
//   - Stale reclaim (FR-19): dead lock is reclaimed by unlink + re-create via
//     O_EXCL. The reclaim itself races safely — only one reclaimer wins.
//   - ensure-running (FR-21): probe lock; alive → no-op; none/stale → launch one
//     daemon (fire-and-forget, no lifecycle ownership). The launch is now hosted in
//     a tmux session via supervisor.start (ADR-014); the engineer retains no handle.
//   - Isolation (FR-20 caveat): this module is the single swappable boundary so
//     the single-winner model can change without rippling into routing/authoring.

import { open, mkdir, unlink, readFile, writeFile } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Internal constants — ONLY place that encodes the pidfile path.
// ─────────────────────────────────────────────────────────────────────────────
const DAEMON_DIR = '.daemon';
const PIDFILE_NAME = 'daemon.pid';

function pidfilePath(repoPath: string): string {
  return join(repoPath, DAEMON_DIR, PIDFILE_NAME);
}

// Exported so observability code (daemon-log.ts) can locate `.daemon/` without
// re-encoding the directory literal — the pidfile name (`daemon.pid`) and O_EXCL
// stay confined here (boundary test), but the dir itself is a shared anchor.
export function daemonDir(repoPath: string): string {
  return join(repoPath, DAEMON_DIR);
}

// Exported for engine-store GC to construct pidfile paths across the fleet
// without hardcoding the pidfile path itself (boundary test requirement).
// Keeps all pidfile path logic confined to this module.
export function getPidfilePath(repoPath: string): string {
  return pidfilePath(repoPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pidfile record shape.
// ─────────────────────────────────────────────────────────────────────────────
export interface PidRecord {
  pid: number;
  uuid: string;
  startedAt: string;
  /**
   * Additive (FR-14): the directory of the running engine build that wrote
   * this pidfile — normally `dist-versions/<version-id>` (or `dist/` when
   * running unpublished/dev code). Derived from THIS module's own resolved
   * location so it always reflects the engine actually executing, never a
   * caller-supplied value. Absent on records written before this field
   * existed — readers must tolerate `undefined` (never throw).
   */
  engineDir?: string;
  /**
   * Additive (#374): marks a HANDOFF record — a lock briefly held by a CLI
   * process (restart handoff, ensureRunning's acquire-then-unlink step) purely
   * to win the O_EXCL arbitration, never by a running daemon. Such a record's
   * pid is live (it is the CLI process itself), but it must NOT be read as "a
   * daemon is running": pre-#374, a racer observing one no-op'd while the
   * transient holder unlinked and returned — leaving ZERO daemons. Absent on
   * real daemon records — readers must tolerate `undefined`.
   */
  transient?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result types.
// ─────────────────────────────────────────────────────────────────────────────

/** Returned when THIS process successfully created the pidfile and owns the lock. */
export interface AcquireSuccess {
  acquired: true;
  pid: number;
  uuid: string;
  startedAt: string;
}

/**
 * Returned when the pidfile already exists and the existing owner is still alive.
 *
 * Note: `owner.pid` may be -1 when the pidfile vanished between EEXIST and the read
 * (phantom lock). Callers MUST guard with `owner.pid > 0` and treat pid===-1 as
 * reclaimable — it is not a real process id and must never be passed to isLive().
 */
export interface AcquireOccupied {
  acquired: false;
  reason: 'occupied';
  owner: PidRecord;
}

/** Returned when we cannot create the .daemon/ directory or the pidfile (permission denied, etc.). */
export interface AcquireError {
  acquired: false;
  reason: 'error';
  error: Error;
}

export type AcquireResult = AcquireSuccess | AcquireOccupied | AcquireError;

/** Returned from reclaim() when the stale lock was successfully replaced. */
export interface ReclaimSuccess {
  reclaimed: true;
  acquired: true;
  pid: number;
  uuid: string;
  startedAt: string;
}

/** Returned from reclaim() when the lock was alive — we are NOT the owner. */
export interface ReclaimOccupied {
  reclaimed: false;
  acquired: false;
  reason: 'alive';
  owner: PidRecord;
}

/** Returned from reclaim() on unexpected error. */
export interface ReclaimError {
  reclaimed: false;
  acquired: false;
  reason: 'error';
  error: Error;
}

export type ReclaimResult = ReclaimSuccess | ReclaimOccupied | ReclaimError;

// ─────────────────────────────────────────────────────────────────────────────
// Injectable kill probe type (allows deterministic ESRCH/EPERM in tests).
// ─────────────────────────────────────────────────────────────────────────────
export type KillProbe = (pid: number, signal: number) => void;

const defaultKill: KillProbe = (pid, signal) => {
  process.kill(pid, signal);
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers.
// ─────────────────────────────────────────────────────────────────────────────

// This module's own resolved directory — the "engine dir" for whichever build
// is currently executing (dist-versions/<id>/engine, or a dev src/engine dir
// under ts-node/tsx). Computed once; never derived from caller input.
const OWN_ENGINE_DIR = dirname(fileURLToPath(import.meta.url));

async function writePidfileExcl(repoPath: string, transient?: boolean): Promise<PidRecord> {
  await mkdir(daemonDir(repoPath), { recursive: true });

  const record: PidRecord = {
    pid: process.pid,
    uuid: randomUUID(),
    startedAt: new Date().toISOString(),
    engineDir: OWN_ENGINE_DIR,
    ...(transient ? { transient: true } : {}),
  };

  // O_EXCL: fails with EEXIST if the file already exists — the kernel-level mutex.
  const fh = await open(pidfilePath(repoPath), 'wx');
  try {
    await fh.writeFile(JSON.stringify(record), 'utf8');
  } finally {
    await fh.close();
  }

  return record;
}

// Exported for read-only observability (`conduct daemon status`): callers get the
// owner record (or null for absent/corrupt) without touching the pidfile path.
export async function readPidRecord(repoPath: string): Promise<PidRecord | null> {
  let parsed: unknown;
  try {
    const raw = await readFile(pidfilePath(repoPath), 'utf8');
    parsed = JSON.parse(raw);
  } catch {
    // File absent or JSON parse failure — treat as absent so callers reclaim.
    return null;
  }

  // Runtime shape guard: a malformed pidfile (non-numeric pid, missing uuid, etc.)
  // must be treated as absent. Without this guard, `process.kill("notanumber", 0)`
  // throws a TypeError (not an ESRCH errno), which the isLive catch block has no
  // matching code for — it falls through to `return true` (conservatively alive).
  // That would permanently refuse every future daemon for this repo (FR-19 violation).
  if (
    typeof (parsed as any)?.pid !== 'number' ||
    !Number.isInteger((parsed as any).pid) ||
    (parsed as any).pid <= 0 ||
    typeof (parsed as any)?.uuid !== 'string'
  ) {
    return null;
  }

  return parsed as PidRecord;
}

/**
 * TEST HELPER: writePidRecord — directly write a pidfile without O_EXCL.
 * Used ONLY in tests to set up initial state (e.g., simulating an orphaned process).
 * Production code must use acquire() or reclaim() to respect the O_EXCL mutex.
 */
export async function writePidRecord(
  repoPath: string,
  record: PidRecord,
): Promise<void> {
  await mkdir(daemonDir(repoPath), { recursive: true });
  await writeFile(pidfilePath(repoPath), JSON.stringify(record), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * isLive — test whether a pid is still running.
 *
 * Uses process.kill(pid, 0): this sends no signal but checks liveness.
 *   - Success         → alive
 *   - EPERM           → alive (we can see the process, just cannot signal it;
 *                       conservative — never reclaim a lock we can't prove dead)
 *   - ESRCH           → dead (no such process)
 *   - any other error → treated as alive (conservative)
 *
 * @param pid   - PID to probe.
 * @param kill  - Injectable kill probe (default: process.kill). Override in tests
 *               to exercise ESRCH / EPERM deterministically.
 */
export function isLive(pid: number, kill: KillProbe = defaultKill): boolean {
  try {
    kill(pid, 0);
    return true; // no throw → alive
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return false; // no such process → dead
    }
    // EPERM or anything else → conservatively alive
    return true;
  }
}

/**
 * acquire — attempt to become the owner of the 1-per-repo daemon lock.
 *
 * Creates `.daemon/daemon.pid` via O_EXCL (atomic). On EEXIST, reads the
 * existing pidfile and checks liveness:
 *   - existing owner alive → returns occupied (no-op, loser exits 0)
 *   - existing owner dead  → returns occupied with the stale record (caller
 *     should call reclaim() to replace it)
 *
 * @param repoPath - Absolute path to the repository root.
 * @param kill     - Injectable kill probe (default: process.kill).
 * @param opts     - `transient: true` marks the created record as a handoff
 *                   record (#374) — set by callers that immediately unlink it.
 */
export async function acquire(
  repoPath: string,
  kill: KillProbe = defaultKill,
  opts: { transient?: boolean } = {},
): Promise<AcquireResult> {
  try {
    const record = await writePidfileExcl(repoPath, opts.transient);
    return { acquired: true, ...record };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;

    if (code === 'EEXIST') {
      // Pidfile already exists — read it to report the existing owner.
      const owner = await readPidRecord(repoPath);
      if (owner) {
        return { acquired: false, reason: 'occupied', owner };
      }
      // Pidfile vanished between the EEXIST and our read (phantom lock).
      // owner.pid === -1 is the sentinel for this race window.
      // Callers MUST guard with owner.pid > 0 and treat pid===-1 as reclaimable,
      // not as a live owner (it is not a real process id).
      return {
        acquired: false,
        reason: 'occupied',
        owner: { pid: -1, uuid: '', startedAt: '' },
      };
    }

    // Any other error (EACCES, ENOENT for non-existent parent, etc.) → named error.
    return { acquired: false, reason: 'error', error: err as Error };
  }
}

/**
 * reclaim — replace a stale (dead-pid) pidfile with a fresh owner record.
 *
 * 1. Reads the existing pidfile.
 * 2. If the stored pid is still alive → returns occupied (we must not reclaim).
 * 3. If dead → unlinks the stale pidfile and re-creates via O_EXCL.
 *    The O_EXCL on re-create means two concurrent reclaimers race safely — only
 *    one wins; the loser gets EEXIST and returns occupied.
 *
 * A repo is NEVER permanently refused — every call to reclaim() either wins the
 * lock or loses to a concurrent winner (who is now the fresh owner).
 *
 * @param repoPath - Absolute path to the repository root.
 * @param kill     - Injectable kill probe (default: process.kill).
 * @param opts     - `transient: true` marks the re-created record as a handoff
 *                   record (#374) — set by callers that immediately unlink it.
 */
export async function reclaim(
  repoPath: string,
  kill: KillProbe = defaultKill,
  opts: { transient?: boolean } = {},
): Promise<ReclaimResult> {
  try {
    // Read the existing pidfile to determine if reclaim is warranted.
    const existing = await readPidRecord(repoPath);

    if (existing && isLive(existing.pid, kill)) {
      return { reclaimed: false, acquired: false, reason: 'alive', owner: existing };
    }

    // Owner is dead (or pidfile was absent) — unlink the stale file and reclaim.
    try {
      await unlink(pidfilePath(repoPath));
    } catch {
      // File may have already been unlinked by a concurrent reclaimer — that's fine;
      // the O_EXCL below will correctly arbitrate the winner.
    }

    // Re-create via O_EXCL — exactly one concurrent reclaimer wins.
    try {
      const record = await writePidfileExcl(repoPath, opts.transient);
      return { reclaimed: true, acquired: true, ...record };
    } catch (innerErr: unknown) {
      const code = (innerErr as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        // A concurrent reclaimer just won — read their record and report occupied.
        const newOwner = await readPidRecord(repoPath);
        return {
          reclaimed: false,
          acquired: false,
          reason: 'alive',
          owner: newOwner ?? { pid: -1, uuid: '', startedAt: '' },
        };
      }
      throw innerErr;
    }
  } catch (err: unknown) {
    return { reclaimed: false, acquired: false, reason: 'error', error: err as Error };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// holdLock — the running daemon's OWN lifetime lock (ADR-010 liveness).
// ─────────────────────────────────────────────────────────────────────────────

// Module-confined production defaults for holdLock bounded-wait polling.
const DEFAULT_TAKEOVER_WAIT_MS = 10_000;
const DEFAULT_POLL_MS = 250;

/** Handle returned to a daemon that successfully claimed (or proceeded past) the lock. */
export interface DaemonLockHandle {
  /** The pid recorded in the pidfile (this process), or process.pid if unwritten. */
  pid: number;
  /** True when we own the pidfile and release() should unlink it. */
  owned: boolean;
  /** Async release — unlink our pidfile (best-effort). Call on normal exit. */
  release: () => Promise<void>;
  /** Sync release — unlink our pidfile (best-effort). Backstop for `process.exit`. */
  releaseSync: () => void;
}

/** Optional parameters for holdLock bounded-wait behavior. */
export interface HoldLockOptions {
  /**
   * Maximum time in milliseconds to wait for a live owner to release the lock.
   * Only used when encountering a live owner; defaults to 10 seconds.
   */
  takeoverWaitMs?: number;
  /**
   * Poll interval in milliseconds when waiting for lock availability.
   * Only used when encountering a live owner; defaults to 250ms.
   */
  pollMs?: number;
}

function makeLockHandle(repoPath: string, pid: number, owned: boolean): DaemonLockHandle {
  return {
    pid,
    owned,
    release: async () => {
      if (!owned) return;
      try {
        await unlink(pidfilePath(repoPath));
      } catch {
        // Already gone — fine.
      }
    },
    releaseSync: () => {
      if (!owned) return;
      try {
        unlinkSync(pidfilePath(repoPath));
      } catch {
        // Already gone — fine.
      }
    },
  };
}

/**
 * holdLock — claim the 1-per-repo pidfile for THIS process and keep it for the
 * daemon's lifetime, so liveness is observable (ADR-010) and a second daemon for
 * the same repo refuses to start.
 *
 * Distinct from `ensureRunning`, which SPAWNS a fresh daemon. `holdLock` is what the
 * spawned daemon calls on boot to actually write `.daemon/daemon.pid` with its own
 * pid — the wiring that was missing, leaving liveness unobservable.
 *
 *   - acquired (no prior pidfile)        → own the lock, return a handle.
 *   - occupied by a LIVE pid             → poll (if options.takeoverWaitMs set) or
 *                                           return null immediately (1-per-repo).
 *   - occupied by a DEAD/phantom pid     → reclaim it, return a handle (immediate,
 *                                           no wait).
 *   - reclaim lost to a concurrent daemon → return null.
 *   - acquire/reclaim ERROR (e.g. EACCES) → return an unowned handle so the daemon
 *     still builds; liveness just isn't observable (self-heals on the next claim).
 *
 * @param repoPath - Absolute path to the repository root.
 * @param options  - Optional: { takeoverWaitMs?: number, pollMs?: number }.
 *                   When set, on live-owner occupancy, poll acquire() every pollMs
 *                   until takeoverWaitMs elapses. Returns a handle if acquired
 *                   during the wait, null if the wait expires with owner still live.
 *                   Dead-pid reclaim is unaffected (immediate, no wait).
 */
export async function holdLock(
  repoPath: string,
  options?: HoldLockOptions,
): Promise<DaemonLockHandle | null> {
  const result = await acquire(repoPath);
  if (result.acquired) {
    return makeLockHandle(repoPath, result.pid, true);
  }
  if (result.reason === 'occupied') {
    const owner = result.owner;
    if (owner.pid > 0 && isLive(owner.pid)) {
      // A live daemon owns the lock.
      // If options.takeoverWaitMs is set, poll for the lock to become available.
      if (options?.takeoverWaitMs !== undefined) {
        const takeoverWaitMs = options.takeoverWaitMs ?? DEFAULT_TAKEOVER_WAIT_MS;
        const pollMs = options.pollMs ?? DEFAULT_POLL_MS;

        const startTime = Date.now();
        while (Date.now() - startTime < takeoverWaitMs) {
          // Wait for the next poll interval.
          await new Promise((resolve) => setTimeout(resolve, pollMs));

          // Try to acquire the lock.
          const pollResult = await acquire(repoPath);
          if (pollResult.acquired) {
            return makeLockHandle(repoPath, pollResult.pid, true);
          }
          // If the result is occupied but by a dead pid, the loop will
          // continue polling until the timeout, then fall through to the
          // normal dead-pid reclaim path below.
          if (pollResult.reason === 'occupied' && pollResult.owner.pid > 0) {
            if (!isLive(pollResult.owner.pid)) {
              // Owner is now dead — exit polling and let the normal stale path handle it.
              break;
            }
          }
        }
      }
      // Bounded-wait expired or no wait requested — return null (1-per-repo).
      return null;
    }
    // Stale (dead or phantom) → reclaim (immediate, no wait).
    const r = await reclaim(repoPath, defaultKill);
    if (r.reclaimed) {
      return makeLockHandle(repoPath, r.pid, true);
    }
    if (r.reason === 'alive') {
      return null; // a concurrent reclaimer won and is alive
    }
    // reclaim error → fall through to unowned handle (best-effort build).
    return makeLockHandle(repoPath, process.pid, false);
  }
  // acquire error (permission, etc.) → run without an observable lock.
  return makeLockHandle(repoPath, process.pid, false);
}

/**
 * clearStaleLockForRestart — FR-8: hand off the 1-per-repo lock ahead of a
 * `restart` verb's tmux-level respawn, built ENTIRELY from the existing
 * acquire/reclaim primitives (no new lock semantics — plan Task 25 constraint).
 *
 *   - No prior pidfile    → acquire (O_EXCL) then immediately unlink our own
 *     transient record. This still forces the O_EXCL race arbitration to run
 *     BEFORE anything spawns, so a concurrent caller racing the same repo
 *     (e.g. `ensureRunning`) cannot end up double-spawning (FR-8 race case).
 *   - Prior owner is LIVE → left untouched. That live process is the one the
 *     supervisor's respawn is about to kill; ADR-010 forbids reclaiming a
 *     live lock — the freshly-booted daemon's own `holdLock()` reclaims once
 *     the old process is actually dead.
 *   - Prior owner is DEAD (or phantom) → reclaim() (the existing stale-reclaim
 *     path), then unlink the transient record we just won so the freshly
 *     spawned daemon claims a clean lock via O_EXCL on boot (new pid).
 *
 * Returns the previous owner's real pid (or null when there was none, or it
 * was a phantom/-1 sentinel) — useful for "new holder pid !== old" assertions.
 *
 * @param repoPath - Absolute path to the repository root.
 * @param kill     - Injectable kill probe (default: process.kill).
 */
export async function clearStaleLockForRestart(
  repoPath: string,
  kill: KillProbe = defaultKill,
): Promise<number | null> {
  const owner = await readPidRecord(repoPath);

  if (!owner) {
    // No prior lock on disk — still race-arbitrate via O_EXCL in case a
    // concurrent caller (e.g. ensureRunning) is claiming the same repo now.
    // transient (#374): this ownership lasts microseconds (create → unlink);
    // the marker keeps a racing ensureRunning from reading it as a live daemon
    // and no-op'ing — which would end the race with ZERO daemons.
    const result = await acquire(repoPath, kill, { transient: true });
    if (result.acquired) {
      try {
        await unlink(pidfilePath(repoPath));
      } catch {
        // Already gone — fine.
      }
    }
    return null;
  }

  if (owner.pid > 0 && isLive(owner.pid, kill)) {
    return owner.pid; // live — leave it; the pane respawn will kill it
  }

  // Dead/phantom stale record — reclaim via the existing primitive.
  // transient (#374): same handoff marking as the acquire branch above.
  const result = await reclaim(repoPath, kill, { transient: true });
  if (result.reclaimed) {
    try {
      await unlink(pidfilePath(repoPath));
    } catch {
      // Already gone — fine.
    }
  }
  return owner.pid > 0 ? owner.pid : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ensureRunning — injectable options type (FR-21, FR-23).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injectable launch function (default: launchDaemon).
 * Receives only the repoPath — fire-and-forget.
 * Errors thrown by the launch fn are not propagated (fire-and-forget).
 */
export type LaunchFn = (repoPath: string) => void | Promise<void>;

/**
 * Optional mirror writer called AFTER a successful liveness confirmation.
 * Failure is NON-FATAL — the loop continues regardless (FR-23, C4).
 */
export type WriteDaemonStateFn = () => Promise<void>;

export interface EnsureRunningOpts {
  /**
   * Injectable launch function (default: launchDaemon). Called at most
   * once when no live daemon is found. Never called when a live owner exists.
   */
  launch?: LaunchFn;
  /**
   * Injectable kill probe (default: process.kill). Passed through to isLive/reclaim.
   */
  kill?: KillProbe;
  /**
   * Callback invoked exactly once when a stale lock is reclaimed. Used by
   * callers and tests to count reclaim events (FR-21 negative path).
   */
  onReclaim?: () => void;
  /**
   * Best-effort mirror writer. Called after a fresh spawn to record
   * `daemonState` in the registry. Failure is non-fatal (FR-23, C4).
   * The control path NEVER reads this value for a liveness decision.
   */
  writeDaemonState?: WriteDaemonStateFn;
  /**
   * A registry-level daemonState view, injected by callers (e.g., tests or
   * the engineer). This value is NEVER consulted for any liveness decision —
   * the pidfile is the single source of truth (FR-23, C4, ADR-010).
   * Passing it here is intentional: it proves the implementation ignores it.
   */
  registryDaemonState?: Record<string, string>;
}

/**
 * ensureRunning — probe the 1-per-repo lock; spawn once iff no live daemon.
 *
 * Algorithm (FR-21, ADR-010, C3/C4):
 *   1. Attempt to acquire the lock (O_EXCL create of `.daemon/daemon.pid`).
 *      a. Acquired → WE now own the lock (no prior daemon); fall through to spawn.
 *      b. Occupied (EEXIST) → read the existing pidfile and check liveness with
 *         the REAL process.kill (defaultKill — pidfile is authoritative):
 *         - isLive → STOP. No spawn, no signal. (zero-management contract)
 *         - dead  → reclaim the stale lock, call onReclaim(), fall through to spawn.
 *   2. Spawn: call opts.launch(repoPath) (default: launchDaemon) ONCE.
 *   3. Best-effort mirror: call writeDaemonState() if provided; swallow any error.
 *
 * The function NEVER:
 *   - reads `registryDaemonState` for a liveness decision (pidfile wins).
 *   - sends a non-zero kill signal to any pid.
 *   - spawns more than once.
 *   - retains any handle to the spawned process.
 *
 * Note on opts.kill: the injectable kill probe exists ONLY as a management-signal
 * spy (so callers/tests can assert that NO non-zero signals were sent). Liveness
 * probing always uses defaultKill (the real process.kill) because the pidfile
 * must be the single authoritative source of truth — an injected probe cannot
 * substitute for the real OS liveness check (FR-23, ADR-010).
 *
 * @param repoPath - Absolute path to the repository root.
 * @param opts     - Injectable overrides for testing and integration.
 */
export async function ensureRunning(
  repoPath: string,
  opts: EnsureRunningOpts = {},
): Promise<void> {
  // NON-AUTHORITATIVE MIRROR GATE (FR-23, C4, ADR-010):
  // opts.registryDaemonState is intentionally NEVER read for any liveness decision.
  // The pidfile (.daemon/daemon.pid) is the SINGLE source of truth. A stale registry
  // that claims "running" while the pidfile points at a dead pid is ignored — the
  // pidfile liveness check wins. Explicitly void the registry view so it is clear
  // no control path can accidentally read it.
  void opts.registryDaemonState;
  // Liveness probing uses defaultKill (real process.kill) unconditionally —
  // opts.kill is a management-signal spy, not a liveness substitute.

  const launchFn: LaunchFn =
    opts.launch ??
    (async (path: string) => {
      // Default: import launchDaemon lazily (avoids circular-dep issues).
      const { launchDaemon } = await import('./engineer/daemon-launch.js');
      await launchDaemon(path);
    });

  let needsSpawn = false;

  // Step 1: try to acquire the lock (O_EXCL atomic create).
  // acquire() does not invoke kill — it reads the pidfile only.
  // transient (#374): the record we create here is unlinked moments later so
  // the real daemon can spawn fresh — mark it so a concurrent racer (another
  // ensureRunning, or a restart handoff) never mistakes it for a live daemon.
  const acquireResult = await acquire(repoPath, defaultKill, { transient: true });

  if (acquireResult.acquired) {
    // WE just created the pidfile — no prior daemon was running.
    // Unlink our transient pidfile so the real daemon spawns fresh via O_EXCL.
    try {
      await unlink(pidfilePath(repoPath));
    } catch {
      // Already gone — fine.
    }
    needsSpawn = true;
  } else if (acquireResult.reason === 'occupied') {
    // A pidfile already exists — check liveness using the real OS kill (defaultKill).
    // This is the authoritative liveness check; the injected kill probe is not used
    // here because it is a management-signal spy only.
    const owner = acquireResult.owner;
    if (owner.pid > 0 && owner.transient !== true && isLive(owner.pid, defaultKill)) {
      // Live daemon found — strictly NO spawn, NO signal. (FR-21 negative, ADR-005)
      // ADR-005: ensureRunning is LAUNCH-not-MANAGE. It never sends SIGTERM, SIGHUP,
      // SIGKILL, or any other control signal. It has no lifecycle ownership over
      // the running daemon — the daemon self-limits and self-terminates.
      // transient exception (#374): a live TRANSIENT owner is a CLI handoff
      // window (restart / another ensureRunning), not a daemon — treating it
      // as one ended the race with zero daemons. Fall through and spawn: the
      // spawned daemon's own boot-time acquire (and the idempotent tmux
      // session) arbitrate any duplicate, so at-least-one is restored without
      // ever risking two.
      return;
    }
    if (owner.pid > 0 && owner.transient === true) {
      // Transient handoff record — the holder unlinks it momentarily and never
      // becomes a daemon itself. Spawn directly; do NOT reclaim (never unlink
      // a live holder's record out from under it).
      needsSpawn = true;
    } else {
      // Owner pid is dead — reclaim the stale lock (uses defaultKill internally).
      // transient (#374): our own reclaimed record is unlinked below, so mark it.
      const reclaimResult = await reclaim(repoPath, defaultKill, { transient: true });
      if (reclaimResult.reclaimed) {
        opts.onReclaim?.();
        // Unlink the reclaimed pidfile so the daemon spawns fresh.
        try {
          await unlink(pidfilePath(repoPath));
        } catch {
          // Already gone — fine.
        }
        needsSpawn = true;
      } else if (
        reclaimResult.reason === 'alive' &&
        reclaimResult.owner.pid > 0 &&
        reclaimResult.owner.transient !== true
      ) {
        // A concurrent reclaimer beat us AND the new owner is a real live
        // daemon — no-op.
        return;
      } else {
        // Reclaim errored — best-effort spawn attempt. Or (#374) the reclaim
        // winner is a live TRANSIENT handoff holder (never becomes a daemon),
        // or a PHANTOM owner (pid === -1: the winner's record vanished before
        // we could read it — per the AcquireOccupied contract, pid -1 must be
        // treated as reclaimable, never as a live owner). No-op'ing on either
        // is the zero-daemon race — spawn instead.
        needsSpawn = true;
      }
    }
  } else {
    // acquire returned 'error' — best-effort spawn attempt.
    needsSpawn = true;
  }

  if (needsSpawn) {
    // Step 2: fire-and-forget — spawn exactly once (FR-21).
    await Promise.resolve(launchFn(repoPath));

    // Step 3: DERIVED mirror write — NON-FATAL on any error (FR-23, C4).
    // The `daemonState` field in the registry is a DERIVED read-only mirror for
    // governor reporting. Its value is derived FROM the confirmed pidfile result,
    // never the other way around. Failure here must not block the loop — the
    // pidfile is authoritative and the daemon is already running.
    if (opts.writeDaemonState) {
      try {
        await opts.writeDaemonState();
      } catch {
        // Mirror write failure is intentionally swallowed — pidfile is authoritative.
        // The registry view may be stale; the next ensureRunning probe will correct it.
      }
    }
  }
}
