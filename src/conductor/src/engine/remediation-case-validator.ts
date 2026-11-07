import type {
  RemediationCaseJudgement,
  RemediationCaseRow,
  RemediationCaseSourceRow,
} from './remediation-case-artifact.js';
import { isBelowSeverityThreshold } from './build-review-domain.js';

export type { RemediationCaseJudgement } from './remediation-case-artifact.js';

export type RemediationCaseGraphRejection =
  | 'invalid-case-keys'
  | 'duplicate-current-source'
  | 'unknown-source'
  | 'duplicate-source'
  | 'missing-source'
  | 'operator-owned-carried-source-outcome'
  | 'unknown-case-reference'
  | 'duplicate-case-reference'
  | 'contradictory-case-disposition'
  | 'contradictory-source-outcome'
  | 'unreferenced-case'
  | 'invalid-action-effect'
  | 'invalid-deferral-effect'
  | 'invalid-reject-effect'
  | 'operator-owned-acceptance'
  | 'operator-owned-resolution'
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
  | 'missing-admission-rationale'
  | 'invalid-advisory-threshold'
  | 'inadmissible-case-binding';

/** Engine-supplied identities; provider output cannot expand either set. */
export interface RemediationCaseValidationReferences {
  readonly existingCaseIds?: readonly string[];
  readonly admittedTaskIds?: readonly string[];
  /** Every plan task id, including tasks whose body was not supplied. */
  readonly planTaskIds?: readonly string[];
  /** Rubric identity for each frozen source supplied to the judgement. */
  readonly sourceRubrics?: Readonly<Record<string, string>>;
  /** Reviewer-owned severity for each frozen source supplied to the judgement. */
  readonly sourceReviewerSeverities?: Readonly<Partial<Record<string, import('./build-review-domain.js').BuildReviewSeverity>>>;
  /** Resolved non-nit thresholds declared by the operator, keyed by rubric. */
  readonly declaredSeverityThresholds?: Readonly<Partial<Record<string, import('./build-review-domain.js').BuildReviewSeverity>>>;
  /** Engine-selected exact owners and repair provenance candidates for each proposed row. */
  readonly allowedDistinctFromCaseIdsByCaseRef?: Readonly<Record<string, readonly string[]>>;
  /** Resolved action cases with an applied action effect that may receive a re-raise declaration. */
  readonly reRaiseEligibleCaseIds?: readonly string[];
  /** Engine-owned disposition sets for bindings to each supplied prior case. */
  readonly bindableDispositionsByCaseId?: Readonly<Record<string, readonly Exclude<RemediationCaseRow['disposition'], 'escalate'>[]>>;
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

export interface UnknownAdmissionTaskRejection {
  readonly ok: false;
  readonly reason: 'unknown-admission-task';
  /** Known plan ids whose full task bodies were not supplied to the provider. */
  readonly indexOnlyTaskIds: readonly string[];
  /** Admitted ids that do not occur in the plan index. */
  readonly absentTaskIds: readonly string[];
}

export interface InadmissibleCaseBindingRejection {
  readonly ok: false;
  readonly reason: 'inadmissible-case-binding';
  readonly bindings: readonly {
    readonly caseRef: string;
    readonly existingCaseId: string;
    readonly disposition: Exclude<RemediationCaseRow['disposition'], 'escalate'>;
    readonly bindableDispositions: readonly Exclude<RemediationCaseRow['disposition'], 'escalate'>[];
  }[];
}

export type ValidateRemediationCaseGraphResult =
  | { readonly ok: true; readonly graph: RemediationCaseGraph }
  | UnknownAdmissionTaskRejection
  | InadmissibleCaseBindingRejection
  | { readonly ok: false; readonly reason: Exclude<RemediationCaseGraphRejection, 'unknown-admission-task' | 'inadmissible-case-binding'> };

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasValidDistinctFrom(caseRow: RemediationCaseRow): boolean {
  if (caseRow.distinctFrom === undefined) return true;
  return Array.isArray(caseRow.distinctFrom) && caseRow.distinctFrom.length > 0 && caseRow.distinctFrom.length <= 128 &&
    caseRow.distinctFrom.every((entry) => {
      const candidate = entry as unknown as Record<string, unknown>;
      return typeof entry === 'object' && entry !== null && !Array.isArray(entry) &&
        Object.keys(candidate).length === 2 && Object.hasOwn(candidate, 'caseId') && Object.hasOwn(candidate, 'reason') &&
        typeof candidate.caseId === 'string' && candidate.caseId.length > 0 && candidate.caseId.length <= 256 &&
        typeof candidate.reason === 'string' && candidate.reason.length > 0 && candidate.reason.length <= 8_000;
    });
}

function hasValidReRaise(caseRow: RemediationCaseRow): boolean {
  if (caseRow.reRaise === undefined) return true;
  const reRaise = caseRow.reRaise as unknown as Record<string, unknown>;
  return typeof reRaise === 'object' && reRaise !== null && !Array.isArray(reRaise) &&
    Object.keys(reRaise).length === 2 && Object.hasOwn(reRaise, 'kind') && Object.hasOwn(reRaise, 'reason') &&
    (reRaise.kind === 'residual-gap' || reRaise.kind === 'repeat') &&
    typeof reRaise.reason === 'string' && reRaise.reason.length > 0 && reRaise.reason.length <= 8_000;
}

function retainAllowedDistinctFrom(
  caseRow: RemediationCaseRow,
  references: RemediationCaseValidationReferences,
): RemediationCaseRow {
  const allowed = references.allowedDistinctFromCaseIdsByCaseRef?.[caseRow.caseRef];
  if (allowed === undefined || caseRow.distinctFrom === undefined) return caseRow;
  const allowedCaseIds = new Set(allowed);
  const distinctFrom = caseRow.distinctFrom.filter((entry) => allowedCaseIds.has(entry.caseId));
  if (distinctFrom.length > 0) return { ...caseRow, distinctFrom };
  const { distinctFrom: _distinctFrom, ...withoutDistinctFrom } = caseRow;
  return withoutDistinctFrom;
}

function retainEligibleReRaise(
  caseRow: RemediationCaseRow,
  references: RemediationCaseValidationReferences,
): RemediationCaseRow {
  if (caseRow.reRaise === undefined) return caseRow;
  const eligibleCaseIds = new Set(references.reRaiseEligibleCaseIds);
  if (caseRow.disposition === 'act' && caseRow.existingCaseId !== undefined &&
    eligibleCaseIds.has(caseRow.existingCaseId)) return caseRow;
  const { reRaise: _reRaise, ...withoutReRaise } = caseRow;
  return withoutReRaise;
}

function hasProviderDurableId(caseRow: RemediationCaseRow): boolean {
  const candidate = caseRow as unknown as Record<string, unknown>;
  const effect = caseRow.effect as unknown as Record<string, unknown>;
  return ['caseId', 'effectId', 'id'].some((key) => hasOwn(candidate, key) || hasOwn(effect, key));
}

function providerOperatorOwnedState(caseRow: RemediationCaseRow):
  | 'operator-owned-acceptance'
  | 'operator-owned-resolution'
  | undefined {
  const candidate = caseRow as unknown as Record<string, unknown>;
  if (hasOwn(candidate, 'operatorAcceptance')) return 'operator-owned-acceptance';
  if (hasOwn(candidate, 'operatorResolution')) return 'operator-owned-resolution';
  return undefined;
}

function validateEffect(
  caseRow: RemediationCaseRow,
  judgement: RemediationCaseJudgement,
): Exclude<RemediationCaseGraphRejection, 'unknown-admission-task' | 'inadmissible-case-binding'> | undefined {
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
    for (const task of effect.tasks) {
      const admission = task as Record<string, unknown>;
      if (!Array.isArray(admission.admittedTaskIds) || admission.admittedTaskIds.length === 0) {
        return 'missing-admission-task';
      }
      if (!nonEmptyString(admission.admissionRationale)) return 'missing-admission-rationale';
      const seen = new Set<string>();
      for (const taskId of admission.admittedTaskIds) {
        if (!nonEmptyString(taskId)) return 'invalid-action-effect';
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
  if (caseRow.disposition === 'advisory') return effect.kind === 'none' ? undefined : 'invalid-reject-effect';
  return effect.kind === 'none' ? undefined : 'invalid-reject-effect';
}

function inadmissibleCaseBindings(
  judgement: RemediationCaseJudgement,
  references: RemediationCaseValidationReferences,
): InadmissibleCaseBindingRejection['bindings'] {
  const bindableByCaseId = references.bindableDispositionsByCaseId;
  if (bindableByCaseId === undefined) return [];

  const bindings: InadmissibleCaseBindingRejection['bindings'][number][] = [];
  for (const caseRow of judgement.cases) {
    if (caseRow.existingCaseId === undefined || caseRow.disposition === 'escalate') continue;
    const bindableDispositions = bindableByCaseId[caseRow.existingCaseId];
    if (bindableDispositions === undefined || bindableDispositions.includes(caseRow.disposition)) continue;
    bindings.push({
      caseRef: caseRow.caseRef,
      existingCaseId: caseRow.existingCaseId,
      disposition: caseRow.disposition,
      bindableDispositions,
    });
  }
  return bindings;
}

function unknownAdmissionTaskIds(
  judgement: Extract<RemediationCaseJudgement, { readonly mode: 'case-v2' }>,
  references: RemediationCaseValidationReferences,
): Pick<UnknownAdmissionTaskRejection, 'indexOnlyTaskIds' | 'absentTaskIds'> | undefined {
  const admittedTaskIds = new Set(references.admittedTaskIds ?? []);
  const planTaskIds = new Set(references.planTaskIds ?? []);
  const indexOnlyTaskIds: string[] = [];
  const absentTaskIds: string[] = [];
  const indexOnlySeen = new Set<string>();
  const absentSeen = new Set<string>();

  for (const caseRow of judgement.cases) {
    if (caseRow.disposition !== 'act') continue;
    if (caseRow.effect.kind !== 'action') continue;
    for (const task of caseRow.effect.tasks) {
      if (!('admittedTaskIds' in task)) continue;
      const taskIds = task.admittedTaskIds;
      for (const taskId of taskIds) {
        if (!nonEmptyString(taskId) || admittedTaskIds.has(taskId)) continue;
        if (planTaskIds.has(taskId)) {
          if (!indexOnlySeen.has(taskId)) indexOnlyTaskIds.push(taskId);
          indexOnlySeen.add(taskId);
        } else {
          if (!absentSeen.has(taskId)) absentTaskIds.push(taskId);
          absentSeen.add(taskId);
        }
      }
    }
  }

  return indexOnlyTaskIds.length > 0 || absentTaskIds.length > 0
    ? { indexOnlyTaskIds, absentTaskIds }
    : undefined;
}

function outcomeMatchesDisposition(
  outcome: RemediationCaseSourceRow['outcome'],
  disposition: RemediationCaseRow['disposition'],
): boolean {
  return outcome === 'merged'
    || (outcome === 'acted' && disposition === 'act')
    || (outcome === 'deferred' && disposition === 'defer')
    || (outcome === 'rejected' && disposition === 'reject')
    || (outcome === 'refuted' && disposition === 'refute')
    || (outcome === 'advisory' && disposition === 'advisory');
}

function advisoryThresholdForSource(
  sourceId: string,
  references: RemediationCaseValidationReferences,
): import('./build-review-domain.js').BuildReviewSeverity | undefined {
  const rubric = references.sourceRubrics?.[sourceId];
  const threshold = rubric === undefined
    ? undefined
    : references.declaredSeverityThresholds?.[rubric];
  return threshold !== 'nit' ? threshold : undefined;
}

function validateConsistency(
  currentSources: ReadonlySet<string>,
  casesByRef: ReadonlyMap<string, RemediationCaseRow>,
  judgement: Extract<RemediationCaseJudgement, { readonly mode: 'case-v2' }>,
): Exclude<RemediationCaseGraphRejection, 'unknown-admission-task' | 'inadmissible-case-binding'> | undefined {
  const consistency = judgement.consistency as unknown as Record<string, unknown>;
  if (!nonEmptyString(consistency.rationale)) return 'missing-consistency-rationale';
  // The consistency record names the *implicated* sources and cases
  // (adr-2026-09-10-portable-build-review-policy D9), not every one:
  // exhaustive source coverage is the graph's job, checked above.
  if (!Array.isArray(consistency.sourceIds) || consistency.sourceIds.length === 0) return 'missing-consistency-source';
  const consistencySources = new Set<string>();
  for (const sourceId of consistency.sourceIds) {
    if (!nonEmptyString(sourceId) || !currentSources.has(sourceId)) return 'unknown-consistency-source';
    if (consistencySources.has(sourceId)) return 'duplicate-consistency-source';
    consistencySources.add(sourceId);
  }
  if (!Array.isArray(consistency.caseRefs) || consistency.caseRefs.length === 0) return 'missing-consistency-case-reference';
  const consistencyCases = new Set<string>();
  for (const caseRef of consistency.caseRefs) {
    if (!nonEmptyString(caseRef) || !casesByRef.has(caseRef)) return 'unknown-consistency-case-reference';
    if (consistencyCases.has(caseRef)) return 'duplicate-consistency-case-reference';
    consistencyCases.add(caseRef);
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
    if (!hasValidDistinctFrom(caseRow)) return { ok: false, reason: 'invalid-case-keys' };
    if (!hasValidReRaise(caseRow)) return { ok: false, reason: 'invalid-case-keys' };
    if (hasProviderDurableId(caseRow)) return { ok: false, reason: 'provider-durable-id' };
    const operatorState = providerOperatorOwnedState(caseRow);
    if (operatorState) return { ok: false, reason: operatorState };
    if (judgement.mode === 'case-v2' && caseRow.existingCaseId &&
      !(references.existingCaseIds ?? []).includes(caseRow.existingCaseId)) {
      return { ok: false, reason: 'unknown-existing-case' };
    }
    if (caseRow.disposition === 'advisory' && !nonEmptyString(caseRow.rationale)) {
      return { ok: false, reason: 'invalid-advisory-threshold' };
    }
    const effectError = validateEffect(caseRow, judgement);
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

  if (judgement.mode === 'case-v2') {
    const unknownAdmissions = unknownAdmissionTaskIds(judgement, references);
    if (unknownAdmissions) return { ok: false, reason: 'unknown-admission-task', ...unknownAdmissions };
  }

  const sourcesByCase = new Map<string, RemediationCaseSourceRow[]>();
  const seenSources = new Set<string>();
  for (const source of judgement.sourceOutcomes) {
    if (source.outcome === 'carried') return { ok: false, reason: 'operator-owned-carried-source-outcome' };
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
    if (caseRow.disposition === 'advisory') {
      const threshold = advisoryThresholdForSource(source.sourceId, references);
      const reviewerSeverity = references.sourceReviewerSeverities?.[source.sourceId];
      if (threshold === undefined || caseRow.adjudicatedSeverity === undefined ||
        reviewerSeverity === undefined ||
        !isBelowSeverityThreshold(caseRow.adjudicatedSeverity, threshold) ||
        isBelowSeverityThreshold(reviewerSeverity, caseRow.adjudicatedSeverity)) {
        return { ok: false, reason: 'invalid-advisory-threshold' };
      }
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
  const inadmissibleBindings = inadmissibleCaseBindings(judgement, references);
  if (inadmissibleBindings.length > 0) {
    return { ok: false, reason: 'inadmissible-case-binding', bindings: inadmissibleBindings };
  }

  return {
    ok: true,
    graph: {
      sourceOutcomes: judgement.sourceOutcomes,
      cases: judgement.cases.map((caseRow) => ({
        case: retainEligibleReRaise(retainAllowedDistinctFrom(caseRow, references), references),
        sources: sourcesByCase.get(caseRow.caseRef)!,
      })),
    },
  };
}

export type IndexOnlyAdmissionClassification =
  | { readonly kind: 'index-only'; readonly taskIds: readonly string[] }
  | { readonly kind: 'other'; readonly reason: RemediationCaseGraphRejection };

/**
 * Determines whether adding index-only task bodies is the sole defect in a
 * rejected case-v2 graph. Re-validation, rather than reason-text parsing,
 * preserves the validator's ordinary failure ordering.
 */
export function classifyIndexOnlyAdmission(
  currentSourceIds: readonly string[],
  judgement: RemediationCaseJudgement,
  references: RemediationCaseValidationReferences,
  rejection: UnknownAdmissionTaskRejection,
): IndexOnlyAdmissionClassification {
  if (rejection.absentTaskIds.length > 0 || rejection.indexOnlyTaskIds.length === 0) {
    return { kind: 'other', reason: 'unknown-admission-task' };
  }
  const revalidation = validateRemediationCaseGraph(currentSourceIds, judgement, {
    ...references,
    admittedTaskIds: [...new Set([
      ...(references.admittedTaskIds ?? []),
      ...rejection.indexOnlyTaskIds,
    ])],
  });
  return revalidation.ok
    ? { kind: 'index-only', taskIds: rejection.indexOnlyTaskIds }
    : { kind: 'other', reason: revalidation.reason };
}
