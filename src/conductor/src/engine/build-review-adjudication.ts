import type { BuildReviewWorkOrderCase } from './build-review-work-order.js';
import { hasReservedOrFailedRemediationEffect, isBuildEligibleActionCase, isBuildReviewDecisionStop, isOpenRemediationCase } from './remediation-case-effects.js';
import type { RemediationCaseJudgement } from './remediation-case-artifact.js';
import type { ValidateRemediationCaseGraphResult } from './remediation-case-validator.js';
import { currentBuildReviewSourceLinks, type RemediationCaseRecord } from './remediation-case-store.js';
import type { ChildId } from './child-context.js';

/** The only routes a post-join review is allowed to publish. */
export type BuildReviewAdjudicationRoute = 'pass' | 'build' | 'mechanical-retry' | 'halt';

export interface BuildReviewAdjudicationTransition {
  readonly route: BuildReviewAdjudicationRoute;
  /** A mixed lap retains its infrastructure blocker after BUILD is selected. */
  readonly remainingMechanical: boolean;
  readonly reason: string;
}

/**
 * The raw join has already classified infrastructure independently.  The
 * semantic reducer never clears it and never infers operator coverage.
 */
export type BuildReviewMechanicalState = 'healthy' | 'retry' | 'halt';

/**
 * The application boundary receives no actionable cases until the whole v2
 * judgement is mechanically valid and free of its declared decision stops.
 * It deliberately consumes the adjudicator's verdict without interpreting
 * finding prose or attempting a second semantic compatibility judgement.
 */
export function authorizeBuildReviewRemediationActionEffects(input: {
  readonly judgement: RemediationCaseJudgement;
  readonly validation: ValidateRemediationCaseGraphResult;
}): readonly string[] {
  if (!input.validation.ok) return [];
  if (input.judgement.mode === 'case-v2' &&
    (input.judgement.consistency.verdict === 'blocked' || input.judgement.cases.some((caseRow) => caseRow.disposition === 'escalate'))) {
    return [];
  }
  return input.validation.graph.cases
    .filter(({ case: caseRow }) => caseRow.disposition === 'act')
    .map(({ case: caseRow }) => caseRow.caseRef);
}

function hasUnfinishedEffect(record: RemediationCaseRecord): boolean {
  return (isOpenRemediationCase(record) && record.effect.kind !== 'none' && record.effect.status !== 'applied')
    || (record.disposition === 'refute' && hasReservedOrFailedRemediationEffect(record));
}

function currentSourceCoverageIsConsistent(
  currentSourceIds: readonly string[],
  cases: readonly RemediationCaseRecord[],
): boolean {
  const current = new Set(currentSourceIds);
  if (current.size !== currentSourceIds.length) return false;
  const sourceLinks = currentBuildReviewSourceLinks(cases);
  const outcomes = new Map<string, string>();
  for (const sourceId of current) {
    const source = sourceLinks.get(sourceId);
    if (source !== undefined) outcomes.set(sourceId, source.link.outcome);
  }
  return currentSourceIds.every((sourceId) => outcomes.has(sourceId));
}

/**
 * Derive an effective route from finalized durable case state.  This is kept
 * pure so the conductor cannot accidentally turn a partial effect into PASS.
 */
export function reduceBuildReviewAdjudication(input: {
  /** Exact current source identity is required to prove no stale case routes BUILD. */
  readonly currentSourceIds: readonly string[];
  /** Scope is required so a durable action obligation gives the operator its exact command. */
  readonly feature: string;
  readonly child: ChildId | undefined;
  readonly cases: readonly RemediationCaseRecord[];
  readonly mechanical: BuildReviewMechanicalState;
}): BuildReviewAdjudicationTransition {
  if (!currentSourceCoverageIsConsistent(input.currentSourceIds, input.cases)) {
    return { route: 'halt', remainingMechanical: input.mechanical !== 'healthy', reason: 'current remediation source coverage is incomplete or contradictory' };
  }
  // A failed action can be resolved by an operator only while its source is
  // still live. Name that case and its exact scoped command before the generic
  // unfinished-effect branch so the coordinator does not discard the
  // actionable identity that clean-PASS settlement retains.
  const failedActionWithCurrentSource = input.cases.find((record) =>
    record.disposition === 'act' && record.resolution === 'open' &&
    record.effect.kind === 'action' && record.effect.status === 'failed' &&
    record.sources.some((source) => input.currentSourceIds.includes(source.sourceId)),
  );
  if (failedActionWithCurrentSource) {
    return {
      route: 'halt',
      remainingMechanical: input.mechanical !== 'healthy',
      reason: `open action case ${failedActionWithCurrentSource.id} has a failed effect while a current remediation source remains unaccepted; resolve with ai-conductor build-review resolve-case --feature ${input.feature}${input.child === undefined ? '' : ` --child ${input.child}`} --case ${failedActionWithCurrentSource.id} --rationale "<why>"`,
    };
  }
  if (input.cases.some(hasUnfinishedEffect)) {
    return { route: 'halt', remainingMechanical: input.mechanical !== 'healthy', reason: 'remediation effect is not finalized' };
  }
  const currentDecisionOwners = [...new Set(input.cases
    .filter(isBuildReviewDecisionStop)
    .filter((record) => record.sources.some((source) => input.currentSourceIds.includes(source.sourceId)))
    .map((record) => record.escalation?.owner)
    .filter((owner): owner is 'product' | 'plan' | 'architecture' => owner !== undefined))];
  const consistencyStop = input.cases
    .filter(isBuildReviewDecisionStop)
    .find((record) => record.consistencyStop !== undefined && record.sources.some((source) => input.currentSourceIds.includes(source.sourceId)));
  if (consistencyStop?.consistencyStop) {
    return {
      route: 'halt',
      remainingMechanical: input.mechanical !== 'healthy',
      reason: `build-review adjudication consistency is blocked for ${consistencyStop.consistencyStop.sourceIds.join(', ')}: ${consistencyStop.consistencyStop.rationale}`,
    };
  }
  if (currentDecisionOwners.length > 0) {
    return {
      route: 'halt',
      remainingMechanical: input.mechanical !== 'healthy',
      reason: `${currentDecisionOwners.join(', ')} decision is required for current remediation sources`,
    };
  }
  if (input.cases.some((record) =>
    isBuildEligibleActionCase(record) && record.sources.some((source) => input.currentSourceIds.includes(source.sourceId)),
  )) {
    return {
      route: 'build',
      remainingMechanical: input.mechanical !== 'healthy',
      reason: input.mechanical === 'healthy' ? 'applied action effect' : 'applied action effect with retained coverage blocker',
    };
  }
  // An open applied action that covers no current source is not benign
  // history: attempted history is resolved by reconciliation before it gets
  // here, so what remains is a published work order BUILD never attempted
  // (typically a lap that halted after applying it). PASS would stamp the gate
  // done around durable unfinished work, and halting held it forever, so the
  // published work goes to BUILD.
  if (input.cases.some(isBuildEligibleActionCase)) {
    return {
      route: 'build',
      remainingMechanical: input.mechanical !== 'healthy',
      reason: 'applied action effect awaits its BUILD attempt',
    };
  }
  if (input.mechanical === 'halt') {
    return { route: 'halt', remainingMechanical: true, reason: 'uncovered build-review coverage failure' };
  }
  if (input.mechanical === 'retry') {
    return { route: 'mechanical-retry', remainingMechanical: true, reason: 'build-review coverage retry is pending' };
  }
  return { route: 'pass', remainingMechanical: false, reason: 'all current findings have finalized non-action outcomes' };
}

/** Deterministic work-order ordering shared by action execution and rendering. */
export function orderBuildReviewActionCases(cases: readonly BuildReviewWorkOrderCase[]): BuildReviewWorkOrderCase[] {
  const priority = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return [...cases].sort((left, right) =>
    priority[left.priority] - priority[right.priority] || left.caseId.localeCompare(right.caseId),
  );
}

/** Render source-to-case state without mutating the raw aggregate artifact. */
export function renderBuildReviewAdjudicationTrace(cases: readonly RemediationCaseRecord[]): string {
  return cases.map((record) => {
    const sources = record.sources.map((source) => source.sourceId).join(', ');
    const effect = record.effect.kind === 'none'
      ? 'none'
      : `${record.effect.kind}:${record.effect.status}:${record.effect.id}`;
    return `${record.id} [${record.disposition}/${record.resolution}] sources: ${sources}; effect: ${effect}`;
  }).join('\n');
}
