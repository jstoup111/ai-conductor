import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// ── Restart-intent marker (Task 5, daemon auto-restart feature) ───────────────
//
// Pure, injected helpers for the restart-intent marker schema. When the daemon
// detects a stale engine, it writes a RESTART_PENDING marker with structured
// metadata (reason, fromIdentity, targetIdentity, at) and polls for clearance
// before spawning a new engine. The marker tracks why the restart was issued
// and identifies the actors involved (daemon → engine).
//
// Round-trip guarantees: all fields (including null identities) are preserved
// exactly through write → JSON → read, so downstream logic can rely on
// structured data without parsing strings. Never throws on read/write/clear;
// failures are logged (if a logger is provided) and degraded gracefully.

/** Relative path (under the project root) of the restart-pending marker. */
export const RESTART_MARKER_PATH = '.daemon/RESTART_PENDING';

/**
 * RestartMarker captures the structured metadata for a pending engine restart.
 * All fields are required (though identities may be null) and round-trip
 * losslessly through the JSON file.
 */
export interface RestartMarker {
  /** Why the restart was triggered (e.g., "engine stalled for 30s"). */
  reason: string;
  /** Identity of the daemon/actor issuing the restart request (may be null). */
  fromIdentity: string | null;
  /** Identity of the engine being restarted (may be null). */
  targetIdentity: string | null;
  /** Timestamp when the restart was requested (Date.getTime() or ISO ms). */
  at: number;
}

/**
 * Write a restart marker to `<dir>/.daemon/RESTART_PENDING`. Creates `.daemon/`
 * if needed. The marker is stored as JSON and includes all fields exactly as
 * provided (including null identities). A failed write is swallowed (logged if
 * a logger is provided) so persistence failure degrades gracefully without
 * crashing the poll loop. Never throws.
 */
export async function writeRestartMarker(
  marker: RestartMarker,
  dir: string,
  log?: (msg: string) => void,
): Promise<void> {
  const target = join(dir, RESTART_MARKER_PATH);
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(marker, null, 2), 'utf-8');
  } catch (err) {
    log?.(
      `could not persist restart marker: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Read the restart marker from `<dir>/.daemon/RESTART_PENDING`. Returns the
 * parsed marker with all fields preserved exactly as written (including null
 * identities and the exact timestamp). Returns `null` if the file does not
 * exist or cannot be read. Returns `null` if the file content is not valid
 * JSON (corrupt marker). Never throws.
 */
export async function readRestartMarker(dir: string): Promise<RestartMarker | null> {
  try {
    const raw = await readFile(join(dir, RESTART_MARKER_PATH), 'utf-8');
    const parsed = JSON.parse(raw) as RestartMarker;
    return parsed;
  } catch {
    return null; // absent / unreadable / corrupt JSON → null
  }
}

/**
 * Delete the restart marker at `<dir>/.daemon/RESTART_PENDING`. A failed
 * delete is swallowed (logged if a logger is provided) so cleanup failure
 * degrades gracefully. Never throws.
 */
export async function clearRestartMarker(
  dir: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await rm(join(dir, RESTART_MARKER_PATH), { force: true });
  } catch (err) {
    log?.(
      `could not delete restart marker: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
