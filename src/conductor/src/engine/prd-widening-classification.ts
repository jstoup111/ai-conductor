import type { AcceptedWideningDecision } from './accepted-widenings.js';
import type { RemediationCasePrdWideningRecord } from './remediation-case-store.js';
import { prdWideningSourceId } from './prd-widening-context.js';

/** The single authority projection consumed by PRD routing and renderers. */
export type PrdWideningClassification =
  | { readonly kind: 'not-blocking'; readonly reason: 'non-over-scope' | 'non-nc' }
  | { readonly kind: 'accepted'; readonly decisionId: string }
  | { readonly kind: 'refused'; readonly decisionId: string }
  | {
      readonly kind: 'unresolved';
      readonly reason:
        | 'missing-relation'
        | 'stale-relation'
        | 'uncertain-relation'
        | 'missing-decision'
        | 'corrupt-case-store'
        | 'corrupt-decision-store'
        | 'unrenderable-projection';
    };

export interface PrdWideningClassificationInput {
  readonly grade: 'PASS' | 'FIXABLE' | 'PLAN_GAP' | 'OVER_SCOPE';
  readonly criterion: string;
  /** A relation is fresh only when the publisher checked its complete snapshot. */
  readonly relation?: { readonly kind: 'same-case' | 'different' | 'uncertain'; readonly caseId?: string; readonly fresh: boolean };
  readonly decisions: readonly AcceptedWideningDecision[];
}

function effectiveDecision(
  caseId: string,
  decisions: readonly AcceptedWideningDecision[],
): AcceptedWideningDecision | undefined {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const candidates = decisions.filter((decision) => decision.originalCaseId === caseId);
  return candidates.filter((decision) =>
    !candidates.some((other) => other.supersedes?.id === decision.id && other.supersedes.revision === decision.revision),
  ).sort((left, right) => right.revision - left.revision)[0] ??
    // Keeping the map read makes an invalid dangling supersedes reference inert.
    [...byId.values()].find(() => false);
}

/**
 * Derive authority solely from a fresh same-case relation and an explicit,
 * effective operator decision. Reviewer wording and asserted approval are not
 * inputs, so neither can manufacture authority.
 */
export function classifyPrdWidening(input: PrdWideningClassificationInput): PrdWideningClassification {
  if (input.grade !== 'OVER_SCOPE') return { kind: 'not-blocking', reason: 'non-over-scope' };
  if (!/^NC\.\d+$/i.test(input.criterion)) return { kind: 'not-blocking', reason: 'non-nc' };
  if (!input.relation) return { kind: 'unresolved', reason: 'missing-relation' };
  if (!input.relation.fresh) return { kind: 'unresolved', reason: 'stale-relation' };
  if (input.relation.kind === 'uncertain' || input.relation.kind === 'different') {
    return { kind: 'unresolved', reason: 'uncertain-relation' };
  }
  if (!input.relation.caseId) return { kind: 'unresolved', reason: 'missing-relation' };
  const decision = effectiveDecision(input.relation.caseId, input.decisions);
  if (!decision) return { kind: 'unresolved', reason: 'missing-decision' };
  return decision.authority === 'accept'
    ? { kind: 'accepted', decisionId: decision.id }
    : { kind: 'refused', decisionId: decision.id };
}

/** The minimum current-report data that can be bound to published evidence. */
export interface PrdWideningProjectionFinding {
  readonly criterion: string;
  readonly grade: 'PASS' | 'FIXABLE' | 'PLAN_GAP' | 'OVER_SCOPE';
  readonly evidence: string;
}

/**
 * The single freshness-aware projection for every PRD widening consumer.
 *
 * A case relationship is usable only if its current source id *and immutable
 * current snapshot* match the report row being projected.  This deliberately
 * gives no authority to an NC ordinal, an old relation, or reviewer prose.
 */
export function classifyPrdWideningProjection(input: {
  readonly findings: readonly PrdWideningProjectionFinding[];
  readonly decisions: readonly AcceptedWideningDecision[];
  readonly cases: readonly RemediationCasePrdWideningRecord[];
  readonly evidenceFault?: Extract<PrdWideningClassification, { readonly kind: 'unresolved' }>['reason'];
}): ReadonlyMap<string, PrdWideningClassification> {
  const publishedDigests = input.findings
    .filter((finding) => finding.grade === 'OVER_SCOPE' && /^NC\.\d+$/i.test(finding.criterion))
    .map((finding) => {
      const sourceId = prdWideningSourceId(finding);
      return input.cases.find((candidate) => candidate.currentSources.some((source) => source.sourceId === sourceId))?.reconciliationDigest;
    });
  // A relation is a publication of one frozen reconciliation batch only when
  // every current NC subject carries the same engine-stamped identity.
  const publishedDigest = publishedDigests.length > 0 && publishedDigests.every((value) =>
    typeof value === 'string' && value === publishedDigests[0]) ? publishedDigests[0] : undefined;
  return new Map(input.findings.map((finding) => {
    if (finding.grade !== 'OVER_SCOPE') {
      return [finding.criterion, classifyPrdWidening({
        grade: finding.grade,
        criterion: finding.criterion,
        decisions: input.decisions,
      })] as const;
    }
    if (input.evidenceFault) {
      return [finding.criterion, { kind: 'unresolved', reason: input.evidenceFault } as const] as const;
    }
    // Story-criterion decisions retain their criterion-keyed authority. They
    // have no lap-local NC source identity to reconcile, so they never fall
    // back to a reviewer-summary comparison.
    if (!/^NC\.\d+$/i.test(finding.criterion)) {
      const decision = input.decisions.filter((candidate) => candidate.criterion === finding.criterion)
        .sort((left, right) => right.revision - left.revision)[0];
      return [finding.criterion, decision === undefined
        ? { kind: 'unresolved', reason: 'missing-decision' } as const
        : decision.authority === 'accept'
          ? { kind: 'accepted', decisionId: decision.id } as const
          : { kind: 'refused', decisionId: decision.id } as const] as const;
    }
    const sourceId = prdWideningSourceId(finding);
    const caseForSource = input.cases.find((candidate) =>
      candidate.currentSources.some((source) => source.sourceId === sourceId),
    );
    const current = caseForSource?.currentSources.find((source) => source.sourceId === sourceId);
    const relationship = caseForSource?.relationships.find((candidate) => candidate.currentSourceId === sourceId);
    const relation = current?.snapshot === finding.evidence && relationship !== undefined
      ? {
          kind: relationship.kind,
          ...(relationship.kind === 'same-case' ? { caseId: relationship.caseId } : {}),
          // Equality alone is insufficient: two absent digests must never
          // turn an un-published relation into fresh authority.
          fresh: publishedDigest !== undefined && caseForSource?.reconciliationDigest === publishedDigest,
        } as const
      : current !== undefined || relationship !== undefined
        ? { kind: 'same-case' as const, fresh: false }
        : undefined;
    return [finding.criterion, classifyPrdWidening({
      grade: finding.grade,
      criterion: finding.criterion,
      relation,
      decisions: input.decisions,
    })] as const;
  }));
}
