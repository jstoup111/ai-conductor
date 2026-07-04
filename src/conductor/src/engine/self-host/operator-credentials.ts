// self-host/operator-credentials.ts — operator credentials freshness classifier
//
// Phase 2 (TR-2): the pre-flight must identify expired or imminent-expiry
// credentials so the conductor parks BEFORE launching a build, blocking on
// an operator refresh rather than burning a retry budget or HALTing.
//
// The imminent-expiry margin buffers for token rotation delays + time between
// the pre-flight check and actual build invocation. We use 7 days.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Imminent-expiry margin in milliseconds.
 * Tokens expiring within this window are treated as expired.
 */
const IMMINENT_EXPIRY_MARGIN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Reads the operator credentials file and classifies the OAuth token state.
 * Fails open: any read error or malformed structure returns 'unknown'.
 *
 * @param globalConfigDir The operator's global config directory (typically ~/.claude)
 * @param now Current timestamp in milliseconds for testing/injection
 * @returns 'fresh' if the token expires beyond the margin, 'expired' if it expires
 *          before the margin or is already past expiry, 'unknown' for any error
 */
export async function readOperatorCredentialsState(
  globalConfigDir: string,
  now: number,
): Promise<'fresh' | 'expired' | 'unknown'> {
  try {
    const credPath = join(globalConfigDir, '.credentials.json');
    const contents = await readFile(credPath, 'utf-8');
    const creds = JSON.parse(contents);

    // Fail-open: no claudeAiOauth block
    if (!creds.claudeAiOauth || typeof creds.claudeAiOauth !== 'object') {
      return 'unknown';
    }

    const { expiresAt } = creds.claudeAiOauth;

    // Fail-open: expiresAt is missing or not a number
    if (typeof expiresAt !== 'number') {
      return 'unknown';
    }

    // Calculate the expiry window start (when tokens become imminent)
    const imminentWindowStart = now + IMMINENT_EXPIRY_MARGIN_MS;

    // If the token expires before the window starts, it's already expired or imminent
    if (expiresAt <= imminentWindowStart) {
      return 'expired';
    }

    return 'fresh';
  } catch {
    // Fail-open: read error, parse error, or any other exception
    return 'unknown';
  }
}
