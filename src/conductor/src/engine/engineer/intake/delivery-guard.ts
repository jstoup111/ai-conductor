// delivery-guard module — PR state verification probe (Task 1, TR-1)
//
// Provides PR state probing utilities for the claim delivery guard.
// Used to detect when a spec PR has been closed-unmerged (re-eligibility trigger).

/** Shell runner for the `gh` CLI. Mirrors the engineer loop's GhRunner shape. */
export type GhRunner = (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;

/** Discriminated PR state from verifyPrState probe. */
export type PrState = 'open' | 'merged' | 'closed-unmerged' | 'unknown';

/**
 * Probe GitHub PR state via gh runner.
 *
 * Calls `gh pr view <url> --json state,mergedAt` and maps the response to a
 * discriminated state. Handles errors gracefully — if gh throws or stdout
 * is unparseable JSON, returns 'unknown' instead of crashing.
 *
 * @param gh - The gh CLI runner (shells `gh <args>` with cwd context)
 * @param url - The GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)
 * @returns One of: 'open' | 'merged' | 'closed-unmerged' | 'unknown'
 */
export async function verifyPrState(gh: GhRunner, url: string): Promise<PrState> {
  try {
    // Shell out to gh pr view with JSON output for state and mergedAt.
    const { stdout } = await gh(['pr', 'view', url, '--json', 'state,mergedAt'], {
      cwd: process.cwd(),
    });

    // Parse the JSON response.
    const pr = JSON.parse(stdout || '{}') as { state?: string; mergedAt?: string | null };

    // Map state to PrState.
    if (pr.state === 'OPEN') {
      return 'open';
    }

    if (pr.state === 'MERGED') {
      return 'merged';
    }

    if (pr.state === 'CLOSED' && pr.mergedAt === null) {
      return 'closed-unmerged';
    }

    // Unrecognized state → unknown.
    return 'unknown';
  } catch {
    // gh threw or any other error → unknown.
    return 'unknown';
  }
}
