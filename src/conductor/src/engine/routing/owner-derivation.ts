import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseChildId, type ChildId } from '../child-context.js';
import type { SliceTopologyMembership } from '../slice-topology.js';
import { parsePlanTaskBodies } from '../plan-task-parse.js';
import { isEngineAppendedRemediationTaskId } from '../remediation-append.js';
import {
  MalformedFeatureManifestError,
  resolveFeatureArtifact,
  worktreeManifestSource,
} from '../feature-manifest-source.js';

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
  readonly sliceMembership: SliceTopologyMembership;
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

export type RemediationTaskChildResolution =
  | { readonly kind: 'resolved'; readonly child: ChildId }
  | { readonly kind: 'unreadable' };

function parseCachedRemediationChild(value: unknown): ChildId | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? parseChildId(value) : undefined;
  }
  return typeof value === 'string' && /^(?:[1-9]\d*)$/.test(value)
    ? parseChildId(value)
    : undefined;
}

/**
 * Reads this feature's committed plan without relying on a disposable cache.
 * A repository may hold many plans, so recovery must never infer membership
 * from an unscoped directory listing.
 */
async function readCommittedPlanText(projectRoot: string, featureSlug?: string): Promise<string | undefined> {
  try {
    // engine-state is a disposable cache.  Callers that already proved the
    // feature identity from their durable envelope must be able to recover
    // committed rem ownership after that cache is lost.
    let slug: unknown = featureSlug;
    if (slug === undefined) {
      try {
        const state = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'engine-state.json'), 'utf8')) as Record<string, unknown>;
        slug = state.feature_desc;
      } catch {
        // Handled by the unambiguous-plan fallback below.
      }
      if (typeof slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) {
        // A legacy cache rebuild has no caller-proven slug.  It may use the
        // plan directory only when it contains exactly one candidate; with
        // siblings, refusing is the only safe ownership result.
        const plans = (await readdir(join(projectRoot, '.docs', 'plans'))).filter((name) => name.endsWith('.md'));
        if (plans.length !== 1) return undefined;
        slug = plans[0]!.slice(0, -3);
      }
    }
    if (typeof slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) return undefined;
    const plan = await resolveFeatureArtifact(
      worktreeManifestSource(projectRoot),
      slug,
      'plan',
      async () => [`.docs/plans/${slug}.md`],
    );
    const planPath = plan.paths.find((path) => plan.origin === 'legacy' || !plan.missing.includes(path));
    return planPath === undefined ? undefined : await readFile(join(projectRoot, planPath), 'utf8');
  } catch (error) {
    if (error instanceof MalformedFeatureManifestError) throw error;
    // A lost engine-state/plan pair is unreadable; guessing from another
    // feature's plan would assign a remediation task to the wrong child.
    return undefined;
  }
}

/** Resolve a remediation task's committed Child assignment before its disposable cache. */
export async function resolveRemediationTaskChild(
  projectRoot: string,
  taskId: string,
  cachedChild: unknown,
  featureSlug?: string,
): Promise<RemediationTaskChildResolution> {
  const planText = await readCommittedPlanText(projectRoot, featureSlug);
  const committedChild = planText === undefined ? undefined : readRemTaskChildLine(planText, taskId);
  const child = committedChild === undefined ? undefined : parseChildId(committedChild);
  if (child !== undefined) return { kind: 'resolved', child };

  const cached = parseCachedRemediationChild(cachedChild);
  return cached === undefined ? { kind: 'unreadable' } : { kind: 'resolved', child: cached };
}

/**
 * Returns every durable remediation-task membership declared by committed
 * `Child:` lines. The engine-state mapping remains only a compatibility cache.
 */
export async function readCommittedRemediationTaskChildren(
  projectRoot: string,
  featureSlug?: string,
): Promise<Record<string, number>> {
  const planText = await readCommittedPlanText(projectRoot, featureSlug);
  if (planText === undefined) return {};

  return Object.fromEntries(
    [...parsePlanTaskBodies(planText).keys()].flatMap((taskId): Array<[string, number]> => {
      if (!isEngineAppendedRemediationTaskId(taskId)) return [];
      const child = readRemTaskChildLine(planText, taskId);
      return child === undefined ? [] : [[taskId, child]];
    }),
  );
}

/**
 * Derive ownership for work already bound to one or more plan tasks without
 * consulting a provider or judgement dependency.
 */
export function deriveTaskBoundOwner({
  taskIds,
  sliceMembership,
  planText,
  appendedChildren,
  declaredPositions,
}: TaskBoundOwnerInput): TaskBoundOwnerDerivation {
  const owners: Array<{ owner: number; reason: Exclude<TaskBoundOwnerReason, 'multi-task-earliest'> }> = [];

  for (const taskId of taskIds) {
    if (isEngineAppendedRemediationTaskId(taskId)) {
      const committedChild = readRemTaskChildLine(planText, taskId);
      if (committedChild !== undefined) {
        if (!declaredPositions.includes(committedChild)) {
          return { kind: 'halt', taskId, detail: `Task-bound work cannot use child position ${committedChild} recorded for ${taskId}` };
        }
        owners.push({ owner: committedChild, reason: 'rem-child-line' });
        continue;
      }
      const cachedChild = appendedChildren[taskId];
      if (cachedChild !== undefined) {
        if (!declaredPositions.includes(cachedChild)) {
          return { kind: 'halt', taskId, detail: `Task-bound work cannot use child position ${cachedChild} recorded for ${taskId}` };
        }
        owners.push({ owner: cachedChild, reason: 'rem-cache' });
        continue;
      }
    } else {
      const slice = sliceMembership.taskSlices[taskId];
      if (slice !== undefined) {
        if (!declaredPositions.includes(slice)) {
          return { kind: 'halt', taskId, detail: `Task-bound work cannot use child position ${slice} recorded for ${taskId}` };
        }
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
