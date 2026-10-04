import type { RemediationCaseRow } from './remediation-case-artifact.js';
import { hasReservedOrFailedRemediationEffect } from './remediation-case-effects.js';
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
  /** A clean PASS with no order settles absent non-action case history too. */
  readonly resolveAbsentOpenNonActionCases?: boolean;
  /** Case identities known by the caller to belong to another feature/domain. */
  readonly foreignCaseIds?: readonly string[];
  /** Rows that need recurrence detection but remain owned by a separate writer. */
  readonly recurrenceOnlyCaseRefs?: ReadonlySet<string>;
  /**
   * Open cases this lap's own decision-stop writer re-produces under a
   * deterministic id. Absence from the graph is not evidence against them: a
   * same-lap replay must find them open and converge (ADR D11).
   */
  readonly retainOpenCaseIds?: ReadonlySet<string>;
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
      /** Unbound action proposals that reuse resolved action-source history. */
      readonly recurringCaseIdsByRef?: ReadonlyMap<string, readonly string[]>;
      /**
       * Every case this reconciliation transitioned that no current `caseRef`
       * points at — today, prior attempted action cases absent from the
       * admitted graph, which are resolved here. `caseIdsByRef` cannot name
       * them (they have no proposal), so a caller emitting lifecycle
       * occurrences from that map alone would change durable state silently.
       */
      readonly resolvedAbsentCaseIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: RemediationCaseReconciliationRejection;
      readonly caseIds?: readonly string[];
      readonly sourceIds?: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: 'second-unresolved-owner';
      readonly caseIds: readonly string[];
      readonly sourceIds: readonly string[];
    }
  | { readonly ok: false; readonly reason: 'store-failure'; readonly storeReason: RemediationCaseStoreFailureReason; readonly caseIds?: readonly string[]; readonly sourceIds?: readonly string[] };

/** Explicit durable bindings, never prose similarity or tree movement, decide reuse. */
export type RemediationCaseReuseDisposition = 'resume' | 'reuse' | 'halt-repeat' | 'halt-regression';

export function classifyRemediationCaseReuse(
  record: RemediationCaseRecord,
  attemptedCaseIds: ReadonlySet<string>,
): RemediationCaseReuseDisposition {
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
      readonly recurringCaseIdsByRef?: ReadonlyMap<string, readonly string[]>;
      readonly resolvedAbsentCaseIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: RemediationCaseReconciliationRejection;
      readonly caseIds?: readonly string[];
      readonly sourceIds?: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: 'second-unresolved-owner';
      readonly caseIds: readonly string[];
      readonly sourceIds: readonly string[];
    };

function isDurableId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 256;
}

function effectFor(caseRow: RemediationCaseRow, id: string | undefined): RemediationCaseEffect {
  if (caseRow.disposition === 'reject' || caseRow.disposition === 'escalate') return { kind: 'none' };
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
  const existingById = new Map(state.cases.map((record) => [record.id, record]));
  const usedIds = new Set<string>();
  for (const record of state.cases) {
    usedIds.add(record.id);
    if (record.effect.kind !== 'none') usedIds.add(record.effect.id);
  }

  const referencedExisting = new Set<string>();
  const graphBoundExistingIds = new Set(
    input.graph.cases.flatMap(({ case: caseRow }) => caseRow.existingCaseId === undefined ? [] : [caseRow.existingCaseId]),
  );
  const replacements = new Map<string, RemediationCaseRecord>();
  const additions: RemediationCaseRecord[] = [];
  const caseIdsByRef = new Map<string, string>();
  const recurringCaseIdsByRef = new Map<string, readonly string[]>();
  const claimed = new Set<string>();

  for (const proposed of input.graph.cases) {
    const { case: caseRow, sources } = proposed;
    if (!caseRow.existingCaseId) {
      // A new action against a resolved action source is a regression unless
      // the judge explicitly declared the new concern distinct.  The durable
      // source link is sufficient bookkeeping; semantic distinction remains
      // the judge's case-v2 declaration, never a prose comparison here.
      if (!caseRow.distinctFrom?.length) {
        const recurringCaseIds = state.cases
          .filter((record) => record.disposition === 'act' && record.resolution === 'resolved')
          .filter((record) => record.sources.some((link) => sources.some((source) => source.sourceId === link.sourceId)))
          .map((record) => record.id);
        if (recurringCaseIds.length > 0) {
          recurringCaseIdsByRef.set(caseRow.caseRef, recurringCaseIds);
          continue;
        }
      }
      // Escalation rows still need the same resolved-source recurrence gate,
      // but a non-recurring stop is persisted by the coordinator's dedicated
      // decision-stop seam rather than this general transition writer.
      if (input.recurrenceOnlyCaseRefs?.has(caseRow.caseRef)) continue;
      // `distinctFrom` is an admitted declaration that this proposal is not
      // the open case with otherwise matching sources.  It must therefore
      // reach the owner check and (when unowned) stamp its own durable case.
      const converged = caseRow.distinctFrom === undefined
        ? convergedCaseFor(state, proposed, claimed)
        : undefined;
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
      for (const source of sources) {
        const owner = state.cases.find((record) =>
          record.resolution === 'open' && !graphBoundExistingIds.has(record.id) &&
          record.sources.some((link) => link.sourceId === source.sourceId),
        );
        if (owner) {
          return {
            ok: false,
            reason: 'second-unresolved-owner',
            caseIds: [owner.id, caseId],
            sourceIds: [source.sourceId],
          };
        }
      }
      const effectId = caseRow.disposition === 'reject' || caseRow.disposition === 'escalate'
        ? undefined
        : takeId(input.generateId, usedIds);
      if (effectId === 'id-generation-failed' || effectId === 'id-collision') return { ok: false, reason: effectId };
      claimed.add(caseId);
      caseIdsByRef.set(caseRow.caseRef, caseId);
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
        ...(caseRow.distinctFrom === undefined ? {} : { distinctFrom: caseRow.distinctFrom }),
        ...(caseRow.escalation === undefined ? {} : { escalation: caseRow.escalation }),
      });
      continue;
    }

    const existingCaseId = caseRow.existingCaseId;
    if (foreignIds.has(existingCaseId)) return {
      ok: false, reason: 'foreign-case-binding', caseIds: [existingCaseId], sourceIds: sources.map((source) => source.sourceId),
    };
    const existing = existingById.get(existingCaseId);
    if (!existing) return {
      ok: false, reason: 'unknown-case-binding', caseIds: [existingCaseId], sourceIds: sources.map((source) => source.sourceId),
    };
    if (existing.domain !== 'build_review') return {
      ok: false, reason: 'foreign-case-binding', caseIds: [existingCaseId], sourceIds: sources.map((source) => source.sourceId),
    };
    if (referencedExisting.has(existingCaseId)) return {
      ok: false, reason: 'duplicate-case-binding', caseIds: [existingCaseId], sourceIds: sources.map((source) => source.sourceId),
    };
    const admitsRefutation = caseRow.disposition === 'refute'
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
    const admitsDeferral = caseRow.disposition === 'defer'
      && existing.disposition === 'act'
      && existing.effect.kind === 'action'
      && existing.effect.status === 'applied';
    if (caseRow.disposition === 'refute' && existing.refutation) return {
      ok: false, reason: 'refutation-repeat', caseIds: [existingCaseId], sourceIds: sources.map((source) => source.sourceId),
    };
    if (existing.disposition !== caseRow.disposition && !admitsRefutation && !admitsDeferral) return {
      ok: false, reason: 'illegal-disposition-transition', caseIds: [existingCaseId], sourceIds: sources.map((source) => source.sourceId),
    };
    referencedExisting.add(existingCaseId);
    claimed.add(existingCaseId);
    caseIdsByRef.set(caseRow.caseRef, existingCaseId);

    let appendedSources = [...existing.sources];
    for (const source of sources) {
      const historical = existing.sources.find((link) => link.sourceId === source.sourceId);
      if (historical) {
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
        if (historical.outcome !== source.outcome) return {
          ok: false, reason: 'illegal-source-link', caseIds: [existingCaseId], sourceIds: [source.sourceId],
        };
        continue;
      }
      appendedSources.push({ sourceId: source.sourceId, outcome: source.outcome, recordedAt: input.recordedAt });
    }
    if (admitsRefutation) {
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
    if (
      replacement.resolution === 'open'
      && replacement.disposition === 'act'
      && replacement.effect.kind === 'action'
      && !referencedExisting.has(replacement.id)
      && attemptedIds.has(replacement.id)
      // Same shared effect-status test as the non-action branch below: an
      // attempted case whose effect is still reserved or durably failed is
      // unfinished evidence, and attempt membership alone must not resolve it.
      && !hasReservedOrFailedRemediationEffect(replacement)
    ) {
      changed = true;
      resolvedAbsentCaseIds.push(replacement.id);
      return { ...replacement, resolution: 'resolved' as const };
    }
    if (
      replacement.resolution === 'open'
      && replacement.disposition !== 'act'
      && !referencedExisting.has(replacement.id)
      && input.resolveAbsentOpenNonActionCases
      && !input.retainOpenCaseIds?.has(replacement.id)
      // Shared effect-status test (remediation-case-effects.ts): a reserved or
      // failed effect is durable unfinished evidence, never benign absence, so
      // it must not resolve into a terminal PASS.
      && !hasReservedOrFailedRemediationEffect(replacement)
    ) {
      changed = true;
      resolvedAbsentCaseIds.push(replacement.id);
      return { ...replacement, resolution: 'resolved' as const };
    }
    return replacement;
  });
  return {
    ok: true,
    state: { ...state, cases: [...cases, ...additions] },
    changed,
    caseIdsByRef,
    ...(recurringCaseIdsByRef.size === 0 ? {} : { recurringCaseIdsByRef }),
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
  if (!mutation.ok) return {
    ok: false,
    reason: 'store-failure',
    storeReason: mutation.reason,
    ...(mutation.reason === 'rejected-transition' && 'caseIds' in mutation
      ? { caseIds: mutation.caseIds, sourceIds: mutation.sourceIds }
      : {}),
  };
  return mutation.value.ok
    ? {
        ok: true,
        state: mutation.value.state,
        caseIdsByRef: mutation.value.caseIdsByRef,
        ...(mutation.value.recurringCaseIdsByRef === undefined ? {} : { recurringCaseIdsByRef: mutation.value.recurringCaseIdsByRef }),
        resolvedAbsentCaseIds: mutation.value.resolvedAbsentCaseIds,
      }
    : mutation.value;
}
