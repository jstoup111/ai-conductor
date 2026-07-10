// engineer/intake/dependency-claim.ts — dependency-aware wrapper around the
// existing file-backed IntakeQueue. FR-8 (oldest-unblocked wins), FR-9
// (all-blocked distinct from empty — Task 21), FR-12 (cycle defers, never
// dropped). Task 19: this file currently implements only the oldest-unblocked
// walk; the all-blocked outcome lands in Task 21.

import type { BlockerVerdict } from '../../blocker-resolver.js';
import {
  parsePriorityLabels,
  PRIORITY_BAND_RANK,
  type IssueLabelReader,
  type PriorityBand,
} from '../../backlog-priority.js';

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

/** Resolves priority bands for a batch of sourceRefs — typically
 * `resolveClaimBands` bound to an IssueLabelReader. Absent ⇒ FIFO (today's
 * behavior, byte-for-byte). Throws propagate as a single logged warning; the
 * walk falls back to drain order rather than failing the claim. */
export type ResolveBands = (refs: string[]) => Promise<Map<string, PriorityBand>>;

export interface DependencyClaimDeps {
  queue: DependencyClaimQueue;
  resolveDependency: ResolveDependency;
  ledger?: DependencyClaimLedger;
  resolveBands?: ResolveBands;
  log?: (...args: unknown[]) => void;
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
/**
 * Resolve the priority band for each of the given sourceRefs, via a single
 * batched call to the injected IssueLabelReader. TR-1: a 404 (`not-found`)
 * or a ref absent from the reader's result both default to `unlabeled`;
 * when a ref carries multiple priority labels, the highest band wins (via
 * parsePriorityLabels). A throwing reader propagates the throw untouched —
 * this helper does not catch or degrade to a fallback mode.
 */
export async function resolveClaimBands(
  reader: IssueLabelReader,
  refs: string[],
): Promise<Map<string, PriorityBand>> {
  const uniqueRefs = [...new Set(refs)];
  const readerResult = await reader(uniqueRefs);

  const bands = new Map<string, PriorityBand>();
  for (const ref of uniqueRefs) {
    const labels = readerResult.get(ref);
    if (!labels || labels === 'not-found') {
      bands.set(ref, 'unlabeled');
    } else {
      bands.set(ref, parsePriorityLabels(labels) ?? 'unlabeled');
    }
  }
  return bands;
}

export async function claimUnblocked(deps: DependencyClaimDeps): Promise<ClaimOutcome> {
  const { queue, resolveDependency, resolveBands, log } = deps;
  const held: ClaimableEnvelope[] = [];
  const deferred: AllBlockedEntry[] = [];

  try {
    if (resolveBands) {
      // Drain ALL pending entries up front via the queue's own atomic claim()
      // primitive. This lets a band resolver see (and reorder) the full
      // pending set before any verdict is evaluated.
      for (;;) {
        const envelope = await queue.claim();
        if (!envelope) break;
        held.push(envelope);
      }

      if (held.length === 0) {
        return { kind: 'empty' };
      }

      try {
        const refs = held
          .map((e) => e.sourceRef)
          .filter((ref): ref is string => ref != null && ref !== '');
        const bands = await resolveBands(refs);
        // TR-3: sort key is band rank ONLY. Ties within a band fall through
        // to `originalIndex`, which mirrors the drain order the queue
        // produced from its own receivedAt__id filename sort — so entries
        // sharing a band stay strictly receivedAt-FIFO relative to each
        // other, and Array.prototype.sort's ES2019+ stability guarantee
        // makes that tie-break deterministic across runs (no reliance on an
        // unstable sort to "happen" to preserve order).
        const withIndex = held.map((envelope, originalIndex) => ({ envelope, originalIndex }));
        withIndex.sort((a, b) => {
          const bandA = a.envelope.sourceRef
            ? (bands.get(a.envelope.sourceRef) ?? 'unlabeled')
            : 'no-issue';
          const bandB = b.envelope.sourceRef
            ? (bands.get(b.envelope.sourceRef) ?? 'unlabeled')
            : 'no-issue';
          const rankDiff = PRIORITY_BAND_RANK[bandA] - PRIORITY_BAND_RANK[bandB];
          return rankDiff !== 0 ? rankDiff : a.originalIndex - b.originalIndex;
        });
        held.splice(0, held.length, ...withIndex.map((w) => w.envelope));
      } catch (err) {
        // Sort failure must never fail the claim — fall back to drain order
        // and surface exactly one warning for operators.
        log?.('claimUnblocked: resolveBands threw; falling back to drain order', err);
      }

      // Evaluate verdicts in band order
      for (let i = 0; i < held.length; i++) {
        const envelope = held[i];
        const verdict = await resolveDependency(envelope.sourceRef);
        if (verdict.kind === 'unblocked') {
          held.splice(i, 1);
          return { kind: 'claim', envelope };
        }

        // blocked / indeterminate / cycle — defer, stateless, keep walking.
        deferred.push({ envelope, verdict });
      }

      return deferred.length > 0 ? { kind: 'all-blocked', entries: deferred } : { kind: 'empty' };
    } else {
      // Absent resolveBands: use the original claim-then-evaluate-inline loop,
      // short-circuiting as soon as the first unblocked entry is found. This
      // preserves the FIFO ordering and O(k) I/O cost (where k = position of
      // first unblocked entry) of the pre-banding implementation.
      for (;;) {
        const envelope = await queue.claim();
        if (!envelope) {
          // Queue exhausted; return all-blocked if we deferred any, else empty
          return deferred.length > 0
            ? { kind: 'all-blocked', entries: deferred }
            : { kind: 'empty' };
        }

        held.push(envelope);
        const verdict = await resolveDependency(envelope.sourceRef);
        if (verdict.kind === 'unblocked') {
          held.splice(held.indexOf(envelope), 1);
          return { kind: 'claim', envelope };
        }

        // blocked / indeterminate / cycle — defer and continue
        deferred.push({ envelope, verdict });
      }
    }
  } finally {
    // Release every remaining held entry back to the queue, regardless of
    // how the walk ended (claim found, empty, or an unexpected throw) — the
    // selected entry was already removed from `held`, so it's never
    // re-released; deferral must never drop an entry from the queue.
    for (const envelope of held) {
      await queue.release(envelope);
    }
  }
}
