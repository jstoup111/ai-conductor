// Covers: task:6

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchEngineer, type DispatchEngineerOpts } from '../../../src/engine/engineer-cli.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue, type IntakeQueue } from '../../../src/engine/engineer/intake/queue.js';
import type { Envelope } from '../../../src/engine/engineer/intake/port.js';

const SOURCE = 'github-issues';
let workDir: string;
let engineerDir: string;

function envelope(id: string): Envelope {
  return {
    id,
    source: SOURCE,
    sourceRef: `o/a#${id}`,
    text: `idea ${id}`,
    status: 'pending',
    receivedAt: `2026-10-02T00:00:${id.slice(-2)}.000Z`,
  };
}

function capture(queue?: IntakeQueue) {
  const out: string[] = [];
  const err: string[] = [];
  const ghCalls: string[][] = [];
  const gh: NonNullable<DispatchEngineerOpts['gh']> = async (args) => {
    ghCalls.push(args);
    return { stdout: '[]' };
  };
  const opts: DispatchEngineerOpts = {
    engineerDir,
    gh,
    print: (line) => out.push(line),
    printErr: (line) => err.push(line),
    intakeFileQueue: queue,
  };
  return { out, err, ghCalls, opts };
}

async function strand(queue: IntakeQueue, ledger: ReturnType<typeof createLedger>, item: Envelope): Promise<void> {
  await queue.enqueue(item);
  await queue.claim();
  await ledger.record({ source: item.source, sourceRef: item.sourceRef });
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-claim-strand-faults-'));
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('engineer claim stranded-envelope recovery faults', () => {
  it('deduplicates a recovered strand when its pending copy already exists', async () => {
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const item = envelope('01');
    await strand(queue, ledger, item);
    const claimedPath = join(engineerDir, 'inbox', '2026-10-02T00_00_01.000Z__01.claimed');
    await writeFile(claimedPath, JSON.stringify({ ...item, recoveryMarker: 'from-strand' }));
    await queue.enqueue(item);

    const released: string[] = [];
    const retainingQueue: IntakeQueue = {
      ...queue,
      release: async (entry) => {
        released.push(entry.sourceRef);
        return queue.release(entry);
      },
      // Preserve the final claimed file so the test can distinguish a released
      // strand from the original pending copy after the first walk.
      ack: async () => {},
    };
    const { out, err, opts } = capture(retainingQueue);
    const code = await dispatchEngineer({ kind: 'claim' }, opts);
    const names = await readdir(join(engineerDir, 'inbox'));
    const retained = JSON.parse(await readFile(claimedPath, 'utf8')) as { recoveryMarker?: string };
    const second = capture(retainingQueue);
    const secondCode = await dispatchEngineer({ kind: 'claim' }, second.opts);

    expect({
      code,
      sourceRef: JSON.parse(out[0]).sourceRef,
      pending: await queue.list(),
      released,
      reportedRelease: err.join('\n').includes('released 1 stranded intake claim(s)'),
      names,
      recoveryMarker: retained.recoveryMarker,
      secondCode,
      secondSourceRef: JSON.parse(second.out[0]).sourceRef,
    }).toEqual({
      code: 0,
      sourceRef: item.sourceRef,
      pending: [],
      released: [item.sourceRef],
      reportedRelease: true,
      names: ['2026-10-02T00_00_01.000Z__01.claimed'],
      recoveryMarker: 'from-strand',
      secondCode: 0,
      secondSourceRef: undefined,
    });
  });

  it('refuses a non-ENOENT strand release before walking, then another claim recovers the remaining strand', async () => {
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const blocked = envelope('02');
    const recoverable = envelope('03');
    await strand(queue, ledger, blocked);
    await strand(queue, ledger, recoverable);
    const blockedPendingPath = join(engineerDir, 'inbox', '2026-10-02T00_00_02.000Z__02.json');
    await mkdir(blockedPendingPath);
    await writeFile(join(blockedPendingPath, 'blocker'), 'x');

    const first = capture();
    const firstCode = await dispatchEngineer({ kind: 'claim' }, first.opts);
    await rm(blockedPendingPath, { recursive: true });
    const second = capture();
    const secondCode = await dispatchEngineer({ kind: 'claim' }, second.opts);

    expect({
      firstCode,
      namesBlocked: first.err.join('\n').includes(blocked.sourceRef),
      ghCalls: first.ghCalls,
      secondCode,
      sourceRef: JSON.parse(second.out[0]).sourceRef,
      remaining: (await queue.list()).map(({ sourceRef }) => sourceRef),
    }).toEqual({
      firstCode: 1,
      namesBlocked: true,
      ghCalls: [],
      secondCode: 0,
      sourceRef: blocked.sourceRef,
      remaining: [recoverable.sourceRef],
    });
  });

  it('skips a claimed envelope deleted after listing and recovers the remaining strand', async () => {
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const vanished = envelope('04');
    const recovered = envelope('05');
    await strand(queue, ledger, vanished);
    await strand(queue, ledger, recovered);
    let removed = false;
    const deletingQueue: IntakeQueue = {
      ...queue,
      release: async (item) => {
        if (!removed) {
          removed = true;
          await rm(join(engineerDir, 'inbox', '2026-10-02T00_00_04.000Z__04.claimed'));
        }
        return queue.release(item);
      },
    };

    const { out, opts } = capture(deletingQueue);
    const code = await dispatchEngineer({ kind: 'claim' }, opts);

    expect({ code, sourceRef: JSON.parse(out[0]).sourceRef }).toEqual({ code: 0, sourceRef: recovered.sourceRef });
  });

  it.each([
    ['invalid', 'not json'],
    ['ambiguous', JSON.stringify({ version: 1, pid: 0, token: 'owner', acquiredAt: '2026-10-02T00:00:00.000Z' })],
  ])('fails closed on %s lease metadata before any inbox rename or walk', async (_kind, owner) => {
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const item = envelope('06');
    await strand(queue, ledger, item);
    await mkdir(join(engineerDir, 'inbox.lease'));
    await writeFile(join(engineerDir, 'inbox.lease', 'owner.json'), owner);

    const { err, ghCalls, opts } = capture();
    const code = await dispatchEngineer({ kind: 'claim' }, opts);

    expect({ code, namesLease: err.join('\n').includes('intake claim lease'), ghCalls, inbox: await readdir(join(engineerDir, 'inbox')) }).toEqual({
      code: 1,
      namesLease: true,
      ghCalls: [],
      inbox: ['2026-10-02T00_00_06.000Z__06.claimed'],
    });
  });

  it('reports corrupt-ledger failure before renaming or recovering any strand', async () => {
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const item = envelope('07');
    await queue.enqueue(item);
    await queue.claim();
    await writeFile(join(engineerDir, 'ledger.json'), 'not json');

    const { err, ghCalls, opts } = capture();
    const code = await dispatchEngineer({ kind: 'claim' }, opts);

    expect({ code, corrupt: err.join('\n').includes('intake ledger is corrupt'), ghCalls, inbox: await readdir(join(engineerDir, 'inbox')) }).toEqual({
      code: 1,
      corrupt: true,
      ghCalls: [],
      inbox: ['2026-10-02T00_00_07.000Z__07.claimed'],
    });
  });
});
