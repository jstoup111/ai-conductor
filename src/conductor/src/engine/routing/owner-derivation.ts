import type { CoverageBindingEnvelope } from '../coverage-binding-envelope.js';
import { parsePlanTaskBodies } from '../plan-task-parse.js';
import { isEngineAppendedRemediationTaskId } from '../remediation-append.js';

export type TaskBoundOwnerReason =
  | 'task-slice'
  | 'rem-child-line'
  | 'rem-cache'
  | 'multi-task-earliest';

export type TaskBoundOwnerDerivation =
  | { readonly kind: 'owned'; readonly owner: number; readonly reason: TaskBoundOwnerReason }
  | { readonly kind: 'halt'; readonly taskId: string; readonly detail: string };

export interface TaskBoundOwnerInput {
  readonly taskIds: readonly string[];
  readonly envelope: Pick<CoverageBindingEnvelope, 'sliceMembership'>;
  readonly planText: string;
  readonly appendedChildren: Readonly<Record<string, number>>;
  readonly declaredPositions: readonly number[];
}

/** Read the committed child assignment in an appended remediation task block. */
export function readRemTaskChildLine(planText: string, taskId: string): number | undefined {
  const body = parsePlanTaskBodies(planText).get(taskId);
  const child = body?.match(/^\s*\*\*Child:\*\*\s*(\d+)\s*$/m)?.[1];
  return child === undefined ? undefined : Number(child);
}

/**
 * Derive ownership for work already bound to one or more plan tasks without
 * consulting a provider or judgement dependency.
 */
export function deriveTaskBoundOwner({
  taskIds,
  envelope,
  planText,
  appendedChildren,
  declaredPositions: _declaredPositions,
}: TaskBoundOwnerInput): TaskBoundOwnerDerivation {
  const owners: Array<{ owner: number; reason: Exclude<TaskBoundOwnerReason, 'multi-task-earliest'> }> = [];

  for (const taskId of taskIds) {
    if (isEngineAppendedRemediationTaskId(taskId)) {
      const committedChild = readRemTaskChildLine(planText, taskId);
      if (committedChild !== undefined) {
        owners.push({ owner: committedChild, reason: 'rem-child-line' });
        continue;
      }
      const cachedChild = appendedChildren[taskId];
      if (cachedChild !== undefined) {
        owners.push({ owner: cachedChild, reason: 'rem-cache' });
        continue;
      }
    } else {
      const slice = envelope.sliceMembership?.taskSlices[taskId];
      if (slice !== undefined) {
        owners.push({ owner: slice, reason: 'task-slice' });
        continue;
      }
    }

    return {
      kind: 'halt',
      taskId,
      detail: `Task-bound work cannot derive an owner for ${taskId}`,
    };
  }

  if (owners.length === 0) {
    return {
      kind: 'halt',
      taskId: '<none>',
      detail: 'Task-bound work has no task ids from which to derive an owner',
    };
  }

  const earliest = owners.reduce((current, candidate) => candidate.owner < current.owner ? candidate : current);
  return owners.length === 1
    ? { kind: 'owned', owner: earliest.owner, reason: earliest.reason }
    : { kind: 'owned', owner: earliest.owner, reason: 'multi-task-earliest' };
}
