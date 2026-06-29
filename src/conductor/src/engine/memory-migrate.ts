/**
 * memory-migrate.ts
 *
 * Safe, reversible migration of an existing in-tree `.memory/` directory into
 * the canonical shared store (ADR-020, condition C5).
 *
 * ─── BACKUP SCHEME ───────────────────────────────────────────────────────────
 * The original `.memory/` is COPIED (not moved) to `.memory.pre-migrate.bak/`
 * before any modification to `.memory/` itself. Consequences:
 *
 *   • Original is intact until AFTER verify succeeds AND swap is done (C5).
 *   • A verify failure leaves `.memory/` as a real dir — no destructive change.
 *   • An interrupted migration (failBeforeSwap) leaves `.memory/` as a real dir;
 *     re-run detects it and continues (A20 re-entrancy).
 *   • Backup is retained indefinitely — operator cleans it up; used for A22 reverse.
 *
 * ─── RE-ENTRANCY (A20) ────────────────────────────────────────────────────────
 * Copy step is union/no-overwrite (copyMissing). If a prior interrupted run
 * already copied entries into the canonical store, a re-run sees them already
 * present and skips them. The backup existence check prevents double-backup.
 *
 * ─── UNION / DEDUP (A21) ──────────────────────────────────────────────────────
 * When copying into a pre-populated canonical store, files that already exist
 * are skipped (no-overwrite). Index lines are deduplicated by entry path
 * (e.g. `decisions/<name>.md`) — a line is only appended if the canonical
 * index does not already contain that path reference.
 */

import { lstat } from 'fs/promises';
import { join } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface MigrateOptions {
  /**
   * Injectable verifier. Called after copy, before swap.
   * If it returns `false`, migration throws (message matches /verif/i) and
   * leaves the original `.memory/` real dir intact (no swap, no loss) — C5.
   */
  verify?: () => Promise<boolean>;

  /**
   * Injectable fault hook. Called after backup+copy, after verify, but just
   * before the swap. If it throws (message must match /interrupt/i in tests),
   * the swap is skipped; `.memory/` remains a real dir; a plain re-run completes.
   */
  failBeforeSwap?: () => Promise<void>;

  /**
   * One-time reverse. Restore `.memory.pre-migrate.bak/` as a real in-tree
   * `.memory/`, returning the project to its pre-migration state.
   */
  reverse?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely migrates an existing in-tree `.memory/` real directory into the
 * canonical shared store, replacing it with a symlink (ADR-020, Option A).
 *
 * A17 — detect / skip:
 *   • `.memory/` absent → fresh project (FR-12). No-op.
 *   • `.memory/` is a symlink → already migrated. No-op.
 */
export async function migrateMemory(
  repoPath: string,
  _opts: MigrateOptions = {},
): Promise<void> {
  const memPath = join(repoPath, '.memory');

  // ── A17: Detect ────────────────────────────────────────────────────────────
  const memStat = await lstat(memPath).catch(() => null);

  if (!memStat) {
    // No .memory/ at all → fresh project (FR-12). No-op.
    return;
  }

  if (memStat.isSymbolicLink()) {
    // Already a symlink → already migrated. No-op (idempotent, FR-11).
    return;
  }

  // Real directory — migration body will be added in A18.
  throw new Error('Migration for real .memory/ directories not yet implemented (A18).');
}
