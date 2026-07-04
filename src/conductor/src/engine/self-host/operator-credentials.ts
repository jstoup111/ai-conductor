// self-host/operator-credentials.ts — operator credentials freshness classifier
//
// Phase 2 (TR-2): the pre-flight must identify expired or imminent-expiry
// credentials so the conductor parks BEFORE launching a build, blocking on
// an operator refresh rather than burning a retry budget or HALTing.
//
// The imminent-expiry margin buffers for token rotation delays + time between
// the pre-flight check and actual build invocation. Real OAuth tokens live for
// hours, so the margin must stay well under that or every dispatch parks.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Imminent-expiry margin in milliseconds.
 * Tokens expiring within this window are treated as expired.
 */
const IMMINENT_EXPIRY_MARGIN_MS = 5 * 60 * 1000; // 5 minutes

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

/**
 * Polls for credentials file changes until it becomes fresh or timeout elapses.
 * Used in Phase 3 (TR-3 & TR-4): park-and-poll mechanism.
 *
 * Polling loop checks mtime advancement and reclassifies the credentials state.
 * - If state becomes 'fresh': resolves with 'refreshed' + state
 * - If state remains 'expired' or 'unknown': keeps polling
 * - If file is deleted: keeps polling (fail-open, no crash)
 * - If timeout elapses: resolves with 'timeout' + last observed state + path
 *
 * @param config Configuration object with injected dependencies for testability
 * @returns Promise resolving to { type: 'refreshed' | 'timeout', ... }
 */
export async function waitForCredentialsChange(config: {
  initialState: 'fresh' | 'expired' | 'unknown';
  credentialsPath: string;
  globalConfigDir: string;
  timeoutMs: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<{
  type: 'refreshed' | 'timeout';
  credentialsState?: 'fresh' | 'expired' | 'unknown';
  credentialsPath: string;
  expiresAt?: string;
}> {
  const {
    initialState,
    credentialsPath,
    globalConfigDir,
    timeoutMs,
    pollIntervalMs = 1000,
    sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
  } = config;

  const startTime = now();
  let lastObservedExpiresAt: string | undefined;

  // Try to get initial mtime
  let lastMtime: number | undefined;
  try {
    const stats = await stat(credentialsPath);
    lastMtime = stats.mtimeMs;
  } catch {
    // File doesn't exist yet; that's okay, keep polling
  }

  // Extract initial expiresAt for timeout fallback
  try {
    const contents = await readFile(credentialsPath, 'utf-8');
    const creds = JSON.parse(contents);
    if (creds.claudeAiOauth?.expiresAt !== undefined) {
      lastObservedExpiresAt = String(creds.claudeAiOauth.expiresAt);
    }
  } catch {
    // File unreadable; that's okay, keep polling
  }

  // Polling loop
  while (true) {
    const elapsed = now() - startTime;

    // Check timeout
    if (elapsed >= timeoutMs) {
      return {
        type: 'timeout',
        credentialsPath,
        credentialsState: initialState,
        expiresAt: lastObservedExpiresAt,
      };
    }

    // Sleep before the next poll
    await sleep(pollIntervalMs);

    // Check for mtime advancement
    let mtimeAdvanced = false;
    let currentMtime: number | undefined;
    try {
      const stats = await stat(credentialsPath);
      currentMtime = stats.mtimeMs;
      if (lastMtime !== undefined && currentMtime > lastMtime) {
        mtimeAdvanced = true;
        lastMtime = currentMtime;
      } else if (lastMtime === undefined) {
        // File appeared for the first time
        lastMtime = currentMtime;
        mtimeAdvanced = true;
      }
    } catch {
      // File doesn't exist or is unreadable; keep polling
      mtimeAdvanced = false;
    }

    // If mtime advanced, reclassify the credentials
    if (mtimeAdvanced) {
      const newState = await readOperatorCredentialsState(globalConfigDir, now());

      // Update last observed expiresAt for timeout fallback
      try {
        const contents = await readFile(credentialsPath, 'utf-8');
        const creds = JSON.parse(contents);
        if (creds.claudeAiOauth?.expiresAt !== undefined) {
          lastObservedExpiresAt = String(creds.claudeAiOauth.expiresAt);
        }
      } catch {
        // Unreadable; keep the last observed value
      }

      // If fresh, resolve immediately
      if (newState === 'fresh') {
        return {
          type: 'refreshed',
          credentialsState: newState,
          credentialsPath,
        };
      }
      // Otherwise, keep polling (still expired or unknown)
    }
  }
}
