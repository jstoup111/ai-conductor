import type { ActiveChildResolution } from '../child-cursor.js';
import { childBranchFor, leafBranchFor } from '../feature-branch-identity.js';
import type { ActiveChildLifecycleTarget } from '../child-lifecycle.js';
import { assertNever, type RoundId } from './route-types.js';

export type ExecutionChildResolution =
  | { readonly source: 'none' }
  | { readonly source: 'refused'; readonly cursor: ActiveChildResolution }
  | { readonly source: 'cursor'; readonly target: ActiveChildLifecycleTarget }
  | { readonly source: 'routed-host'; readonly target: ActiveChildLifecycleTarget; readonly roundId: RoundId }
  | { readonly source: 'revalidating'; readonly target: ActiveChildLifecycleTarget; readonly generation: number };

/** The executable cursor variants which own a concrete child region. */
export type ExecutionChildTargetResolution = Exclude<
  ExecutionChildResolution,
  { readonly source: 'none' | 'refused' }
>;

/**
 * A repair requires stack preflight until routing or revalidation selects its
 * host. Only the conductor's BUILD-region entry refuses on it; read-only
 * consumers keep the cursor child (adr-2026-10-10).
 */
export function isUnroutedRepairPending(
  cursor: ActiveChildResolution,
): cursor is Extract<ActiveChildResolution, { kind: 'repair-pending' }> {
  return cursor.kind === 'repair-pending' && cursor.routedRepair === undefined && cursor.revalidating === undefined;
}

/**
 * The child whose state and operator commands own the current execution.
 * Routing overlays the normal stack cursor without changing its range/leaf
 * result, so restack planning and execution cannot drift apart.
 */
export function resolveExecutionChild(cursor: ActiveChildResolution, slug: string): ExecutionChildResolution {
  switch (cursor.kind) {
    case 'no-child': return { source: 'none' };
    case 'topology-unavailable':
    case 'detached-head':
    case 'git-error':
    case 'divergent': return { source: 'refused', cursor };
    case 'active':
    case 'repair-pending': return resolveActiveExecutionChild(cursor, slug);
  }
  return assertNever(cursor);
}

function resolveActiveExecutionChild(
  cursor: Extract<ActiveChildResolution, { kind: 'active' | 'repair-pending' }>,
  slug: string,
): ExecutionChildResolution {
  const routed = cursor.routedRepair;
  const revalidating = cursor.revalidating;
  const child = routed?.child ?? revalidating?.child ?? cursor.child;
  const branch = child === cursor.position && cursor.isLeaf ? leafBranchFor(slug) : childBranchFor(slug, child);
  if (typeof branch !== 'string' && !branch.ok) return { source: 'refused', cursor };
  const target: ActiveChildLifecycleTarget = {
    child, position: child, isLeaf: child === cursor.position && cursor.isLeaf,
    branch: typeof branch === 'string' ? branch : branch.branch,
    ...(child === cursor.child && cursor.leafMovePending ? { leafMovePending: true } : {}),
  };
  if (routed) return { source: 'routed-host', target, roundId: routed.roundId };
  if (revalidating) return { source: 'revalidating', target, generation: revalidating.generation };
  return { source: 'cursor', target };
}
