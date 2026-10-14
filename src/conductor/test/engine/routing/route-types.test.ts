// Covers: task:1
import { describe, expect, it } from 'vitest';

import { MAX_CHILD_ID } from '../../../src/engine/child-context.js';
import {
  MAX_ROUTE_ROUNDS,
  parseRepairMarker,
  parseRevalidationQueueRecord,
  parseRouteRecord,
  parseRoundId,
} from '../../../src/engine/routing/route-types.js';

const routeRecord = {
  roundId: 'r1',
  kind: 'audit',
  phase: 'open',
  items: [{ findingId: 'finding-1', kind: 'audit', owner: 1, host: 2, reason: 'task ownership', fallback: [3] }],
  allocation: {
    2: { remTaskIds: ['rem-4'], blockBodies: ['### Task 4\n'] },
  },
  hosts: { 1: 'restacked', 2: 'repairing', 3: 'pending' },
  currentHostIndex: 1,
  receipt: { settlementId: 'settlement-1' },
  outbox: [{
    eventId: 'event-1', occurredAt: '2026-10-12T00:00:00.000Z',
    event: { type: 'routed_repair_phase', eventId: 'event-1', occurredAt: '2026-10-12T00:00:00.000Z' },
  }],
};

describe('routed repair durable record parsers', () => {
  it('parses only bounded, branded route round ids', () => {
    expect(parseRoundId('r1')).toBe('r1');
    expect(parseRoundId(`r${MAX_ROUTE_ROUNDS}`)).toBe(`r${MAX_ROUTE_ROUNDS}`);

    for (const invalid of ['r0', `r${MAX_ROUTE_ROUNDS + 1}`, '1', 'routes/r1', '']) {
      expect(parseRoundId(invalid)).toBeUndefined();
    }
  });

  it('parses a route record carrying every declared field', () => {
    expect(parseRouteRecord(JSON.stringify(routeRecord))).toEqual(routeRecord);
  });

  it('rejects route records without an outbox or with an invalid round phase', () => {
    const { outbox: _outbox, ...withoutOutbox } = routeRecord;
    expect(parseRouteRecord(JSON.stringify(withoutOutbox))).toBeUndefined();
    expect(parseRouteRecord(JSON.stringify({ ...routeRecord, phase: 'settling' }))).toBeUndefined();
  });

  it('rejects outbox events missing or disagreeing with their envelope identity', () => {
    const missingEventId = structuredClone(routeRecord);
    delete (missingEventId.outbox[0]!.event as Record<string, unknown>).eventId;
    expect(parseRouteRecord(JSON.stringify(missingEventId))).toBeUndefined();

    const missingOccurredAt = structuredClone(routeRecord);
    delete (missingOccurredAt.outbox[0]!.event as Record<string, unknown>).occurredAt;
    expect(parseRouteRecord(JSON.stringify(missingOccurredAt))).toBeUndefined();

    const mismatched = structuredClone(routeRecord);
    (mismatched.outbox[0]!.event as Record<string, unknown>).eventId = 'other-event';
    expect(parseRouteRecord(JSON.stringify(mismatched))).toBeUndefined();
    expect(parseRevalidationQueueRecord(JSON.stringify({
      generation: 1,
      entries: [],
      outbox: [{ eventId: 'event-2', occurredAt: '2026-10-12T00:00:00.000Z', event: { type: 'child_revalidated' } }],
    }))).toBeUndefined();
  });

  it('parses valid repair markers and revalidation queues', () => {
    expect(parseRepairMarker(JSON.stringify({ host: 2, roundId: 'r1' }))).toEqual({ host: 2, roundId: 'r1' });
    expect(parseRevalidationQueueRecord(JSON.stringify({
      generation: 3,
      entries: [{ child: 2, closureSha: 'a'.repeat(40), state: 'pending' }],
      outbox: [{
        eventId: 'event-2', occurredAt: '2026-10-12T00:00:00.000Z',
        event: { type: 'child_revalidated', eventId: 'event-2', occurredAt: '2026-10-12T00:00:00.000Z' },
      }],
    }))).toEqual({
      generation: 3,
      entries: [{ child: 2, closureSha: 'a'.repeat(40), state: 'pending' }],
      outbox: [{
        eventId: 'event-2', occurredAt: '2026-10-12T00:00:00.000Z',
        event: { type: 'child_revalidated', eventId: 'event-2', occurredAt: '2026-10-12T00:00:00.000Z' },
      }],
    });
  });

  it('rejects out-of-bounds repair marker hosts and queue entries without a closure SHA', () => {
    expect(parseRepairMarker(JSON.stringify({ host: MAX_CHILD_ID + 1, roundId: 'r1' }))).toBeUndefined();
    expect(parseRevalidationQueueRecord(JSON.stringify({ generation: 1, entries: [{ child: 1, state: 'pending' }], outbox: [] }))).toBeUndefined();
  });
});
