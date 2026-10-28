import type { RemediationCaseRow } from './remediation-case-artifact.js';
import { randomUUID } from 'node:crypto';
import {
  type RemediationCaseEffect,
  type RemediationCaseOutboxEntry,
  type RemediationCaseRecord,
  type RemediationCaseStoreFailureReason,
  type RemediationCaseStoreState,
  type RemediationCaseTransitionViolation,
  appendRemediationCaseOutbox,
  classifyBuildReviewRecurrence,
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
  /** Exact operator authority available to this reconciliation. */
  readonly effectiveAcceptedSourceIds?: ReadonlySet<string>;
  /** Whether this lap proves absence rather than merely omitting a source. */
  readonly mechanicallyHealthy?: boolean;
  /** Full current-lap source projection for exit-time settlement. */
  readonly liveSourceIds?: ReadonlySet<string>;
  /** Preserve the established absence settlement for completed non-action history. */
  readonly resolveAbsentOpenNonActionCases?: boolean;
  /** An attempted applied effect may settle on a normal adjudication lap, never a missing-order PASS. */
  readonly allowAppliedByAbsence?: boolean;
  /** The occurrence lap for any absence retirement performed in this mutation. */
  readonly lapId?: string;
  /** Case identities known by the caller to belong to another feature/domain. */
  readonly foreignCaseIds?: readonly string[];
  /** Proposals classified as `carry` by `classifyRemediationCaseReuse`. */
  readonly carry?: {
    readonly caseRefs: readonly string[];
    readonly lapId: string;
  };
  /**
   * Coordinator-selected repair provenance. Exact source ownership still wins;
   * this data is used only for an unbound act with no exact owner.
   */
  readonly provenanceByCaseRef?: ReadonlyMap<string, {
    readonly selectedCaseId: string;
    readonly candidateCaseIds: readonly string[];
  }>;
}

export type RemediationCaseReconciliationRejection =
  | 'unknown-case-binding'
  | 'foreign-case-binding'
  | 'duplicate-case-binding'
  | 'illegal-disposition-transition'
  | 'refutation-repeat'
  | 'illegal-source-link'
  | 'decision-stop-pending'
  | 'id-generation-failed'
  | 'id-collision';

export type ReconcileRemediationCasesResult =
  | {
      readonly ok: true;
      readonly state: RemediationCaseStoreState;
      readonly caseIdsByRef: ReadonlyMap<string, string>;
      /**
       * Every case this reconciliation transitioned that no current `caseRef`
       * points at — today, prior attempted action cases absent from the
       * admitted graph, which are resolved here. `caseIdsByRef` cannot name
       * them (they have no proposal), so a caller emitting lifecycle
       * occurrences from that map alone would change durable state silently.
       */
      readonly resolvedAbsentCaseIds: readonly string[];
    }
  | { readonly ok: false; readonly reason: RemediationCaseReconciliationRejection }
  | {
    readonly ok: false;
    readonly reason: 'store-failure';
    readonly storeReason: RemediationCaseStoreFailureReason;
    readonly violation?: RemediationCaseTransitionViolation;
  };

/** Explicit durable bindings, never prose similarity or tree movement, decide reuse. */
export type RemediationCaseReuseDisposition = 'resume' | 'reuse' | 'halt-repeat' | 'halt-regression' | 'carry';

export interface RemediationCaseCarryInput {
  readonly currentLapId: string;
  readonly effectiveAcceptedSourceIds: ReadonlySet<string>;
}

/** A durable operator decision carries only after its origin remains effective in a later lap. */
export function isCarryEligibleRemediationCase(
  record: RemediationCaseRecord,
  { currentLapId, effectiveAcceptedSourceIds }: RemediationCaseCarryInput,
): boolean {
  if (record.operatorResolution) return true;
  const origins = record.operatorAcceptance?.origins;
  return record.resolution === 'resolved'
    && origins !== undefined
    && origins.length > 0
    && origins.every((origin) => effectiveAcceptedSourceIds.has(origin.sourceId) && origin.lapId !== currentLapId);
}

/**
 * The sole retirement decision for open build-review action cases.  Acceptance
 * is authoritative even when an earlier effect failed; absence is evidence
 * only on a mechanically healthy lap.  Callers own their writes, never a
 * second interpretation of these conditions.
 */
export function retiresOpenBuildReviewCase(
  record: RemediationCaseRecord,
  input: {
    readonly liveSourceIds: ReadonlySet<string>;
    readonly effectiveAcceptedSourceIds: ReadonlySet<string>;
    readonly mechanicallyHealthy: boolean;
    readonly allowAppliedByAbsence?: boolean;
    /** Allows benign absence to settle a referenced-free non-action row. */
    readonly resolveAbsentOpenNonActionCases?: boolean;
    /** The caller knows the current graph still explicitly names this case. */
    readonly referenced?: boolean;
  },
): boolean {
  if (record.resolution !== 'open') return false;
  // Owner stops are a durable decision, never a benign-absence case. Other
  // non-actions have no autonomous effect to retire, so absence may settle
  // only the caller's explicit, mechanically-healthy non-action lane.
  if (record.disposition !== 'act' || record.effect.kind !== 'action') {
    return input.mechanicallyHealthy
      && input.resolveAbsentOpenNonActionCases === true
      && input.referenced !== true
      && record.disposition !== 'escalate'
      && (record.effect.kind === 'none' || record.effect.status === 'applied');
  }
  // Historical origins are attribution, not evergreen authority. An origin
  // participates only while it remains effective in this lap.
  const originSourceIds = new Set((record.operatorAcceptance?.origins ?? [])
    .filter((origin) => input.effectiveAcceptedSourceIds.has(origin.sourceId))
    .map((origin) => origin.sourceId));
  const covered = record.sources.length > 0 && record.sources.every((source) =>
    input.effectiveAcceptedSourceIds.has(source.sourceId) || originSourceIds.has(source.sourceId) || source.outcome === 'carried');
  if (covered) return true;
  const absent = input.mechanicallyHealthy &&
    (record.effect.status === 'failed' || record.effect.status === 'reserved' ||
      (record.effect.status === 'applied' && input.allowAppliedByAbsence === true)) &&
    record.sources.every((source) => !input.liveSourceIds.has(source.sourceId));
  return absent;
}

/** Apply the one durable representation of a build-review retirement. */
export function retireOpenBuildReviewCase(record: RemediationCaseRecord): RemediationCaseRecord {
  if (record.effect.kind !== 'none' && record.effect.status === 'reserved') {
    return {
      ...record,
      resolution: 'resolved',
      effect: {
        ...record.effect,
        status: 'failed',
        diagnostic: 'retired: every source operator-accepted or no longer raised',
      },
    };
  }
  return { ...record, resolution: 'resolved' };
}

export function classifyRemediationCaseReuse(
  record: RemediationCaseRecord,
  attemptedCaseIds: ReadonlySet<string>,
  carryInput?: RemediationCaseCarryInput,
): RemediationCaseReuseDisposition {
  if (carryInput && isCarryEligibleRemediationCase(record, carryInput)) return 'carry';
  if (record.disposition !== 'act') return 'reuse';
  if (record.resolution === 'resolved') return 'halt-regression';
  return attemptedCaseIds.has(record.id) ? 'halt-repeat' : 'resume';
}

type Reconciliation =
  | {
      readonly ok: true;
      readonly state: RemediationCaseStoreState;
      readonly changed: boolean;
      readonly caseIdsByRef: ReadonlyMap<string, string>;
      readonly resolvedAbsentCaseIds: readonly string[];
    }
  | { readonly ok: false; readonly reason: RemediationCaseReconciliationRejection };

function isDurableId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 256;
}

function effectFor(caseRow: RemediationCaseRow, id: string | undefined): RemediationCaseEffect {
  if (caseRow.disposition === 'reject' || caseRow.disposition === 'advisory' || caseRow.disposition === 'escalate') return { kind: 'none' };
  return caseRow.disposition === 'act'
    ? { id: id!, kind: 'action', status: 'reserved' }
    : { id: id!, kind: 'deferral', status: 'reserved' };
}

/**
 * The durable identity of an un-bound proposal, when one already exists.
 *
 * Reconciliation is serialized by the store lease, but serialization alone does
 * not make it idempotent: replaying one judgement used to stamp a second case
 * and effect id for work the first application had already reserved. An open
 * case whose disposition and complete source-link set are exactly the
 * proposal's IS that proposal, so the replay converges on it. Identity here is
 * the engine's own canonical source ids and outcomes — never rationale prose,
 * summaries, or tree movement.
 */
function convergedCaseFor(
  state: RemediationCaseStoreState,
  proposed: RemediationCaseGraph['cases'][number],
  claimed: ReadonlySet<string>,
): RemediationCaseRecord | undefined {
  return state.cases.find((record) => {
    // A completed non-action case is a mechanically settled recurrence when
    // its engine-owned source identities and outcomes match exactly.  This is
    // intentionally narrower than semantic equivalence: a policy digest is
    // inside a custom finding id, so a policy update cannot reuse this row.
    const settledNonAction = record.resolution === 'resolved' && record.disposition !== 'act' &&
      (record.effect.kind === 'none' || record.effect.status === 'applied');
    if (claimed.has(record.id) || (record.resolution !== 'open' && !settledNonAction)) return false;
    if (record.disposition !== proposed.case.disposition) return false;
    if (record.sources.length !== proposed.sources.length) return false;
    return proposed.sources.every((source) =>
      record.sources.some((link) => link.sourceId === source.sourceId && link.outcome === source.outcome),
    );
  });
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
  const carriedCaseRefs = new Set(input.carry?.caseRefs ?? []);
  const existingById = new Map(state.cases.map((record) => [record.id, record]));
  const usedIds = new Set<string>();
  for (const record of state.cases) {
    usedIds.add(record.id);
    if (record.effect.kind !== 'none') usedIds.add(record.effect.id);
  }

  const referencedExisting = new Set<string>();
  const replacements = new Map<string, RemediationCaseRecord>();
  const additions: RemediationCaseRecord[] = [];
  const outbox: RemediationCaseOutboxEntry[] = [];
  const caseIdsByRef = new Map<string, string>();
  const claimed = new Set<string>();

  for (const proposed of input.graph.cases) {
    const { case: caseRow, sources } = proposed;
    if (!caseRow.existingCaseId) {
      const converged = convergedCaseFor(state, proposed, claimed);
      if (converged) {
        claimed.add(converged.id);
        caseIdsByRef.set(caseRow.caseRef, converged.id);
        referencedExisting.add(converged.id);
        continue;
      }
      const caseId = takeId(input.generateId, usedIds);
      if (typeof caseId !== 'string' || caseId === 'id-generation-failed' || caseId === 'id-collision') {
        return { ok: false, reason: caseId };
      }
      const effectId = caseRow.disposition === 'reject' || caseRow.disposition === 'advisory' || caseRow.disposition === 'escalate'
        ? undefined
        : takeId(input.generateId, usedIds);
      if (effectId === 'id-generation-failed' || effectId === 'id-collision') return { ok: false, reason: effectId };
      const exactRecurrence = caseRow.disposition === 'act'
        ? classifyBuildReviewRecurrence(state.cases, sources.map((source) => source.sourceId), caseRow.distinctFrom ?? [])
        : undefined;
      const provenance = exactRecurrence !== undefined && exactRecurrence.recurrenceOf.length === 0 && exactRecurrence.distinctFrom.length === 0
        ? input.provenanceByCaseRef?.get(caseRow.caseRef)
        : undefined;
      const provenanceDistinctFrom = provenance === undefined
        ? []
        : (caseRow.distinctFrom ?? []).filter((entry) => provenance.candidateCaseIds.includes(entry.caseId));
      const selectedProvenanceIsDistinct = provenance !== undefined &&
        provenanceDistinctFrom.some((entry) => entry.caseId === provenance.selectedCaseId);
      const recurrenceOf = exactRecurrence === undefined
        ? []
        : exactRecurrence.recurrenceOf.length > 0
          ? exactRecurrence.recurrenceOf
          : provenance !== undefined && !selectedProvenanceIsDistinct
            ? [provenance.selectedCaseId]
            : [];
      const distinctFrom = exactRecurrence === undefined
        ? []
        : [...exactRecurrence.distinctFrom, ...provenanceDistinctFrom];
      claimed.add(caseId);
      caseIdsByRef.set(caseRow.caseRef, caseId);
      additions.push({
        id: caseId,
        domain: 'build_review',
        disposition: caseRow.disposition,
        priority: caseRow.priority,
        rationale: caseRow.rationale,
        confidence: caseRow.confidence,
        ...(caseRow.adjudicatedSeverity === undefined ? {} : { adjudicatedSeverity: caseRow.adjudicatedSeverity }),
        resolution: 'open',
        sources: sources.map((source) => ({
          sourceId: source.sourceId,
          outcome: source.outcome,
          recordedAt: input.recordedAt,
        })),
        effect: effectFor(caseRow, effectId),
        ...(caseRow.escalation === undefined ? {} : { escalation: caseRow.escalation }),
        ...(recurrenceOf.length === 0 ? {} : { recurrenceOf }),
        ...(distinctFrom.length === 0 ? {} : { distinctFrom }),
      });
      continue;
    }

    const existingCaseId = caseRow.existingCaseId;
    if (foreignIds.has(existingCaseId)) return { ok: false, reason: 'foreign-case-binding' };
    const existing = existingById.get(existingCaseId);
    if (!existing) return { ok: false, reason: 'unknown-case-binding' };
    if (existing.domain !== 'build_review') return { ok: false, reason: 'foreign-case-binding' };
    if (referencedExisting.has(existingCaseId)) return { ok: false, reason: 'duplicate-case-binding' };
    // Carry is a complete lane, not an exception on every autonomous lane.
    // Decide it first so a carried refutation never consults its historical
    // refutation and a carried deferral never reserves a new effect.
    const admitsCarry = carriedCaseRefs.has(caseRow.caseRef);
    let admitsRefutation = false;
    let admitsDeferral = false;
    let admitsActionRetry = false;
    if (!admitsCarry) {
      admitsRefutation = caseRow.disposition === 'refute'
        && existing.disposition === 'act'
        && existing.resolution === 'open'
        && attemptedIds.has(existing.id)
        && existing.effect.kind === 'action'
        && existing.effect.status === 'applied';
      // An applied action whose finding comes back may be conclusively deferred:
      // the repair was tried, and the judge has found the remaining fix outside
      // the approved plan. Without this lane the only transitions off an applied
      // action are refutation or another action, and a legitimate follow-up
      // halted the feature as an illegal transition.
      admitsDeferral = caseRow.disposition === 'defer'
        && existing.disposition === 'act'
        && existing.effect.kind === 'action'
        && existing.effect.status === 'applied';
      // A failed action effect is terminal (for example charged past the
      // kickback budget), so no lap can apply it and the open case halted every
      // lap. Re-raising its finding as action reserves a fresh effect, which is
      // charged like any new action, so an exhausted budget still stops the lap.
      admitsActionRetry = caseRow.disposition === 'act'
        && existing.disposition === 'act'
        && existing.resolution === 'open'
        && existing.effect.kind === 'action'
        && existing.effect.status === 'failed';
      if (caseRow.disposition === 'refute' && existing.refutation) return { ok: false, reason: 'refutation-repeat' };
      if (existing.disposition !== caseRow.disposition && !admitsRefutation && !admitsDeferral) return { ok: false, reason: 'illegal-disposition-transition' };
    }
    referencedExisting.add(existingCaseId);
    claimed.add(existingCaseId);
    caseIdsByRef.set(caseRow.caseRef, existingCaseId);

    let appendedSources = [...existing.sources];
    for (const source of sources) {
      const historical = existing.sources.find((link) => link.sourceId === source.sourceId);
      if (historical) {
        if (admitsCarry) {
          // A built-in finding commonly re-raises under its original source
          // id. Its old acted link is the authoritative current link, so carry
          // must upgrade it (and record the occurrence) rather than treating
          // it as a replay of an already-carried source.
          if (historical.outcome === 'carried') continue;
          const eventId = takeId(input.generateId, usedIds);
          if (eventId === 'id-generation-failed' || eventId === 'id-collision') return { ok: false, reason: eventId };
          const origins = existing.operatorAcceptance?.origins ?? [];
          outbox.push({
            eventId,
            occurredAt: input.recordedAt,
            event: {
              type: 'build_review_acceptance_carried', eventId, feature: state.feature.feature,
              lapId: input.carry!.lapId, sourceId: source.sourceId, caseId: existing.id,
              originSourceIds: origins.map((origin) => origin.sourceId),
              originLapIds: origins.map((origin) => origin.lapId),
            },
          });
          appendedSources = appendedSources.map((link) => link.sourceId === source.sourceId
            ? { ...link, outcome: 'carried', recordedAt: input.recordedAt }
            : link);
          continue;
        }
        // An applied action may be conclusively refuted on a later attempted
        // lap. Preserve the source identity while changing its durable
        // outcome; adding a second link would violate the store's unique
        // source-id invariant.
        if ((admitsRefutation && historical.outcome === 'acted' && source.outcome === 'refuted')
          || (admitsDeferral && historical.outcome === 'acted' && source.outcome === 'deferred')) {
          appendedSources = appendedSources.map((link) => link.sourceId === source.sourceId
            ? { ...link, outcome: source.outcome, recordedAt: input.recordedAt }
            : link);
          continue;
        }
        if (historical.outcome !== source.outcome) return { ok: false, reason: 'illegal-source-link' };
        continue;
      }
      if (admitsCarry) {
        const eventId = takeId(input.generateId, usedIds);
        if (eventId === 'id-generation-failed' || eventId === 'id-collision') return { ok: false, reason: eventId };
        const origins = existing.operatorAcceptance?.origins ?? [];
        outbox.push({
          eventId,
          occurredAt: input.recordedAt,
          event: {
            type: 'build_review_acceptance_carried', eventId, feature: state.feature.feature,
            lapId: input.carry!.lapId, sourceId: source.sourceId, caseId: existing.id,
            originSourceIds: origins.map((origin) => origin.sourceId),
            originLapIds: origins.map((origin) => origin.lapId),
          },
        });
      }
      appendedSources.push({ sourceId: source.sourceId, outcome: admitsCarry ? 'carried' : source.outcome, recordedAt: input.recordedAt });
    }
    if (admitsCarry) {
      if (appendedSources.some((source, index) => source !== existing.sources[index])) {
        replacements.set(existingCaseId, { ...existing, sources: appendedSources });
      }
    } else if (admitsRefutation) {
      const effectId = caseRow.effect.kind === 'deferral' ? takeId(input.generateId, usedIds) : undefined;
      if (effectId === 'id-generation-failed' || effectId === 'id-collision') return { ok: false, reason: effectId };
      replacements.set(existingCaseId, {
        ...existing,
        disposition: 'refute',
        priority: caseRow.priority,
        rationale: caseRow.rationale,
        confidence: caseRow.confidence,
        resolution: 'resolved',
        sources: appendedSources,
        effect: caseRow.effect.kind === 'none' ? { kind: 'none' } : { id: effectId!, kind: 'deferral', status: 'reserved' },
        refutation: caseRow.refutation!,
      });
    } else if (admitsDeferral) {
      const effectId = takeId(input.generateId, usedIds);
      if (effectId === 'id-generation-failed' || effectId === 'id-collision') return { ok: false, reason: effectId };
      // The deferral effect is reserved like a fresh deferral's: the effect
      // stage files the follow-up and settles the case, so the row reopens
      // until that lands instead of claiming a filed issue it does not have.
      replacements.set(existingCaseId, {
        ...existing,
        disposition: 'defer',
        priority: caseRow.priority,
        rationale: caseRow.rationale,
        confidence: caseRow.confidence,
        resolution: 'open',
        sources: appendedSources,
        effect: { id: effectId, kind: 'deferral', status: 'reserved' },
      });
    } else if (admitsActionRetry) {
      const effectId = takeId(input.generateId, usedIds);
      if (effectId === 'id-generation-failed' || effectId === 'id-collision') return { ok: false, reason: effectId };
      replacements.set(existingCaseId, {
        ...existing,
        priority: caseRow.priority,
        rationale: caseRow.rationale,
        confidence: caseRow.confidence,
        sources: appendedSources,
        effect: { id: effectId, kind: 'action', status: 'reserved' },
      });
    } else if (appendedSources.length !== existing.sources.length) {
      replacements.set(existingCaseId, { ...existing, sources: appendedSources });
    }
  }

  // An empty graph is restart/no-current-source settlement, not evidence that
  // an owner changed the approved baseline. Unlike ordinary non-action
  // history, a durable decision stop cannot be retired by that absence: doing
  // so would let the caller turn an unresolved current-outcome gap into PASS.
  // A later non-empty admitted graph remains the explicit re-evaluation lane.
  if (
    input.resolveAbsentOpenNonActionCases
    && input.graph.sourceOutcomes.length === 0
    && state.cases.some((record) => record.resolution === 'open' && record.disposition === 'escalate')
  ) {
    return { ok: false, reason: 'decision-stop-pending' };
  }

  let changed = additions.length > 0 || replacements.size > 0;
  // Resolved here, but named by no `caseRef` — reported separately so the
  // caller can emit one lifecycle occurrence per persisted transition.
  const resolvedAbsentCaseIds: string[] = [];
  const cases = state.cases.map((record) => {
    const replacement = replacements.get(record.id) ?? record;
    const referenced = referencedExisting.has(replacement.id);
    const retires = !referenced && retiresOpenBuildReviewCase(replacement, {
      liveSourceIds: input.liveSourceIds ?? new Set(input.graph.sourceOutcomes.map((source) => source.sourceId)),
      effectiveAcceptedSourceIds: input.effectiveAcceptedSourceIds ?? new Set(),
      mechanicallyHealthy: input.mechanicallyHealthy === true,
      allowAppliedByAbsence: input.allowAppliedByAbsence,
      resolveAbsentOpenNonActionCases: input.resolveAbsentOpenNonActionCases,
      referenced,
    });
    if (retires && (attemptedIds.has(replacement.id) || replacement.disposition !== 'act')) {
      changed = true;
      resolvedAbsentCaseIds.push(replacement.id);
      if (input.lapId) {
        const eventId = randomUUID();
        outbox.push({ eventId, occurredAt: input.recordedAt, event: {
          type: 'remediation_case_reconciled', eventId, domain: 'build_review', lapId: input.lapId,
          caseId: replacement.id, resolution: 'resolved',
        } });
      }
      return retireOpenBuildReviewCase(replacement);
    }
    return replacement;
  });
  for (const record of cases) {
    const before = existingById.get(record.id);
    if (!input.lapId || before?.resolution !== 'open' || record.resolution !== 'resolved' || resolvedAbsentCaseIds.includes(record.id)) continue;
    const eventId = randomUUID();
    outbox.push({ eventId, occurredAt: input.recordedAt, event: {
      type: 'remediation_case_reconciled', eventId, domain: 'build_review', lapId: input.lapId,
      caseId: record.id, resolution: 'resolved',
    } });
  }
  return {
    ok: true,
    state: outbox.length > 0
      ? (() => {
          const upgraded = appendRemediationCaseOutbox(state, outbox[0]!);
          return { ...upgraded, cases: [...cases, ...additions], outbox: [...upgraded.outbox, ...outbox.slice(1)] };
        })()
      : { ...state, cases: [...cases, ...additions] },
    changed,
    caseIdsByRef,
    resolvedAbsentCaseIds,
  };
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
  if (!mutation.ok) {
    return {
      ok: false,
      reason: 'store-failure',
      storeReason: mutation.reason,
      ...(mutation.reason === 'rejected-transition' && mutation.violation ? { violation: mutation.violation } : {}),
    };
  }
  return mutation.value.ok
    ? {
        ok: true,
        state: mutation.value.state,
        caseIdsByRef: mutation.value.caseIdsByRef,
        resolvedAbsentCaseIds: mutation.value.resolvedAbsentCaseIds,
      }
    : mutation.value;
}
