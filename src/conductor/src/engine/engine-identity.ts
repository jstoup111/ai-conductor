// ── Engine identity capture ─────────────────────────────────────────────────
//
// Capture the sha256 hash of an engine binary or build artifact to detect stale
// or corrupted engine executables. Two identical files will always produce the
// same hash, enabling identity comparison for engine freshness checks.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, constants } from 'node:fs/promises';

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
