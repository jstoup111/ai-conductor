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

import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
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
 */
export async function writeOperatorPark(root: string, slug: string): Promise<void> {
  const dir = join(root, '.daemon', OPERATOR_PARKED_SUBDIR);
  await mkdir(dir, { recursive: true });
  const body = `${new Date().toISOString()}\nparked by operator\n`;
  await writeFile(parkedMarkerPath(root, slug), body, 'utf-8');
}

/**
 * Report whether `slug` is currently operator-parked under `root` — existence
 * of `.daemon/parked/<slug>` is authoritative.
 */
export async function isOperatorParked(root: string, slug: string): Promise<boolean> {
  try {
    await stat(parkedMarkerPath(root, slug));
    return true;
  } catch {
    return false;
  }
}

/** Delete the `.daemon/parked/<slug>` marker for `slug` under `root`. */
export async function removeOperatorPark(root: string, slug: string): Promise<void> {
  await rm(parkedMarkerPath(root, slug), { force: true });
}
