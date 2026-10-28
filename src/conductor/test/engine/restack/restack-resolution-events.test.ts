// Covers: task:2
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { emitRestackRefused } from '../../../src/engine/restack/restack-events.js';
import { parseCommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';
import type { ConductorEvent } from '../../../src/types/events.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

async function persistedEvents(eventsPath: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(eventsPath, 'utf8')).trim().split('\n').map((line) => {
    const { ts: _ts, ...event } = JSON.parse(line) as Record<string, unknown>;
    return event;
  });
}

describe('restack resolution events', () => {
  it('persists recorded and consumed resolution occurrences with operator identity only on recording', async () => {
    const root = await mkdtemp(join(tmpdir(), 'restack-resolution-events-'));
    const eventsPath = join(root, '.pipeline', 'events.jsonl');
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(eventsPath, events);
    const child = parseChildId(2)!;
    const recordedTip = parseCommitSha('a'.repeat(40))!;
    const consumedTip = parseCommitSha('b'.repeat(40))!;
    const opId = 'restack-42' as RestackOpId;
    const resolutionEvents = [
      { type: 'restack_resolution', opId, child, action: 'recorded', tip: recordedTip, operator: 'james' },
      { type: 'restack_resolution', opId, child, action: 'consumed', tip: consumedTip },
    ] satisfies ConductorEvent[];

    try {
      persister.start();
      for (const event of resolutionEvents) await events.emit(event);

      expect(await persistedEvents(eventsPath)).toEqual([
        { type: 'restack_resolution', opId, child: 2, action: 'recorded', tip: recordedTip, operator: 'james' },
        { type: 'restack_resolution', opId, child: 2, action: 'consumed', tip: consumedTip },
      ]);
    } finally {
      persister.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists restack-resolution-stale refusals with their child and detail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'restack-resolution-refusal-'));
    const eventsPath = join(root, '.pipeline', 'events.jsonl');
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(eventsPath, events);
    const child = parseChildId(2)!;
    const detail = 'parent tree mismatch';

    try {
      persister.start();
      await events.emit(emitRestackRefused({ reason: 'restack-resolution-stale', child, detail }));

      expect(await persistedEvents(eventsPath)).toEqual([
        { type: 'restack_refused', reason: 'restack-resolution-stale', child: 2, detail },
      ]);
    } finally {
      persister.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
