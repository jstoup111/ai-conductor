import {
  coordinateBuildReviewAdjudication,
  type BuildReviewAdjudicationCoordinatorInput,
} from './build-review-adjudication-coordinator.js';
import { parseBuildReviewAggregate } from './build-review-aggregate.js';

export type BuildReviewOutcome =
  | { readonly kind: 'awaiting-settlement'; readonly lapId: string }
  | { readonly kind: 'repair'; readonly lapId: string; readonly caseIds: readonly string[]; readonly trace: string; readonly remainingInfrastructure: boolean }
  | { readonly kind: 'decision-stop'; readonly lapId: string; readonly stops: readonly { readonly caseId: string; readonly owner: 'product' | 'plan' | 'architecture' }[]; readonly detail: string; readonly trace: string; readonly remainingInfrastructure: boolean }
  | { readonly kind: 'infrastructure'; readonly lapId?: string; readonly status: 'retry' | 'halt'; readonly reason: string; readonly trace?: string }
  | { readonly kind: 'settled'; readonly lapId: string; readonly trace: string };

/** The application boundary shared by attended and daemon review consumers. */
export async function applyBuildReviewOutcome(input: {
  readonly settlement: 'pending' | 'settled';
  readonly recordedAggregate: unknown;
  readonly adjudication: Omit<BuildReviewAdjudicationCoordinatorInput, 'aggregate'>;
}): Promise<BuildReviewOutcome> {
  const aggregate = parseBuildReviewAggregate(input.recordedAggregate);
  if (!aggregate) {
    return {
      kind: 'infrastructure', status: 'halt',
      reason: 'build-review aggregate is not a complete settled lap',
    };
  }
  if (input.settlement !== 'settled') return { kind: 'awaiting-settlement', lapId: aggregate.lapId };

  const adjudication = await coordinateBuildReviewAdjudication({
    ...input.adjudication,
    aggregate,
  });
  if (!adjudication.ok) {
    return { kind: 'infrastructure', lapId: aggregate.lapId, status: 'halt', reason: adjudication.detail };
  }
  if (adjudication.route === 'build') {
    // Coordinator validation and the durable effect lease must both have
    // produced an admitted action before any consumer can receive repair work.
    if (adjudication.durable.repairCaseIds.length === 0) {
      return { kind: 'infrastructure', lapId: aggregate.lapId, status: 'halt', reason: 'adjudication selected BUILD without a durable admitted repair', trace: adjudication.trace };
    }
    return {
      kind: 'repair', lapId: aggregate.lapId, caseIds: adjudication.durable.repairCaseIds,
      trace: adjudication.trace, remainingInfrastructure: adjudication.remainingMechanical,
    };
  }
  if (adjudication.durable.decisionStops.length > 0) {
    return {
      kind: 'decision-stop', lapId: aggregate.lapId, stops: adjudication.durable.decisionStops,
      detail: adjudication.detail, trace: adjudication.trace,
      remainingInfrastructure: adjudication.remainingMechanical,
    };
  }
  if (adjudication.route === 'mechanical-retry' || adjudication.route === 'halt') {
    return {
      kind: 'infrastructure', lapId: aggregate.lapId,
      status: adjudication.route === 'mechanical-retry' ? 'retry' : 'halt',
      reason: adjudication.detail, trace: adjudication.trace,
    };
  }
  return { kind: 'settled', lapId: aggregate.lapId, trace: adjudication.trace };
}
