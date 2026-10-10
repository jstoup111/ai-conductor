import type { PrMergeState } from './pr-labels.js';

export type ShippedReadinessVerdict =
  | 'ready'
  | 'conflicting'
  | 'ci-failing'
  | 'ci-pending'
  | 'no-checks'
  | 'draft'
  | 'indeterminate';

export const SHIPPED_READINESS_GRACE_MS = 30 * 60 * 1000;

export const DOCUMENTED_MERGE_STATE_STATUSES = new Set([
  'BEHIND',
  'BLOCKED',
  'CLEAN',
  'DIRTY',
  'DRAFT',
  'HAS_HOOKS',
  'UNKNOWN',
  'UNSTABLE',
]);

/** State retained by the sweep around a PR read, rather than GitHub PR state. */
export interface ShippedReadinessObservation {
  /** Whether an UNKNOWN mergeability response was re-read within this tick. */
  mergeabilityReread: 'not-needed' | 'completed' | 'failed';
  /** When the current head commit was first observed by the watch entry. */
  headFirstSeenAt?: number;
}

/**
 * Classify an open watched PR after the sweep has performed its optional
 * mergeability re-read. The ordering is the approved readiness precedence.
 */
export function classifyShippedReadiness(
  state: PrMergeState,
  observation: ShippedReadinessObservation,
  now: number,
): ShippedReadinessVerdict {
  if (state.isDraft) return 'draft';

  if (
    observation.mergeabilityReread === 'failed'
    || state.mergeable === 'UNKNOWN'
    || !DOCUMENTED_MERGE_STATE_STATUSES.has(state.mergeStateStatus ?? '')
  ) return 'indeterminate';

  if (state.mergeable === 'CONFLICTING' || state.mergeStateStatus === 'DIRTY') return 'conflicting';
  if (state.checksOutcome === 'failed') return 'ci-failing';
  if (state.checksOutcome === 'pending') return 'ci-pending';

  if (state.checksOutcome === 'none') {
    const graceElapsed = observation.headFirstSeenAt !== undefined
      && now - observation.headFirstSeenAt >= SHIPPED_READINESS_GRACE_MS;
    return state.baseRefName === 'main' && graceElapsed ? 'no-checks' : 'ci-pending';
  }

  return 'ready';
}

export type ShippedReadinessRouteHandlers<Result> = {
  [Verdict in ShippedReadinessVerdict]: () => Result;
};

/** Route every closed verdict explicitly so new verdicts require a new owner. */
export function routeShippedReadiness<Result>(
  verdict: ShippedReadinessVerdict,
  handlers: ShippedReadinessRouteHandlers<Result>,
): Result {
  switch (verdict) {
    case 'ready': return handlers.ready();
    case 'conflicting': return handlers.conflicting();
    case 'ci-failing': return handlers['ci-failing']();
    case 'ci-pending': return handlers['ci-pending']();
    case 'no-checks': return handlers['no-checks']();
    case 'draft': return handlers.draft();
    case 'indeterminate': return handlers.indeterminate();
  }
  return assertNever(verdict);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected shipped readiness verdict: ${String(value)}`);
}
