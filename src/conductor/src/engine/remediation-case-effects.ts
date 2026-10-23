import { randomUUID } from 'node:crypto';

import {
  publishBuildReviewWorkOrder,
  type BuildReviewWorkOrderCase,
  type BuildReviewWorkOrderTask,
} from './build-review-work-order.js';
import { orderBuildReviewActionCases } from './build-review-adjudication.js';
import {
  chargeBuildReviewEffectInLedger,
  MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
  recordKickbackCapEvidence,
  type BumpKickbackGateInput,
} from './kickback-ledger.js';
import type { ChildId } from './child-context.js';
import type { FileIntakeIssueResult } from './engineer/intake/file-issue.js';
import type { EffectMarkerTrackerClient } from './tracker-client.js';
import type { RemediationCaseDeferralEffect } from './remediation-case-artifact.js';
import {
  type RemediationCaseFeatureIdentity,
  type RemediationCaseRecord,
  type RemediationCaseStoreState,
  type RemediationCaseTransitionViolation,
  RemediationCaseStore,
  appendRemediationCaseOutbox,
} from './remediation-case-store.js';
import { retireOpenBuildReviewCase, retiresOpenBuildReviewCase } from './remediation-case-reconciler.js';

export type RemediationEffectResult =
  | { readonly ok: true; readonly status: 'applied' | 'already-applied'; readonly effectId: string }
  | {
    readonly ok: false;
    readonly reason: string;
    /**
     * Case ids whose reserved action effect this executor durably flipped to
     * `failed` under its own lease. Reported from the same mutation that
     * persisted the transition, so the caller never has to re-read the store
     * (and never mistakes a read failure for "nothing failed"). Absent when
     * the failure left every reservation untouched.
     */
    readonly failedCaseIds?: readonly string[];
  };

type ActionCase = RemediationCaseRecord & {
  readonly effect: Extract<RemediationCaseRecord['effect'], { readonly kind: 'action' }>;
};

type DeferralCase = RemediationCaseRecord & {
  readonly effect: Extract<RemediationCaseRecord['effect'], { readonly kind: 'deferral' }>;
};

export type PersistBuildReviewDecisionStopResult =
  | { readonly ok: true; readonly status: 'persisted' | 'already-persisted' | 'already-resolved'; readonly caseId: string }
  | { readonly ok: false; readonly reason: 'invalid-decision-stop' | 'conflicting-case-id' | `case store ${string}`; readonly violation?: never }
  | { readonly ok: false; readonly reason: 'rejected-transition'; readonly violation: RemediationCaseTransitionViolation };

/** The shared lifecycle vocabulary for reducers and effect execution. */
export function isOpenRemediationCase(record: RemediationCaseRecord): boolean {
  return record.resolution === 'open';
}

/** An open owner or blocked-consistency stop is durable blocking state, never a deferral-shaped effect. */
export function isBuildReviewDecisionStop(record: RemediationCaseRecord): boolean {
  return isOpenRemediationCase(record)
    && record.disposition === 'escalate'
    && record.effect.kind === 'none'
    && (record.escalation !== undefined || record.consistencyStop !== undefined);
}

function sameDecisionStop(left: RemediationCaseRecord, right: RemediationCaseRecord): boolean {
  return left.id === right.id && left.disposition === 'escalate' && right.disposition === 'escalate' &&
    left.effect.kind === 'none' && right.effect.kind === 'none' &&
    left.escalation?.owner === right.escalation?.owner &&
    sameSourceOutcomes(left, right);
}

function sameSourceOutcomes(left: RemediationCaseRecord, right: RemediationCaseRecord): boolean {
  return left.sources.length === right.sources.length && left.sources.every((source) =>
    right.sources.some((other) => source.sourceId === other.sourceId && source.outcome === other.outcome),
  );
}

function sameDecisionStopOwnerOrConsistency(left: RemediationCaseRecord, right: RemediationCaseRecord): boolean {
  // D5.7 defines an unbound stop's convergence key as its owner and source
  // set. This deliberately treats two ownerless consistency stops as having
  // the same owner, while never letting matching consistency prose bridge an
  // owner mismatch.
  return left.escalation?.owner === right.escalation?.owner;
}

function sameSourceIds(left: RemediationCaseRecord, right: RemediationCaseRecord): boolean {
  const ids = (record: RemediationCaseRecord) => [...new Set(record.sources.map((source) => source.sourceId))].sort();
  return JSON.stringify(ids(left)) === JSON.stringify(ids(right));
}

/**
 * The effect-state owner persists decision stops through its existing lease,
 * but deliberately has no publication, tracker, artifact, or charge adapter.
 */
export async function persistBuildReviewDecisionStop(input: {
  readonly store: RemediationCaseStore;
  readonly record: RemediationCaseRecord;
}): Promise<PersistBuildReviewDecisionStopResult> {
  if (!isBuildReviewDecisionStop(input.record)) return { ok: false, reason: 'invalid-decision-stop' };
  const mutation = await input.store.mutate<PersistBuildReviewDecisionStopResult>(async (state) => {
    const existing = state.cases.find((record) => record.id === input.record.id);
    if (existing && !isOpenRemediationCase(existing)) {
      // A judgement can name a settled case as its existing case. Re-raising
      // exactly the sources that settlement already decided changes nothing;
      // anything else is new blocking state and must not overwrite history.
      if (sameSourceIds(existing, input.record)) {
        return { value: { ok: true as const, status: 'already-resolved' as const, caseId: existing.id } };
      }
      const record = { ...input.record, id: randomUUID() };
      return {
        value: { ok: true as const, status: 'persisted' as const, caseId: record.id },
        nextState: { ...state, cases: [...state.cases, record] },
      };
    }
    if (existing) {
      return {
        value: sameDecisionStop(existing, input.record)
          ? { ok: true as const, status: 'already-persisted' as const, caseId: existing.id }
          : { ok: false as const, reason: 'conflicting-case-id' as const },
      };
    }
    const converged = state.cases.find((record) =>
      isBuildReviewDecisionStop(record) && record.disposition === 'escalate' &&
      sameDecisionStopOwnerOrConsistency(record, input.record) && sameSourceOutcomes(record, input.record),
    );
    if (converged) {
      return { value: { ok: true as const, status: 'already-persisted' as const, caseId: converged.id } };
    }
    return {
      value: { ok: true as const, status: 'persisted' as const, caseId: input.record.id },
      nextState: { ...state, cases: [...state.cases, input.record] },
    };
  });
  if (mutation.ok) return mutation.value;
  return mutation.reason === 'rejected-transition' && mutation.violation !== undefined
    ? { ok: false, reason: mutation.reason, violation: mutation.violation }
    : { ok: false, reason: `case store ${mutation.reason}` };
}

function isActionCase(record: RemediationCaseRecord): record is ActionCase {
  return isOpenRemediationCase(record)
    && record.disposition === 'act'
    && record.refutation === undefined
    && record.effect.kind === 'action';
}

/** The one durable vocabulary for action cases that may enter a BUILD retry. */
export function isBuildEligibleActionCase(record: RemediationCaseRecord): record is ActionCase {
  return isActionCase(record) && record.effect.status === 'applied';
}

/**
 * The ONE effect-status test shared by the reconciler's benign-absence resolve
 * predicate and the settlement obligation predicate below. A reserved effect
 * is uncompleted durable work and a failed effect is an unresolved failure;
 * neither may settle into a terminal PASS by absence alone, whatever the
 * effect kind. Deriving both predicates from this single test is what keeps
 * them agreeing — editing one side reopened the fail-open PASS.
 */
export function hasReservedOrFailedRemediationEffect(record: RemediationCaseRecord): boolean {
  return record.effect.kind !== 'none'
    && (record.effect.status === 'reserved' || record.effect.status === 'failed');
}

/** Open cases whose durable effect blocks recovery or terminal PASS settlement. */
export function isBuildReviewSettlementObligationCase(record: RemediationCaseRecord): boolean {
  return isOpenRemediationCase(record)
    && (isBuildReviewDecisionStop(record) || isBuildEligibleActionCase(record) || hasReservedOrFailedRemediationEffect(record));
}

export const STRANDED_ACTION_RESERVATION_DIAGNOSTIC = 'stranded reservation: tasks never published';
export const STRANDED_DEFERRAL_RESERVATION_DIAGNOSTIC = 'stranded reservation: deferral never filed';

export type SettleStrandedActionReservationsResult =
  | { readonly ok: true; readonly settled: readonly { readonly caseId: string; readonly effectId: string }[] }
  | { readonly ok: false; readonly reason: string; readonly violation?: RemediationCaseTransitionViolation };

/**
 * Settle action reservations a previous lap made but never published.
 *
 * Reconciliation reserves an action effect before the effect boundary
 * publishes its tasks, and the tasks exist only in that lap's judgement. A lap
 * that stopped in between left a reservation no later lap can apply, and the
 * reducer halts on it forever. Run at lap start, before this lap reconciles,
 * every reserved effect is an earlier lap's; one is stranded only when the
 * published order does not carry its case and none of its sources is live
 * this lap. A live source is still current work: the judge can resume or
 * converge on the case and the effect boundary applies it, so it is left alone.
 *
 * The stranded case is retired exactly as an operator-retired reservation is:
 * resolved, with its never-completed effect recorded as failed rather than
 * falsely applied. Resolved rows block neither the reducer nor settlement.
 */
export async function settleStrandedBuildReviewActionReservations(input: {
  readonly store: RemediationCaseStore;
  /** This lap's reported, unsuppressed rubric-namespaced source ids. */
  readonly liveSourceIds: ReadonlySet<string>;
  /** Absence is authoritative only for a mechanically complete lap. */
  readonly mechanicallyHealthy: boolean;
  /** Current durable operator authority; invalidated origins are excluded. */
  readonly effectiveAcceptedSourceIds: ReadonlySet<string>;
  /**
   * Case ids the published work order carries, read under the store lease
   * that serializes every order writer. `undefined` (an unreadable order)
   * proves nothing, so nothing is settled.
   */
  readonly readPublishedCaseIds: (actionEffectIds: readonly string[]) => Promise<ReadonlySet<string> | undefined>;
  readonly lapId: string;
}): Promise<SettleStrandedActionReservationsResult> {
  const mutation = await input.store.mutate<readonly { readonly caseId: string; readonly effectId: string }[]>(async (state) => {
    const candidates = state.cases.filter((record): record is ActionCase =>
      isActionCase(record) && record.effect.status === 'reserved'
      && retiresOpenBuildReviewCase(record, {
        liveSourceIds: input.liveSourceIds,
        effectiveAcceptedSourceIds: input.effectiveAcceptedSourceIds,
        mechanicallyHealthy: input.mechanicallyHealthy,
      }));
    if (candidates.length === 0) return { value: [] };
    const published = await input.readPublishedCaseIds(
      state.cases.flatMap((record) => record.effect.kind === 'action' ? [record.effect.id] : []));
    if (published === undefined) return { value: [] };
    const settled = candidates
      .filter((record) => !published.has(record.id))
      .map((record) => ({ caseId: record.id, effectId: record.effect.id }));
    if (settled.length === 0) return { value: [] };
    const stranded = new Set(settled.map(({ caseId }) => caseId));
    const events = settled.map(({ caseId }) => {
      const eventId = randomUUID();
      return { eventId, occurredAt: new Date().toISOString(), event: {
        type: 'remediation_case_reconciled' as const, eventId, domain: 'build_review' as const,
        lapId: input.lapId, caseId, resolution: 'resolved' as const,
      } };
    });
    const upgraded = appendRemediationCaseOutbox(state, events[0]!);
    return {
      value: settled,
      nextState: {
        ...upgraded,
        cases: upgraded.cases.map((record) => stranded.has(record.id)
          ? retireOpenBuildReviewCase(record)
          : record),
        outbox: [...upgraded.outbox, ...events.slice(1)],
      },
    };
  });
  if (mutation.ok) return { ok: true, settled: mutation.value };
  return mutation.reason === 'rejected-transition' && mutation.violation !== undefined
    ? { ok: false, reason: mutation.reason, violation: mutation.violation }
    : { ok: false, reason: mutation.reason };
}

/**
 * An open case whose effect already failed (for example an action charged past
 * the kickback budget) is terminal for that effect, yet the reducer halts on
 * it every lap. Once its sources are absent from a mechanically complete lap,
 * its finding is gone: resolve the case and keep the failure diagnostic.
 */
export async function resolveAbsentFailedBuildReviewCases(input: {
  readonly store: RemediationCaseStore;
  /** This lap's reported, unsuppressed rubric-namespaced source ids. */
  readonly liveSourceIds: ReadonlySet<string>;
  readonly lapId: string;
  readonly mechanicallyHealthy: boolean;
}): Promise<SettleStrandedActionReservationsResult> {
  const mutation = await input.store.mutate<readonly { readonly caseId: string; readonly effectId: string }[]>(async (state) => {
    const settled = state.cases.flatMap((record) =>
      record.effect.kind === 'action' && retiresOpenBuildReviewCase(record, {
        liveSourceIds: input.liveSourceIds,
        effectiveAcceptedSourceIds: new Set(),
        mechanicallyHealthy: input.mechanicallyHealthy,
        allowAppliedByAbsence: false,
      })
        ? [{ caseId: record.id, effectId: record.effect.id }]
        : []);
    if (settled.length === 0) return { value: [] };
    const retired = new Set(settled.map(({ caseId }) => caseId));
    const events = settled.map(({ caseId }) => {
      const eventId = randomUUID();
      return { eventId, occurredAt: new Date().toISOString(), event: {
        type: 'remediation_case_reconciled' as const, eventId, domain: 'build_review' as const,
        lapId: input.lapId, caseId, resolution: 'resolved' as const,
      } };
    });
    const upgraded = appendRemediationCaseOutbox(state, events[0]!);
    return {
      value: settled,
      nextState: {
        ...upgraded,
        cases: upgraded.cases.map((record) => retired.has(record.id) ? retireOpenBuildReviewCase(record) : record),
        outbox: [...upgraded.outbox, ...events.slice(1)],
      },
    };
  });
  if (mutation.ok) return { ok: true, settled: mutation.value };
  return mutation.reason === 'rejected-transition' && mutation.violation !== undefined
    ? { ok: false, reason: mutation.reason, violation: mutation.violation }
    : { ok: false, reason: mutation.reason };
}

/**
 * A deferral reserved by an earlier lap that never filed its issue (for
 * example a run without a filing capability) can never be applied, and the
 * reducer halts on it every lap. Settle it once its sources are absent from a
 * mechanically complete lap, the same evidence the action settlement uses.
 */
export async function settleStrandedBuildReviewDeferralReservations(input: {
  readonly store: RemediationCaseStore;
  /** This lap's reported, unsuppressed rubric-namespaced source ids. */
  readonly liveSourceIds: ReadonlySet<string>;
  readonly lapId: string;
}): Promise<SettleStrandedActionReservationsResult> {
  const mutation = await input.store.mutate<readonly { readonly caseId: string; readonly effectId: string }[]>(async (state) => {
    const settled = state.cases.flatMap((record) =>
      isOpenRemediationCase(record) && record.effect.kind === 'deferral' && record.effect.status === 'reserved'
        && record.sources.every((source) => !input.liveSourceIds.has(source.sourceId))
        ? [{ caseId: record.id, effectId: record.effect.id }]
        : []);
    if (settled.length === 0) return { value: [] };
    const stranded = new Set(settled.map(({ caseId }) => caseId));
    const events = settled.map(({ caseId }) => {
      const eventId = randomUUID();
      return { eventId, occurredAt: new Date().toISOString(), event: {
        type: 'remediation_case_reconciled' as const, eventId, domain: 'build_review' as const,
        lapId: input.lapId, caseId, resolution: 'resolved' as const,
      } };
    });
    const upgraded = appendRemediationCaseOutbox(state, events[0]!);
    return {
      value: settled,
      nextState: {
        ...upgraded,
        cases: upgraded.cases.map((record) => stranded.has(record.id) && record.effect.kind === 'deferral'
        ? {
          ...record,
          resolution: 'resolved',
          effect: { id: record.effect.id, kind: 'deferral', status: 'failed', diagnostic: STRANDED_DEFERRAL_RESERVATION_DIAGNOSTIC },
        }
        : record),
        outbox: [...upgraded.outbox, ...events.slice(1)],
      },
    };
  });
  if (mutation.ok) return { ok: true, settled: mutation.value };
  return mutation.reason === 'rejected-transition' && mutation.violation !== undefined
    ? { ok: false, reason: mutation.reason, violation: mutation.violation }
    : { ok: false, reason: mutation.reason };
}

function replaceCases(
  state: RemediationCaseStoreState,
  replace: (record: RemediationCaseRecord) => RemediationCaseRecord,
): RemediationCaseStoreState {
  return { ...state, cases: state.cases.map(replace) };
}

/**
 * Publish one prioritized durable order, then charge only its stable primary
 * effect.  A restart sees the same order/effect id and therefore cannot spend
 * the gate again.
 */
export async function applyBuildReviewActionEffects(input: {
  readonly projectRoot: string;
  readonly feature: RemediationCaseFeatureIdentity;
  readonly store: RemediationCaseStore;
  /**
   * The validated-consistent adjudication selection. Re-checking case state
   * under the store lease below makes a late exact operator disposition win
   * without dropping unrelated admitted actions.
   */
  readonly tasksByCaseId: ReadonlyMap<string, readonly BuildReviewWorkOrderTask[]>;
  readonly chargeInput: BumpKickbackGateInput;
  /** The current BUILD child owns its own review convergence budget. */
  readonly child?: ChildId;
  readonly workOrderId?: () => string;
  /** Testable I/O boundaries; production defaults retain the durable adapters. */
  readonly publishWorkOrder?: typeof publishBuildReviewWorkOrder;
  readonly chargeEffect?: typeof chargeBuildReviewEffectInLedger;
}): Promise<RemediationEffectResult> {
  const mutation = await input.store.mutate<RemediationEffectResult>(async (state) => {
    // The coordinator's authority read may suppress a newly accepted case
    // after reconciliation reserved it but before this lease begins. Only the
    // surviving task-bearing cases may publish or consume an effect; the exit
    // reconciliation resolves the suppressed reservation separately.
    const actionCases = state.cases
      .filter(isActionCase)
      .filter((record) => input.tasksByCaseId.has(record.id));
    if (actionCases.length === 0) return { value: { ok: false as const, reason: 'no open action effects' } };
    const pending = actionCases.filter((record) => record.effect.kind === 'action' && record.effect.status === 'reserved');
    if (pending.length === 0) {
      const failed = actionCases.filter((record) => record.effect.status === 'failed');
      if (failed.length === actionCases.length) {
        return {
          value: {
            ok: false as const,
            reason: `all open action effects failed: ${failed.map((record) =>
              `${record.effect.id} (${record.effect.status === 'failed' ? record.effect.diagnostic : 'unknown'})`).join(', ')}`,
          },
        };
      }
      return { value: { ok: true as const, status: 'already-applied' as const, effectId: actionCases[0]!.effect.id } };
    }
    const cases: BuildReviewWorkOrderCase[] = [];
    for (const record of actionCases) {
      const tasks = input.tasksByCaseId.get(record.id);
      if (!tasks || tasks.length === 0) return { value: { ok: false as const, reason: `action case ${record.id} has no work-order tasks` } };
      cases.push({
        caseId: record.id,
        priority: record.priority,
        // Case-v2 validation admits only acted or merged links to an action;
        // preserve that closed action evidence and never deliver unrelated
        // reject/defer/refute/escalate history as BUILD work.
        sources: record.sources
          .filter(({ outcome }) => outcome === 'acted' || outcome === 'merged')
          .map(({ sourceId, outcome, recordedAt }) => ({
            sourceId,
            // The preceding filter closes this vocabulary to action sources.
            outcome: outcome as 'acted' | 'merged',
            recordedAt,
          })),
        tasks,
      });
    }
    // The charge identity is the FIRST-TIME route's own reserved effect, taken
    // in the same deterministic order the work order publishes. Charging
    // `actionCases[0]` charged whichever action came first overall — so a later
    // materially distinct case re-charged an already-charged id, the ledger
    // reported `already-charged`, and the new route was never counted against
    // the convergence bound.
    const orderedPendingIds = new Set(pending.map((record) => record.effect.id));
    // This selection is the effect executor's lease-local authority. A
    // reservation from an earlier aborted lap is durable evidence, not current
    // work, and must remain untouched by either terminal mutation below.
    const isSettling = (record: RemediationCaseRecord): record is ActionCase =>
      record.effect.kind === 'action' && record.effect.status === 'reserved' && orderedPendingIds.has(record.effect.id);
    const primaryEffectId = orderBuildReviewActionCases(cases)
      .map((row) => actionCases.find((record) => record.id === row.caseId)!.effect.id)
      .find((effectId) => orderedPendingIds.has(effectId))!;
    const workOrderId = input.workOrderId?.() ?? randomUUID();
    const failPending = (diagnostic: string): RemediationCaseStoreState => replaceCases(state, (record) =>
      isSettling(record)
        ? { ...record, effect: { id: record.effect.id, kind: 'action', status: 'failed', diagnostic } }
        : record,
    );
    const failedCaseIds = pending.filter(isSettling).map((record) => record.id);
    const published = await (input.publishWorkOrder ?? publishBuildReviewWorkOrder)(input.projectRoot, {
      version: 'v1', domain: 'build_review', feature: input.feature, effectId: primaryEffectId,
      cases: orderBuildReviewActionCases(cases),
    });
    if (!published.ok) {
      const diagnostic = `work-order ${published.reason}`;
      return { value: { ok: false as const, reason: diagnostic, failedCaseIds }, nextState: failPending(diagnostic) };
    }
    let charged: Awaited<ReturnType<typeof chargeBuildReviewEffectInLedger>>;
    try {
      charged = await (input.chargeEffect ?? chargeBuildReviewEffectInLedger)(input.projectRoot, primaryEffectId, input.chargeInput, input.child);
    } catch (error) {
      const diagnostic = `build-review effect charge failed: ${error instanceof Error ? error.message : String(error)}`;
      return { value: { ok: false as const, reason: diagnostic, failedCaseIds }, nextState: failPending(diagnostic) };
    }
    if (charged.status === 'unreadable') {
      return { value: { ok: false as const, reason: charged.reason, failedCaseIds }, nextState: failPending(charged.reason) };
    }
    if (charged.status === 'charged' && (charged.exhausted || charged.cumulativeExhausted)) {
      // A bare "budget exhausted" halt told the operator nothing about which
      // work is blocked or how close the counters are. Name both.
      const blocked = pending.map((record) => `${record.id} (effect ${record.effect.id})`).join(', ');
      const scope = charged.cumulativeExhausted ? 'cumulative' : 'per-gate';
      let diagnostic = `build-review kickback budget exhausted (${scope}): blocked cases ${blocked}; ` +
        `count ${charged.entry.count}, cumulative ${charged.entry.cumulative}`;
      // `kickback-budget raise --gate build_review` moves the cumulative limit,
      // and admits a halt only when the ledger's cap evidence names the
      // generation the HALT body repeats. This diagnostic becomes that body.
      // A failed evidence write still halts; it only leaves the halt without
      // the raise recovery, which is the pre-existing behaviour.
      if (charged.cumulativeExhausted) {
        try {
          const capEntry = await recordKickbackCapEvidence(input.projectRoot, 'build_review', {
            consumed: charged.entry.cumulative,
            limit: charged.entry.effectiveLimit ?? MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
            latestReason: charged.entry.lastReason ?? '',
          }, input.child);
          diagnostic += `\nKickback halt generation: ${capEntry.capEvidence!.haltGeneration}`;
        } catch { /* halt without recovery evidence */ }
      }
      return { value: { ok: false as const, reason: diagnostic, failedCaseIds }, nextState: failPending(diagnostic) };
    }
    const next = replaceCases(state, (record) => isSettling(record)
      ? { ...record, effect: { id: record.effect.id, kind: 'action', status: 'applied', workOrderId } }
      : record);
    return { value: { ok: true as const, status: 'applied' as const, effectId: primaryEffectId }, nextState: next };
  });
  return mutation.ok ? mutation.value : { ok: false, reason: `case store ${mutation.reason}` };
}

export function remediationEffectMarker(effectId: string): string {
  // ai-conductor:session-command-context=operator-only
  return `<!-- ai-conductor-remediation-effect:${effectId} -->`;
  // /ai-conductor:session-command-context
}

/**
 * The intake adapter is the single sanitizer before tracker publication. This
 * renderer supplies the fixed semantic sections and the stable recovery key.
 */
export function renderBuildReviewDeferralIssue(
  effect: RemediationCaseDeferralEffect,
  rationale: string,
  effectId: string,
): string {
  return [
    '## Observed',
    effect.body,
    '',
    '## Impact',
    rationale,
    '',
    '## Desired Outcome',
    'Resolve the deferred build-review finding in a future planned change.',
    '',
    '## Hypotheses',
    effect.exclusionRationale,
    '',
    remediationEffectMarker(effectId),
  ].join('\n');
}

/** Exact-marker lookup precedes create; the marker makes a post-create crash recoverable. */
export async function applyBuildReviewDeferralEffect(input: {
  readonly projectRoot: string;
  readonly feature: RemediationCaseFeatureIdentity;
  readonly store: RemediationCaseStore;
  readonly caseId: string;
  readonly effect: RemediationCaseDeferralEffect;
  readonly repo: string;
  readonly tracker: EffectMarkerTrackerClient;
  readonly fileIssue: (input: { title: string; body: string; priority: 'critical' | 'high' | 'medium' | 'low' }) => Promise<Pick<FileIntakeIssueResult, 'issueUrl'>>;
}): Promise<RemediationEffectResult> {
  const mutation = await input.store.mutate<RemediationEffectResult>(async (state) => {
    const record = state.cases.find((item) => item.id === input.caseId);
    if (!record || record.effect.kind !== 'deferral') return { value: { ok: false as const, reason: 'unknown deferral case' } };
    const deferral = record as DeferralCase;
    if (deferral.effect.status === 'applied') return { value: { ok: true as const, status: 'already-applied' as const, effectId: deferral.effect.id } };
    const marker = remediationEffectMarker(deferral.effect.id);
    let issueUrl: string | null;
    try {
      issueUrl = await input.tracker.findIssueByEffectMarker(marker, input.repo, input.projectRoot);
      if (!issueUrl) {
        const filed = await input.fileIssue({
          title: input.effect.title,
          body: renderBuildReviewDeferralIssue(input.effect, deferral.rationale, deferral.effect.id),
          priority: record.priority,
        });
        issueUrl = filed.issueUrl;
      }
    } catch (error) {
      const diagnostic = `deferred intake failed: ${error instanceof Error ? error.message : String(error)}`;
      const next = replaceCases(state, (item) => item.id === deferral.id
        ? { ...item, effect: { id: deferral.effect.id, kind: 'deferral', status: 'failed', diagnostic } }
        : item);
      return { value: { ok: false as const, reason: diagnostic }, nextState: next };
    }
    const next = replaceCases(state, (item) => item.id === deferral.id
      ? { ...item, effect: { id: deferral.effect.id, kind: 'deferral', status: 'applied', issueUrl: issueUrl! } }
      : item);
    return { value: { ok: true as const, status: 'applied' as const, effectId: deferral.effect.id }, nextState: next };
  });
  return mutation.ok ? mutation.value : { ok: false, reason: `case store ${mutation.reason}` };
}
