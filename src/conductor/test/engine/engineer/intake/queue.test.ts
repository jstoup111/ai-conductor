// Covers: task:2
// Unit: FileIntakeQueue.listClaimed() plus existing IntakeQueue.list()/remove() behavior.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileQueue } from '../../../../src/engine/engineer/intake/queue.js';
import type { Envelope } from '../../../../src/engine/engineer/intake/port.js';

const readBoundary = vi.hoisted(() => ({
  deleteClaimedFile: false,
  deleted: false,
  error: null as Error | null,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    async readFile(...args: Parameters<typeof actual.readFile>) {
      const path = args[0];
      if (readBoundary.error && typeof path === 'string' && path.endsWith('.claimed')) {
        throw readBoundary.error;
      }
      if (readBoundary.deleteClaimedFile && !readBoundary.deleted && typeof path === 'string' && path.endsWith('.claimed')) {
        readBoundary.deleted = true;
        await actual.unlink(path);
      }
      return actual.readFile(...args);
    },
  };
});

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
  readBoundary.deleteClaimedFile = false;
  readBoundary.deleted = false;
  readBoundary.error = null;
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

describe('FileIntakeQueue.listClaimed', () => {
  it('returns sorted claimed envelopes and excludes pending envelopes', async () => {
    const q = createFileQueue(join(dir, 'inbox'));
    const older = env('o/a#1', '2026-06-27T00:00:01.000Z');
    const newer = env('o/a#2', '2026-06-27T00:00:02.000Z');
    const pending = env('o/a#3', '2026-06-27T00:00:03.000Z');
    await q.enqueue(older);
    await q.enqueue(newer);
    await q.enqueue(pending);
    await q.claim();
    await q.claim();

    await expect(q.listClaimed()).resolves.toEqual([older, newer]);
  });

  it('skips a claimed envelope deleted after discovery', async () => {
    const q = createFileQueue(join(dir, 'inbox'));
    const vanished = env('o/a#1', '2026-06-27T00:00:01.000Z');
    const retained = env('o/a#2', '2026-06-27T00:00:02.000Z');
    await q.enqueue(vanished);
    await q.enqueue(retained);
    await q.claim();
    await q.claim();

    readBoundary.deleteClaimedFile = true;
    await expect(q.listClaimed()).resolves.toEqual([retained]);
  });

  it('propagates a non-ENOENT error while reading a claimed envelope', async () => {
    const q = createFileQueue(join(dir, 'inbox'));
    const claimed = env('o/a#1', '2026-06-27T00:00:01.000Z');
    await q.enqueue(claimed);
    await q.claim();
    const error = Object.assign(new Error('read failed'), { code: 'EIO' });

    readBoundary.error = error;
    await expect(q.listClaimed()).rejects.toBe(error);
  });
});
