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

import { appendFile, copyFile, lstat, mkdir, readdir, readFile, rename, rm, symlink, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { CATEGORIES, projectKey } from './memory-store.js';

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
   * Injectable fault hook fired mid-swap: after the real .memory dir is
   * removed but before the temp symlink is renamed into place. Simulates
   * a crash in the post-rm window. Tests assert a plain re-run recovers.
   */
  failDuringSwap?: () => Promise<void>;

  /**
   * One-time reverse. Restore `.memory.pre-migrate.bak/` as a real in-tree
   * `.memory/`, returning the project to its pre-migration state.
   */
  reverse?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Reads HOME from the environment so tests can redirect it to a temp dir. */
function resolveHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

/** Returns the canonical harness directory for the project at `repoPath`. */
async function getCanonicalHarnessDir(repoPath: string): Promise<string> {
  const home = resolveHome();
  const key = await projectKey(repoPath);
  return join(home, '.ai-conductor', 'memory', key, 'harness');
}

/**
 * Copy files from `srcDir` to `destDir`, SKIPPING any that already exist in
 * `destDir` (union / no-overwrite semantics for A21 and A20 re-entrancy).
 * Returns the list of basenames actually copied (newly added).
 */
async function copyMissing(srcDir: string, destDir: string): Promise<string[]> {
  const entries = await readdir(srcDir, { withFileTypes: true }).catch(() => []);
  const copied: string[] = [];
  if (entries.length === 0) return copied;

  await mkdir(destDir, { recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const destFile = join(destDir, entry.name);
    const exists = await lstat(destFile)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      await copyFile(join(srcDir, entry.name), destFile);
      copied.push(entry.name);
    }
  }
  return copied;
}

/**
 * Recursively copy an entire directory tree from `srcDir` to `destDir`,
 * overwriting any existing files (used for backup creation and A22 reverse).
 */
async function copyAll(srcDir: string, destDir: string): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true }).catch(() => []);
  await mkdir(destDir, { recursive: true });
  for (const entry of entries) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyAll(src, dest);
    } else if (entry.isFile()) {
      await copyFile(src, dest);
    }
  }
}

/**
 * A21 — Merge index lines from the local `.memory/index.md` into the canonical
 * `harness/index.md`, deduplicating by entry path.
 *
 * Only entries in `newlyAddedByCategory` (files actually copied this run) are
 * considered. A line is appended only when the canonical index does not already
 * contain that path reference (e.g. `decisions/mine.md`). This prevents
 * duplicate index lines when a sibling worktree already migrated the same entry.
 */
async function mergeIndexLines(
  localMemPath: string,
  canonicalHarness: string,
  newlyAddedByCategory: Record<string, string[]>,
): Promise<void> {
  const categories = Object.keys(newlyAddedByCategory);
  if (categories.length === 0) return;

  const canonicalIndexPath = join(canonicalHarness, 'index.md');
  const localIndexPath = join(localMemPath, 'index.md');

  const localContent = await readFile(localIndexPath, 'utf8').catch(() => '');
  const canonicalContent = await readFile(canonicalIndexPath, 'utf8').catch(() => '');

  const linesToAppend: string[] = [];

  for (const category of categories) {
    const names = newlyAddedByCategory[category] ?? [];
    for (const name of names) {
      const entryPath = `${category}/${name}`; // e.g. "decisions/mine.md"

      // Dedup: skip if canonical index already references this path.
      if (canonicalContent.includes(entryPath)) continue;

      // Find the corresponding line in local index, or synthesise one.
      const localLine = localContent
        .split('\n')
        .find((l) => l.includes(entryPath));

      if (localLine && localLine.trim()) {
        linesToAppend.push(localLine);
      } else {
        const stem = name.replace(/\.md$/, '');
        linesToAppend.push(`- [${stem}](${entryPath})`);
      }
    }
  }

  if (linesToAppend.length > 0) {
    // appendFile uses O_APPEND — concurrent-safe for small writes on POSIX.
    await appendFile(canonicalIndexPath, linesToAppend.join('\n') + '\n', 'utf8');
  }
}

/**
 * Default verifier: confirms every source entry file is present in the
 * canonical store (per-file existence check).
 */
async function runDefaultVerify(
  localMemPath: string,
  canonicalHarness: string,
): Promise<boolean> {
  for (const cat of CATEGORIES) {
    const srcDir = join(localMemPath, cat);
    const destDir = join(canonicalHarness, cat);
    const files = await readdir(srcDir).catch(() => []);
    for (const f of files) {
      const exists = await lstat(join(destDir, f))
        .then(() => true)
        .catch(() => false);
      if (!exists) return false;
    }
  }
  return true;
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
 *
 * A18 — copy-verify-swap:
 *   1. **Backup** — copy `.memory/` to `.memory.pre-migrate.bak/`.
 *   2. **Copy** — union-copy each category dir into canonical store.
 *   3. **Verify** — default verifier checks every source entry is present.
 *   4. **Swap** — remove real `.memory/`, create symlink to canonical harness.
 */
export async function migrateMemory(
  repoPath: string,
  _opts: MigrateOptions = {},
): Promise<void> {
  const memPath = join(repoPath, '.memory');
  const backupPath = join(repoPath, '.memory.pre-migrate.bak');

  // ── A22: Reverse ───────────────────────────────────────────────────────────
  // Restore `.memory.pre-migrate.bak/` as a real in-tree `.memory/`, returning
  // the project to its pre-migration state (one-time rollback, FR-11).
  if (_opts.reverse) {
    const backupStat = await lstat(backupPath).catch(() => null);
    if (!backupStat) {
      throw new Error(
        'Cannot reverse: no backup found at .memory.pre-migrate.bak — ' +
          'migration may not have been performed yet.',
      );
    }

    // Remove current .memory (symlink or real dir).
    const currentStat = await lstat(memPath).catch(() => null);
    if (currentStat) {
      if (currentStat.isSymbolicLink()) {
        await unlink(memPath);
      } else {
        await rm(memPath, { recursive: true, force: true });
      }
    }

    // Restore backup as a real directory.
    await copyAll(backupPath, memPath);
    return;
  }

  // ── A17: Detect ────────────────────────────────────────────────────────────
  const memStat = await lstat(memPath).catch(() => null);

  if (!memStat) {
    // No .memory/ — check whether a backup exists to determine why.
    const backupStat = await lstat(backupPath).catch(() => null);
    if (backupStat) {
      // Interrupted swap: .memory was removed but the symlink was never
      // (re)created. Complete the swap idempotently: ensure canonical is
      // populated from the backup, clean any stale temp link, then re-link.
      const canonicalHarness = await getCanonicalHarnessDir(repoPath);
      await mkdir(canonicalHarness, { recursive: true });
      for (const cat of CATEGORIES) {
        await copyMissing(join(backupPath, cat), join(canonicalHarness, cat));
      }
      const tmpLink = memPath + '.tmp-link';
      await rm(tmpLink, { force: true, recursive: true }).catch(() => {});
      await symlink(canonicalHarness, memPath);
      return;
    }
    // Genuinely fresh project (no prior memory, no backup) → no-op.
    return;
  }

  if (memStat.isSymbolicLink()) {
    // Already a symlink → already migrated. No-op (idempotent, FR-11).
    return;
  }

  // `.memory/` is a real directory — proceed with migration.

  // ── A18/A20: Backup ────────────────────────────────────────────────────────
  // Copy (not move) original to backup, retaining it for A22 reverse.
  // A20 re-entrancy: if a backup already exists from a prior interrupted run,
  // skip re-backup — the original content is still safe in the backup.
  const backupExists = await lstat(backupPath)
    .then(() => true)
    .catch(() => false);
  if (!backupExists) {
    await copyAll(memPath, backupPath);
  }

  // ── A18/A21: Copy into canonical store (union / no-overwrite) ─────────────
  const canonicalHarness = await getCanonicalHarnessDir(repoPath);
  await mkdir(canonicalHarness, { recursive: true });

  const newlyAddedByCategory: Record<string, string[]> = {};
  for (const cat of CATEGORIES) {
    const srcDir = join(memPath, cat);
    const destDir = join(canonicalHarness, cat);
    const copied = await copyMissing(srcDir, destDir);
    if (copied.length > 0) {
      newlyAddedByCategory[cat] = copied;
    }
  }

  // A21: Update canonical index with lines for newly added entries (dedup).
  await mergeIndexLines(memPath, canonicalHarness, newlyAddedByCategory);

  // ── A18/A19: Verify ────────────────────────────────────────────────────────
  // A19 (C5): an injected verifier returning false must abort non-destructively —
  // the original `.memory/` real dir is left completely intact (no swap, no loss).
  const verified = _opts.verify
    ? await _opts.verify()
    : await runDefaultVerify(memPath, canonicalHarness);

  if (!verified) {
    // C5: Abort without destructive change. Original .memory/ is still intact
    // (we only copied TO canonical; we never touched .memory/).
    throw new Error(
      'Migration verification failed: not all entries could be confirmed in ' +
        'the canonical store. Original .memory/ is intact — no swap performed.',
    );
  }

  // ── A20: failBeforeSwap hook ────────────────────────────────────────────────
  // Injectable interruption point. If it throws, the swap is skipped and .memory/
  // remains a real dir. A subsequent plain re-run detects the real dir, skips the
  // already-present backup, re-runs copy (union/no-overwrite, nothing new to add),
  // re-verifies, and completes — losing no entry (A20 re-entrancy guarantee).
  if (_opts.failBeforeSwap) {
    await _opts.failBeforeSwap();
  }

  // ── A18: Swap ──────────────────────────────────────────────────────────────
  // Crash-safe swap: create the symlink under a temp name first, then remove
  // the real .memory dir, then atomically rename the temp link into place.
  // If a crash occurs between rm and rename, the recovery branch in A17 detect
  // will complete the swap idempotently on the next run.
  const tmpLink = memPath + '.tmp-link';
  await rm(tmpLink, { force: true, recursive: true }).catch(() => {});
  await symlink(canonicalHarness, tmpLink);
  await rm(memPath, { recursive: true, force: true });
  // Injection point for crash-window test (after rm, before rename).
  if (_opts.failDuringSwap) {
    await _opts.failDuringSwap();
  }
  await rename(tmpLink, memPath);
}
