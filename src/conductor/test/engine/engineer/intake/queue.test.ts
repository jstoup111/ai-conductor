// Unit: IntakeQueue.list()/remove() for pending envelopes (Task 3).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileQueue } from '../../../../src/engine/engineer/intake/queue.js';
import type { Envelope } from '../../../../src/engine/engineer/intake/port.js';

function env(sourceRef: string, receivedAt: string): Envelope {
  return {
    id: sourceRef,
    source: 'github-issues',
    sourceRef,
    text: `idea ${sourceRef}`,
    status: 'pending',
    receivedAt,
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'queue-list-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('IntakeQueue.list/remove', () => {
  it('list() returns all pending envelopes; remove() unlinks one and it is omitted afterward', async () => {
    const q = createFileQueue(join(dir, 'inbox'));
    const a = env('o/a#1', '2026-06-27T00:00:01.000Z');
    const b = env('o/a#2', '2026-06-27T00:00:02.000Z');
    await q.enqueue(a);
    await q.enqueue(b);

    const before = await q.list();
    expect(before.map((e) => e.sourceRef).sort()).toEqual(['o/a#1', 'o/a#2']);

    await q.remove(a);

    const after = await q.list();
    expect(after.map((e) => e.sourceRef)).toEqual(['o/a#2']);
  });

  it('remove() of an already-absent envelope is a benign no-op', async () => {
    const q = createFileQueue(join(dir, 'inbox'));
    const a = env('o/a#1', '2026-06-27T00:00:01.000Z');
    await expect(q.remove(a)).resolves.not.toThrow();
  });
});
