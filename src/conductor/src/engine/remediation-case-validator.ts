import type {
  RemediationCaseJudgement,
  RemediationCaseRow,
  RemediationCaseSourceRow,
} from './remediation-case-artifact.js';

export type { RemediationCaseJudgement } from './remediation-case-artifact.js';

export type RemediationCaseGraphRejection =
  | 'duplicate-current-source'
  | 'unknown-source'
  | 'duplicate-source'
  | 'missing-source'
  | 'unknown-case-reference'
  | 'duplicate-case-reference'
  | 'contradictory-case-disposition'
  | 'contradictory-source-outcome'
  | 'unreferenced-case'
  | 'invalid-action-effect'
  | 'invalid-deferral-effect'
  | 'invalid-reject-effect'
  | 'refute-without-binding'
  | 'refutation-without-refuted-assertion'
  | 'refutation-confidence-not-high'
  | 'invalid-refute-effect'
  | 'provider-durable-id'
  | 'missing-consistency-source'
  | 'duplicate-consistency-source'
  | 'unknown-consistency-source'
  | 'missing-consistency-case-reference'
  | 'duplicate-consistency-case-reference'
  | 'unknown-consistency-case-reference'
  | 'missing-consistency-rationale'
  | 'unknown-existing-case'
  | 'missing-admission-task'
  | 'duplicate-admission-task'
  | 'unknown-admission-task'
  | 'missing-admission-rationale';

/** Engine-supplied identities; provider output cannot expand either set. */
export interface RemediationCaseValidationReferences {
  readonly existingCaseIds?: readonly string[];
  readonly admittedTaskIds?: readonly string[];
}

export interface ProposedRemediationCase {
  readonly case: RemediationCaseRow;
  readonly sources: readonly RemediationCaseSourceRow[];
}

/**
 * The provider's complete, but still non-durable, proposed source-to-case graph.
 * Reconciliation owns durable case/effect identities after this boundary succeeds.
 */
export interface RemediationCaseGraph {
  readonly sourceOutcomes: readonly RemediationCaseSourceRow[];
  readonly cases: readonly ProposedRemediationCase[];
}

export type ValidateRemediationCaseGraphResult =
  | { readonly ok: true; readonly graph: RemediationCaseGraph }
  | { readonly ok: false; readonly reason: RemediationCaseGraphRejection };

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasProviderDurableId(caseRow: RemediationCaseRow): boolean {
  const candidate = caseRow as unknown as Record<string, unknown>;
  const effect = caseRow.effect as unknown as Record<string, unknown>;
  return ['caseId', 'effectId', 'id'].some((key) => hasOwn(candidate, key) || hasOwn(effect, key));
}

function validateEffect(
  caseRow: RemediationCaseRow,
  judgement: RemediationCaseJudgement,
  references: RemediationCaseValidationReferences,
): RemediationCaseGraphRejection | undefined {
  const effect = caseRow.effect as unknown as Record<string, unknown>;
  if (caseRow.disposition === 'act') {
    if (effect.kind !== 'action' || effect.route !== 'build' || !Array.isArray(effect.tasks) || effect.tasks.length === 0) {
      return 'invalid-action-effect';
    }
    if (!effect.tasks.every((task) => (
      typeof task === 'object'
      && task !== null
      && nonEmptyString((task as Record<string, unknown>).title)
    ))) return 'invalid-action-effect';
    if (judgement.mode !== 'case-v2') return undefined;
    const admittedTaskIds = new Set(references.admittedTaskIds ?? []);
    for (const task of effect.tasks) {
      const admission = task as Record<string, unknown>;
      if (!Array.isArray(admission.admittedTaskIds) || admission.admittedTaskIds.length === 0) {
        return 'missing-admission-task';
      }
      if (!nonEmptyString(admission.admissionRationale)) return 'missing-admission-rationale';
      const seen = new Set<string>();
      for (const taskId of admission.admittedTaskIds) {
        if (!nonEmptyString(taskId) || !admittedTaskIds.has(taskId)) return 'unknown-admission-task';
        if (seen.has(taskId)) return 'duplicate-admission-task';
        seen.add(taskId);
      }
    }
    return undefined;
  }
  if (caseRow.disposition === 'defer') {
    return effect.kind === 'deferral' && nonEmptyString(effect.exclusionRationale)
      ? undefined
      : 'invalid-deferral-effect';
  }
  if (caseRow.disposition === 'refute') {
    if (!caseRow.existingCaseId) return 'refute-without-binding';
    if (caseRow.confidence !== 'high') return 'refutation-confidence-not-high';
    if (!caseRow.refutation?.assertions.some((assertion) => assertion.verdict === 'refuted')) {
      return 'refutation-without-refuted-assertion';
    }
    if (effect.kind === 'none') return undefined;
    return effect.kind === 'deferral' && nonEmptyString(effect.exclusionRationale)
      ? undefined
      : effect.kind === 'deferral' ? 'invalid-deferral-effect' : 'invalid-refute-effect';
  }
  return effect.kind === 'none' ? undefined : 'invalid-reject-effect';
}

function outcomeMatchesDisposition(
  outcome: RemediationCaseSourceRow['outcome'],
  disposition: RemediationCaseRow['disposition'],
): boolean {
  return outcome === 'merged'
    || (outcome === 'acted' && disposition === 'act')
    || (outcome === 'deferred' && disposition === 'defer')
    || (outcome === 'rejected' && disposition === 'reject')
    || (outcome === 'refuted' && disposition === 'refute');
}

function validateConsistency(
  currentSources: ReadonlySet<string>,
  casesByRef: ReadonlyMap<string, RemediationCaseRow>,
  judgement: Extract<RemediationCaseJudgement, { readonly mode: 'case-v2' }>,
): RemediationCaseGraphRejection | undefined {
  const consistency = judgement.consistency as unknown as Record<string, unknown>;
  if (!nonEmptyString(consistency.rationale)) return 'missing-consistency-rationale';
  if (!Array.isArray(consistency.sourceIds)) return 'missing-consistency-source';
  const consistencySources = new Set<string>();
  for (const sourceId of consistency.sourceIds) {
    if (!nonEmptyString(sourceId) || !currentSources.has(sourceId)) return 'unknown-consistency-source';
    if (consistencySources.has(sourceId)) return 'duplicate-consistency-source';
    consistencySources.add(sourceId);
  }
  for (const sourceId of currentSources) {
    if (!consistencySources.has(sourceId)) return 'missing-consistency-source';
  }
  if (!Array.isArray(consistency.caseRefs)) return 'missing-consistency-case-reference';
  const consistencyCases = new Set<string>();
  for (const caseRef of consistency.caseRefs) {
    if (!nonEmptyString(caseRef) || !casesByRef.has(caseRef)) return 'unknown-consistency-case-reference';
    if (consistencyCases.has(caseRef)) return 'duplicate-consistency-case-reference';
    consistencyCases.add(caseRef);
  }
  for (const caseRef of casesByRef.keys()) {
    if (!consistencyCases.has(caseRef)) return 'missing-consistency-case-reference';
  }
  return undefined;
}

/**
 * Validates a provider result as one all-or-nothing graph over the frozen
 * current source set. It has no persistence or effect boundary: callers only
 * receive a graph after every source and case relation is admitted.
 */
export function validateRemediationCaseGraph(
  currentSourceIds: readonly string[],
  judgement: RemediationCaseJudgement,
  references: RemediationCaseValidationReferences = {},
): ValidateRemediationCaseGraphResult {
  const currentSources = new Set<string>();
  for (const sourceId of currentSourceIds) {
    if (currentSources.has(sourceId)) return { ok: false, reason: 'duplicate-current-source' };
    currentSources.add(sourceId);
  }

  const casesByRef = new Map<string, RemediationCaseRow>();
  for (const caseRow of judgement.cases) {
    if (hasProviderDurableId(caseRow)) return { ok: false, reason: 'provider-durable-id' };
    if (judgement.mode === 'case-v2' && caseRow.existingCaseId &&
      !(references.existingCaseIds ?? []).includes(caseRow.existingCaseId)) {
      return { ok: false, reason: 'unknown-existing-case' };
    }
    const effectError = validateEffect(caseRow, judgement, references);
    if (effectError) return { ok: false, reason: effectError };

    const prior = casesByRef.get(caseRow.caseRef);
    if (prior) {
      return {
        ok: false,
        reason: prior.disposition === caseRow.disposition
          ? 'duplicate-case-reference'
          : 'contradictory-case-disposition',
      };
    }
    casesByRef.set(caseRow.caseRef, caseRow);
  }

  const sourcesByCase = new Map<string, RemediationCaseSourceRow[]>();
  const seenSources = new Set<string>();
  for (const source of judgement.sourceOutcomes) {
    if (!currentSources.has(source.sourceId)) return { ok: false, reason: 'unknown-source' };
    if (seenSources.has(source.sourceId)) return { ok: false, reason: 'duplicate-source' };

    const caseRow = casesByRef.get(source.caseRef);
    if (!caseRow) return { ok: false, reason: 'unknown-case-reference' };
    if (source.outcome === 'escalate') {
      if (judgement.mode !== 'case-v2' || caseRow.disposition !== 'escalate') {
        return { ok: false, reason: 'contradictory-source-outcome' };
      }
    } else if (!outcomeMatchesDisposition(source.outcome, caseRow.disposition)) {
      return { ok: false, reason: 'contradictory-source-outcome' };
    }

    seenSources.add(source.sourceId);
    const sources = sourcesByCase.get(source.caseRef) ?? [];
    sources.push(source);
    sourcesByCase.set(source.caseRef, sources);
  }

  for (const sourceId of currentSourceIds) {
    if (!seenSources.has(sourceId)) return { ok: false, reason: 'missing-source' };
  }
  for (const caseRow of judgement.cases) {
    if (!sourcesByCase.has(caseRow.caseRef)) return { ok: false, reason: 'unreferenced-case' };
  }
  if (judgement.mode === 'case-v2') {
    const consistencyError = validateConsistency(currentSources, casesByRef, judgement);
    if (consistencyError) return { ok: false, reason: consistencyError };
  }

  return {
    ok: true,
    graph: {
      sourceOutcomes: judgement.sourceOutcomes,
      cases: judgement.cases.map((caseRow) => ({
        case: caseRow,
        sources: sourcesByCase.get(caseRow.caseRef)!,
      })),
    },
  };
}
