import { randomUUID } from 'node:crypto';

import type { AsBuiltGoverningReference } from './as-built-contract.js';
import type {
  RemediationCaseAsBuiltRelation,
  RemediationCaseAsBuiltSource,
  RemediationCaseStoreState,
  RemediationCaseStoreV4State,
} from './remediation-case-store.js';

type ReconciliationRelation = Exclude<RemediationCaseAsBuiltRelation, 'needs-human'>;
export interface AsBuiltCaseFinding {
  readonly findingId: string;
  readonly attemptId: string;
  readonly class: 'REMEDIABLE' | 'DESIGN';
  readonly reference?: AsBuiltGoverningReference;
  readonly summary: string;
}

type ReconciliationSource = AsBuiltCaseFinding;

export interface AsBuiltReconciliationResult {
  readonly source: ReconciliationSource;
  readonly relation: ReconciliationRelation;
  readonly reason: string;
  readonly priorCaseId?: string;
  readonly repairTaskIds?: readonly string[];
}

export interface AsBuiltReconciliationOptions {
  readonly results: readonly AsBuiltReconciliationResult[];
  readonly newCaseId?: () => string;
  readonly newEventId?: () => string;
  readonly occurredAt?: string;
}

export interface AsBuiltNeedsHumanOptions {
  readonly findings: readonly ReconciliationSource[];
  readonly reason: string;
  readonly newCaseId?: () => string;
  readonly newEventId?: () => string;
  readonly occurredAt?: string;
}

export interface RecordedAsBuiltSource {
  readonly findingId: string;
  readonly caseId: string;
  readonly attemptId: string;
  readonly outcome: RemediationCaseAsBuiltRelation;
  readonly priorCaseId?: string;
  readonly reason: string;
}

export interface AsBuiltCaseReconciliationResult {
  readonly state: RemediationCaseStoreV4State;
  readonly recordedSources: readonly RecordedAsBuiltSource[];
}

interface AsBuiltOutboxEntry {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly event: {
    readonly type: 'as_built_finding_reconciled';
    readonly eventId: string;
    readonly findingId: string;
    readonly caseId: string;
    readonly attemptId: string;
    readonly outcome: RemediationCaseAsBuiltRelation;
    readonly priorCaseId?: string;
    readonly reason: string;
  };
}

function asV4(state: RemediationCaseStoreState): RemediationCaseStoreV4State {
  if (state.version === 'v4') return state;
  return {
    version: 'v4',
    feature: state.feature,
    cases: state.cases,
    prdWideningCases: state.version === 'v1' ? [] : state.prdWideningCases,
    asBuiltCases: [],
    suppressions: state.suppressions ?? [],
    outbox: state.version === 'v3' ? state.outbox : [],
  };
}

function stampedCaseId(generateId: () => string): string {
  return `as-built-case:${generateId()}`;
}

function sourceFor(
  source: ReconciliationSource,
  relation: RemediationCaseAsBuiltRelation,
  reason: string,
  priorCaseId?: string,
): RemediationCaseAsBuiltSource {
  return {
    findingId: source.findingId,
    attemptId: source.attemptId,
    class: source.class,
    ...(source.reference === undefined ? {} : { reference: source.reference }),
    summary: source.summary,
    relation,
    reason,
    ...(priorCaseId === undefined ? {} : { priorCaseId }),
  };
}

function appendOutbox(
  state: RemediationCaseStoreV4State,
  recorded: readonly RecordedAsBuiltSource[],
  newEventId: () => string,
  occurredAt: string,
): RemediationCaseStoreV4State {
  const entries: AsBuiltOutboxEntry[] = recorded.map((source) => {
    const eventId = newEventId();
    return {
      eventId,
      occurredAt,
      event: {
        type: 'as_built_finding_reconciled', eventId,
        findingId: source.findingId, caseId: source.caseId, attemptId: source.attemptId,
        outcome: source.outcome, ...(source.priorCaseId === undefined ? {} : { priorCaseId: source.priorCaseId }),
        reason: source.reason,
      },
    };
  });
  // Task 6 adds this event to the store's persisted outbox union and parser.
  // The helper owns the atomic state shape now; the cast prevents that later
  // event-spine wiring from broadening this task's declared file scope.
  return { ...state, outbox: [...state.outbox, ...entries] } as unknown as RemediationCaseStoreV4State;
}

function recordedFindingIds(state: RemediationCaseStoreV4State): Set<string> {
  return new Set(state.asBuiltCases.flatMap((record) => record.sources.map((source) => source.findingId)));
}

/** Reconcile accepted as-built planning results without performing store I/O. */
export function recordAsBuiltReconciliation(
  state: RemediationCaseStoreState,
  options: AsBuiltReconciliationOptions,
): AsBuiltCaseReconciliationResult {
  const current = asV4(state);
  const generateId = options.newCaseId ?? randomUUID;
  const existingFindingIds = recordedFindingIds(current);
  const cases = [...current.asBuiltCases];
  const recordedSources: RecordedAsBuiltSource[] = [];

  for (const result of options.results) {
    if (existingFindingIds.has(result.source.findingId)) continue;
    existingFindingIds.add(result.source.findingId);
    const linked = result.relation === 'same' || result.relation === 'recurrence';
    const caseId = linked ? result.priorCaseId : stampedCaseId(generateId);
    if (caseId === undefined) continue;
    const source = sourceFor(result.source, result.relation, result.reason, result.priorCaseId);
    if (linked) {
      const index = cases.findIndex((record) => record.id === caseId);
      if (index < 0) continue;
      const prior = cases[index]!;
      cases[index] = {
        ...prior, status: 'open', sources: [...prior.sources, source],
        recurrenceCount: prior.recurrenceCount + (result.relation === 'recurrence' ? 1 : 0),
      };
    } else {
      cases.push({
        id: caseId, domain: 'as_built', sources: [source], status: 'open',
        repairTaskIds: result.repairTaskIds ?? [], recurrenceCount: 1,
        ...(result.relation === 'materially-changed' && result.priorCaseId !== undefined ? { changedFrom: result.priorCaseId } : {}),
      });
    }
    recordedSources.push({ findingId: source.findingId, caseId, attemptId: source.attemptId, outcome: result.relation, ...(result.priorCaseId === undefined ? {} : { priorCaseId: result.priorCaseId }), reason: result.reason });
  }

  const next = { ...current, asBuiltCases: cases };
  return { state: appendOutbox(next, recordedSources, options.newEventId ?? randomUUID, options.occurredAt ?? new Date().toISOString()), recordedSources };
}

/** Record halt-bound findings as durable as-built cases without planner I/O. */
export function recordAsBuiltNeedsHuman(
  state: RemediationCaseStoreState,
  options: AsBuiltNeedsHumanOptions,
): AsBuiltCaseReconciliationResult {
  const current = asV4(state);
  const generateId = options.newCaseId ?? randomUUID;
  const existingFindingIds = recordedFindingIds(current);
  const cases = [...current.asBuiltCases];
  const recordedSources: RecordedAsBuiltSource[] = [];

  for (const finding of options.findings) {
    if (existingFindingIds.has(finding.findingId)) continue;
    existingFindingIds.add(finding.findingId);
    const caseId = stampedCaseId(generateId);
    const source = sourceFor(finding, 'needs-human', options.reason);
    cases.push({ id: caseId, domain: 'as_built', sources: [source], status: 'needs-human', repairTaskIds: [], recurrenceCount: 1 });
    recordedSources.push({ findingId: source.findingId, caseId, attemptId: source.attemptId, outcome: 'needs-human', reason: options.reason });
  }

  const next = { ...current, asBuiltCases: cases };
  return { state: appendOutbox(next, recordedSources, options.newEventId ?? randomUUID, options.occurredAt ?? new Date().toISOString()), recordedSources };
}

/** Resolve open history on an approved gate pass, retaining all other history. */
export function resolveOpenAsBuiltCases(state: RemediationCaseStoreState): AsBuiltCaseReconciliationResult {
  const current = asV4(state);
  return {
    state: { ...current, asBuiltCases: current.asBuiltCases.map((record) => record.status === 'open' ? { ...record, status: 'resolved' } : record) },
    recordedSources: [],
  };
}
