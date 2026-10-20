import { buildReviewAdjudicationSourceId } from './build-review-adjudication-context.js';
import {
  matchesBuildReviewDisposition,
  type BuildReviewAcceptedRiskFinding,
  type BuildReviewDispositionListResult,
  type BuildReviewDispositionRecord,
  type BuildReviewFeatureIdentity,
} from './build-review-dispositions.js';
import type { BuildReviewLapId } from './build-review-domain.js';
import type { RemediationCaseRecord, RemediationCaseStoreReadResult } from './remediation-case-store.js';

/** Acceptance as it applies to one current build-review finding. */
export type BuildReviewAcceptanceResolution =
  | { readonly kind: 'direct' }
  | {
    readonly kind: 'carried';
    readonly caseId: string;
    readonly originFindingId: string;
    readonly originLapId: BuildReviewLapId;
    readonly operator: string;
    readonly rationale: string;
  }
  | { readonly kind: 'none' };

export type ResolveBuildReviewAcceptanceResult =
  | BuildReviewAcceptanceResolution
  | Exclude<BuildReviewDispositionListResult, { readonly ok: true }>;

/**
 * Returns the case input with a proposed binding made visible to the shared
 * resolver.  Callers use this before persisting a link so carry admission and
 * carry rendering have exactly the same authority.
 */
export function withProposedBuildReviewCaseSources(
  input: RemediationCaseStoreReadResult,
  caseId: string,
  sources: readonly RemediationCaseRecord['sources'][number][],
): RemediationCaseStoreReadResult {
  if (!input.ok) return input;
  return {
    ok: true,
    state: {
      ...input.state,
      cases: input.state.cases.map((record) => record.id === caseId
        ? { ...record, sources: [...record.sources, ...sources.filter((source) => !record.sources.some((existing) => existing.sourceId === source.sourceId))] }
        : record),
    },
  };
}

function directDisposition(
  feature: BuildReviewFeatureIdentity,
  finding: BuildReviewAcceptedRiskFinding,
  records: readonly BuildReviewDispositionRecord[],
): BuildReviewDispositionRecord | undefined {
  return records.find((record) => matchesBuildReviewDisposition(feature, finding, [record]));
}

function sourceIdFor(finding: BuildReviewAcceptedRiskFinding): string {
  return buildReviewAdjudicationSourceId({
    rubric: finding.canonicalPayload.rubric,
    findingId: finding.id,
  });
}

/**
 * Resolves accepted risk from already-read feature-local stores. The disposition
 * store remains the authority for direct acceptance; case links only extend it
 * to a later finding explicitly bound to the same case.
 */
export function resolveBuildReviewAcceptance(
  feature: BuildReviewFeatureIdentity,
  finding: BuildReviewAcceptedRiskFinding,
  dispositionInput: BuildReviewDispositionListResult,
  caseInput: RemediationCaseStoreReadResult,
  /** The lap being evaluated; a disposition made in it cannot carry itself. */
  currentLapId?: BuildReviewLapId,
): ResolveBuildReviewAcceptanceResult {
  if (!dispositionInput.ok) return dispositionInput;

  if (directDisposition(feature, finding, dispositionInput.records)) return { kind: 'direct' };
  if (!caseInput.ok) return { kind: 'none' };

  const currentSourceId = sourceIdFor(finding);
  for (const caseRecord of caseInput.state.cases) {
    const currentLink = caseRecord.sources.find((source) => source.sourceId === currentSourceId);
    if (!currentLink) continue;

    const origin = acceptedOrigin(feature, caseRecord, dispositionInput.records, caseInput.state.cases, new Set());
    if (!origin || origin.disposition.sourceLapId === currentLapId ||
      !strictlyLater(currentLink.recordedAt, origin.disposition.acceptedAt) ||
      !strictlyLater(currentLink.recordedAt, origin.linkRecordedAt)) continue;

    return {
      kind: 'carried', caseId: caseRecord.id, originFindingId: origin.disposition.finding.id,
      originLapId: origin.disposition.sourceLapId, operator: origin.disposition.operator,
      rationale: origin.disposition.rationale,
    };
  }
  return { kind: 'none' };
}

function acceptedOrigin(
  feature: BuildReviewFeatureIdentity,
  caseRecord: RemediationCaseRecord,
  records: readonly BuildReviewDispositionRecord[],
  allCases: readonly RemediationCaseRecord[],
  visited: ReadonlySet<string>,
): { readonly disposition: BuildReviewDispositionRecord; readonly linkRecordedAt: string } | undefined {
  if (visited.has(caseRecord.id)) return undefined;
  const nextVisited = new Set([...visited, caseRecord.id]);
  for (const link of caseRecord.sources) {
    const disposition = records.find((record) =>
      sourceIdFor(record.finding) === link.sourceId && matchesBuildReviewDisposition(feature, record.finding, [record]),
    );
    if (disposition) return { disposition, linkRecordedAt: link.recordedAt };
  }
  // A later case can bind a source which was itself carried by an earlier
  // case. Follow that binding to its direct accepted origin; the result still
  // names the original finding and lap, rather than inventing an intermediate
  // acceptance.
  for (const link of caseRecord.sources) {
    for (const linkedCase of allCases) {
      if (linkedCase.id === caseRecord.id || !linkedCase.sources.some((candidate) => candidate.sourceId === link.sourceId)) continue;
      const origin = acceptedOrigin(feature, linkedCase, records, allCases, nextVisited);
      if (!origin || !strictlyLater(link.recordedAt, origin.disposition.acceptedAt) ||
        !strictlyLater(link.recordedAt, origin.linkRecordedAt)) continue;
      return origin;
    }
  }
  return undefined;
}

function strictlyLater(left: string, right: string): boolean {
  return Date.parse(left) > Date.parse(right);
}
