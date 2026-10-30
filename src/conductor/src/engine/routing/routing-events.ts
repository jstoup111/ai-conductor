import { randomUUID } from 'node:crypto';

import type { ConductorEvent } from '../../types/events.js';
import type { ChildId } from '../child-context.js';
import type { HostState, RouteRecord, RoundId } from './route-types.js';
import type { CommitSha } from '../restack/restack-types.js';

function occurrence(): { readonly eventId: string; readonly occurredAt: string } {
  return { eventId: randomUUID(), occurredAt: new Date().toISOString() };
}

/** Creates the sole event form for admission of a durable routed record. */
export function remediationRoutedEvent(record: RouteRecord): Extract<ConductorEvent, { type: 'remediation_routed' }> {
  const child = Math.min(...Object.keys(record.hosts).map(Number)) as ChildId;
  return {
    type: 'remediation_routed', ...occurrence(), roundId: record.roundId, kind: record.kind,
    items: record.items.map(({ findingId, owner, host, reason }) => ({ findingId, owner, host, reason })), child,
  };
}

/** Creates the sole event form for a legal routed host transition. */
export function routedRepairPhaseEvent(
  roundId: RoundId,
  host: ChildId,
  phase: HostState,
  credit: boolean,
): Extract<ConductorEvent, { type: 'routed_repair_phase' }> {
  return { type: 'routed_repair_phase', ...occurrence(), roundId, host, phase, credit, child: host };
}

/** Creates the durable operator-landing occurrence paired with its route mutation. */
export function operatorRoundEvent(
  roundId: RoundId,
  operator: NonNullable<RouteRecord['operator']>,
  host: ChildId,
  phase: 'opened' | 'declared' | 'abandoned',
): Extract<ConductorEvent, { type: 'operator_round' }> {
  return {
    type: 'operator_round', ...occurrence(), roundId, child: host,
    origin: operator.origin, reason: operator.reason, action: phase,
  };
}

/** Creates the durable occurrence paired with closing a stale audit round. */
export function routingRoundSupersededEvent(
  record: RouteRecord,
  supersededBy: RoundId,
  droppedHosts: readonly ChildId[],
  findingIds: readonly string[],
  reason: string,
  operator: string,
): Extract<ConductorEvent, { type: 'routing_round_superseded' }> {
  return {
    type: 'routing_round_superseded', ...occurrence(), roundId: record.roundId,
    supersededBy, droppedHosts, findingIds, reason, operator,
    child: Math.min(...droppedHosts) as ChildId,
  };
}

/** Creates the one durable occurrence for a completed queued revalidation. */
export function childRevalidatedEvent(
  child: ChildId,
  generation: number,
  closureSha: CommitSha,
  outcome: 'passed' | 'fixed',
): Extract<ConductorEvent, { type: 'child_revalidated' }> {
  return { type: 'child_revalidated', ...occurrence(), child, generation, closureSha, outcome };
}

/** Creates the durable occurrence paired with an upward host movement. */
export function remediationReroutedEvent(
  roundId: RoundId,
  from: ChildId,
  to: ChildId,
  rejectedRef: string,
): Extract<ConductorEvent, { type: 'remediation_rerouted' }> {
  return {
    type: 'remediation_rerouted', ...occurrence(), roundId, from, to,
    evidence: rejectedRef, child: to,
  };
}

/** Place an occurrence in the same durable record transaction as its state. */
export function withOutboxEvent(record: RouteRecord, event: ConductorEvent): RouteRecord {
  if (!('eventId' in event) || !('occurredAt' in event)) throw new Error('routing occurrence must carry durable identity');
  return { ...record, outbox: [...record.outbox, { eventId: event.eventId, occurredAt: event.occurredAt, event }] };
}
