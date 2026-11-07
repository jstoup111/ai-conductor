import type { ConductorEventEmitter } from '../conductor-event-emitter.js';
import type { GitRunner } from '../rebase.js';
import {
  conflictParentRefFor,
  decisionMatchesRange,
  decisionRefFor,
  readConflictRecord,
  readRestackDecision,
} from './restack-conflict-record.js';
import type { DeliveredRestackDecision } from './restack-journal.js';
import { parseCommitSha, type ChildRange, type RestackOpId } from './restack-types.js';

export interface DeliveredOperatorDecision {
  readonly answer: string;
  readonly commit: string;
  readonly paths: readonly string[];
}

export interface RestackDecisionDelivery {
  readonly operatorDecision?: DeliveredOperatorDecision;
  readonly deliveredDecision?: DeliveredRestackDecision;
  readonly diagnostic?: string;
}

/**
 * Read an operator decision once for both replay entry points. A matching
 * decision is not observable as applied until its paired conflict refs can be
 * retired atomically with the eventual journal move.
 */
export async function prepareRestackDecisionDelivery(input: {
  readonly worktree: string;
  readonly slug: string;
  readonly range: ChildRange;
  readonly opId: RestackOpId;
  readonly git: GitRunner;
  readonly events?: ConductorEventEmitter;
}): Promise<RestackDecisionDelivery | undefined> {
  const recorded = await readRestackDecision(input.worktree, input.slug, input.range.child, { git: input.git });
  const delivered = recorded.kind === 'decision' && decisionMatchesRange(recorded.decision, input.range)
    ? recorded
    : undefined;
  const diagnostic = recorded.kind === 'unreadable'
    ? `unreadable operator decision at ${decisionRefFor(input.slug, input.range.child)}`
    : recorded.kind === 'decision'
      ? `stale operator decision: ${recorded.decision.answer}`
      : undefined;

  if (recorded.kind === 'decision' && delivered === undefined) {
    await input.events?.emit({
      type: 'restack_decision', action: 'stale', child: input.range.child,
      commit: recorded.decision.commit, paths: [...recorded.decision.paths], opId: input.opId,
    });
  }
  if (delivered === undefined) return { diagnostic };

  const conflictRecord = await readConflictRecord(input.worktree, input.slug, { git: input.git });
  const parent = await input.git(['rev-parse', '-q', '--verify', conflictParentRefFor(input.slug)]);
  const conflictParent = parent.exitCode === 0 ? parseCommitSha(parent.stdout.trim()) : undefined;
  if (conflictRecord.kind !== 'record' || conflictParent === undefined) return undefined;

  await input.events?.emit({
    type: 'restack_decision', action: 'applied', child: input.range.child,
    commit: delivered.decision.commit, paths: [...delivered.decision.paths], opId: input.opId,
  });
  return {
    operatorDecision: {
      answer: delivered.decision.answer,
      commit: delivered.decision.commit,
      paths: delivered.decision.paths,
    },
    deliveredDecision: {
      child: input.range.child,
      blob: delivered.blob,
      record: conflictRecord.blob,
      parent: conflictParent,
    },
  };
}

export function restackDecisionDetailLines(delivery: RestackDecisionDelivery): readonly string[] {
  return [
    ...(delivery.operatorDecision === undefined ? [] : [`operator decision applied: ${delivery.operatorDecision.answer}`]),
    ...(delivery.diagnostic === undefined ? [] : [delivery.diagnostic]),
  ];
}
