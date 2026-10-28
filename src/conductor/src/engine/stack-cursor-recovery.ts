import { leafBranchFor } from './feature-branch-identity.js';
import { describeResealRecovery } from './reseal-cli.js';

type TopologyDetails = {
  readonly planPath?: string;
  readonly positionsRef?: string;
  readonly recordedPositions?: readonly number[];
  readonly planPositions?: readonly number[];
};
export type StackCursorFailureCause =
  | 'plan-missing' | 'plan-invalid' | 'positions-changed' | 'positions-ref-unreadable' | 'git-error'
  | 'detached-head';

/** Render one operator recovery for every active-stack cursor failure. */
export async function formatStackCursorRecovery(
  worktree: string,
  slug: string,
  cause: StackCursorFailureCause,
  topology: TopologyDetails = {},
): Promise<string> {
  const planPath = topology.planPath ?? `.docs/plans/${slug}.md`;
  if (cause === 'detached-head') return `git switch ${leafBranchFor(slug)}`;
  if (cause === 'positions-ref-unreadable') {
    const positions = topology.planPositions ?? topology.recordedPositions ?? [];
    return `git update-ref refs/conductor/${slug}/positions "$(printf '%s' '${JSON.stringify(positions)}' | git hash-object -w --stdin)"`;
  }
  if (cause === 'positions-changed' || cause === 'plan-missing' || cause === 'plan-invalid') {
    return await describeResealRecovery(worktree, planPath) ??
      `ai-conductor reseal --slug ${slug} --path ${planPath} --reason "«why»" --clear-halt`;
  }
  return 'rm -f .pipeline/HALT .pipeline/HALT.class';
}

export async function formatStackCursorRefusal(
  worktree: string,
  slug: string,
  cause: StackCursorFailureCause,
  detail: string,
  topology: TopologyDetails = {},
): Promise<string> {
  const topologyDetails = [
    topology.planPath ? `plan path ${topology.planPath}` : undefined,
    topology.positionsRef ? `positions ref ${topology.positionsRef}` : undefined,
    topology.recordedPositions ? `recorded positions [${topology.recordedPositions.join(',')}]` : undefined,
    topology.planPositions ? `plan positions [${topology.planPositions.join(',')}]` : undefined,
  ].filter((value): value is string => value !== undefined);
  const recovery = await formatStackCursorRecovery(worktree, slug, cause, topology);
  return `${detail}${topologyDetails.length ? `; ${topologyDetails.join('; ')}` : ''}\nRecovery:\n${recovery}`;
}
