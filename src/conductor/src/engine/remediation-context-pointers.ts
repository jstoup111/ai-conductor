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
    const anchor = identityForFinding(finding)?.canonicalPayload.anchor;
    if (!anchor) return [];

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
  for (const priorLap of priorLaps) {
    const lap = record(priorLap);
    if (!lap || typeof lap.artifactPath !== 'string' || !Array.isArray(lap.findings)) continue;

    for (const priorEntry of lap.findings) {
      const entry = record(priorEntry);
      if (!entry || typeof entry.findingRef !== 'string') continue;

      const identity = identityForFinding(entry.finding);
      if (identity) priorByIdentity.set(identity.id, [...(priorByIdentity.get(identity.id) ?? []), `${lap.artifactPath}#${entry.findingRef}`]);
    }
  }

  return findings.flatMap((finding) => {
    const identity = identityForFinding(finding);
    const priorAttempts = identity && priorByIdentity.get(identity.id);
    return priorAttempts ? [`prior attempts (${priorAttempts.length}): ${priorAttempts.join(', ')}`] : [];
  });
}

function identityForFinding(value: unknown) {
  const finding = record(value);
  const anchor = finding && record(finding.anchor);
  if (!finding || !anchor) return undefined;

  return canonicalizeBuildReviewFindingIdentity({
    rubric: anchor.rubric,
    contractVersion: 'v1',
    concernKind: finding.concernKind,
    anchor,
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
