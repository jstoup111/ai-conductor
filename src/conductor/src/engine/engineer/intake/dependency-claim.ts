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

export type ClaimOutcome =
  | { kind: 'claim'; envelope: ClaimableEnvelope }
  | { kind: 'empty' };

/**
 * Walk pending intake entries oldest-first (via the queue's own atomic
 * claim() primitive), deferring any entry whose blocker verdict is not
 * `unblocked`. Deferred entries are released back to the queue unchanged —
 * no ledger write, no attempt increment.
 *
 * Returns the first `unblocked` entry as a claim. If the walk exhausts the
 * queue without finding one, returns `{ kind: 'empty' }` (Task 21 will
 * replace this branch with a distinct all-blocked outcome when there WERE
 * deferred entries).
 */
export async function claimUnblocked(deps: DependencyClaimDeps): Promise<ClaimOutcome> {
  const { queue, resolveDependency } = deps;
  const held: ClaimableEnvelope[] = [];

  try {
    for (;;) {
      const envelope = await queue.claim();
      if (!envelope) {
        return { kind: 'empty' };
      }

      const verdict = await resolveDependency(envelope.sourceRef);
      if (verdict.kind === 'unblocked') {
        return { kind: 'claim', envelope };
      }

      // blocked / indeterminate / cycle — defer, stateless, keep walking.
      held.push(envelope);
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
