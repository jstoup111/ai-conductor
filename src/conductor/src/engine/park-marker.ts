// park-marker.ts — the single source of truth for the `.daemon/parked/<slug>`
// operator-park marker.
//
// An operator-park marks a single feature (by slug) as parked for the
// operator: the daemon loop treats the presence of
// `.daemon/parked/<slug>` as a stop for that slug and never advances,
// opens a PR, or merges past it while the marker exists. This mirrors
// halt-marker.ts's single-source pattern so the path and write/read/remove
// primitives are spelled once instead of being duplicated across the
// conductor, the dashboard, and the daemon loop.

import { mkdir, open, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

/** Directory (relative to project root) that holds per-slug park markers. */
export const OPERATOR_PARKED_SUBDIR = 'parked';

// ─────────────────────────────────────────────────────────────────────────────
// Main repository root resolution (Task 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Memoization cache for resolveMainRepoRoot results, keyed by startDir.
 * Prevents repeated git invocations for the same directory.
 */
const resolveMainRepoRootCache = new Map<string, Promise<string>>();

/**
 * Resolve the main repository root from any directory within a git repository
 * (main checkout or linked worktree). Uses `git rev-parse --git-common-dir` to
 * find the git common directory, then takes its parent as the repo root.
 *
 * - If startDir is the main repo root or a linked worktree, returns the main root.
 * - If startDir is not in a git repository, returns startDir as-is (fallback to
 *   pre-#486 behavior).
 * - Results are memoized per startDir to avoid repeated git invocations.
 * - Optional error callback for logging git failures (fallback still occurs).
 *
 * @param startDir Directory to resolve from (main root, worktree root, or any subdir)
 * @param gitRunner Optional custom git runner (for testing); not used in production
 * @param onResolveError Optional callback to log git resolution errors
 * @returns Promise<string> The main repository root (or startDir if not in a git repo)
 */
export async function resolveMainRepoRoot(
  startDir: string,
  gitRunner?: { (args: string[], cwd: string): Promise<string> },
  onResolveError?: (err: Error) => void,
): Promise<string> {
  // Check cache first
  const cached = resolveMainRepoRootCache.get(startDir);
  if (cached) {
    return cached;
  }

  // Compute the resolution
  const resultPromise = (async () => {
    try {
      // Use git rev-parse --git-common-dir to find the git directory
      // Use injected gitRunner if provided (for testing), otherwise use execFile
      const runner = gitRunner || ((args: string[], cwd: string) => execFile('git', args, { cwd }));
      const result = await runner(['rev-parse', '--git-common-dir'], startDir);

      // stdout contains the git-common-dir path (may be relative or absolute)
      let gitCommonDir = (typeof result === 'string' ? result : result.stdout).trim();

      // If relative, join it against startDir
      if (!isAbsolute(gitCommonDir)) {
        gitCommonDir = join(startDir, gitCommonDir);
      }

      // The repo root is the parent of the git common dir
      const repoRoot = dirname(gitCommonDir);
      return repoRoot;
    } catch (err) {
      // Fallback: not a git repository or git error
      if (onResolveError && err instanceof Error) {
        onResolveError(err);
      }
      return startDir;
    }
  })();

  // Cache the promise for future calls
  resolveMainRepoRootCache.set(startDir, resultPromise);

  return resultPromise;
}

/**
 * Test-only hook to reset the memoization cache between test runs.
 * Export as a no-op in production; vitest only calls this from tests.
 */
export function __resetResolveCacheForTests(): void {
  resolveMainRepoRootCache.clear();
}

function parkedMarkerPath(root: string, slug: string): string {
  return join(root, '.daemon', OPERATOR_PARKED_SUBDIR, slug);
}

/**
 * Write `.daemon/parked/<slug>` under `root`, creating the `.daemon/parked/`
 * directory chain if needed. The body records the timestamp of the write and
 * that the marker was parked by the operator — the provenance the daemon
 * dashboard surfaces.
 *
 * Idempotent: uses an exclusive create (`wx`) so a marker that already exists
 * is left completely untouched — same content, same mtime. This also makes
 * concurrent writers for the same slug race safely: exactly one create wins,
 * every other racer sees `EEXIST` and treats it as already-parked (a no-op),
 * so exactly one intact marker survives.
 *
 * If `root` is a linked worktree, the marker is written to the MAIN repository
 * root (resolved via git rev-parse --git-common-dir). This ensures markers
 * are always visible to the daemon's gate at the main checkout root.
 */
export async function writeOperatorPark(root: string, slug: string): Promise<void> {
  const mainRoot = await resolveMainRepoRoot(root);
  const dir = join(mainRoot, '.daemon', OPERATOR_PARKED_SUBDIR);
  await mkdir(dir, { recursive: true });
  const body = `${new Date().toISOString()}\nparked by operator\n`;
  let handle;
  try {
    handle = await open(parkedMarkerPath(mainRoot, slug), 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Already parked — writeOperatorPark is idempotent, so this is a no-op.
      return;
    }
    throw err;
  }
  try {
    await handle.writeFile(body, 'utf-8');
  } finally {
    await handle.close();
  }
}

/**
 * Report whether `slug` is currently operator-parked under `root`.
 *
 * Fails toward parked: a plain "marker does not exist" (ENOENT) is the only
 * case that reports `false`. Any other read error — permission denied, the
 * marker path being a directory, etc. — is treated as parked (`true`) and, if
 * `logCallback` is provided, is reported through it so the caller can surface
 * the anomaly without the check itself throwing. An empty (zero-byte) marker
 * file also reports `true`: its mere existence is the signal, not its
 * contents.
 *
 * If `root` is a linked worktree, the check is performed at the MAIN repository
 * root (resolved via git rev-parse --git-common-dir). This ensures visibility
 * to markers written from worktrees and consistency with the daemon gate.
 */
export async function isOperatorParked(
  root: string,
  slug: string,
  logCallback?: (err: Error) => void
): Promise<boolean> {
  const mainRoot = await resolveMainRepoRoot(root);
  try {
    await readFile(parkedMarkerPath(mainRoot, slug));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    if (logCallback) {
      logCallback(err as Error);
    }
    return true;
  }
}

/**
 * Delete the `.daemon/parked/<slug>` marker for `slug` under `root`.
 *
 * If `root` is a linked worktree, the marker is deleted from the MAIN repository
 * root (resolved via git rev-parse --git-common-dir).
 */
export async function removeOperatorPark(root: string, slug: string): Promise<void> {
  const mainRoot = await resolveMainRepoRoot(root);
  await rm(parkedMarkerPath(mainRoot, slug), { force: true });
}

/**
 * List every slug with a live `.daemon/parked/<slug>` marker under `root`.
 * Used by the dashboard (FR-6) to surface a STALE park — a marker left
 * behind for a slug with no worktree and no backlog entry — which would
 * otherwise be invisible to every other scan. `[]` when the directory is
 * absent (no parks yet).
 *
 * If `root` is a linked worktree, lists markers from the MAIN repository
 * root (resolved via git rev-parse --git-common-dir).
 */
export async function listOperatorParkedSlugs(root: string): Promise<string[]> {
  const mainRoot = await resolveMainRepoRoot(root);
  const dir = join(mainRoot, '.daemon', OPERATOR_PARKED_SUBDIR);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Write an auto-park marker (`.daemon/parked/<slug>`) created by the machine
 * (e.g., "No evidence after N attempts"), distinct from operator-park markers.
 *
 * The marker body has the format:
 * ```
 * auto-parked: <reason>
 * timestamp: <ISO-8601>
 * ```
 *
 * Idempotent: uses an exclusive create (`wx`) so a marker that already exists
 * is left completely untouched — same content, same mtime. Concurrent writers
 * for the same slug race safely: exactly one create wins, others see `EEXIST`
 * and treat it as already-parked (a no-op).
 *
 * If `root` is a linked worktree, the marker is written to the MAIN repository
 * root (resolved via git rev-parse --git-common-dir). This ensures markers
 * written from build agents in worktrees are visible to the daemon's gate at
 * the main checkout root, fixing the #486 regression where worktree-written
 * markers were invisible to the sweep gate.
 */
export async function writeAutoPark(root: string, slug: string, reason: string): Promise<void> {
  const mainRoot = await resolveMainRepoRoot(root);
  const dir = join(mainRoot, '.daemon', OPERATOR_PARKED_SUBDIR);
  await mkdir(dir, { recursive: true });
  const body = `auto-parked: ${reason}\ntimestamp: ${new Date().toISOString()}\n`;
  let handle;
  try {
    handle = await open(parkedMarkerPath(mainRoot, slug), 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Already parked — writeAutoPark is idempotent, so this is a no-op.
      return;
    }
    throw err;
  }
  try {
    await handle.writeFile(body, 'utf-8');
  } finally {
    await handle.close();
  }
}

/**
 * Distinguish the provenance of a park marker:
 * - `'auto'` if the marker was created by writeAutoPark() (machine provenance)
 * - `'operator'` if the marker was created by writeOperatorPark() (operator provenance)
 * - `null` if no marker exists for this slug
 *
 * Reads the marker file and checks the prefix:
 * - If it starts with `auto-parked:`, returns 'auto'
 * - Otherwise (operator-park format), returns 'operator'
 * - ENOENT returns null
 *
 * If `root` is a linked worktree, the check is performed at the MAIN repository
 * root (resolved via git rev-parse --git-common-dir).
 */
export async function getProvenanceType(
  root: string,
  slug: string
): Promise<'auto' | 'operator' | null> {
  const mainRoot = await resolveMainRepoRoot(root);
  try {
    const content = await readFile(parkedMarkerPath(mainRoot, slug), 'utf-8');
    if (content.startsWith('auto-parked:')) {
      return 'auto';
    }
    return 'operator';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Alias for getProvenanceType — read park provenance (auto vs operator).
 * Maintained for backward compatibility with acceptance tests.
 */
export const readParkProvenance = getProvenanceType;
