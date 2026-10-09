import { extractAuthoritativeStoryCriteria, type PrdAuditReport } from './artifacts.js';
import type { PendingAsBuiltRemediationFinding } from './kickback-ledger.js';
import type { IntentRelation } from './accepted-widenings.js';
import type { ScopeTrailer } from './scope-trailer.js';
import { resolveScopeWideningRationale } from './scope-widening-rationale.js';
import { isPrdAuditNoOwnerOrdinal } from './prd-audit-contract.js';
import { offeredCaseToPersistedOffer } from './prd-widening-offers.js';
import { prdWideningSourceId } from './prd-widening-context.js';
import { renderPrdWideningRecovery } from './prd-widening-recovery.js';
import { classifyPrdWideningProjection, type PrdWideningClassification } from './prd-widening-classification.js';
import { renderRefusalReworkContext, type RefusalReworkEvidence } from './prd-widening-refusal-rework.js';
import type { RemediationCasePrdWideningRecord } from './remediation-case-store.js';
import type { AcceptedWideningDecision } from './accepted-widenings.js';
import { OVER_SCOPE_HALT_CLASS, type OverScopeHaltClass } from './halt-classification.js';

export function withRefusalReworkContext(
  dispatchContext: string,
  refusals: readonly RefusalReworkEvidence[] | undefined,
): string {
  return refusals === undefined
    ? dispatchContext
    : `${dispatchContext}\n\n${renderRefusalReworkContext(refusals)}`;
}

export interface RecordedPrdAuditFinding {
  gate: 'prd_audit';
  grade: 'PLAN_GAP' | 'OVER_SCOPE';
  criterion: string;
  summary: string;
  accepted?: boolean;
  decision?: 'accept' | 'refuse';
  rationale?: string;
  operator?: string;
}

/** A remediated as-built BLOCKED row retained after the rebuilt gate converges. */
export type RecordedAsBuiltRemediationFinding = PendingAsBuiltRemediationFinding;

export type RecordedReviewFinding = RecordedPrdAuditFinding | RecordedAsBuiltRemediationFinding;

export type PrdAuditPlanGapRoute =
  | { kind: 'none' }
  | { kind: 'record'; findings: RecordedPrdAuditFinding[] }
  | { kind: 'halt'; haltClass: 'plan-gap'; detail: string; findings: RecordedPrdAuditFinding[] };

export function criterionStorySection(
  storiesText: string,
  criterion: string,
): 'happy' | 'negative' | undefined {
  // The story id uses the stories parser's heading alphabet (`[A-Za-z0-9.-]`,
  // see `story-criteria.ts`): the
  // trailing `.<digits>` is the criterion ordinal and everything before it is
  // the heading id verbatim, so `S5a.3` and `S2.1.3` classify instead of
  // silently returning undefined (#2219 / PR #2222 fixed the sibling sites).
  const id = criterion.match(/^S([A-Za-z0-9.-]+)\.(\d+)$/i);
  if (!id) return undefined;

  const [, storyId, ordinal] = id;
  const storyPrefix = `Story ${storyId} `;
  const storyCriteria = extractAuthoritativeStoryCriteria(storiesText).filter((candidate) =>
    candidate.toLowerCase().startsWith(storyPrefix.toLowerCase()),
  );
  const matchedCriterion = storyCriteria[Number(ordinal) - 1];
  if (!matchedCriterion) return undefined;
  if (matchedCriterion.toLowerCase().startsWith(`${storyPrefix}happy:`.toLowerCase())) {
    return 'happy';
  }
  if (matchedCriterion.toLowerCase().startsWith(`${storyPrefix}negative:`.toLowerCase())) {
    return 'negative';
  }
  return undefined;
}

export type PrdAuditOverScopeRoute =
  | { kind: 'none' }
  | { kind: 'record'; findings: RecordedPrdAuditFinding[] }
  | { kind: 'halt'; haltClass: OverScopeHaltClass; detail: string; findings: RecordedPrdAuditFinding[]; undecided: Array<RecordedPrdAuditFinding & { relation: IntentRelation }>; refused: Array<RecordedPrdAuditFinding & { relation: IntentRelation }>; defects?: Array<{ kind: string; criterion?: string; message?: string }> }
  | {
    kind: 'refusal-rework';
    refusals: RefusalReworkEvidence[];
    findings: RecordedPrdAuditFinding[];
    refused: Array<RecordedPrdAuditFinding & { relation: IntentRelation }>;
    detail: string;
  };

/**
 * One PRD-audit route result shared by the serial SHIP walk and the
 * validation-group join. A recorded finding is an explicit accepted risk;
 * a halted finding keeps its route-specific operator decision. Keeping this
 * result above either execution shape prevents their gate-satisfaction logic
 * from drifting apart.
 */
export type CurrentPrdAuditRoute =
  | { kind: 'none' }
  | { kind: 'record' }
  | { kind: 'plan-gap-halt'; route: Extract<PrdAuditPlanGapRoute, { kind: 'halt' }> }
  | { kind: 'over-scope-halt'; route: Extract<PrdAuditOverScopeRoute, { kind: 'halt' }> }
  | { kind: 'over-scope-refusal-rework'; route: Extract<PrdAuditOverScopeRoute, { kind: 'refusal-rework' }> }
  // D8: the projection itself refused. Named, blocking, and ahead of every
  // other route — an unrenderable decision must not be settled as satisfied.
  | { kind: 'projection-halt'; reason: string };



/**
 * Adapt the validated verdict to the existing widening domain without
 * re-reading its derived Markdown report.  Presentation ordinals remain only
 * locators for no-owner observations; their evidence and relation come from
 * the typed authority.
 */
/** All-blocking-refused evidence; a missing NC snapshot is a persistence fault. */
function buildRefusalReworkEvidence(
  refused: ReadonlyArray<{ criterion: string }>,
  classifications: ReadonlyMap<string, PrdWideningClassification>,
  decisions: readonly AcceptedWideningDecision[],
): { ok: true; refusals: RefusalReworkEvidence[] } | { ok: false; criterion: string } {
  const refusals: RefusalReworkEvidence[] = [];
  for (const finding of refused) {
    const classification = classifications.get(finding.criterion);
    const decision = classification?.kind === 'refused'
      ? decisions.find((candidate) => candidate.id === classification.decisionId)
      : undefined;
    if (!decision) return { ok: false, criterion: finding.criterion };
    const key = finding.criterion;
    const decisionId = decision.id;
    const revision = decision.revision;
    const rationale = decision.rationale;
    if (isPrdAuditNoOwnerOrdinal(finding.criterion)) {
      const caseId = decision.originalCaseId;
      const snapshot = decision.originalSource?.snapshot;
      // The planner's NC context must be able to read the persisted original
      // offer snapshot; without it the refusal is not admissible as rework
      // input and falls back to the record-specific persistence recovery.
      if (caseId === undefined || snapshot === undefined) return { ok: false, criterion: finding.criterion };
      refusals.push({ key, decisionId, revision, rationale, caseId, snapshot });
    } else {
      refusals.push({ key, decisionId, revision, rationale });
    }
  }
  return { ok: true, refusals };
}

export function routeTypedPrdAuditOverScope(
  report: PrdAuditReport,
  relations: ReadonlyMap<string, IntentRelation>,
  decisions: readonly AcceptedWideningDecision[],
  cases: readonly RemediationCasePrdWideningRecord[],
): PrdAuditOverScopeRoute {
  const overScope = report.findings.filter((finding) => finding.grade === 'OVER_SCOPE');
  if (overScope.some((finding) => !relations.has(finding.criterion))) return { kind: 'none' };
  // Keep routing on the exact same freshness-aware projection as artifact
  // completion and rendered records.  This must not reconstruct freshness
  // from a source link here: that would let a stale relation pass one reader
  // while the other readers correctly reject it.
  const classifications = classifyPrdWideningProjection({
    findings: report.findings,
    decisions,
    cases,
  });
  const findings = overScope.map((finding) => {
    const relation = relations.get(finding.criterion) as IntentRelation;
    const summary = finding.evidence.trim() || `Unplanned behavior for ${finding.criterion}.`;
    if (relation !== 'outside-visible') {
      return { gate: 'prd_audit' as const, grade: 'OVER_SCOPE' as const, criterion: finding.criterion, summary, relation, accepted: true, classification: 'not-blocking' as const };
    }
    if (!isPrdAuditNoOwnerOrdinal(finding.criterion)) {
      const decision = decisions.filter((candidate) => candidate.criterion === finding.criterion).at(-1);
      return {
        gate: 'prd_audit' as const, grade: 'OVER_SCOPE' as const, criterion: finding.criterion, summary, relation,
        accepted: decision?.authority === 'accept', classification: decision?.authority === 'accept' ? 'accepted' as const : decision?.authority === 'refuse' ? 'blocking-refused' as const : 'blocking-undecided' as const,
        ...(decision ? { decision: decision.authority, rationale: decision.rationale, operator: decision.operator } : {}),
      };
    }
    const sourceId = prdWideningSourceId(finding);
    const record = cases.find((candidate) => candidate.relationships.some((item) => item.currentSourceId === sourceId));
    const published = record?.relationships.filter((item) => item.currentSourceId === sourceId).at(-1);
    // A validated renamed/reworded same-case relation must render the
    // original editable offer as well.  Otherwise a stored refusal becomes
    // an anonymous pending item and an operator cannot explicitly revise it.
    const relationCase = published?.kind === 'same-case'
      ? cases.find((candidate) => candidate.id === published.caseId)
      : undefined;
    const offer = cases.find((candidate) => candidate.originalSources.some((source) => source.sourceId === sourceId)) ?? relationCase;
    const original = offer?.originalSources.find((source) => source.sourceId === sourceId) ?? offer?.originalSources[0];
    const projected = classifications.get(finding.criterion)!;
    const classification = projected;
    const decision = classification.kind === 'accepted' || classification.kind === 'refused'
      ? decisions.find((candidate) => candidate.id === classification.decisionId)
      : undefined;
    return {
      gate: 'prd_audit' as const, grade: 'OVER_SCOPE' as const, criterion: finding.criterion, summary, relation,
      accepted: classification.kind === 'accepted',
      classification: classification.kind === 'refused' ? 'blocking-refused' as const : classification.kind === 'accepted' || classification.kind === 'not-blocking' ? 'accepted' as const : 'blocking-undecided' as const,
      ...(decision ? { decision: decision.authority, rationale: decision.rationale, operator: decision.operator } : {}),
      ...(offer && original ? {
        offerEntryId: offer.id,
        originalSource: { id: original.sourceId, snapshot: original.snapshot },
        originalCaseId: offer.id,
        ...(classification.kind === 'refused' && decision ? { kind: 'revise-decision' as const, priorDecision: { id: decision.id, revision: decision.revision } } : { kind: 'pending' as const }),
      } : {}),
    };
  });
  if (!findings.length) return { kind: 'none' };
  const undecided = findings.filter((finding) => finding.classification === 'blocking-undecided');
  const refused = findings.filter((finding) => finding.classification === 'blocking-refused');
  const recorded = findings.map(({ relation: _relation, classification: _classification, ...finding }) => finding);
  if (undecided.length || refused.length) {
    const defects: Array<{ kind: string; criterion: string }> = [];
    const editable = (items: typeof findings) => items.flatMap(({ classification: _classification, ...finding }) => {
      if (!isPrdAuditNoOwnerOrdinal(finding.criterion)) return [finding];
      const record = 'offerEntryId' in finding
        ? cases.find((candidate) => candidate.id === finding.offerEntryId)
        : undefined;
      const offer = record && offeredCaseToPersistedOffer(record);
      if (!offer) {
        defects.push({ kind: 'projection-failed', criterion: finding.criterion });
        return [];
      }
      // Verdict rows keep current report identities; editable offers retain
      // their persisted identities, even after renumbering or wording drift.
      return [{ ...finding, ...offer,
        ...('kind' in finding && finding.kind === 'revise-decision' ? { kind: finding.kind, priorDecision: finding.priorDecision } : {}),
      }];
    });
    const pendingOffers = editable(undecided);
    const refusedOffers = editable(refused);
    // Refusals with nothing left to decide and no projection defect route to
    // bounded BUILD rework instead of re-halting (ADR D1). The evidence is
    // derived from the durable decision; an NC refusal whose decision lacks
    // its original-source snapshot is a persistence fault, not rework input.
    if (undecided.length === 0 && defects.length === 0) {
      const refusalEvidence = buildRefusalReworkEvidence(refused, classifications, decisions);
      if (!refusalEvidence.ok) {
        return {
          kind: 'halt', haltClass: OVER_SCOPE_HALT_CLASS,
          detail: renderPrdWideningRecovery('persistence-failed', [refusalEvidence.criterion]),
          findings: recorded,
          undecided: [],
          refused: refusedOffers,
        };
      }
      return {
        kind: 'refusal-rework',
        refusals: refusalEvidence.refusals,
        findings: recorded,
        refused: refusedOffers,
        detail: `OVER_SCOPE visible behavior on ${refused.map((finding) => finding.criterion).join(', ')}.`,
      };
    }
    return {
      kind: 'halt', haltClass: OVER_SCOPE_HALT_CLASS,
      detail: defects.length
        ? renderPrdWideningRecovery('projection-failed', defects.map((defect) => defect.criterion))
        : `OVER_SCOPE visible behavior on ${[...undecided, ...refused].map((finding) => finding.criterion).join(', ')}.`,
      findings: recorded,
      undecided: pendingOffers,
      refused: refusedOffers,
      ...(defects.length ? { defects } : {}),
    };
  }
  const hasOtherBlockingGrade = report.findings.some((finding) => finding.grade !== 'PASS' && finding.grade !== 'OVER_SCOPE');
  return hasOtherBlockingGrade ? { kind: 'none' } : { kind: 'record', findings: recorded };
}

/** Direct, immutable scope evidence passed to the PRD-audit reviewer. */
export function prdAuditScopeProjection(input: {
  resealEvidence: readonly { path: string; reason: string }[];
  scopeTrailers: readonly ScopeTrailer[];
}): {
  resealEvidence: readonly { path: string; reason: string }[];
  scopeTrailers: readonly ScopeTrailer[];
} {
  return {
    resealEvidence: input.resealEvidence.map((entry) => ({ ...entry })),
    // Reuse the common widening rationale precedence: a matching `Scope:`
    // trailer is authored evidence, not an engine-invented explanation.
    scopeTrailers: input.scopeTrailers.map((entry) => ({
      path: entry.path,
      rationale: resolveScopeWideningRationale(entry.path, input.scopeTrailers, '').rationale,
    })),
  };
}

export function prdAuditHaltsOnAnyPlanGap(config: unknown): boolean {
  return (config as { prd_audit?: { halt_on_any_plan_gap?: boolean } }).prd_audit?.halt_on_any_plan_gap === true;
}
