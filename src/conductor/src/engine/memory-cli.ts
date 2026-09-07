/**
 * `conduct memory setup [dir]` CLI handler (adr-2026-06-29-shared-memory-store-placement-and-durability, A14).
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
 * The project prelude invokes this once before pipeline startup. This is the
 * SINGLE LIVE PATH for memory initialisation.
 */

import { lstat, readlink } from 'fs/promises';
import { join, isAbsolute, resolve as resolvePath } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { ensureMemoryStore, projectKey } from './memory-store.js';
import { migrateMemory } from './memory-migrate.js';
import type { ConductorEventEmitter } from '../ui/events.js';

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

export type MemoryPathState = 'absent' | 'directory' | 'symlink';

async function memoryPathState(projectDir: string): Promise<MemoryPathState> {
  try {
    const stat = await lstat(join(projectDir, '.memory'));
    return stat.isSymbolicLink() ? 'symlink' : 'directory';
  } catch {
    return 'absent';
  }
}

/** Runs the idempotent setup branch without CLI output or exit-code mapping. */
export async function setupMemoryStore(projectDir: string): Promise<'migrated' | 'ensured'> {
  if (!existsSync(projectDir)) {
    throw new Error(`directory does not exist: ${projectDir}`);
  }

  if (await memoryPathState(projectDir) === 'directory') {
    await migrateMemory(projectDir);
    return 'migrated';
  }

  await ensureMemoryStore(projectDir);
  return 'ensured';
}

async function isCanonicalMemoryPath(projectDir: string): Promise<boolean> {
  try {
    const target = await readlink(join(projectDir, '.memory'));
    const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
    return target === join(home, '.ai-conductor', 'memory', await projectKey(projectDir), 'harness');
  } catch {
    return false;
  }
}

/**
 * Observes daemon memory setup without allowing setup or event failures to
 * interrupt dispatch preparation.
 */
export async function observeMemorySetup(
  projectDir: string,
  events?: Pick<ConductorEventEmitter, 'emit'>,
): Promise<void> {
  const before = await memoryPathState(projectDir);
  let reason: string | undefined;

  try {
    await setupMemoryStore(projectDir);
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }

  let canonical = false;
  try {
    canonical = await isCanonicalMemoryPath(projectDir);
  } catch (error) {
    reason ??= error instanceof Error ? error.message : String(error);
  }

  try {
    await events?.emit({ type: 'memory_setup', before, canonical, ...(reason ? { reason } : {}) });
  } catch {
    // Telemetry is best-effort; daemon dispatch must survive an observer fault.
  }
}

/**
 * Execute `conduct memory setup [dir]`.
 *
 * Logic:
 *   - Resolve `dir` (default: cwd).
 *   - If `.memory/` is a real directory → `migrateMemory` (copy-verify-swap,
 *     adr-2026-06-29-safe-reversible-memory-migration). On failure, prints the error and returns exit code 1.
 *   - Otherwise → `ensureMemoryStore` (create canonical dir + symlink,
 *     idempotent). On failure, prints the error and returns exit code 1.
 *
 * Returns 0 on success, 1 on error.
 */
export async function dispatchMemorySetup(d: MemoryDispatch): Promise<number> {
  const rawDir = d.dir ?? process.cwd();
  const projectDir = isAbsolute(rawDir) ? rawDir : resolvePath(process.cwd(), rawDir);

  try {
    const branch = await setupMemoryStore(projectDir);
    if (branch === 'migrated') {
      // Real directory (pre-migration content) — migrate it.
      console.log(`conduct memory setup: migrating existing .memory/ in ${projectDir}`);
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
