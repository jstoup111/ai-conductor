/**
 * memory-store.ts
 *
 * Canonical per-project memory store (adr-2026-06-29-shared-memory-store-placement-and-durability).
 *
 * A11 — projectKey: branch- and worktree-independent project identity key.
 * A13 — ensureMemoryStore: create canonical dir + category subdirs + index.md
 *        and make `.memory` in the repo a symlink to it. Idempotent.
 *        recordMemoryEntry: write a file-per-entry into the store (required to
 *        prove idempotency of ensureMemoryStore in the acceptance spec).
 */

import { createHash } from 'crypto';
import {
  mkdir,
  writeFile,
  appendFile,
  symlink,
  lstat,
  readlink,
  unlink,
} from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

export interface MemoryEntry {
  /**
   * One of the standard category subdirs: decisions | patterns | gotchas | context.
   * Validated at runtime against CATEGORIES; throws if not a member.
   */
  category: CategoryName;
  /**
   * Filename stem — the file will be written as `<category>/<name>.md`.
   * Must not contain `/`, `\\`, or `..`; throws on any path-separator character.
   */
  name: string;
  /** Full Markdown body of the entry file. */
  body: string;
  /** Single line to append to `index.md` (a newline is appended if absent). */
  indexLine: string;
  /**
   * When `true`, this entry has not yet been pushed to the platform provider
   * and is awaiting reconciliation.  Set by the fallback path in
   * `memory-fallback.ts` on ledger entries so the pending state is explicit
   * (FR-13a plan-B17).  Purely informational — behaviour is driven by ledger
   * membership, not this flag.
   */
  pendingReconcile?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs a git sub-command and returns trimmed stdout.
 * Returns an empty string on any error (missing git, not a repo, etc.).
 */
async function gitOutput(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFile('git', args, { cwd });
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Derives the stable project identity string used to build the project key.
 *
 * Priority:
 *  1. `git remote get-url origin` — URL is stable across all branches/worktrees.
 *  2. Absolute path of `git rev-parse --git-common-dir` — the common `.git`
 *     directory is the same for every linked worktree of one project.
 *  3. `repoPath` itself as a last resort (single-machine, no remote).
 */
async function stableIdentity(repoPath: string): Promise<string> {
  const originUrl = await gitOutput(['remote', 'get-url', 'origin'], repoPath);
  if (originUrl) {
    return originUrl;
  }

  // git rev-parse --git-common-dir returns the shared .git dir (absolute on
  // modern git).  Resolve relative paths relative to cwd just in case.
  const rawCommonDir = await gitOutput(['rev-parse', '--git-common-dir'], repoPath);
  if (rawCommonDir) {
    const absolute = rawCommonDir.startsWith('/')
      ? rawCommonDir
      : join(repoPath, rawCommonDir);
    return absolute;
  }

  return repoPath;
}

/** Category subdirectories that every harness store contains. */
export const CATEGORIES = ['decisions', 'patterns', 'gotchas', 'context'] as const;

/** Union of all valid category names (derived from CATEGORIES to stay in sync). */
export type CategoryName = (typeof CATEGORIES)[number];

/** Reads HOME from the environment so tests can redirect it to a temp dir. */
function resolveHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — A11
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a stable, filesystem-safe key for the project at `repoPath`.
 *
 * The key is derived from the project's stable identity (origin URL or the
 * common git dir path), NOT from the current branch or worktree path, so all
 * linked worktrees of the same project return the same key, while different
 * projects return different keys (cross-project isolation, A12).
 */
export async function projectKey(repoPath: string): Promise<string> {
  const identity = await stableIdentity(repoPath);
  return createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — A13
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensures the canonical per-project memory store exists and that `.memory` in
 * `repoPath` is a symlink to its `harness/` subdirectory.
 *
 * Structure created under `~/.ai-conductor/memory/<key>/harness/`:
 *   decisions/   patterns/   gotchas/   context/   index.md
 *
 * Idempotent:
 *  - Calling a second time does NOT overwrite existing `index.md` content or
 *    any category-file content.
 *  - If `.memory` already exists as a **real directory** (pre-migration content),
 *    it is left alone — migration (adr-2026-06-29-safe-reversible-memory-migration) handles that conversion separately.
 *  - If `.memory` is already a symlink pointing to this store, it is kept as-is.
 *
 * Removal safety (A15): this function only ever creates or replaces the
 * `.memory` SYMLINK — it never removes the canonical store.  Removing a
 * worktree (which unlinks the `.memory` symlink) therefore leaves the
 * canonical store untouched so sibling worktrees can still read it.
 */
export async function ensureMemoryStore(repoPath: string): Promise<void> {
  const home = resolveHome();
  const key = await projectKey(repoPath);
  const harnessDir = join(home, '.ai-conductor', 'memory', key, 'harness');

  // 1. Create canonical harness directory and category subdirectories.
  await mkdir(harnessDir, { recursive: true });
  for (const cat of CATEGORIES) {
    await mkdir(join(harnessDir, cat), { recursive: true });
  }

  // 2. Create index.md only when absent — never overwrite existing content.
  const indexPath = join(harnessDir, 'index.md');
  let indexExists = false;
  try {
    await lstat(indexPath);
    indexExists = true;
  } catch {
    // File absent — will create below.
  }
  if (!indexExists) {
    await writeFile(indexPath, '# Memory Index\n\n', 'utf8');
  }

  // 3. Wire up `.memory` symlink in the repo.
  const memPath = join(repoPath, '.memory');
  let createLink = true;

  try {
    const stat = await lstat(memPath);
    if (stat.isSymbolicLink()) {
      const currentTarget = await readlink(memPath);
      if (currentTarget === harnessDir) {
        // Already points at the correct target — nothing to do.
        createLink = false;
      } else {
        // Points elsewhere (e.g. stale from a prior key) — replace it.
        await unlink(memPath);
      }
    } else {
      // Real directory (pre-migration) or unexpected file — do NOT touch it.
      createLink = false;
    }
  } catch {
    // `.memory` does not exist yet — fall through to create the symlink.
  }

  if (createLink) {
    await symlink(harnessDir, memPath);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: input validation (path-traversal safety for recordMemoryEntry)
// ─────────────────────────────────────────────────────────────────────────────

/** Set of valid category names for O(1) membership checks. */
const CATEGORY_SET: ReadonlySet<string> = new Set<string>(CATEGORIES);

/**
 * Validates that `entry.category` and `entry.name` cannot be used to escape
 * `harnessDir` via path traversal.
 *
 * Throws an `Error` with a clear message if:
 *  - `category` is not one of the known CATEGORIES members.
 *  - `name` contains `/`, `\\`, or `..` (or any path-separator / parent ref).
 *
 * Also performs a defence-in-depth check: the fully-resolved entry path must
 * start with `harnessDir` — if any future code change accidentally allows a
 * crafted value through, this backstop prevents writing outside the store.
 */
function validateEntry(harnessDir: string, entry: MemoryEntry): void {
  // 1. Category whitelist check.
  if (!CATEGORY_SET.has(entry.category)) {
    throw new Error(
      `Invalid category: "${entry.category}". ` +
        `Must be one of: ${CATEGORIES.join(', ')}.`,
    );
  }

  // 2. Name path-character check.
  //    Reject any name that contains a forward slash, backslash, or the parent
  //    directory reference `..` (as a standalone segment or embedded).
  if (
    entry.name.includes('/') ||
    entry.name.includes('\\') ||
    entry.name === '..' ||
    entry.name.startsWith('../') ||
    entry.name.includes('/../') ||
    entry.name.endsWith('/..')
  ) {
    throw new Error(
      `Invalid name: "${entry.name}". ` +
        `Name must not contain path separators or parent-directory references ("..").`,
    );
  }

  // 3. Defence-in-depth: verify the resolved entry path stays within harnessDir.
  //    This is a backstop; the checks above should be sufficient.
  const resolved = join(harnessDir, entry.category, `${entry.name}.md`);
  if (!resolved.startsWith(harnessDir + '/') && resolved !== harnessDir) {
    throw new Error(
      `Resolved entry path "${resolved}" escapes the store directory "${harnessDir}". ` +
        `Refusing to write.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — A13 (also satisfies A16's no-clobber protocol)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Writes a memory entry into the canonical store for `repoPath` and appends
 * `indexLine` to `index.md`.
 *
 * Input validation (path-traversal safety):
 *  - `entry.category` must be one of the known CATEGORIES; throws otherwise.
 *  - `entry.name` must not contain `/`, `\\`, or `..`; throws otherwise.
 *  - A defence-in-depth resolved-path check confirms the final path stays
 *    within `harnessDir`.
 *
 * Concurrent-write safety (A16 — no-clobber protocol):
 *  - Entry files use file-per-entry layout (each has a unique name), so two
 *    simultaneous writes to different entries land as separate files with no
 *    conflict.
 *  - `index.md` is updated via `appendFile` which uses O_APPEND, atomic for
 *    small writes on POSIX/Linux: both lines survive even when two worktrees
 *    call this simultaneously — neither write clobbers the other.
 *
 * Append-only index: the `index.md` line is always appended, never replaced.
 * If the same `name` is written twice, the entry FILE is overwritten (last
 * write wins) but the index grows by one line each call — the index is an
 * append-only log.  Callers that want idempotent index behaviour should
 * deduplicate before calling, or use unique names per logical entry.
 *
 * Writes go directly to the canonical store (not through the `.memory`
 * symlink) so they work even when a worktree's symlink has been removed.
 */
export async function recordMemoryEntry(
  repoPath: string,
  entry: MemoryEntry,
): Promise<void> {
  const home = resolveHome();
  const key = await projectKey(repoPath);
  const harnessDir = join(home, '.ai-conductor', 'memory', key, 'harness');

  // Validate inputs before any file I/O.
  validateEntry(harnessDir, entry);

  // Write the entry file (file-per-entry layout — concurrent safe, distinct paths).
  const entryPath = join(harnessDir, entry.category, `${entry.name}.md`);
  await writeFile(entryPath, entry.body, 'utf8');

  // Append the index line with O_APPEND atomicity (no-clobber, concurrent safe).
  const indexPath = join(harnessDir, 'index.md');
  const line = entry.indexLine.endsWith('\n')
    ? entry.indexLine
    : `${entry.indexLine}\n`;
  await appendFile(indexPath, line, 'utf8');
}
