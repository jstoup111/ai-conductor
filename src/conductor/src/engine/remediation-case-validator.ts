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
  | 'provider-durable-id';

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

function validateEffect(caseRow: RemediationCaseRow): RemediationCaseGraphRejection | undefined {
  const effect = caseRow.effect as unknown as Record<string, unknown>;
  if (caseRow.disposition === 'act') {
    if (effect.kind !== 'action' || effect.route !== 'build' || !Array.isArray(effect.tasks) || effect.tasks.length === 0) {
      return 'invalid-action-effect';
    }
    return effect.tasks.every((task) => (
      typeof task === 'object'
      && task !== null
      && nonEmptyString((task as Record<string, unknown>).title)
    )) ? undefined : 'invalid-action-effect';
  }
  if (caseRow.disposition === 'defer') {
    return effect.kind === 'deferral' && nonEmptyString(effect.exclusionRationale)
      ? undefined
      : 'invalid-deferral-effect';
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
    || (outcome === 'rejected' && disposition === 'reject');
}

/**
 * Validates a provider result as one all-or-nothing graph over the frozen
 * current source set. It has no persistence or effect boundary: callers only
 * receive a graph after every source and case relation is admitted.
 */
export function validateRemediationCaseGraph(
  currentSourceIds: readonly string[],
  judgement: RemediationCaseJudgement,
): ValidateRemediationCaseGraphResult {
  const currentSources = new Set<string>();
  for (const sourceId of currentSourceIds) {
    if (currentSources.has(sourceId)) return { ok: false, reason: 'duplicate-current-source' };
    currentSources.add(sourceId);
  }

  const casesByRef = new Map<string, RemediationCaseRow>();
  for (const caseRow of judgement.cases) {
    if (hasProviderDurableId(caseRow)) return { ok: false, reason: 'provider-durable-id' };
    const effectError = validateEffect(caseRow);
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
    if (!outcomeMatchesDisposition(source.outcome, caseRow.disposition)) {
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
