import { randomUUID } from 'node:crypto';

import { assembleBuildReviewAdjudicationContext, buildReviewAdjudicationSourceId } from './build-review-adjudication-context.js';
import { reduceBuildReviewAdjudication, renderBuildReviewAdjudicationTrace, type BuildReviewMechanicalState } from './build-review-adjudication.js';
import { projectBuildReviewAggregateSources, type BuildReviewAggregate } from './build-review-aggregate.js';
import { applyBuildReviewActionEffects, applyBuildReviewDeferralEffect } from './remediation-case-effects.js';
import type { RemediationCaseJudgement } from './remediation-case-artifact.js';
import { reconcileRemediationCases } from './remediation-case-reconciler.js';
import { RemediationCaseStore } from './remediation-case-store.js';
import { validateRemediationCaseGraph } from './remediation-case-validator.js';
import type { BuildReviewFeatureIdentity } from './build-review-dispositions.js';
import type { BumpKickbackGateInput } from './kickback-ledger.js';
import type { EffectMarkerTrackerClient } from './tracker-client.js';
import type { RemediationCaseDeferralEffect } from './remediation-case-artifact.js';
import type { ConductorEvent } from '../types/events.js';

type RemediationCaseLifecycleEvent = Extract<ConductorEvent, {
  type: 'remediation_adjudication_started' | 'remediation_adjudication_completed' | 'remediation_adjudication_failed'
    | 'remediation_case_reconciled' | 'remediation_effect_reserved' | 'remediation_effect_applied'
    | 'remediation_effect_failed' | 'remediation_semantic_repeat_halt';
}>;

export type BuildReviewAdjudicationCoordinatorResult =
  | { readonly ok: true; readonly route: 'pass' | 'build' | 'mechanical-retry' | 'halt'; readonly detail: string; readonly trace: string; readonly remainingMechanical: boolean }
  | { readonly ok: false; readonly detail: string };

/**
 * Provider-facing work is deliberately a dependency. The coordinator owns all
 * identity, completeness, effects, and transition legality after that one
 * judgement returns.
 */
export async function coordinateBuildReviewAdjudication(input: {
  readonly projectRoot: string;
  readonly feature: BuildReviewFeatureIdentity;
  readonly aggregate: BuildReviewAggregate;
  readonly operatorResolvedFindingIds: ReadonlySet<string>;
  /** Re-reads the separate operator authority before every provider boundary. */
  readonly resolveOperatorResolvedFindingIds?: () => Promise<ReadonlySet<string>>;
  readonly mechanical: BuildReviewMechanicalState;
  readonly judge: (context: unknown) => Promise<RemediationCaseJudgement>;
  readonly chargeInput: BumpKickbackGateInput;
  readonly tracker?: EffectMarkerTrackerClient;
  readonly repo?: string;
  readonly fileIssue?: (input: { title: string; body: string; priority: 'critical' | 'high' | 'medium' | 'low' }) => Promise<{ issueUrl: string }>;
  readonly generateId?: () => string;
  readonly emit?: (event: RemediationCaseLifecycleEvent) => void | Promise<void>;
}): Promise<BuildReviewAdjudicationCoordinatorResult> {
  const sources = projectBuildReviewAggregateSources(input.aggregate);
  if (!sources) return { ok: false, detail: 'invalid raw aggregate source projection' };
  const operatorResolvedFindingIds = async (): Promise<ReadonlySet<string>> =>
    input.resolveOperatorResolvedFindingIds ? input.resolveOperatorResolvedFindingIds() : input.operatorResolvedFindingIds;
  const routeIfAllOperatorResolved = (resolved: ReadonlySet<string>): BuildReviewAdjudicationCoordinatorResult | undefined => {
    if (sources.some((source) => !resolved.has(source.findingId))) return undefined;
    const transition = reduceBuildReviewAdjudication({ currentSourceIds: [], cases: [], mechanical: input.mechanical });
    return { ok: true, route: transition.route, detail: transition.reason, trace: `route: ${transition.route}; all current sources are operator-resolved`, remainingMechanical: transition.remainingMechanical };
  };
  let resolved: ReadonlySet<string>;
  try { resolved = await operatorResolvedFindingIds(); } catch { return { ok: false, detail: 'operator disposition state is unavailable' }; }
  const initialOperatorRoute = routeIfAllOperatorResolved(resolved);
  if (initialOperatorRoute) return initialOperatorRoute;
  let currentSources = sources.filter((source) => !resolved.has(source.findingId));
  // Operator authority is terminal for an all-resolved content lap.  In
  // particular, do not turn it into an empty model prompt or case-store read.
  const fail = async (detail: string): Promise<BuildReviewAdjudicationCoordinatorResult> => {
    await input.emit?.({ type: 'remediation_adjudication_failed', domain: 'build_review', lapId: input.aggregate.lapId, reason: detail });
    return { ok: false, detail };
  };
  const store = new RemediationCaseStore(input.projectRoot, input.feature);
  const prior = await store.read();
  if (!prior.ok) return fail(`case store ${prior.reason}`);
  const context = assembleBuildReviewAdjudicationContext({
    aggregate: input.aggregate, priorCases: prior.state.cases, operatorResolvedFindingIds: resolved,
  });
  if (!context.ok) return fail(`adjudication context ${context.stop.code}`);
  // A disposition arriving while the case store was read wins before the one
  // provider dispatch.  Rebuild the complete projection rather than letting
  // the provider see an obsolete source.
  try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
  const preDispatchOperatorRoute = routeIfAllOperatorResolved(resolved);
  if (preDispatchOperatorRoute) return preDispatchOperatorRoute;
  currentSources = sources.filter((source) => !resolved.has(source.findingId));
  const freshContext = assembleBuildReviewAdjudicationContext({
    aggregate: input.aggregate, priorCases: prior.state.cases, operatorResolvedFindingIds: resolved,
  });
  if (!freshContext.ok) return fail(`adjudication context ${freshContext.stop.code}`);
  await input.emit?.({ type: 'remediation_adjudication_started', domain: 'build_review', lapId: input.aggregate.lapId });
  let judgement: RemediationCaseJudgement;
  try { judgement = await input.judge(freshContext.context); } catch { return fail('remediate judgement failed'); }
  // Do not reconcile or effect a provider result after a late exact operator
  // acceptance made every source non-autonomous.
  try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
  const postJudgeOperatorRoute = routeIfAllOperatorResolved(resolved);
  if (postJudgeOperatorRoute) return postJudgeOperatorRoute;
  if (sources.some((source) => resolved.has(source.findingId))) return fail('operator disposition changed during adjudication');
  const graph = validateRemediationCaseGraph(currentSources.map(buildReviewAdjudicationSourceId), judgement);
  if (!graph.ok) return fail(`invalid remediation judgement ${graph.reason}`);
  const reconciled = await reconcileRemediationCases(store, {
    graph: graph.graph, recordedAt: new Date().toISOString(), generateId: input.generateId ?? randomUUID,
  });
  if (!reconciled.ok) return fail(reconciled.reason === 'store-failure' ? `case store ${reconciled.storeReason}` : `case reconciliation ${reconciled.reason}`);

  // Reconciliation preserves proposed-case order for engine-stamped additions;
  // explicit existing bindings retain their own durable id. This derives the
  // local mapping without making a provider-visible identity API.
  const newlyStamped = reconciled.state.cases.slice(prior.state.cases.length);
  let newIndex = 0;
  const caseIdsByRef = new Map<string, string>();
  for (const proposed of graph.graph.cases) {
    const id = proposed.case.existingCaseId ?? newlyStamped[newIndex++]?.id;
    if (id) caseIdsByRef.set(proposed.case.caseRef, id);
  }
  const reconciledCasesById = new Map(reconciled.state.cases.map((record) => [record.id, record]));
  const priorCasesById = new Map(prior.state.cases.map((record) => [record.id, record]));
  const emittedCaseIds = new Set<string>();
  for (const caseId of caseIdsByRef.values()) {
    if (emittedCaseIds.has(caseId)) continue;
    emittedCaseIds.add(caseId);
    const record = reconciledCasesById.get(caseId);
    if (!record) return fail(`reconciled case ${caseId} is unavailable`);
    await input.emit?.({
      type: 'remediation_case_reconciled', domain: 'build_review', lapId: input.aggregate.lapId,
      caseId, resolution: record.resolution,
    });
    const priorEffect = priorCasesById.get(caseId)?.effect;
    const wasReserved = priorEffect?.kind !== 'none' && priorEffect?.status === 'reserved';
    if (record.effect.kind !== 'none' && record.effect.status === 'reserved' && !wasReserved) {
      await input.emit?.({
        type: 'remediation_effect_reserved', domain: 'build_review', lapId: input.aggregate.lapId,
        caseId, effectId: record.effect.id, effectKind: record.effect.kind,
      });
    }
  }

  for (const proposed of graph.graph.cases) {
    if (!proposed.case.existingCaseId) continue;
    const caseId = caseIdsByRef.get(proposed.case.caseRef);
    const record = caseId ? reconciledCasesById.get(caseId) : undefined;
    if (!caseId || !record) return fail('existing case identity was not reconciled');
    if (record.disposition === 'act' && record.resolution === 'resolved') {
      await input.emit?.({
        type: 'remediation_semantic_repeat_halt', domain: 'build_review', lapId: input.aggregate.lapId,
        caseId, ...(record.effect.kind === 'none' ? {} : { effectId: record.effect.id }), reason: 'regressed',
      });
      return fail(`semantic remediation case regression ${caseId}`);
    }
  }

  const tasksByCaseId = new Map<string, readonly { readonly title: string }[]>();
  for (const proposed of graph.graph.cases) {
    if (proposed.case.disposition !== 'act') continue;
    const caseId = caseIdsByRef.get(proposed.case.caseRef);
    if (!caseId || proposed.case.effect.kind !== 'action') return fail('action case identity was not reconciled');
    tasksByCaseId.set(caseId, proposed.case.effect.tasks);
  }
  if (tasksByCaseId.size > 0) {
    const pendingActionEffects = reconciled.state.cases.filter((record) =>
      record.effect.kind === 'action' && record.effect.status === 'reserved',
    );
    const action = await applyBuildReviewActionEffects({
      projectRoot: input.projectRoot, feature: input.feature, store, tasksByCaseId, chargeInput: input.chargeInput,
    });
    if (!action.ok) {
      for (const record of pendingActionEffects) {
        if (record.effect.kind !== 'action') continue;
        await input.emit?.({
          type: 'remediation_effect_failed', domain: 'build_review', lapId: input.aggregate.lapId,
          caseId: record.id, effectId: record.effect.id, effectKind: 'action', reason: action.reason,
        });
      }
      return fail(action.reason);
    }
    if (action.status === 'applied') {
      for (const record of pendingActionEffects) {
        if (record.effect.kind !== 'action') continue;
        await input.emit?.({
          type: 'remediation_effect_applied', domain: 'build_review', lapId: input.aggregate.lapId,
          caseId: record.id, effectId: record.effect.id, effectKind: 'action',
        });
      }
    }
  }
  if (input.tracker && input.repo && input.fileIssue) {
    for (const proposed of graph.graph.cases) {
      if (proposed.case.disposition !== 'defer' || proposed.case.effect.kind !== 'deferral') continue;
      const caseId = caseIdsByRef.get(proposed.case.caseRef);
      if (!caseId) return fail('deferral case identity was not reconciled');
      const deferred = await applyBuildReviewDeferralEffect({
        projectRoot: input.projectRoot, feature: input.feature, store, caseId, effect: proposed.case.effect as RemediationCaseDeferralEffect,
        repo: input.repo, tracker: input.tracker, fileIssue: input.fileIssue,
      });
      const record = reconciledCasesById.get(caseId);
      if (!record || record.effect.kind !== 'deferral') return fail('deferral case effect was not reconciled');
      if (!deferred.ok) {
        await input.emit?.({
          type: 'remediation_effect_failed', domain: 'build_review', lapId: input.aggregate.lapId,
          caseId, effectId: record.effect.id, effectKind: 'deferral', reason: deferred.reason,
        });
        return fail(deferred.reason);
      }
      if (deferred.status === 'applied') {
        await input.emit?.({
          type: 'remediation_effect_applied', domain: 'build_review', lapId: input.aggregate.lapId,
          caseId, effectId: record.effect.id, effectKind: 'deferral',
        });
      }
    }
  }
  const settled = await store.read();
  if (!settled.ok) return fail(`case store ${settled.reason}`);
  const transition = reduceBuildReviewAdjudication({ currentSourceIds: currentSources.map(buildReviewAdjudicationSourceId), cases: settled.state.cases, mechanical: input.mechanical });
  await input.emit?.({
    type: 'remediation_adjudication_completed', domain: 'build_review', lapId: input.aggregate.lapId,
    caseIds: settled.state.cases.map((record) => record.id),
    effectIds: settled.state.cases.flatMap((record) => record.effect.kind === 'none' ? [] : [record.effect.id]),
  });
  return {
    ok: true, route: transition.route, detail: transition.reason,
    trace: `route: ${transition.route}\n${renderBuildReviewAdjudicationTrace(settled.state.cases)}`,
    remainingMechanical: transition.remainingMechanical,
  };
}
