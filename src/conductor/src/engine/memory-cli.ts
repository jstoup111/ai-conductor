/**
 * `conduct memory setup [dir]` CLI handler (ADR-017, A14).
 *
 * Non-interactive: runs to completion and the caller exits with the returned
 * exit code. Mirrors the registry/engineer/daemon subcommand pattern so the
 * memory-setup entry is dispatched BEFORE the interactive pipeline boots.
 *
 * Behaviour:
 *   1. If `.memory/` is a real directory (pre-migration content): invoke
 *      `migrateMemory` (copy-verify-swap) to move it into the canonical store
 *      and replace it with a symlink.
 *   2. Otherwise (no `.memory/` yet or already a symlink): invoke
 *      `ensureMemoryStore` to create the canonical store + symlink. Idempotent.
 *
 * The caller in `bin/conduct` (run_bootstrap) invokes this once at bootstrap
 * time. No other code in bin/conduct creates .memory/ directly — this is the
 * SINGLE LIVE PATH for memory initialisation.
 */

import { lstat } from 'fs/promises';
import { join, isAbsolute, resolve as resolvePath } from 'path';
import { existsSync } from 'fs';
import { ensureMemoryStore } from './memory-store.js';
import { migrateMemory } from './memory-migrate.js';

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch type (mirrors RegistryDispatch pattern)
// ─────────────────────────────────────────────────────────────────────────────

export type MemoryDispatch = { kind: 'setup'; dir?: string };

/**
 * Detect `conduct memory setup [dir]` in process.argv.
 * Returns the matched dispatch, or null when argv targets a different command.
 */
export function detectMemoryCommand(argv: string[]): MemoryDispatch | null {
  // argv is process.argv: [node, entry, sub, sub2, ...]
  const args = argv.slice(2);
  if (args[0] === 'memory' && args[1] === 'setup') {
    const dir = args[2] && !args[2].startsWith('-') ? args[2] : undefined;
    return { kind: 'setup', dir };
  }
  return null;
}

/**
 * Execute `conduct memory setup [dir]`.
 *
 * Logic:
 *   - Resolve `dir` (default: cwd).
 *   - If `.memory/` is a real directory → `migrateMemory` (copy-verify-swap,
 *     ADR-020). On failure, prints the error and returns exit code 1.
 *   - Otherwise → `ensureMemoryStore` (create canonical dir + symlink,
 *     idempotent). On failure, prints the error and returns exit code 1.
 *
 * Returns 0 on success, 1 on error.
 */
export async function dispatchMemorySetup(d: MemoryDispatch): Promise<number> {
  const rawDir = d.dir ?? process.cwd();
  const projectDir = isAbsolute(rawDir) ? rawDir : resolvePath(process.cwd(), rawDir);

  if (!existsSync(projectDir)) {
    console.error(`conduct memory setup: directory does not exist: ${projectDir}`);
    return 1;
  }

  const memPath = join(projectDir, '.memory');

  try {
    let memStat: Awaited<ReturnType<typeof lstat>> | null = null;
    try {
      memStat = await lstat(memPath);
    } catch {
      // .memory does not exist — fall through to ensureMemoryStore.
    }

    if (memStat && !memStat.isSymbolicLink()) {
      // Real directory (pre-migration content) — migrate it.
      console.log(`conduct memory setup: migrating existing .memory/ in ${projectDir}`);
      await migrateMemory(projectDir);
    } else {
      // No .memory/ yet, or already a symlink — ensure the canonical store.
      await ensureMemoryStore(projectDir);
    }

    console.log(`conduct memory setup: .memory/ is ready at ${projectDir}`);
    return 0;
  } catch (e) {
    console.error(
      `conduct memory setup: failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }
}
