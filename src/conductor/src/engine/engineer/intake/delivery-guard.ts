// delivery-guard module — PR state verification probe (Task 1, TR-1) and
// claim delivery guard decorator (Task 2, TR-2)
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

// ─── createDeliveryGuardedQueue ────────────────────────────────────────────────

/** Minimal envelope shape this module cares about. */
export interface GuardedEnvelope {
  source?: string;
  sourceRef?: string;
  [key: string]: unknown;
}

/** The subset of IntakeQueue this decorator wraps. */
export interface GuardedQueue {
  claim(): Promise<GuardedEnvelope | null>;
  release(e: GuardedEnvelope): Promise<void>;
}

/** Minimal ledger interface for guard. */
export interface GuardLedger {
  get(source: string, sourceRef: string): Promise<any>;
  record(input: { source: string; sourceRef: string }): Promise<void>;
  transition(...args: any[]): Promise<void>;
}

/** Dependencies passed to the decorator. */
export interface DeliveryGuardDeps {
  gh: GhRunner;
}

/**
 * Decorator that wraps a queue with claim/release guard logic.
 *
 * For healthy candidates (no ledger entry or status 'pending'/'unseen'),
 * passes through unchanged without ledger writes or gh calls.
 *
 * Holds rejected candidates in an internal list for later release patterns
 * (implemented in later tasks).
 *
 * @param queue - The underlying IntakeQueue to wrap
 * @param ledger - The ledger for duplicate detection
 * @param deps - Dependencies (gh runner, etc.)
 * @returns A wrapped queue with { claim(), release() }
 */
export function createDeliveryGuardedQueue(
  queue: GuardedQueue,
  ledger: GuardLedger,
  deps: DeliveryGuardDeps,
): GuardedQueue {
  const held: GuardedEnvelope[] = [];

  return {
    async claim(): Promise<GuardedEnvelope | null> {
      const candidate = await queue.claim();
      if (!candidate) return null;

      const source = String(candidate.source ?? '');
      const sourceRef = String(candidate.sourceRef ?? '');

      // Check if ledger has an entry for this candidate
      const entry = await ledger.get(source, sourceRef);

      // Healthy path: no ledger entry (non-recording source) or pending status
      if (!entry || entry.status === 'pending' || entry.status === 'unseen') {
        // Passthrough unchanged — no ledger writes, no gh calls
        return candidate;
      }

      // Problematic candidate — hold it for later release pattern
      held.push(candidate);

      // Continue scanning for the next candidate
      return this.claim();
    },

    async release(e: GuardedEnvelope): Promise<void> {
      await queue.release(e);
    },
  };
}
