// Covers: task:1, task:200
import { describe, expect, it } from 'vitest';

import { MAX_CHILD_ID } from '../../../src/engine/child-context.js';
import type { ChildId } from '../../../src/engine/child-context.js';
import {
  MAX_ROUTE_ROUNDS,
  parseRepairMarker,
  parseRevalidationQueueRecord,
  parseRouteRecord,
  parseRoundId,
  emptyUnsettledReceipt,
  type RoutedItem,
  type UnsettledRoundReceipt,
} from '../../../src/engine/routing/route-types.js';

const compileTimeUnsettledReceipt: UnsettledRoundReceipt = {
  laps: {},
  growth: 0,
  taskless: {},
  echo: {},
  acks: {
    // @ts-expect-error Unsettled receipts cannot acknowledge a host.
    1: true,
  },
};
void compileTimeUnsettledReceipt;

const c1 = 1 as ChildId;

const compileTimeExistingTaskItem: RoutedItem = {
  findingId: 'existing-task', kind: 'audit', owner: c1, host: c1, reason: 'repair', fallback: [],
  existingTask: true,
  taskIds: ['T1'],
};
void compileTimeExistingTaskItem;

const compileTimeOrdinaryItem: RoutedItem = {
  findingId: 'ordinary', kind: 'audit', owner: c1, host: c1, reason: 'new remediation', fallback: [],
  // @ts-expect-error Authored-task bindings require the existing-task discriminator.
  taskIds: ['T1'],
};
void compileTimeOrdinaryItem;

const routeRecord = {
  roundId: 'r1',
  kind: 'audit',
  phase: 'open',
  items: [{
    findingId: 'finding-1', kind: 'audit', owner: 1, host: 2, reason: 'task ownership', fallback: [3],
    existingTask: true,
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
  fallback: [{ from: 1, to: 2, evidence: ['src/b.ts'], branch: 'feat/c1/demo', head: 'e'.repeat(40) }],
  reroute: { sourceBranch: 'feat/c1/demo', rejectedTip: 'f'.repeat(40), resetTip: 'a'.repeat(40), destination: 2 },
  outbox: [{
    eventId: 'event-1', occurredAt: '2026-10-12T00:00:00.000Z',
    event: { type: 'routed_repair_phase', eventId: 'event-1', occurredAt: '2026-10-12T00:00:00.000Z' },
  }],
};

const entry = { host: 2, pinnedBase: 'c'.repeat(40), tree: 'd'.repeat(40) };

/** The record after reroute sync and region entry: source rerouted, destination repairing and pinned. */
const { reroute: _syncedReroute, fallback: rerouteFallback, outbox: rerouteOutbox, ...rerouteHead } = routeRecord;
void _syncedReroute;
const enteredRecord = {
  ...rerouteHead,
  hosts: { 1: 'rerouted', 2: 'repairing', 3: 'pending' },
  entry,
  fallback: rerouteFallback,
  outbox: rerouteOutbox,
};

/** The record createRouteRecord writes: prepared, every host pending, index 0, nothing entered or moved. */
const preparedRecord = {
  roundId: 'r1', kind: 'audit', phase: 'prepared',
  items: [{ findingId: 'finding-1', kind: 'audit', owner: 1, host: 1, reason: 'task ownership', fallback: [] }],
  allocation: { 1: { remTaskIds: ['rem-4'], blockBodies: ['### Task rem-4\n'] } },
  hosts: { 1: 'pending' },
  currentHostIndex: 0,
  receipt: emptyUnsettledReceipt(),
  outbox: [],
};

/** The record admitRound writes: open, with the first host admitted. */
const admittedRecord = { ...preparedRecord, phase: 'open', hosts: { 1: 'admitted' } };

/** A round that finished: its rerouted source and its done destination are both terminal. */
const closedRecord = { ...enteredRecord, phase: 'closed', hosts: { 1: 'rerouted', 2: 'done', 3: 'done' } };

describe('routed repair durable record parsers', () => {
  it('parses only bounded, branded route round ids', () => {
    expect(parseRoundId('r1')).toBe('r1');
    expect(parseRoundId(`r${MAX_ROUTE_ROUNDS}`)).toBe(`r${MAX_ROUTE_ROUNDS}`);

    for (const invalid of ['r0', `r${MAX_ROUTE_ROUNDS + 1}`, '1', 'routes/r1', '']) {
      expect(parseRoundId(invalid)).toBeUndefined();
    }
  });

  it('round-trips the settled, reroute-moved, and entry-pinned record byte-identically', () => {
    for (const record of [routeRecord, enteredRecord]) {
      const parsed = parseRouteRecord(JSON.stringify(record));
      expect(parsed).toEqual(record);
      expect(JSON.stringify(parsed)).toBe(JSON.stringify(record));
    }
  });

  it('parses every lifecycle state a production route writer records', () => {
    const written: Record<string, unknown> = {
      'created (prepared, all pending)': preparedRecord,
      'created with a charged settlement before admission': {
        ...preparedRecord,
        receipt: { laps: { prd_audit: 1 }, growth: 1, taskless: {}, echo: {}, settlementId: 's-1', acks: { 1: true } },
      },
      'admitted (open, first host admitted)': admittedRecord,
      'entered (open, admitted host pinned)': { ...admittedRecord, entry: { ...entry, host: 1 } },
      'repairing (open, pinned host repairing)': { ...admittedRecord, hosts: { 1: 'repairing' }, entry: { ...entry, host: 1 } },
      'built in place': { ...admittedRecord, hosts: { 1: 'built' }, entry: { ...entry, host: 1 } },
      'done in place': { ...admittedRecord, hosts: { 1: 'done' } },
      'advanced to the next host': { ...admittedRecord, hosts: { 1: 'restacked', 2: 'admitted' }, currentHostIndex: 1 },
      'reroute moved, awaiting sync': routeRecord,
      'reroute synced (destination admitted)': { ...enteredRecord, hosts: { 1: 'rerouted', 2: 'admitted', 3: 'pending' }, entry: undefined },
      'reroute synced and entered': enteredRecord,
      'closed': closedRecord,
    };
    for (const [state, record] of Object.entries(written)) {
      expect(parseRouteRecord(JSON.stringify(record)), state).toBeDefined();
    }
  });

  it('rejects every route-record lifecycle combination no writer can produce', () => {
    const contradictions: Record<string, unknown> = {
      'prepared with a reroute payload and a reroute-moved source': { ...routeRecord, phase: 'prepared' },
      'prepared with an admitted host': { ...preparedRecord, hosts: { 1: 'admitted' } },
      'prepared past its first host': { ...preparedRecord, hosts: { 1: 'pending', 2: 'pending' }, currentHostIndex: 1 },
      'prepared with a pinned entry': { ...preparedRecord, entry: { ...entry, host: 1 } },
      'prepared with a fallback movement': { ...preparedRecord, fallback: routeRecord.fallback },
      'open with an unadmitted current host and no reroute': { ...preparedRecord, phase: 'open' },
      'open with two hosts in flight': { ...enteredRecord, hosts: { 1: 'rerouted', 2: 'repairing', 3: 'admitted' } },
      'open with a reroute whose destination is already admitted': { ...routeRecord, hosts: { 1: 'reroute-moved', 2: 'admitted', 3: 'pending' } },
      'open with a reroute whose unentered destination is pinned': { ...routeRecord, entry },
      'open with a reroute-moved host but no reroute payload': { ...enteredRecord, hosts: { 1: 'reroute-moved', 2: 'repairing', 3: 'pending' } },
      'a rerouted host without a recorded movement': { ...enteredRecord, fallback: [] },
      'a movement from a host that never moved': { ...enteredRecord, fallback: [{ ...routeRecord.fallback[0]!, from: 3, to: 2 }] },
      'closed with a pending current host': { ...closedRecord, hosts: { 1: 'rerouted', 2: 'pending', 3: 'done' } },
      'closed with a built current host awaiting its exit restack': { ...closedRecord, hosts: { 1: 'rerouted', 2: 'built', 3: 'done' } },
      'closed with another host still repairing': { ...closedRecord, hosts: { 1: 'rerouted', 2: 'done', 3: 'repairing' } },
      'closed with a reroute awaiting sync': { ...routeRecord, phase: 'closed', hosts: { 1: 'reroute-moved', 2: 'done', 3: 'done' } },
      'an entry pinned for a host other than the current host': { ...enteredRecord, entry: { ...entry, host: 1 } },
    };
    for (const [combination, record] of Object.entries(contradictions)) {
      expect(parseRouteRecord(JSON.stringify(record)), combination).toBeUndefined();
    }
  });

  it('accepts an existing-task item only when its durable task binding is present', () => {
    const existingTaskRecord = structuredClone(routeRecord);
    (existingTaskRecord.items[0]! as { existingTask?: boolean }).existingTask = true;
    expect(parseRouteRecord(JSON.stringify(existingTaskRecord))).toEqual(existingTaskRecord);
  });

  it('rejects an entry whose host is absent or differs from the current host', () => {
    expect(parseRouteRecord(JSON.stringify({ ...enteredRecord, entry: { ...entry, host: 4 } }))).toBeUndefined();
    expect(parseRouteRecord(JSON.stringify({ ...enteredRecord, entry: { ...entry, host: 1 } }))).toBeUndefined();
  });

  it('rejects a closed round whose current host has not reached a terminal lifecycle state', () => {
    expect(parseRouteRecord(JSON.stringify({ ...routeRecord, phase: 'closed' }))).toBeUndefined();
    expect(parseRouteRecord(JSON.stringify({
      ...routeRecord,
      phase: 'closed',
      hosts: { ...routeRecord.hosts, 2: 'admitted' },
    }))).toBeUndefined();
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

  it('normalizes the legacy empty receipt into a complete unsettled receipt', () => {
    const unsettled = { ...routeRecord, receipt: {} };
    const parsed = parseRouteRecord(JSON.stringify(unsettled));
    expect(parsed?.receipt).toEqual(emptyUnsettledReceipt());
    expect(parsed?.receipt).toMatchObject({ laps: {}, growth: 0, taskless: {}, echo: {}, acks: {} });
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

  it('rejects settled receipts without a host acknowledgement or with an unknown acknowledging host', () => {
    const withoutAcknowledgements = structuredClone(routeRecord);
    (withoutAcknowledgements.receipt.acks as Record<number, true>) = {};
    expect(parseRouteRecord(JSON.stringify(withoutAcknowledgements))).toBeUndefined();

    const unknownAcknowledgement = structuredClone(routeRecord);
    (unknownAcknowledgement.receipt.acks as Record<number, true>) = { 4: true };
    expect(parseRouteRecord(JSON.stringify(unknownAcknowledgement))).toBeUndefined();
  });

  it('fails closed on malformed receipts, existing-task bindings without ids, and invalid obligation branches', () => {
    expect(parseRouteRecord(JSON.stringify({ ...routeRecord, receipt: { laps: 'x' } }))).toBeUndefined();
    expect(parseRouteRecord(JSON.stringify({ ...routeRecord, receipt: { ...routeRecord.receipt, lapz: {} } }))).toBeUndefined();
    expect(parseRouteRecord(JSON.stringify({ ...routeRecord, receipt: { ...routeRecord.receipt, extra: true } }))).toBeUndefined();
    expect(parseRouteRecord(JSON.stringify({ ...routeRecord, receipt: { ...routeRecord.receipt, laps: { build_review: 1 } } }))).toBeUndefined();
    expect(parseRouteRecord(JSON.stringify({ ...routeRecord, receipt: { ...routeRecord.receipt, taskless: { build_review: 1 } } }))).toBeUndefined();

    const existingWithoutTaskIds = structuredClone(routeRecord);
    const existing = existingWithoutTaskIds.items[0]! as Record<string, unknown>;
    delete existing.taskIds;
    existing.restage = false;
    expect(parseRouteRecord(JSON.stringify(existingWithoutTaskIds))).toBeUndefined();

    const unmixedExistingWithoutTaskIds = structuredClone(routeRecord);
    const unmixedExisting = unmixedExistingWithoutTaskIds.items[0]! as Record<string, unknown>;
    unmixedExisting.existingTask = true;
    delete unmixedExisting.taskIds;
    delete unmixedExisting.restage;
    expect(parseRouteRecord(JSON.stringify(unmixedExistingWithoutTaskIds))).toBeUndefined();

    const ordinaryWithTaskBinding = structuredClone(routeRecord);
    delete (ordinaryWithTaskBinding.items[0]! as Record<string, unknown>).existingTask;
    expect(parseRouteRecord(JSON.stringify(ordinaryWithTaskBinding))).toBeUndefined();

    const existingWithRestageTrue = structuredClone(routeRecord);
    (existingWithRestageTrue.items[0]! as Record<string, unknown>).restage = true;
    expect(parseRouteRecord(JSON.stringify(existingWithRestageTrue))).toBeUndefined();

    const invalidBranch = structuredClone(routeRecord);
    (invalidBranch.items[0]!.obligation as Record<string, unknown>).branch = 'feat/../x';
    expect(parseRouteRecord(JSON.stringify(invalidBranch))).toBeUndefined();

    const lockBranch = structuredClone(routeRecord);
    (lockBranch.items[0]!.obligation as Record<string, unknown>).branch = 'feat/c1.lock/demo';
    expect(parseRouteRecord(JSON.stringify(lockBranch))).toBeUndefined();
  });

  it('round-trips routed rationale, restage state, and host retry hints', () => {
    const enriched = structuredClone(routeRecord) as Record<string, unknown>;
    const item = (enriched.items as Array<Record<string, unknown>>)[0]!;
    const allocation = enriched.allocation as Record<string, Record<string, unknown>>;
    item.rationale = 'implements D2';
    item.existingTask = true;
    item.restage = false;
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

  // Covers: task:28
  it('parses valid repair markers and revalidation queues', () => {
    expect(parseRepairMarker(JSON.stringify({ host: 2, roundId: 'r1' }))).toEqual({ host: 2, roundId: 'r1' });
    expect(parseRevalidationQueueRecord(JSON.stringify({
      generation: 3,
      entries: [
        {
          child: 2,
          position: 2,
          closureSha: 'a'.repeat(40),
          gates: ['test_suite'],
          replay: { oldParent: 'b'.repeat(40), newParent: 'c'.repeat(40) },
          state: 'queued',
        },
        {
          child: 4,
          position: 4,
          closureSha: 'd'.repeat(40),
          gates: ['acceptance_specs', 'build_review'],
          replay: { oldParent: 'e'.repeat(40), newParent: 'f'.repeat(40) },
          state: 'queued',
        },
      ],
      outbox: [{
        eventId: 'event-2', occurredAt: '2026-10-12T00:00:00.000Z',
        event: { type: 'child_revalidated', eventId: 'event-2', occurredAt: '2026-10-12T00:00:00.000Z' },
      }],
    }))).toEqual({
      generation: 3,
      entries: [
        {
          child: 2,
          position: 2,
          closureSha: 'a'.repeat(40),
          gates: ['test_suite'],
          replay: { oldParent: 'b'.repeat(40), newParent: 'c'.repeat(40) },
          state: 'queued',
        },
        {
          child: 4,
          position: 4,
          closureSha: 'd'.repeat(40),
          gates: ['acceptance_specs', 'build_review'],
          replay: { oldParent: 'e'.repeat(40), newParent: 'f'.repeat(40) },
          state: 'queued',
        },
      ],
      outbox: [{
        eventId: 'event-2', occurredAt: '2026-10-12T00:00:00.000Z',
        event: { type: 'child_revalidated', eventId: 'event-2', occurredAt: '2026-10-12T00:00:00.000Z' },
      }],
    });
  });

  // Covers: task:28
  it('rejects queues with duplicate children, non-ascending positions, or abbreviated closure SHAs', () => {
    const entry = {
      child: 2,
      position: 2,
      closureSha: 'a'.repeat(40),
      gates: ['test_suite'],
      replay: { oldParent: 'b'.repeat(40), newParent: 'c'.repeat(40) },
      state: 'queued',
    };
    const laterEntry = {
      child: 4,
      position: 4,
      closureSha: 'd'.repeat(40),
      gates: ['build_review'],
      replay: { oldParent: 'e'.repeat(40), newParent: 'f'.repeat(40) },
      state: 'queued',
    };

    expect(parseRevalidationQueueRecord(JSON.stringify({
      generation: 3, entries: [entry, { ...laterEntry, child: 2 }], outbox: [],
    }))).toBeUndefined();
    expect(parseRevalidationQueueRecord(JSON.stringify({
      generation: 3, entries: [laterEntry, entry], outbox: [],
    }))).toBeUndefined();
    expect(parseRevalidationQueueRecord(JSON.stringify({
      generation: 3, entries: [{ ...entry, closureSha: 'a'.repeat(12) }], outbox: [],
    }))).toBeUndefined();
  });

  it('rejects queues with an unknown gate or a state other than queued', () => {
    const entry = {
      child: 2,
      position: 2,
      closureSha: 'a'.repeat(40),
      gates: ['test_suite'],
      replay: { oldParent: 'b'.repeat(40), newParent: 'c'.repeat(40) },
      state: 'queued',
    };

    expect(parseRevalidationQueueRecord(JSON.stringify({
      generation: 3, entries: [{ ...entry, gates: ['lint-docs'] }], outbox: [],
    }))).toBeUndefined();
    expect(parseRevalidationQueueRecord(JSON.stringify({
      generation: 3, entries: [{ ...entry, state: 'pending' }], outbox: [],
    }))).toBeUndefined();
  });

  it('rejects out-of-bounds repair marker hosts and queue entries without a closure SHA', () => {
    expect(parseRepairMarker(JSON.stringify({ host: MAX_CHILD_ID + 1, roundId: 'r1' }))).toBeUndefined();
    expect(parseRevalidationQueueRecord(JSON.stringify({ generation: 1, entries: [{ child: 1, position: 1, state: 'queued' }], outbox: [] }))).toBeUndefined();
  });
});
