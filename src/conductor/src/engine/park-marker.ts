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
import { join } from 'node:path';

/** Directory (relative to project root) that holds per-slug park markers. */
export const OPERATOR_PARKED_SUBDIR = 'parked';

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
 */
export async function writeOperatorPark(root: string, slug: string): Promise<void> {
  const dir = join(root, '.daemon', OPERATOR_PARKED_SUBDIR);
  await mkdir(dir, { recursive: true });
  const body = `${new Date().toISOString()}\nparked by operator\n`;
  let handle;
  try {
    handle = await open(parkedMarkerPath(root, slug), 'wx');
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
 */
export async function isOperatorParked(
  root: string,
  slug: string,
  logCallback?: (err: Error) => void
): Promise<boolean> {
  try {
    await readFile(parkedMarkerPath(root, slug));
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

/** Delete the `.daemon/parked/<slug>` marker for `slug` under `root`. */
export async function removeOperatorPark(root: string, slug: string): Promise<void> {
  await rm(parkedMarkerPath(root, slug), { force: true });
}

/**
 * List every slug with a live `.daemon/parked/<slug>` marker under `root`.
 * Used by the dashboard (FR-6) to surface a STALE park — a marker left
 * behind for a slug with no worktree and no backlog entry — which would
 * otherwise be invisible to every other scan. `[]` when the directory is
 * absent (no parks yet).
 */
export async function listOperatorParkedSlugs(root: string): Promise<string[]> {
  const dir = join(root, '.daemon', OPERATOR_PARKED_SUBDIR);
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
 */
export async function writeAutoPark(root: string, slug: string, reason: string): Promise<void> {
  const dir = join(root, '.daemon', OPERATOR_PARKED_SUBDIR);
  await mkdir(dir, { recursive: true });
  const body = `auto-parked: ${reason}\ntimestamp: ${new Date().toISOString()}\n`;
  let handle;
  try {
    handle = await open(parkedMarkerPath(root, slug), 'wx');
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
 */
export async function getProvenanceType(
  root: string,
  slug: string
): Promise<'auto' | 'operator' | null> {
  try {
    const content = await readFile(parkedMarkerPath(root, slug), 'utf-8');
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
