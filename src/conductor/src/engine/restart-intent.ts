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

/** Relative path (under the project root) of the restart suppression record. */
export const SUPPRESSION_PATH = '.daemon/RESTART_PENDING.suppression';

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
 * RestartMarkerStatus distinguishes between present, absent, and corrupt markers.
 * Used by readRestartMarkerWithStatus to provide structured status information.
 */
export interface RestartMarkerStatus {
  /** One of: 'present' (valid marker), 'absent' (missing), 'absent-corrupt' (unreadable). */
  kind: 'present' | 'absent' | 'absent-corrupt';
  /** The parsed marker if present; null otherwise. */
  marker: RestartMarker | null;
  /** Optional error description for debugging (only set for absent-corrupt). */
  error?: string;
}

/**
 * SuppressionRecord tracks when a restart loop was suppressed due to non-convergence.
 * When the daemon detects that the engine identity differs from the marker's target
 * identity at boot, it records the current (fresh) identity to prevent repeated
 * restart attempts for that same identity.
 */
export interface SuppressionRecord {
  /** The identity being suppressed (null if suppression could not be determined). */
  suppressedTarget: string | null;
  /** Timestamp when suppression was recorded (Date.getTime() or ISO ms). */
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

/**
 * Read the restart marker with structured status distinguishing absent vs corrupt.
 * Returns a status object with kind and marker:
 * - 'present': marker file exists and is valid JSON
 * - 'absent': marker file does not exist (silent, no warning)
 * - 'absent-corrupt': marker file exists but contains invalid JSON
 *   → the corrupt file is automatically removed
 *   → one warning is logged (if a logger is provided) naming the corruption
 *
 * Never throws; all errors are degraded gracefully.
 */
export async function readRestartMarkerWithStatus(
  dir: string,
  log?: (msg: string) => void,
): Promise<RestartMarkerStatus> {
  const filePath = join(dir, RESTART_MARKER_PATH);

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as RestartMarker;
    return {
      kind: 'present',
      marker: parsed,
    };
  } catch (err) {
    // Distinguish: file not found (absent) vs file exists but corrupt (absent-corrupt)
    const isNotFound =
      err instanceof Error && 'code' in err && err.code === 'ENOENT';

    if (isNotFound) {
      // File does not exist — silent return, no warning
      return {
        kind: 'absent',
        marker: null,
      };
    }

    // File exists but is corrupt (invalid JSON or other read error)
    // Remove the corrupt file and log a warning
    const errorMsg = err instanceof Error ? err.message : String(err);
    log?.(
      `restart marker is corrupt and will be removed: ${errorMsg}`,
    );

    // Attempt to remove the corrupt file
    try {
      await rm(filePath, { force: true });
    } catch (rmErr) {
      log?.(
        `could not remove corrupt restart marker: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`,
      );
    }

    return {
      kind: 'absent-corrupt',
      marker: null,
      error: errorMsg,
    };
  }
}

/**
 * Record a suppression for a non-convergent identity at boot.
 *
 * When the daemon detects that the fresh engine identity differs from the marker's
 * target identity, it records the current on-disk identity to suppress repeated
 * restart attempts for that identity. The suppression persists alongside the marker
 * at `<dir>/.daemon/RESTART_PENDING.suppression` and prevents re-triggering until
 * the identity moves to a new value.
 *
 * A failed write is swallowed (logged if a logger is provided) so persistence failure
 * degrades gracefully without crashing. Never throws.
 */
export async function recordSuppression(
  suppressedTarget: string | null,
  dir: string,
  log?: (msg: string) => void,
): Promise<void> {
  const target = join(dir, SUPPRESSION_PATH);
  const record: SuppressionRecord = {
    suppressedTarget,
    at: Date.now(),
  };

  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(record, null, 2), 'utf-8');
  } catch (err) {
    log?.(
      `could not persist suppression record: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Read the suppression record from `<dir>/.daemon/RESTART_PENDING.suppression`.
 * Returns the parsed suppression record with all fields preserved exactly as written
 * (including null suppressedTarget and the exact timestamp). Returns `null` if the
 * file does not exist or cannot be read. Returns `null` if the file content is not
 * valid JSON (corrupt suppression). Never throws.
 */
export async function getSuppression(dir: string): Promise<SuppressionRecord | null> {
  try {
    const raw = await readFile(join(dir, SUPPRESSION_PATH), 'utf-8');
    const parsed = JSON.parse(raw) as SuppressionRecord;
    return parsed;
  } catch {
    return null; // absent / unreadable / corrupt JSON → null
  }
}
