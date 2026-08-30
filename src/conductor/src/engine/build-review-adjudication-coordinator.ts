import { randomUUID } from 'node:crypto';

import { assembleBuildReviewAdjudicationContext } from './build-review-adjudication-context.js';
import { reduceBuildReviewAdjudication, type BuildReviewMechanicalState } from './build-review-adjudication.js';
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

export type BuildReviewAdjudicationCoordinatorResult =
  | { readonly ok: true; readonly route: 'pass' | 'build' | 'mechanical-retry' | 'halt'; readonly detail: string; readonly remainingMechanical: boolean }
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
  readonly mechanical: BuildReviewMechanicalState;
  readonly judge: (context: unknown) => Promise<RemediationCaseJudgement>;
  readonly chargeInput: BumpKickbackGateInput;
  readonly tracker?: EffectMarkerTrackerClient;
  readonly repo?: string;
  readonly fileIssue?: (input: { title: string; body: string; priority: 'critical' | 'high' | 'medium' | 'low' }) => Promise<{ issueUrl: string }>;
  readonly generateId?: () => string;
}): Promise<BuildReviewAdjudicationCoordinatorResult> {
  const store = new RemediationCaseStore(input.projectRoot, input.feature);
  const prior = await store.read();
  if (!prior.ok) return { ok: false, detail: `case store ${prior.reason}` };
  const context = assembleBuildReviewAdjudicationContext({
    aggregate: input.aggregate, priorCases: prior.state.cases, operatorResolvedFindingIds: input.operatorResolvedFindingIds,
  });
  if (!context.ok) return { ok: false, detail: `adjudication context ${context.stop.code}` };
  const currentSources = projectBuildReviewAggregateSources(input.aggregate)
    ?.filter((source) => !input.operatorResolvedFindingIds.has(source.findingId));
  if (!currentSources) return { ok: false, detail: 'invalid raw aggregate source projection' };
  let judgement: RemediationCaseJudgement;
  try { judgement = await input.judge(context.context); } catch { return { ok: false, detail: 'remediate judgement failed' }; }
  const graph = validateRemediationCaseGraph(currentSources.map((source) => source.findingId), judgement);
  if (!graph.ok) return { ok: false, detail: `invalid remediation judgement ${graph.reason}` };
  const reconciled = await reconcileRemediationCases(store, {
    graph: graph.graph, recordedAt: new Date().toISOString(), generateId: input.generateId ?? randomUUID,
  });
  if (!reconciled.ok) return { ok: false, detail: reconciled.reason === 'store-failure' ? `case store ${reconciled.storeReason}` : `case reconciliation ${reconciled.reason}` };

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

  const tasksByCaseId = new Map<string, readonly { readonly title: string }[]>();
  for (const proposed of graph.graph.cases) {
    if (proposed.case.disposition !== 'act') continue;
    const caseId = caseIdsByRef.get(proposed.case.caseRef);
    if (!caseId || proposed.case.effect.kind !== 'action') return { ok: false, detail: 'action case identity was not reconciled' };
    tasksByCaseId.set(caseId, proposed.case.effect.tasks);
  }
  if (tasksByCaseId.size > 0) {
    const action = await applyBuildReviewActionEffects({
      projectRoot: input.projectRoot, feature: input.feature, store, tasksByCaseId, chargeInput: input.chargeInput,
    });
    if (!action.ok) return { ok: false, detail: action.reason };
  }
  if (input.tracker && input.repo && input.fileIssue) {
    for (const proposed of graph.graph.cases) {
      if (proposed.case.disposition !== 'defer' || proposed.case.effect.kind !== 'deferral') continue;
      const caseId = caseIdsByRef.get(proposed.case.caseRef);
      if (!caseId) return { ok: false, detail: 'deferral case identity was not reconciled' };
      const deferred = await applyBuildReviewDeferralEffect({
        projectRoot: input.projectRoot, feature: input.feature, store, caseId, effect: proposed.case.effect as RemediationCaseDeferralEffect,
        repo: input.repo, tracker: input.tracker, fileIssue: input.fileIssue,
      });
      if (!deferred.ok) return { ok: false, detail: deferred.reason };
    }
  }
  const settled = await store.read();
  if (!settled.ok) return { ok: false, detail: `case store ${settled.reason}` };
  const transition = reduceBuildReviewAdjudication({ currentSourceCount: currentSources.length, cases: settled.state.cases, mechanical: input.mechanical });
  return { ok: true, route: transition.route, detail: transition.reason, remainingMechanical: transition.remainingMechanical };
}
