// Covers: task:1, task:200
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
  items: [{
    findingId: 'finding-1', kind: 'audit', owner: 1, host: 2, reason: 'task ownership', fallback: [3],
    taskIds: ['T1'],
    obligation: { branch: 'feat/c2/demo', head: 'a'.repeat(40), tree: 'b'.repeat(40) },
  }],
  allocation: {
    2: { remTaskIds: ['rem-4'], blockBodies: ['### Task 4\n'] },
  },
  hosts: { 1: 'reroute-moved', 2: 'pending', 3: 'pending' },
  currentHostIndex: 1,
  receipt: {
    laps: { prd_audit: 1 }, growth: 2, taskless: { manual_test: 1 }, echo: { 'lint-docs': 3 },
    settlementId: 'settlement-1', acks: { 2: true },
  },
  entry: { host: 2, pinnedBase: 'c'.repeat(40), tree: 'd'.repeat(40) },
  fallback: [{ from: 1, to: 2, evidence: ['src/b.ts'], branch: 'feat/c1/demo', head: 'e'.repeat(40) }],
  reroute: { sourceBranch: 'feat/c1/demo', rejectedTip: 'f'.repeat(40), resetTip: 'a'.repeat(40), destination: 2 },
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

  it('round-trips the typed settled receipt, host entry pin, obligation, fallback and reroute state byte-identically', () => {
    const parsed = parseRouteRecord(JSON.stringify(routeRecord));
    expect(parsed).toEqual(routeRecord);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(routeRecord));
  });

  it('rejects an entry whose host is absent, so one host cannot consume another host\'s pin', () => {
    expect(parseRouteRecord(JSON.stringify({ ...routeRecord, entry: { ...routeRecord.entry, host: 4 } }))).toBeUndefined();
  });

  it('rejects reroutes without a matching latest fallback movement', () => {
    const missingFallback = structuredClone(routeRecord);
    missingFallback.fallback = [];
    expect(parseRouteRecord(JSON.stringify(missingFallback))).toBeUndefined();

    const mismatchedDestination = structuredClone(routeRecord);
    mismatchedDestination.reroute.destination = 3;
    expect(parseRouteRecord(JSON.stringify(mismatchedDestination))).toBeUndefined();

    const mismatchedSource = structuredClone(routeRecord);
    mismatchedSource.hosts[1] = 'repairing';
    mismatchedSource.hosts[3] = 'reroute-moved';
    expect(parseRouteRecord(JSON.stringify(mismatchedSource))).toBeUndefined();
  });

  it('normalizes the legacy empty receipt as an unsettled receipt with zero charges', () => {
    const unsettled = { ...routeRecord, receipt: {} };
    expect(parseRouteRecord(JSON.stringify(unsettled))?.receipt).toEqual({
      laps: {}, growth: 0, taskless: {}, echo: {}, acks: {},
    });
  });

  it('rejects acknowledgements on unsettled receipts while preserving valid taskless and echo receipts', () => {
    const { settlementId: _settlementId, ...acknowledgedUnsettledReceipt } = routeRecord.receipt;
    const acknowledgedUnsettled = { ...routeRecord, receipt: acknowledgedUnsettledReceipt };
    expect(parseRouteRecord(JSON.stringify(acknowledgedUnsettled))).toBeUndefined();

    const tasklessAndEchoUnsettled = {
      ...routeRecord,
      receipt: { laps: {}, growth: 0, taskless: { manual_test: 1 }, echo: { 'lint-docs': 3 }, acks: {} },
    };
    const parsed = parseRouteRecord(JSON.stringify(tasklessAndEchoUnsettled));
    expect(parsed?.receipt).toEqual(tasklessAndEchoUnsettled.receipt);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(tasklessAndEchoUnsettled));
  });

  it('fails closed on malformed receipts, existing-task bindings without ids, and invalid obligation branches', () => {
    expect(parseRouteRecord(JSON.stringify({ ...routeRecord, receipt: { laps: 'x' } }))).toBeUndefined();
    expect(parseRouteRecord(JSON.stringify({ ...routeRecord, receipt: { ...routeRecord.receipt, lapz: {} } }))).toBeUndefined();
    expect(parseRouteRecord(JSON.stringify({ ...routeRecord, receipt: { ...routeRecord.receipt, extra: true } }))).toBeUndefined();

    const existingWithoutTaskIds = structuredClone(routeRecord);
    const existing = existingWithoutTaskIds.items[0]! as Record<string, unknown>;
    delete existing.taskIds;
    existing.restage = false;
    expect(parseRouteRecord(JSON.stringify(existingWithoutTaskIds))).toBeUndefined();

    const invalidBranch = structuredClone(routeRecord);
    (invalidBranch.items[0]!.obligation as Record<string, unknown>).branch = 'feat/../x';
    expect(parseRouteRecord(JSON.stringify(invalidBranch))).toBeUndefined();
  });

  it('round-trips routed rationale, restage state, and host retry hints', () => {
    const enriched = structuredClone(routeRecord) as Record<string, unknown>;
    const item = (enriched.items as Array<Record<string, unknown>>)[0]!;
    const allocation = enriched.allocation as Record<string, Record<string, unknown>>;
    item.rationale = 'implements D2';
    item.restage = true;
    allocation['2']!.retryHint = 'manual_test: FAIL';
    expect(parseRouteRecord(JSON.stringify(enriched))).toEqual(enriched);

    item.rationale = 7;
    expect(parseRouteRecord(JSON.stringify(enriched))).toBeUndefined();
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
