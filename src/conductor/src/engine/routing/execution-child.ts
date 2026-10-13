import type { ActiveChildResolution } from '../child-cursor.js';
import { childBranchFor, leafBranchFor } from '../feature-branch-identity.js';
import type { ChildId } from '../child-context.js';

export type ExecutionChildResolution =
  | { readonly source: 'none' }
  | { readonly source: 'refused'; readonly cursor: ActiveChildResolution }
  | { readonly source: 'cursor' | 'routed-host' | 'revalidating'; readonly target: { readonly child: ChildId; readonly position: ChildId; readonly isLeaf: boolean; readonly branch: string }; readonly roundId?: string; readonly generation?: number };

/**
 * The child whose state and operator commands own the current execution.
 * Routing overlays the normal stack cursor without changing its range/leaf
 * result, so restack planning and execution cannot drift apart.
 */
export function resolveExecutionChild(cursor: ActiveChildResolution, slug: string): ExecutionChildResolution {
  if (cursor.kind === 'no-child') return { source: 'none' };
  if (cursor.kind !== 'active' && cursor.kind !== 'repair-pending') return { source: 'refused', cursor };
  const routed = cursor.routedRepair;
  const revalidating = cursor.revalidating;
  const child = routed?.child ?? revalidating?.child ?? cursor.child;
  const branch = child === cursor.position && cursor.isLeaf ? leafBranchFor(slug) : childBranchFor(slug, child);
  if (typeof branch !== 'string' && !branch.ok) return { source: 'refused', cursor };
  return {
    source: routed ? 'routed-host' : revalidating ? 'revalidating' : 'cursor',
    target: { child, position: child, isLeaf: child === cursor.position && cursor.isLeaf, branch: typeof branch === 'string' ? branch : branch.branch },
    ...(routed ? { roundId: routed.roundId } : {}),
    ...(revalidating ? { generation: revalidating.generation } : {}),
  };
}
