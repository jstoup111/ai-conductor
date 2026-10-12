import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { emitRestackRefused } from '../../src/engine/restack/restack-events.js';
import type { RestackRefusalReason } from '../../src/engine/restack/restack-types.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;

const RESTACK_REFUSAL_REASONS = [
  'cascade-cap',
  'dirty-overlap',
  'sync-collision',
  'checked-out-elsewhere',
  'stack-ref-changed',
  'lock-unavailable',
  'verification-failed',
  'replay-mismatch',
  'range-not-ancestor',
  'closed-child-rewritten',
  'flatten_refused',
  'restack-outstanding',
  'published-stack',
  'deferred-base-refresh',
] as const;

describe('restack_refused on the event spine (sweep G1)', () => {
  // Covers: task:2
  it('closes restack_refused to the fourteen ADR reasons and persists child and detail through EventPersister', async () => {
    const closedVocabulary: Equal<Extract<ConductorEvent, { type: 'restack_refused' }>['reason'], typeof RESTACK_REFUSAL_REASONS[number]> = true;
    const sharedVocabulary: Equal<RestackRefusalReason, typeof RESTACK_REFUSAL_REASONS[number]> = true;
    expect([closedVocabulary, sharedVocabulary]).toEqual([true, true]);
    // @ts-expect-error -- any string outside the closed reason vocabulary is rejected.
    const unknownReason: ConductorEvent = { type: 'restack_refused', reason: 'not-a-restack-reason' };
    void unknownReason;
    expect(new Set(RESTACK_REFUSAL_REASONS).size).toBe(14);

    const projectRoot = await mkdtemp(join(tmpdir(), 'restack-refused-sweep-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const child = parseChildId(2)!;
    const emitted = [
      emitRestackRefused({ reason: 'stack-ref-changed', child, detail: 'refs/heads/feat/c2/demo' }),
      ...RESTACK_REFUSAL_REASONS.map((reason) => emitRestackRefused({ reason })),
    ];
    try {
      persister.start();
      for (const event of emitted) await events.emit(event);
      persister.stop();

      const records = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => {
          const { ts: _ts, ...record } = JSON.parse(line) as Record<string, unknown>;
          return record;
        });
      expect(records[0]).toEqual({
        type: 'restack_refused',
        reason: 'stack-ref-changed',
        child: 2,
        detail: 'refs/heads/feat/c2/demo',
      });
      expect(records.slice(1)).toEqual(RESTACK_REFUSAL_REASONS.map((reason) => ({ type: 'restack_refused', reason })));
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
