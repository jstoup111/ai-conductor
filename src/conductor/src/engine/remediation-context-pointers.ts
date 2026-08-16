import type { BuildReviewFinding } from './build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity } from './build-review-finding-identity.js';
import { parsePlanTaskPaths } from './plan-task-parse.js';

type PriorLap = {
  readonly artifactPath: string;
  readonly findings: readonly { readonly findingRef: string; readonly finding: BuildReviewFinding }[];
};

/** Renders concise plan locations for completeness findings that name a plan task. */
export function planContractPointers(
  findings: readonly BuildReviewFinding[],
  plan: string,
  planPath: string,
): readonly string[] {
  const planTaskPaths = parsePlanTaskPaths(plan);

  return findings.flatMap((finding) => {
    const { anchor } = finding;

    if (anchor.rubric === 'scope') {
      const matchingTaskIds = [...planTaskPaths]
        .filter(([, paths]) => paths.has(anchor.path))
        .map(([taskId]) => taskId);
      if (matchingTaskIds.length !== 1) return [];

      return [`plan contract: ${planPath} — Task ${matchingTaskIds[0]} (anchor: ${anchor.path})`];
    }

    if (anchor.rubric !== 'completeness') return [];

    const { planTask, missingOutcome } = anchor;
    const taskHeader = new RegExp(`^### Task ${escapeRegExp(planTask)}:`, 'm');
    if (!taskHeader.test(plan)) return [];

    return [`plan contract: ${planPath} — Task ${planTask} (anchor: ${missingOutcome})`];
  });
}

/** Renders concise references to same-identity findings from prior review laps. */
export function priorAttemptPointers(
  findings: readonly BuildReviewFinding[],
  priorLaps: readonly PriorLap[],
): readonly string[] {
  const priorByIdentity = new Map<string, string[]>();
  for (const { artifactPath, findings: priorFindings } of priorLaps) {
    for (const { findingRef, finding } of priorFindings) {
      const identity = canonicalizeBuildReviewFindingIdentity({
        rubric: finding.anchor.rubric, contractVersion: 'v1', concernKind: finding.concernKind, anchor: finding.anchor,
      });
      if (identity) priorByIdentity.set(identity.id, [...(priorByIdentity.get(identity.id) ?? []), `${artifactPath}#${findingRef}`]);
    }
  }

  return findings.flatMap((finding) => {
    const identity = canonicalizeBuildReviewFindingIdentity({
      rubric: finding.anchor.rubric, contractVersion: 'v1', concernKind: finding.concernKind, anchor: finding.anchor,
    });
    const priorAttempts = identity && priorByIdentity.get(identity.id);
    return priorAttempts ? [`prior attempts (${priorAttempts.length}): ${priorAttempts.join(', ')}`] : [];
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
