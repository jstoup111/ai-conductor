import type { RemediationCaseRow } from './remediation-case-artifact.js';
import {
  type RemediationCaseEffect,
  type RemediationCaseRecord,
  type RemediationCaseStoreFailureReason,
  type RemediationCaseStoreState,
  RemediationCaseStore,
} from './remediation-case-store.js';
import type { RemediationCaseGraph } from './remediation-case-validator.js';

export interface ReconcileRemediationCasesInput {
  /** Graph already admitted by `validateRemediationCaseGraph`. */
  readonly graph: RemediationCaseGraph;
  /** Engine clock captured for this single reconciliation. */
  readonly recordedAt: string;
  /** Engine-owned durable identity source; inject in tests. */
  readonly generateId: () => string;
  /** Durable BUILD-work-order evidence, supplied by the later work-order seam. */
  readonly attemptedCaseIds?: readonly string[];
  /** Case identities known by the caller to belong to another feature/domain. */
  readonly foreignCaseIds?: readonly string[];
}

export type RemediationCaseReconciliationRejection =
  | 'unknown-case-binding'
  | 'foreign-case-binding'
  | 'duplicate-case-binding'
  | 'illegal-disposition-transition'
  | 'illegal-source-link'
  | 'id-generation-failed'
  | 'id-collision';

export type ReconcileRemediationCasesResult =
  | { readonly ok: true; readonly state: RemediationCaseStoreState; readonly caseIdsByRef: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly reason: RemediationCaseReconciliationRejection }
  | { readonly ok: false; readonly reason: 'store-failure'; readonly storeReason: RemediationCaseStoreFailureReason };

type Reconciliation =
  | { readonly ok: true; readonly state: RemediationCaseStoreState; readonly changed: boolean; readonly caseIdsByRef: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly reason: RemediationCaseReconciliationRejection };

function isDurableId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 256;
}

function effectFor(caseRow: RemediationCaseRow, id: string | undefined): RemediationCaseEffect {
  if (caseRow.disposition === 'reject') return { kind: 'none' };
  return caseRow.disposition === 'act'
    ? { id: id!, kind: 'action', status: 'reserved' }
    : { id: id!, kind: 'deferral', status: 'reserved' };
}

function takeId(generateId: () => string, usedIds: Set<string>): string | RemediationCaseReconciliationRejection {
  let id: string;
  try {
    id = generateId();
  } catch {
    return 'id-generation-failed';
  }
  if (!isDurableId(id)) return 'id-generation-failed';
  if (usedIds.has(id)) return 'id-collision';
  usedIds.add(id);
  return id;
}

function reconcileState(
  state: RemediationCaseStoreState,
  input: ReconcileRemediationCasesInput,
): Reconciliation {
  const foreignIds = new Set(input.foreignCaseIds ?? []);
  const attemptedIds = new Set(input.attemptedCaseIds ?? []);
  const existingById = new Map(state.cases.map((record) => [record.id, record]));
  const usedIds = new Set<string>();
  for (const record of state.cases) {
    usedIds.add(record.id);
    if (record.effect.kind !== 'none') usedIds.add(record.effect.id);
  }

  const referencedExisting = new Set<string>();
  const replacements = new Map<string, RemediationCaseRecord>();
  const additions: RemediationCaseRecord[] = [];
  const caseIdsByRef = new Map<string, string>();

  for (const proposed of input.graph.cases) {
    const { case: caseRow, sources } = proposed;
    if (!caseRow.existingCaseId) {
      const caseId = takeId(input.generateId, usedIds);
      if (typeof caseId !== 'string' || caseId === 'id-generation-failed' || caseId === 'id-collision') {
        return { ok: false, reason: caseId };
      }
      const effectId = caseRow.disposition === 'reject' ? undefined : takeId(input.generateId, usedIds);
      if (effectId === 'id-generation-failed' || effectId === 'id-collision') return { ok: false, reason: effectId };
      additions.push({
        id: caseId,
        domain: 'build_review',
        disposition: caseRow.disposition,
        priority: caseRow.priority,
        rationale: caseRow.rationale,
        confidence: caseRow.confidence,
        resolution: 'open',
        sources: sources.map((source) => ({
          sourceId: source.sourceId,
          outcome: source.outcome,
          recordedAt: input.recordedAt,
        })),
        effect: effectFor(caseRow, effectId),
      });
      caseIdsByRef.set(caseRow.caseRef, caseId);
      continue;
    }

    const existingCaseId = caseRow.existingCaseId;
    if (foreignIds.has(existingCaseId)) return { ok: false, reason: 'foreign-case-binding' };
    const existing = existingById.get(existingCaseId);
    if (!existing) return { ok: false, reason: 'unknown-case-binding' };
    if (existing.domain !== 'build_review') return { ok: false, reason: 'foreign-case-binding' };
    if (referencedExisting.has(existingCaseId)) return { ok: false, reason: 'duplicate-case-binding' };
    if (existing.disposition !== caseRow.disposition) return { ok: false, reason: 'illegal-disposition-transition' };
    referencedExisting.add(existingCaseId);
    caseIdsByRef.set(caseRow.caseRef, existingCaseId);

    const appendedSources = [...existing.sources];
    for (const source of sources) {
      const historical = existing.sources.find((link) => link.sourceId === source.sourceId);
      if (historical) {
        if (historical.outcome !== source.outcome) return { ok: false, reason: 'illegal-source-link' };
        continue;
      }
      appendedSources.push({ sourceId: source.sourceId, outcome: source.outcome, recordedAt: input.recordedAt });
    }
    if (appendedSources.length !== existing.sources.length) {
      replacements.set(existingCaseId, { ...existing, sources: appendedSources });
    }
  }

  let changed = additions.length > 0 || replacements.size > 0;
  const cases = state.cases.map((record) => {
    const replacement = replacements.get(record.id) ?? record;
    if (
      replacement.resolution === 'open'
      && replacement.disposition === 'act'
      && replacement.effect.kind === 'action'
      && !referencedExisting.has(replacement.id)
      && attemptedIds.has(replacement.id)
    ) {
      changed = true;
      return { ...replacement, resolution: 'resolved' as const };
    }
    return replacement;
  });
  return { ok: true, state: { ...state, cases: [...cases, ...additions] }, changed, caseIdsByRef };
}

/**
 * Converts a validated provider graph to engine-owned case state under one
 * lease. It appends raw source evidence and never touches operator decisions.
 */
export async function reconcileRemediationCases(
  store: RemediationCaseStore,
  input: ReconcileRemediationCasesInput,
): Promise<ReconcileRemediationCasesResult> {
  const mutation = await store.mutate<Reconciliation>(async (state) => {
    const reconciliation = reconcileState(state, input);
    return reconciliation.ok
      ? { value: reconciliation, ...(reconciliation.changed ? { nextState: reconciliation.state } : {}) }
      : { value: reconciliation };
  });
  if (!mutation.ok) return { ok: false, reason: 'store-failure', storeReason: mutation.reason };
  return mutation.value.ok
    ? { ok: true, state: mutation.value.state, caseIdsByRef: mutation.value.caseIdsByRef }
    : mutation.value;
}
