import { createHash } from 'node:crypto';

import type { PrdAuditRejectedRow, PrdAuditReport } from './artifacts.js';
import type { AcceptedWideningDecision, IntentRelation } from './accepted-widenings.js';
import type { RemediationCasePrdWideningRecord } from './remediation-case-store.js';

export const PRD_WIDENING_CONTEXT_LIMITS = {
  currentSources: 512, cases: 128, sourceLinksPerCase: 512,
  pointersPerSource: 64, referenceBytes: 256, proseBytes: 8_000, totalBytes: 128 * 1024,
} as const;

export interface PrdWideningContextSource {
  readonly id: string;
  readonly criterion: string;
  readonly grade: 'OVER_SCOPE';
  /** The parsed PRD-intent relation; reconciliation must judge all semantics. */
  readonly relation?: IntentRelation;
  readonly evidence: string;
  readonly prdIds: readonly string[];
}

export interface PrdWideningContext {
  readonly version: 'v1';
  readonly digest: string;
  readonly currentSources: readonly PrdWideningContextSource[];
  readonly cases: readonly RemediationCasePrdWideningRecord[];
  /** Parser diagnostics stay visible but are not reconciliation subjects. */
  readonly rejectedRows?: readonly PrdAuditRejectedRow[];
  /** NC decisions retain their source provenance; story decisions do not. */
  readonly decisions: readonly AcceptedWideningDecision[];
  /**
   * Engine-derived history scope retained so a live case-store read can make
   * the same criterion-only exclusion as the original context assembly.
   * This is not a reconciliation subject or an authority record.
   */
  readonly semanticScope?: PrdWideningSemanticScope;
}

export interface PrdWideningSemanticScope {
  readonly criterionOnlyCaseIds: readonly string[];
}

export interface PrdWideningSemanticSnapshot {
  readonly cases: readonly RemediationCasePrdWideningRecord[];
  readonly decisions: readonly AcceptedWideningDecision[];
  readonly digest: string;
  readonly scope: PrdWideningSemanticScope;
}

export type PrdWideningContextResult =
  | { readonly ok: true; readonly value: PrdWideningContext }
  | { readonly ok: false; readonly reason: 'limit-exceeded'; readonly dimension: keyof typeof PRD_WIDENING_CONTEXT_LIMITS; readonly actual: number; readonly limit: number };

const bytes = (value: string): number => Buffer.byteLength(value, 'utf8');
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * The one semantic history projection used when creating a context and when
 * checking its live-store freshness. Criterion-only authority remains durable
 * but is never an NC matching subject, including after a restart.
 */
export function projectPrdWideningSemanticSnapshot(input: {
  readonly version: PrdWideningContext['version'];
  readonly currentSources: readonly PrdWideningContextSource[];
  readonly cases: readonly RemediationCasePrdWideningRecord[];
  readonly decisions: readonly AcceptedWideningDecision[];
  readonly scope?: PrdWideningSemanticScope;
}): PrdWideningSemanticSnapshot {
  const criterionOnlyCaseIds = input.scope?.criterionOnlyCaseIds ?? [
    ...new Set(input.decisions
      .filter((decision) => decision.originalCaseId !== undefined && !/^NC\.\d+$/i.test(decision.criterion))
      .map((decision) => decision.originalCaseId!)),
  ];
  const excludedCaseIds = new Set(criterionOnlyCaseIds);
  const cases = input.cases.filter((record) => !excludedCaseIds.has(record.id));
  const decisions = input.decisions.filter((decision) =>
    decision.originalSource !== undefined && /^NC\.\d+$/i.test(decision.criterion));
  return {
    cases,
    decisions,
    scope: { criterionOnlyCaseIds },
    digest: hash(JSON.stringify({
      version: input.version,
      currentSources: input.currentSources,
      cases,
      decisions,
    })),
  };
}

/**
 * Engine-owned locator for one parsed NC source.  It is never authority by
 * itself: every caller binds it to the exact evidence snapshot in the same
 * context, so a renumbered report reaches reconciliation rather than relying
 * on summary-equivalence.
 */
export function prdWideningSourceId(finding: Pick<PrdAuditReport['findings'][number], 'criterion' | 'grade' | 'evidence'> & { readonly prdIds?: readonly string[] }): string {
  // A report ordinal is presentation, not durable identity. Bind the locator
  // to the engine's parsed occurrence instead, so a later NC.1 does not take
  // ownership of an unrelated earlier NC.1.
  return `prd-audit:${hash(JSON.stringify({
    criterion: finding.criterion,
    grade: finding.grade,
    evidence: finding.evidence,
    prdIds: finding.prdIds ?? [],
  }))}`;
}
function exceeds(dimension: keyof typeof PRD_WIDENING_CONTEXT_LIMITS, actual: number): PrdWideningContextResult | undefined {
  const limit = PRD_WIDENING_CONTEXT_LIMITS[dimension];
  return actual > limit ? { ok: false, reason: 'limit-exceeded', dimension, actual, limit } : undefined;
}

function checkReferences(values: readonly string[]): PrdWideningContextResult | undefined {
  for (const value of values) {
    const check = exceeds('referenceBytes', bytes(value));
    if (check) return check;
  }
  return undefined;
}

function checkProse(values: readonly string[]): PrdWideningContextResult | undefined {
  for (const value of values) {
    const check = exceeds('proseBytes', bytes(value));
    if (check) return check;
  }
  return undefined;
}

function checkCaseBounds(record: RemediationCasePrdWideningRecord): PrdWideningContextResult | undefined {
  const sourceLinks = record.originalSources.length + record.currentSources.length + record.relationships.length;
  const linkCheck = exceeds('sourceLinksPerCase', sourceLinks);
  if (linkCheck) return linkCheck;

  const caseReference = checkReferences([record.id]);
  if (caseReference) return caseReference;
  for (const source of record.originalSources) {
    const reference = checkReferences([source.sourceId]);
    if (reference) return reference;
    const prose = checkProse([source.snapshot]);
    if (prose) return prose;
  }
  for (const source of record.currentSources) {
    const reference = checkReferences([source.sourceId, source.recordedAt]);
    if (reference) return reference;
    const prose = checkProse([source.snapshot]);
    if (prose) return prose;
  }
  for (const relationship of record.relationships) {
    const relationshipReference = checkReferences([
      relationship.currentSourceId,
      ...(relationship.kind === 'same-case' ? [relationship.caseId] : []),
      ...(relationship.kind === 'uncertain' ? relationship.candidateCaseIds : []),
    ]);
    if (relationshipReference) return relationshipReference;
    const reason = checkProse([relationship.reason]);
    if (reason) return reason;
    if (relationship.kind === 'uncertain') {
      const pointerCheck = exceeds('pointersPerSource', relationship.candidateCaseIds.length);
      if (pointerCheck) return pointerCheck;
    }
  }
  return undefined;
}

function checkDecisionBounds(decision: AcceptedWideningDecision): PrdWideningContextResult | undefined {
  const reference = checkReferences([
    decision.id,
    decision.criterion,
    decision.operator,
    ...(decision.originalSource === undefined ? [] : [decision.originalSource.id]),
    ...(decision.originalCaseId === undefined ? [] : [decision.originalCaseId]),
    ...(decision.offerEntryId === undefined ? [] : [decision.offerEntryId]),
    ...(decision.supersedes === undefined ? [] : [decision.supersedes.id]),
  ]);
  if (reference) return reference;
  return checkProse([
    decision.rationale,
    ...(decision.originalSource === undefined ? [] : [decision.originalSource.snapshot]),
  ]);
}

/**
 * Project all current outside-scope NC sources without summary matching.  The
 * projection retains history verbatim and refuses excess input rather than
 * pruning authority or silently changing what the judge sees.
 */
export function buildPrdWideningContext(
  report: PrdAuditReport,
  cases: readonly RemediationCasePrdWideningRecord[],
  decisions: readonly AcceptedWideningDecision[],
  relations: ReadonlyMap<string, IntentRelation> = new Map(),
): PrdWideningContextResult {
  const currentSources = report.findings
    .filter((finding) => finding.grade === 'OVER_SCOPE' && /^NC\.\d+$/i.test(finding.criterion))
    .map((finding) => ({
      id: prdWideningSourceId(finding),
      criterion: finding.criterion,
      grade: 'OVER_SCOPE' as const,
      ...(relations.get(finding.criterion) === undefined ? {} : { relation: relations.get(finding.criterion) }),
      evidence: finding.evidence,
      prdIds: finding.prdIds,
    }));
  for (const check of [
    exceeds('currentSources', currentSources.length),
    exceeds('cases', cases.length),
  ]) if (check) return check;
  for (const source of currentSources) {
    const references = checkReferences([source.id, source.criterion, ...source.prdIds]);
    if (references) return references;
    const prose = checkProse([source.evidence]);
    if (prose) return prose;
    const pointerCheck = exceeds('pointersPerSource', source.prdIds.length);
    if (pointerCheck) return pointerCheck;
  }
  for (const record of cases) {
    const check = checkCaseBounds(record);
    if (check) return check;
  }
  const semanticSnapshot = projectPrdWideningSemanticSnapshot({
    version: 'v1', currentSources, cases, decisions,
  });
  for (const decision of semanticSnapshot.decisions) {
    const check = checkDecisionBounds(decision);
    if (check) return check;
  }
  const value: Omit<PrdWideningContext, 'digest'> = {
    version: 'v1',
    currentSources,
    cases: semanticSnapshot.cases,
    rejectedRows: report.rejectedRows,
    decisions: semanticSnapshot.decisions,
    semanticScope: semanticSnapshot.scope,
  };
  // Diagnostics are rendered alongside the projection but never become a
  // reconciliation subject or change an otherwise identical judgment snapshot.
  const serialized = JSON.stringify(value);
  const total = exceeds('totalBytes', bytes(serialized)); if (total) return total;
  return { ok: true, value: { ...value, digest: semanticSnapshot.digest } };
}
