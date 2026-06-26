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
//   - ensure-running (FR-21): probe lock; alive → no-op; none/stale → spawn one
//     detached daemon (fire-and-forget, no lifecycle ownership).
//   - Isolation (FR-20 caveat): this module is the single swappable boundary so
//     the single-winner model can change without rippling into routing/authoring.

import { open, mkdir, unlink, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Internal constants — ONLY place that encodes the pidfile path.
// ─────────────────────────────────────────────────────────────────────────────
const DAEMON_DIR = '.daemon';
const PIDFILE_NAME = 'daemon.pid';

function pidfilePath(repoPath: string): string {
  return join(repoPath, DAEMON_DIR, PIDFILE_NAME);
}

function daemonDir(repoPath: string): string {
  return join(repoPath, DAEMON_DIR);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pidfile record shape.
// ─────────────────────────────────────────────────────────────────────────────
export interface PidRecord {
  pid: number;
  uuid: string;
  startedAt: string;
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

/** Returned when the pidfile already exists and the existing owner is still alive. */
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

async function writePidfileExcl(repoPath: string): Promise<PidRecord> {
  await mkdir(daemonDir(repoPath), { recursive: true });

  const record: PidRecord = {
    pid: process.pid,
    uuid: randomUUID(),
    startedAt: new Date().toISOString(),
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

async function readPidRecord(repoPath: string): Promise<PidRecord | null> {
  try {
    const raw = await readFile(pidfilePath(repoPath), 'utf8');
    return JSON.parse(raw) as PidRecord;
  } catch {
    return null;
  }
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
 */
export async function acquire(
  repoPath: string,
  kill: KillProbe = defaultKill,
): Promise<AcquireResult> {
  try {
    const record = await writePidfileExcl(repoPath);
    return { acquired: true, ...record };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;

    if (code === 'EEXIST') {
      // Pidfile already exists — read it to report the existing owner.
      const owner = await readPidRecord(repoPath);
      if (owner) {
        return { acquired: false, reason: 'occupied', owner };
      }
      // Pidfile vanished between the EEXIST and our read — treat as occupied.
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
 */
export async function reclaim(
  repoPath: string,
  kill: KillProbe = defaultKill,
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
      const record = await writePidfileExcl(repoPath);
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

/**
 * ensureRunning — stub / scaffold for Task 18.
 *
 * Task 18 (a later agent) implements the full body: probe the lock, and if
 * none/stale, spawn one detached daemon via launchDaemonDetached. This stub
 * exists ONLY so the Task-16 boundary test can assert the export exists.
 *
 * The Task-18 agent should replace this body with the real implementation.
 * The signature is locked:
 *   ensureRunning(repoPath: string, opts?: EnsureRunningOpts): Promise<void>
 *
 * @param repoPath - Absolute path to the repository root.
 */
export async function ensureRunning(repoPath: string): Promise<void> {
  // Task 18 implementation goes here.
  // Contract: probe acquire/isLive; alive → no-op; none/stale → launchDaemonDetached(repoPath).
  void repoPath;
  throw new Error('ensureRunning: not yet implemented (Task 18)');
}
