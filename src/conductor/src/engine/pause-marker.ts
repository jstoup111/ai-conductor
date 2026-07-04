// pause-marker.ts — the single source of truth for the `.daemon/PAUSED` marker.
//
// A PAUSE parks dispatch without halting the daemon: the daemon loop treats
// the presence of `.daemon/PAUSED` as a signal to stop starting new work while
// leaving in-flight work and the daemon process itself alone. It is the
// sibling of `halt-marker.ts` (FR-1/FR-4): existence of the file is
// authoritative, and the JSON body is informational metadata only (who
// paused it and when) — never load-bearing for the pause/resume decision
// itself. A missing or corrupt marker must never be mistaken for "not
// paused"; reads fail closed.

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The dispatch-pause marker the daemon loop treats as a stop-new-work signal. */
export const PAUSE_MARKER = '.daemon/PAUSED';

/** Informational metadata recorded alongside a pause. Never authoritative. */
export interface PauseMetadata {
  pausedAt: string;
  pausedBy?: string;
}

/**
 * Report whether `.daemon/PAUSED` exists under `projectRoot`. Existence is
 * authoritative: a missing file (ENOENT) is "not paused"; any other read
 * failure (permissions, corrupt content, etc.) is treated as paused —
 * fail-closed, since a false "not paused" would let dispatch race ahead.
 */
export async function isPaused(projectRoot: string): Promise<boolean> {
  try {
    await readFile(join(projectRoot, PAUSE_MARKER), 'utf-8');
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return false;
    }
    // Any other failure (corrupt content is read fine but re-thrown by
    // readPauseMetadata's caller; a permissions error, etc.) — fail closed.
    return true;
  }
}

/**
 * Read the informational metadata from `.daemon/PAUSED`, or `undefined` if
 * the marker is absent, unreadable, or contains invalid JSON. Metadata is
 * never authoritative for the pause decision — only `isPaused` is.
 */
export async function readPauseMetadata(projectRoot: string): Promise<PauseMetadata | undefined> {
  try {
    const raw = await readFile(join(projectRoot, PAUSE_MARKER), 'utf-8');
    return JSON.parse(raw) as PauseMetadata;
  } catch {
    return undefined;
  }
}

/**
 * Write `.daemon/PAUSED` under `projectRoot`, creating `.daemon/` if needed.
 * Idempotent: calling repeatedly simply overwrites the metadata (e.g. with a
 * fresh `pausedAt`/`pausedBy`) without erroring.
 */
export async function writePauseMarker(
  projectRoot: string,
  meta: { pausedBy?: string } = {},
): Promise<void> {
  await mkdir(join(projectRoot, '.daemon'), { recursive: true });
  const payload: PauseMetadata = {
    pausedAt: new Date().toISOString(),
    ...(meta.pausedBy !== undefined ? { pausedBy: meta.pausedBy } : {}),
  };
  await writeFile(join(projectRoot, PAUSE_MARKER), JSON.stringify(payload), 'utf-8');
}

/**
 * Remove `.daemon/PAUSED` under `projectRoot`. Idempotent: safe to call when
 * no marker exists (ENOENT is swallowed).
 */
export async function removePauseMarker(projectRoot: string): Promise<void> {
  await unlink(join(projectRoot, PAUSE_MARKER)).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      throw err;
    }
  });
}
