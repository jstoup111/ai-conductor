/**
 * memory-store.ts
 *
 * Canonical per-project memory store (ADR-017).
 *
 * A11 — projectKey: branch- and worktree-independent project identity key.
 */

import { createHash } from 'crypto';
import { join } from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

export interface MemoryEntry {
  /** One of the standard category subdirs (decisions/patterns/gotchas/context). */
  category: string;
  /** Filename stem — the file will be written as `<category>/<name>.md`. */
  name: string;
  /** Full Markdown body of the entry file. */
  body: string;
  /** Single line to append to `index.md` (a newline is appended if absent). */
  indexLine: string;
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
