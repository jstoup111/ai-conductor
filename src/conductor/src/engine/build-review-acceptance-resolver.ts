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
): ResolveBuildReviewAcceptanceResult {
  if (!dispositionInput.ok) return dispositionInput;

  if (directDisposition(feature, finding, dispositionInput.records)) return { kind: 'direct' };
  if (!caseInput.ok) return { kind: 'none' };

  const currentSourceId = sourceIdFor(finding);
  for (const caseRecord of caseInput.state.cases) {
    const currentLink = caseRecord.sources.find((source) => source.sourceId === currentSourceId);
    if (!currentLink) continue;

    const origin = directlyAcceptedOrigin(feature, caseRecord, dispositionInput.records);
    if (!origin || !strictlyLater(currentLink.recordedAt, origin.disposition.acceptedAt) ||
      !strictlyLater(currentLink.recordedAt, origin.linkRecordedAt)) continue;

    return {
      kind: 'carried', caseId: caseRecord.id, originFindingId: origin.disposition.finding.id,
      originLapId: origin.disposition.sourceLapId, operator: origin.disposition.operator,
      rationale: origin.disposition.rationale,
    };
  }
  return { kind: 'none' };
}

function directlyAcceptedOrigin(
  feature: BuildReviewFeatureIdentity,
  caseRecord: RemediationCaseRecord,
  records: readonly BuildReviewDispositionRecord[],
): { readonly disposition: BuildReviewDispositionRecord; readonly linkRecordedAt: string } | undefined {
  for (const link of caseRecord.sources) {
    const disposition = records.find((record) =>
      sourceIdFor(record.finding) === link.sourceId && matchesBuildReviewDisposition(feature, record.finding, [record]),
    );
    if (disposition) return { disposition, linkRecordedAt: link.recordedAt };
  }
  return undefined;
}

function strictlyLater(left: string, right: string): boolean {
  return Date.parse(left) > Date.parse(right);
}
