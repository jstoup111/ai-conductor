// Acceptance: file-backed IntakeQueue (FR-29/30, ADR-011, Stories 5/6) + C1 isolation.
// RED until intake/queue.ts exists. Claim uses its OWN atomic primitive — never daemon-lock.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function loadQueue() {
  return import('../../../../src/engine/engineer/intake/queue.js') as Promise<any>;
}

function env(sourceRef: string, receivedAt: string) {
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
  dir = await mkdtemp(join(tmpdir(), 'queue-acc-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FR-29 durable inbox', () => {
  it('persists an enqueued Envelope across a fresh queue over the same dir', async () => {
    const { createFileQueue } = await loadQueue();
    const a = createFileQueue(join(dir, 'inbox'));
    await a.enqueue(env('o/a#1', '2026-06-27T00:00:00.000Z'));
    const b = createFileQueue(join(dir, 'inbox'));
    const claimed = await b.claim();
    expect(claimed?.sourceRef).toBe('o/a#1');
  });

  it('auto-creates a missing inbox dir on first enqueue', async () => {
    const { createFileQueue } = await loadQueue();
    const q = createFileQueue(join(dir, 'nested', 'inbox'));
    await expect(q.enqueue(env('o/a#1', '2026-06-27T00:00:00.000Z'))).resolves.not.toThrow();
  });

  it('surfaces a corrupt inbox entry as an error without losing valid entries', async () => {
    const { createFileQueue } = await loadQueue();
    const q = createFileQueue(join(dir, 'inbox'));
    await q.enqueue(env('o/a#1', '2026-06-27T00:00:00.000Z'));
    await writeFile(join(dir, 'inbox', 'corrupt.json'), '{ not json');
    await expect(q.claim()).rejects.toThrow(/inbox|corrupt|parse/i);
  });
});

describe('FR-30 claim/ack/release', () => {
  it('claim returns the oldest by receivedAt and ack marks it done', async () => {
    const { createFileQueue } = await loadQueue();
    const q = createFileQueue(join(dir, 'inbox'));
    await q.enqueue(env('o/a#3', '2026-06-27T00:00:03.000Z'));
    await q.enqueue(env('o/a#1', '2026-06-27T00:00:01.000Z'));
    await q.enqueue(env('o/a#2', '2026-06-27T00:00:02.000Z'));
    const first = await q.claim();
    expect(first?.sourceRef).toBe('o/a#1');
    await q.ack(first);
    const second = await q.claim();
    expect(second?.sourceRef).toBe('o/a#2');
  });

  it('two concurrent claims on one Envelope yield exactly one winner', async () => {
    const { createFileQueue } = await loadQueue();
    const q = createFileQueue(join(dir, 'inbox'));
    await q.enqueue(env('o/a#1', '2026-06-27T00:00:00.000Z'));
    const [c1, c2] = await Promise.all([q.claim(), q.claim()]);
    const winners = [c1, c2].filter((c) => c?.sourceRef === 'o/a#1');
    expect(winners.length).toBe(1);
  });

  it('a claimed-but-unacked Envelope is reclaimable via release', async () => {
    const { createFileQueue } = await loadQueue();
    const q = createFileQueue(join(dir, 'inbox'));
    await q.enqueue(env('o/a#1', '2026-06-27T00:00:00.000Z'));
    const claimed = await q.claim();
    await q.release(claimed);
    const reclaimed = await q.claim();
    expect(reclaimed?.sourceRef).toBe('o/a#1');
  });

  it('returns nothing when the inbox is empty', async () => {
    const { createFileQueue } = await loadQueue();
    const q = createFileQueue(join(dir, 'inbox'));
    expect(await q.claim()).toBeFalsy();
  });
});

describe('C1 claim isolated from the daemon O_EXCL lock', () => {
  it('intake/queue.ts does not import daemon-lock', () => {
    const src = readFileSync(
      join(__dirname, '../../../../src/engine/engineer/intake/queue.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/daemon-lock/);
  });
});
