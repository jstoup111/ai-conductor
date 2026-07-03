// engineer/intake/dependency-claim.ts — dependency-aware wrapper around the
// existing file-backed IntakeQueue. FR-8 (oldest-unblocked wins), FR-9
// (all-blocked distinct from empty — Task 21), FR-12 (cycle defers, never
// dropped). Task 19: this file currently implements only the oldest-unblocked
// walk; the all-blocked outcome lands in Task 21.

import type { BlockerVerdict } from '../../blocker-resolver.js';

/** Minimal envelope shape this module cares about. */
export interface ClaimableEnvelope {
  sourceRef?: string;
  [key: string]: unknown;
}

/** The subset of IntakeQueue this walk needs. */
export interface DependencyClaimQueue {
  claim(): Promise<ClaimableEnvelope | null>;
  release(e: ClaimableEnvelope): Promise<void>;
}

/** Injected dependency resolution — typically `resolver.resolve` from
 * createBlockerResolver, bound once per claim call. */
export type ResolveDependency = (sourceRef: string | undefined) => Promise<BlockerVerdict>;

/** Ledger is accepted for interface parity with the real claim path but is
 * intentionally NOT written to for deferred entries — deferral is stateless
 * (no status change, no attempt increment). */
export interface DependencyClaimLedger {
  transition(source: string, sourceRef: string, status: string): Promise<void>;
}

export interface DependencyClaimDeps {
  queue: DependencyClaimQueue;
  resolveDependency: ResolveDependency;
  ledger?: DependencyClaimLedger;
}

/** A single deferred entry surfaced in an all-blocked report. */
export interface AllBlockedEntry {
  envelope: ClaimableEnvelope;
  verdict: BlockerVerdict;
}

export type ClaimOutcome =
  | { kind: 'claim'; envelope: ClaimableEnvelope }
  | { kind: 'empty' }
  | { kind: 'all-blocked'; entries: AllBlockedEntry[] };

/**
 * Walk pending intake entries oldest-first (via the queue's own atomic
 * claim() primitive), deferring any entry whose blocker verdict is not
 * `unblocked`. Deferred entries are released back to the queue unchanged —
 * no ledger write, no attempt increment.
 *
 * Returns the first `unblocked` entry as a claim. If the walk exhausts the
 * queue without finding one:
 *  - `{ kind: 'empty' }` when the queue had no pending entries at all.
 *  - `{ kind: 'all-blocked', entries }` when every pending entry was deferred
 *    (blocked, indeterminate, or cycle) — distinct from empty, so operators
 *    can see WHY the queue is stalled and by what.
 */
export async function claimUnblocked(deps: DependencyClaimDeps): Promise<ClaimOutcome> {
  const { queue, resolveDependency } = deps;
  const held: ClaimableEnvelope[] = [];
  const deferred: AllBlockedEntry[] = [];

  try {
    for (;;) {
      const envelope = await queue.claim();
      if (!envelope) {
        return deferred.length > 0 ? { kind: 'all-blocked', entries: deferred } : { kind: 'empty' };
      }

      const verdict = await resolveDependency(envelope.sourceRef);
      if (verdict.kind === 'unblocked') {
        return { kind: 'claim', envelope };
      }

      // blocked / indeterminate / cycle — defer, stateless, keep walking.
      held.push(envelope);
      deferred.push({ envelope, verdict });
    }
  } finally {
    // Release every deferred entry back to the queue, regardless of how the
    // walk ended (claim found, empty, or an unexpected throw) — deferral
    // must never drop an entry from the queue.
    for (const envelope of held) {
      await queue.release(envelope);
    }
  }
}
