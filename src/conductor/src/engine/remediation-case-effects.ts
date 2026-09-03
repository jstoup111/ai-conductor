import { randomUUID } from 'node:crypto';

import {
  publishBuildReviewWorkOrder,
  type BuildReviewWorkOrderCase,
} from './build-review-work-order.js';
import { orderBuildReviewActionCases } from './build-review-adjudication.js';
import {
  chargeBuildReviewEffectInLedger,
  type BumpKickbackGateInput,
} from './kickback-ledger.js';
import type { FileIntakeIssueResult } from './engineer/intake/file-issue.js';
import type { EffectMarkerTrackerClient } from './tracker-client.js';
import type { RemediationCaseDeferralEffect } from './remediation-case-artifact.js';
import {
  type RemediationCaseFeatureIdentity,
  type RemediationCaseRecord,
  type RemediationCaseStoreState,
  RemediationCaseStore,
} from './remediation-case-store.js';

export type RemediationEffectResult =
  | { readonly ok: true; readonly status: 'applied' | 'already-applied'; readonly effectId: string }
  | { readonly ok: false; readonly reason: string };

type ActionCase = RemediationCaseRecord & {
  readonly effect: Extract<RemediationCaseRecord['effect'], { readonly kind: 'action' }>;
};

type DeferralCase = RemediationCaseRecord & {
  readonly effect: Extract<RemediationCaseRecord['effect'], { readonly kind: 'deferral' }>;
};

/** The shared lifecycle vocabulary for reducers and effect execution. */
export function isOpenRemediationCase(record: RemediationCaseRecord): boolean {
  return record.resolution === 'open';
}

function isActionCase(record: RemediationCaseRecord): record is ActionCase {
  return isOpenRemediationCase(record) && record.effect.kind === 'action';
}

/** The one durable vocabulary for action cases that may enter a BUILD retry. */
export function isBuildEligibleActionCase(record: RemediationCaseRecord): record is ActionCase {
  return isActionCase(record) && record.effect.status === 'applied';
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
  readonly tasksByCaseId: ReadonlyMap<string, readonly { readonly title: string }[]>;
  readonly chargeInput: BumpKickbackGateInput;
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
      cases.push({ caseId: record.id, priority: record.priority, tasks });
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
    const published = await (input.publishWorkOrder ?? publishBuildReviewWorkOrder)(input.projectRoot, {
      version: 'v1', domain: 'build_review', feature: input.feature, effectId: primaryEffectId,
      cases: orderBuildReviewActionCases(cases),
    });
    if (!published.ok) {
      const diagnostic = `work-order ${published.reason}`;
      return { value: { ok: false as const, reason: diagnostic }, nextState: failPending(diagnostic) };
    }
    let charged: Awaited<ReturnType<typeof chargeBuildReviewEffectInLedger>>;
    try {
      charged = await (input.chargeEffect ?? chargeBuildReviewEffectInLedger)(input.projectRoot, primaryEffectId, input.chargeInput);
    } catch (error) {
      const diagnostic = `build-review effect charge failed: ${error instanceof Error ? error.message : String(error)}`;
      return { value: { ok: false as const, reason: diagnostic }, nextState: failPending(diagnostic) };
    }
    if (charged.status === 'unreadable') {
      return { value: { ok: false as const, reason: charged.reason }, nextState: failPending(charged.reason) };
    }
    if (charged.status === 'charged' && (charged.exhausted || charged.cumulativeExhausted)) {
      // A bare "budget exhausted" halt told the operator nothing about which
      // work is blocked or how close the counters are. Name both.
      const blocked = pending.map((record) => `${record.id} (effect ${record.effect.id})`).join(', ');
      const scope = charged.cumulativeExhausted ? 'cumulative' : 'per-gate';
      const diagnostic = `build-review kickback budget exhausted (${scope}): blocked cases ${blocked}; ` +
        `count ${charged.entry.count}, cumulative ${charged.entry.cumulative}`;
      return { value: { ok: false as const, reason: diagnostic }, nextState: failPending(diagnostic) };
    }
    const next = replaceCases(state, (record) => isSettling(record)
      ? { ...record, effect: { id: record.effect.id, kind: 'action', status: 'applied', workOrderId } }
      : record);
    return { value: { ok: true as const, status: 'applied' as const, effectId: primaryEffectId }, nextState: next };
  });
  return mutation.ok ? mutation.value : { ok: false, reason: `case store ${mutation.reason}` };
}

export function remediationEffectMarker(effectId: string): string {
  return `<!-- ai-conductor-remediation-effect:${effectId} -->`;
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
      return { value: { ok: false as const, reason: `deferred intake failed: ${error instanceof Error ? error.message : String(error)}` } };
    }
    const next = replaceCases(state, (item) => item.id === deferral.id
      ? { ...item, effect: { id: deferral.effect.id, kind: 'deferral', status: 'applied', issueUrl: issueUrl! } }
      : item);
    return { value: { ok: true as const, status: 'applied' as const, effectId: deferral.effect.id }, nextState: next };
  });
  return mutation.ok ? mutation.value : { ok: false, reason: `case store ${mutation.reason}` };
}
