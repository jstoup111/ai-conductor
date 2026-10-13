import type { ActiveChildResolution } from '../child-cursor.js';
import { childBranchFor, leafBranchFor } from '../feature-branch-identity.js';
import type { ChildId } from '../child-context.js';
import type { ActiveChildLifecycleTarget } from '../child-lifecycle.js';
import { assertNever, type RoundId } from './route-types.js';

export type ExecutionChildResolution =
  | { readonly source: 'none' }
  | { readonly source: 'refused'; readonly cursor: ActiveChildResolution }
  | { readonly source: 'cursor' | 'routed-host' | 'revalidating'; readonly target: ActiveChildLifecycleTarget; readonly roundId?: RoundId; readonly generation?: number };

/**
 * The child whose state and operator commands own the current execution.
 * Routing overlays the normal stack cursor without changing its range/leaf
 * result, so restack planning and execution cannot drift apart.
 */
export function resolveExecutionChild(cursor: ActiveChildResolution, slug: string): ExecutionChildResolution {
  switch (cursor.kind) {
    case 'no-child': return { source: 'none' };
    case 'envelope-missing':
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
  return {
    source: routed ? 'routed-host' : revalidating ? 'revalidating' : 'cursor',
    target,
    ...(routed ? { roundId: routed.roundId } : {}),
    ...(revalidating ? { generation: revalidating.generation } : {}),
  };
}
