// self-host/daemon-build-token.ts — daemon-owned build token reader seam
//
// Task 5 (TR-3, TR-2): the daemon maintains its own build auth token at a
// configured path, separate from operator OAuth. This reader is the
// BuildAuthProvider seam: the conductor consumes only this reader, so
// EKS/platform identity later swaps the reader implementation.
//
// The reader classifies token state into three outcomes:
// - { state: 'ok', token } — file exists, is readable, and contains non-empty
//   trimmed content. Token is trimmed of leading/trailing whitespace.
// - { state: 'missing' } — file does not exist, or contains only whitespace.
// - { state: 'error', detail } — file exists but is unreadable (e.g., chmod 000).
//   The detail string names the path for diagnostics.

import { readFile } from 'node:fs/promises';

/** Result of reading a daemon build token: discriminated union. */
export type DaemonBuildTokenResult =
  | { state: 'ok'; token: string }
  | { state: 'missing' }
  | { state: 'error'; detail: string };

/**
 * Reads the daemon-owned build token from a file path.
 *
 * Classifies the token state:
 * - 'ok': file exists, is readable, and contains non-empty content (trimmed).
 * - 'missing': file does not exist, or contains only whitespace.
 * - 'error': file exists but cannot be read (detail names the path).
 *
 * The token value is trimmed of leading and trailing whitespace. Empty or
 * whitespace-only files are treated as 'missing' (fail-closed for token
 * presence; an unintentional empty file is treated the same as no file).
 *
 * @param path Absolute path to the daemon build token file.
 * @returns Promise resolving to a DaemonBuildTokenResult discriminated union.
 */
export async function readDaemonBuildToken(
  path: string,
): Promise<DaemonBuildTokenResult> {
  try {
    const contents = await readFile(path, 'utf-8');
    const trimmed = contents.trim();

    // Empty or whitespace-only file is treated as missing
    if (trimmed.length === 0) {
      return { state: 'missing' };
    }

    return { state: 'ok', token: trimmed };
  } catch (err: unknown) {
    // File does not exist
    if (
      err instanceof Error &&
      err.message.includes('ENOENT')
    ) {
      return { state: 'missing' };
    }

    // Any other error (EACCES, EIO, etc.) is treated as unreadable
    const errorMsg = err instanceof Error ? err.message : String(err);
    const detail = `cannot read daemon build token: ${path} (${errorMsg})`;
    return { state: 'error', detail };
  }
}
