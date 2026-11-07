// Covers: task:2
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
  // Covers: task:1
  it('persists a recorded decision without its answer through the event spine', async () => {
    const root = await mkdtemp(join(tmpdir(), 'restack-decision-events-'));
    const eventsPath = join(root, '.pipeline', 'events.jsonl');
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(eventsPath, events);
    const child = parseChildId(2)!;
    const commit = parseCommitSha('c'.repeat(40))!;
    const opId = 'restack-42' as RestackOpId;
    const event = {
      type: 'restack_decision',
      opId,
      child,
      action: 'recorded',
      commit,
      paths: ['src/flag.ts'],
      operator: 'james',
    } satisfies ConductorEvent;

    try {
      persister.start();
      await events.emit(event);

      expect(await persistedEvents(eventsPath)).toEqual([
        {
          type: 'restack_decision',
          opId,
          child: 2,
          action: 'recorded',
          commit,
          paths: ['src/flag.ts'],
          operator: 'james',
        },
      ]);
    } finally {
      persister.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists restack-resolution-stale refusals with their child and detail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'restack-resolution-refusal-'));
    const eventsPath = join(root, '.pipeline', 'events.jsonl');
    await mkdir(join(root, '.pipeline'), { recursive: true });
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
