import type { BuildReviewWorkOrderCase } from './build-review-work-order.js';
import { isBuildEligibleActionCase, isOpenRemediationCase } from './remediation-case-effects.js';
import type { RemediationCaseRecord } from './remediation-case-store.js';

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

function hasUnfinishedEffect(record: RemediationCaseRecord): boolean {
  return isOpenRemediationCase(record) && record.effect.kind !== 'none' && record.effect.status !== 'applied';
}

function currentSourceCoverageIsConsistent(
  currentSourceIds: readonly string[],
  cases: readonly RemediationCaseRecord[],
): boolean {
  const current = new Set(currentSourceIds);
  if (current.size !== currentSourceIds.length) return false;
  const outcomes = new Map<string, string>();
  for (const record of cases) {
    for (const source of record.sources) {
      if (!current.has(source.sourceId)) continue;
      const previous = outcomes.get(source.sourceId);
      if (previous !== undefined && previous !== source.outcome) return false;
      outcomes.set(source.sourceId, source.outcome);
    }
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
  readonly cases: readonly RemediationCaseRecord[];
  readonly mechanical: BuildReviewMechanicalState;
}): BuildReviewAdjudicationTransition {
  if (!currentSourceCoverageIsConsistent(input.currentSourceIds, input.cases)) {
    return { route: 'halt', remainingMechanical: input.mechanical !== 'healthy', reason: 'current remediation source coverage is incomplete or contradictory' };
  }
  if (input.cases.some(hasUnfinishedEffect)) {
    return { route: 'halt', remainingMechanical: input.mechanical !== 'healthy', reason: 'remediation effect is not finalized' };
  }
  if (input.cases.some((record) =>
    isBuildEligibleActionCase(record) && record.sources.some((source) => input.currentSourceIds.includes(source.sourceId)),
  )) {
    return {
      route: 'build',
      remainingMechanical: input.mechanical !== 'healthy',
      reason: input.mechanical === 'healthy' ? 'applied action effect' : 'applied action effect with retained infrastructure blocker',
    };
  }
  if (input.mechanical === 'halt') {
    return { route: 'halt', remainingMechanical: true, reason: 'uncovered build-review infrastructure failure' };
  }
  if (input.mechanical === 'retry') {
    return { route: 'mechanical-retry', remainingMechanical: true, reason: 'build-review infrastructure retry is pending' };
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
