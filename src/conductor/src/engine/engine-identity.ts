// ── Engine identity capture ─────────────────────────────────────────────────
//
// Capture the sha256 hash of an engine binary or build artifact to detect stale
// or corrupted engine executables. Two identical files will always produce the
// same hash, enabling identity comparison for engine freshness checks.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, constants } from 'node:fs/promises';

/**
 * Represents a checker that determines if the current engine is stale,
 * current, or indeterminate based on identity comparison.
 */
export interface StaleEngineChecker {
  check(): 'stale' | 'current' | 'indeterminate';
}

/**
 * Capture the sha256 hash of a file's bytes. Returns a 64-character hex string
 * representing the sha256 digest, or null if the file cannot be read or does
 * not exist.
 *
 * Two identical files will always produce the same hash. This is suitable for
 * detecting stale or corrupted engine artifacts.
 *
 * @param entryPath - The path to the file to hash
 * @returns A promise resolving to the sha256 hash (64 hex chars) or null on error
 */
export async function captureEngineIdentity(entryPath: string): Promise<string | null> {
  try {
    // Verify the file exists and is readable before starting the hash
    await access(entryPath, constants.R_OK);
  } catch {
    // File does not exist or is not readable
    return null;
  }

  return new Promise((resolve) => {
    const hash = createHash('sha256');
    const stream = createReadStream(entryPath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      const digest = hash.digest('hex');
      resolve(digest);
    });

    stream.on('error', () => {
      // If the stream errors (e.g., permission denied at read time), return null
      resolve(null);
    });
  });
}

/**
 * Create a checker that compares engine identities to detect staleness.
 *
 * When `captured` is null (indicating capture failed), the checker is disabled:
 * - Always returns 'current' (conservative: assume the engine is fresh)
 * - Never accesses the filesystem
 * - Calls the warn callback exactly once at construction time
 *
 * When `captured` is a valid hash string, the checker is enabled and can perform
 * actual staleness checks (implementation in later tasks).
 *
 * @param captured - The captured engine identity (sha256 hash) or null if capture failed
 * @param warn - Optional callback to warn about capture failure
 * @returns A StaleEngineChecker that can determine engine freshness
 */
export function createStaleEngineChecker(
  captured: string | null,
  warn?: (msg: string) => void
): StaleEngineChecker {
  // When captured is null, the checker is disabled
  if (captured === null) {
    if (warn) {
      warn('Engine identity capture failed; stale-engine checker disabled');
    }

    // Return a permanently disabled checker
    return {
      check(): 'stale' | 'current' | 'indeterminate' {
        return 'current';
      }
    };
  }

  // When captured is a valid hash, the checker is enabled
  // Full implementation of staleness detection comes in later tasks
  return {
    check(): 'stale' | 'current' | 'indeterminate' {
      return 'indeterminate';
    }
  };
}
