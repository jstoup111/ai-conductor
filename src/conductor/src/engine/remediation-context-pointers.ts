import type { BuildReviewFinding } from './build-review-domain.js';
import {
  canonicalizeBuildReviewFindingIdentity,
  type BuildReviewFindingCanonicalPayload,
} from './build-review-finding-identity.js';
import { parsePlanTaskPaths } from './plan-task-parse.js';

type PriorLap = {
  readonly artifactPath: string;
  readonly findings: readonly { readonly findingRef: string; readonly finding: BuildReviewFinding }[];
};

/** Renders concise plan locations for findings that name a plan task or an owned file. */
export function planContractPointers(
  findings: readonly BuildReviewFinding[],
  plan: string,
  planPath: string,
): readonly string[] {
  const planTaskPaths = parsePlanTaskPaths(plan);

  return findings.flatMap((finding) => {
    const anchor = identityForFinding(finding)?.canonicalPayload.anchor;
    if (!anchor) return [];

    const fileAnchor = fileAnchorFor(anchor);
    if (fileAnchor) {
      const matchingTaskIds = [...planTaskPaths]
        .filter(([, paths]) => paths.has(fileAnchor))
        .map(([taskId]) => taskId);
      if (matchingTaskIds.length !== 1) return [];

      return [`plan contract: ${planPath} — Task ${matchingTaskIds[0]} (anchor: ${fileAnchor})`];
    }

    if (anchor.rubric !== 'completeness') return [];

    const { planTask, missingSurface } = anchor;
    const taskHeader = new RegExp(`^### Task ${escapeRegExp(planTask)}:`, 'm');
    if (!taskHeader.test(plan)) return [];

    return [`plan contract: ${planPath} — Task ${planTask} (anchor: ${missingSurface})`];
  });
}

function fileAnchorFor(anchor: BuildReviewFindingCanonicalPayload['anchor']): string | undefined {
  switch (anchor.rubric) {
    case 'scope': return anchor.path;
    case 'tautology': return anchor.changedTest;
    case 'rootCause': return anchor.locus;
    case 'completeness': return undefined;
  }
}

/** Renders concise references to same-anchor findings from prior review laps. */
export function priorAttemptPointers(
  findings: readonly BuildReviewFinding[],
  priorLaps: readonly PriorLap[],
): readonly string[] {
  const priorByAnchor = new Map<string, string[]>();
  for (const priorLap of priorLaps) {
    const lap = record(priorLap);
    if (!lap || typeof lap.artifactPath !== 'string' || !Array.isArray(lap.findings)) continue;

    for (const priorEntry of lap.findings) {
      const entry = record(priorEntry);
      if (!entry || typeof entry.findingRef !== 'string') continue;

      const anchorKey = anchorKeyForFinding(entry.finding);
      if (anchorKey) priorByAnchor.set(anchorKey, [...(priorByAnchor.get(anchorKey) ?? []), `${lap.artifactPath}#${entry.findingRef}`]);
    }
  }

  return findings.flatMap((finding) => {
    const anchorKey = anchorKeyForFinding(finding);
    const priorAttempts = anchorKey && priorByAnchor.get(anchorKey);
    return priorAttempts ? [`prior attempts (${priorAttempts.length}): ${priorAttempts.join(', ')}`] : [];
  });
}

function anchorKeyForFinding(value: unknown): string | undefined {
  const identity = identityForFinding(value);
  return identity && JSON.stringify(identity.canonicalPayload.anchor);
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
