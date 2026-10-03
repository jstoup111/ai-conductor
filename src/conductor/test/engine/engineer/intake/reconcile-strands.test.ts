// Covers: task:3

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CorruptLedgerError, createLedger } from '../../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue, type IntakeQueue } from '../../../../src/engine/engineer/intake/queue.js';
import { reconcileStrandedClaims } from '../../../../src/engine/engineer/intake/reconcile-strands.js';
import type { Envelope } from '../../../../src/engine/engineer/intake/port.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reconcile-strands-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('reconcileStrandedClaims', () => {
  it('releases a pending-ledger claim through an in-memory IntakeQueue', async () => {
    const envelope: Envelope = {
      id: 'in-memory#1',
      source: 'github-issues',
      sourceRef: 'o/a#1',
      text: 'claimed claim',
      status: 'pending',
      receivedAt: '2026-10-02T00:00:01.000Z',
    };
    const claimed = [envelope];
    const pending: Envelope[] = [];
    const ledger = createLedger(join(dir, 'ledger.json'));
    const queue: IntakeQueue = {
      enqueue: async (entry) => { pending.push(entry); },
      claim: async () => pending.shift() ?? null,
      ack: async () => undefined,
      release: async (entry) => {
        claimed.splice(claimed.indexOf(entry), 1);
        pending.push(entry);
      },
      list: async () => pending,
      listClaimed: async () => claimed,
      remove: async (entry) => {
        const index = pending.indexOf(entry);
        if (index !== -1) pending.splice(index, 1);
      },
    };
    await ledger.record({ source: envelope.source, sourceRef: envelope.sourceRef });

    const result = await reconcileStrandedClaims({ queue, ledger });

    expect({ result, claimed, pending }).toEqual({
      result: { released: ['o/a#1'] },
      claimed: [],
      pending: [envelope],
    });
  });

  it('releases only pending claimed envelopes and returns their sourceRefs', async () => {
    const queue = createFileQueue(join(dir, 'inbox'));
    const ledger = createLedger(join(dir, 'ledger.json'));
    const envelopes: Envelope[] = ['pending', 'claimed', 'done', 'absent'].map((ledgerStatus, index) => ({
      id: `o/a#${index + 1}`,
      source: 'github-issues',
      sourceRef: `o/a#${index + 1}`,
      text: `${ledgerStatus} claim`,
      status: 'pending',
      receivedAt: `2026-10-02T00:00:0${index}.000Z`,
    }));

    for (const envelope of envelopes) await queue.enqueue(envelope);
    for (const _ of envelopes) await queue.claim();

    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#2' });
    await ledger.transition('github-issues', 'o/a#2', 'claimed');
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#3' });
    await ledger.transition('github-issues', 'o/a#3', 'claimed');
    await ledger.transition('github-issues', 'o/a#3', 'done');

    const result = await reconcileStrandedClaims({ queue, ledger });

    expect({
      released: result.released,
      claimable: (await queue.list()).map(({ sourceRef }) => sourceRef),
      claimed: (await queue.listClaimed()).map(({ sourceRef }) => sourceRef),
    }).toEqual({
      released: ['o/a#1'],
      claimable: ['o/a#1'],
      claimed: ['o/a#2', 'o/a#3', 'o/a#4'],
    });
  });

  it('reads the ledger once before releasing matching strands', async () => {
    const queue = createFileQueue(join(dir, 'inbox'));
    const realLedger = createLedger(join(dir, 'ledger.json'));
    const envelope: Envelope = {
      id: 'o/a#1',
      source: 'github-issues',
      sourceRef: 'o/a#1',
      text: 'claimed claim',
      status: 'pending',
      receivedAt: '2026-10-02T00:00:01.000Z',
    };
    const trace: string[] = [];
    await queue.enqueue(envelope);
    await queue.claim();
    await realLedger.record({ source: envelope.source, sourceRef: envelope.sourceRef });

    const result = await reconcileStrandedClaims({
      queue: { ...queue, release: async (claimed) => {
        trace.push(`release:${claimed.sourceRef}`);
        return queue.release(claimed);
      } },
      ledger: { ...realLedger, list: async () => {
        trace.push('list');
        return realLedger.list();
      } },
    });

    expect({ result, trace }).toEqual({ result: { released: ['o/a#1'] }, trace: ['list', 'release:o/a#1'] });
  });

  it('ignores a vanished claimed file and releases the remaining matching strand', async () => {
    const queue = createFileQueue(join(dir, 'inbox'));
    const ledger = createLedger(join(dir, 'ledger.json'));
    for (const index of [1, 2]) {
      const envelope: Envelope = {
        id: `o/a#${index}`,
        source: 'github-issues',
        sourceRef: `o/a#${index}`,
        text: 'claimed claim',
        status: 'pending',
        receivedAt: `2026-10-02T00:00:0${index}.000Z`,
      };
      await queue.enqueue(envelope);
      await queue.claim();
      await ledger.record({ source: envelope.source, sourceRef: envelope.sourceRef });
    }
    let releaseCalls = 0;

    const result = await reconcileStrandedClaims({
      queue: { ...queue, release: async (claimed) => {
        releaseCalls += 1;
        if (releaseCalls === 1) throw Object.assign(new Error('claimed file vanished'), { code: 'ENOENT' });
        return queue.release(claimed);
      } },
      ledger,
    });

    expect(result.released).toEqual(['o/a#2']);
  });

  it('names the source reference and release failure when a claimed file cannot be released', async () => {
    const queue = createFileQueue(join(dir, 'inbox'));
    const ledger = createLedger(join(dir, 'ledger.json'));
    const envelope: Envelope = {
      id: 'o/a#1', source: 'github-issues', sourceRef: 'o/a#1', text: 'claimed claim', status: 'pending', receivedAt: '2026-10-02T00:00:01.000Z',
    };
    await queue.enqueue(envelope);
    await queue.claim();
    await ledger.record({ source: envelope.source, sourceRef: envelope.sourceRef });

    await expect(reconcileStrandedClaims({
      queue: { ...queue, release: async () => { throw new Error('EACCES: denied opening envelope.claimed'); } },
      ledger,
    })).rejects.toThrow(/(?=.*o\/a#1)(?=.*EACCES)/);
  });

  it('propagates a corrupt ledger read without releasing a claim', async () => {
    const queue = createFileQueue(join(dir, 'inbox'));
    const ledger = createLedger(join(dir, 'ledger.json'));
    const error = new CorruptLedgerError(join(dir, 'ledger.json'), 'invalid JSON');
    let releases = 0;

    const outcome = await reconcileStrandedClaims({
      queue: { ...queue, release: async () => { releases += 1; } },
      ledger: { ...ledger, list: async () => { throw error; } },
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect({ outcome, releases }).toEqual({ outcome: error, releases: 0 });
  });

  it('does not change fixture ledger bytes while reconciling a stranded claim', async () => {
    const queue = createFileQueue(join(dir, 'inbox'));
    const ledgerPath = join(dir, 'ledger.json');
    const ledger = createLedger(ledgerPath);
    const envelope: Envelope = {
      id: 'o/a#1', source: 'github-issues', sourceRef: 'o/a#1', text: 'claimed claim', status: 'pending', receivedAt: '2026-10-02T00:00:01.000Z',
    };
    await queue.enqueue(envelope);
    await queue.claim();
    await ledger.record({ source: envelope.source, sourceRef: envelope.sourceRef });
    const before = await readFile(ledgerPath);

    await reconcileStrandedClaims({ queue, ledger });

    expect(await readFile(ledgerPath)).toEqual(before);
  });
});
