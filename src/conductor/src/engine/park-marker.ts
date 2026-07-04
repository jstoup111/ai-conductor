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

import { mkdir, open, readFile, rm } from 'node:fs/promises';
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
