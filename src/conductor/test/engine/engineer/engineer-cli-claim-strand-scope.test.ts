// Covers: task:7

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchEngineer, type DispatchEngineerOpts } from '../../../src/engine/engineer-cli.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue } from '../../../src/engine/engineer/intake/queue.js';
import type { Envelope } from '../../../src/engine/engineer/intake/port.js';

const SOURCE = 'github-issues';

let workDir: string;
let engineerDir: string;

function makeEnvelope(id: string, sourceRef = `o/a#${id}`): Envelope {
  return {
    id,
    source: SOURCE,
    sourceRef,
    text: `idea ${id}`,
    status: 'pending',
    receivedAt: `2026-10-01T00:00:${id.padStart(2, '0')}.000Z`,
  };
}

function makeGh() {
  const calls: string[][] = [];
  const gh = async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return { stdout: '[]' };
    return { stdout: JSON.stringify({ labels: [] }) };
  };
  return { calls, gh };
}

function captureOpts(gh: DispatchEngineerOpts['gh']) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    opts: {
      engineerDir,
      gh,
      print: (line) => out.push(line),
      printErr: (line) => err.push(line),
    } satisfies DispatchEngineerOpts,
  };
}

async function strand(queue: ReturnType<typeof createFileQueue>, envelope: Envelope): Promise<void> {
  await queue.enqueue(envelope);
  await queue.claim();
}

async function claimedBytes(inbox: string): Promise<Map<string, Buffer>> {
  const bytes = new Map<string, Buffer>();
  for (const filename of await readdir(inbox)) {
    if (filename.endsWith('.claimed')) bytes.set(filename, await readFile(join(inbox, filename)));
  }
  return bytes;
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-claim-strand-scope-'));
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('engineer claim stranded-envelope recovery scope (Task 7)', () => {
  it('recovers only pending-ledger strands and never reads or serves claimed, done, or absent strands', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const pending = makeEnvelope('01');
    const claimed = makeEnvelope('02');
    const done = makeEnvelope('03');
    const absent = makeEnvelope('04');

    await ledger.record({ source: SOURCE, sourceRef: pending.sourceRef });
    await ledger.record({ source: SOURCE, sourceRef: claimed.sourceRef });
    await ledger.transition(SOURCE, claimed.sourceRef, 'claimed');
    await ledger.record({ source: SOURCE, sourceRef: done.sourceRef });
    await ledger.transition(SOURCE, done.sourceRef, 'done');
    for (const entry of [pending, claimed, done, absent]) {
      await strand(queue, entry);
    }

    const beforeLedger = await ledger.list();
    const beforeClaimed = await claimedBytes(join(engineerDir, 'inbox'));
    const { calls, gh } = makeGh();
    const { out, err, opts } = captureOpts(gh);

    const code = await dispatchEngineer({ kind: 'claim' }, opts);

    expect(code).toBe(0);
    expect(JSON.parse(out[0] ?? '')).toMatchObject({ kind: 'claim', sourceRef: pending.sourceRef });
    expect(err.filter((line) => line.includes('stranded intake claim')))
      .toEqual(['released 1 stranded intake claim(s)']);
    const afterClaimed = await claimedBytes(join(engineerDir, 'inbox'));
    for (const [filename, bytes] of beforeClaimed) {
      if (!filename.includes(`__${pending.id}.claimed`)) {
        expect(afterClaimed.get(filename)).toEqual(bytes);
      }
    }

    const labelReads = calls
      .filter((args) => args[0] === 'api' && args[1]?.includes('/issues/'))
      .map((args) => args[1]);
    expect(labelReads).toEqual(expect.arrayContaining([
      `repos/o/a/issues/${pending.id}`,
      `repos/o/a/issues/${pending.id}/dependencies/blocked_by`,
    ]));
    for (const envelope of [claimed, done]) {
      expect(JSON.stringify(calls)).not.toContain(`/issues/${envelope.id}`);
      expect(JSON.stringify(out)).not.toContain(envelope.sourceRef);
    }

    const afterLedger = await ledger.list();
    for (const entry of beforeLedger) {
      if (entry.sourceRef !== pending.sourceRef) {
        expect(afterLedger.find((candidate) => candidate.sourceRef === entry.sourceRef)).toEqual(entry);
      }
    }
    expect(afterLedger.find((entry) => entry.sourceRef === pending.sourceRef)?.status).toBe('claimed');
  });

  it('leaves ledger bytes unchanged when recovery ends in an empty claim', async () => {
    const ledgerPath = join(engineerDir, 'ledger.json');
    const ledger = createLedger(ledgerPath);
    await ledger.record({ source: SOURCE, sourceRef: 'o/a#11' });
    await ledger.transition(SOURCE, 'o/a#11', 'claimed');
    const before = await readFile(ledgerPath);
    const { gh } = makeGh();
    const { out, opts } = captureOpts(gh);

    const code = await dispatchEngineer({ kind: 'claim' }, opts);

    expect(code).toBe(0);
    expect(JSON.parse(out[0] ?? '')).toMatchObject({ kind: 'claim', empty: true });
    expect(await readFile(ledgerPath)).toEqual(before);
  });

  it('leaves ledger bytes unchanged when a recovered strand is all-blocked', async () => {
    const ledgerPath = join(engineerDir, 'ledger.json');
    const ledger = createLedger(ledgerPath);
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const blocked = makeEnvelope('12', 'not-a-github-reference');
    await ledger.record({ source: SOURCE, sourceRef: blocked.sourceRef });
    await strand(queue, blocked);
    const before = await readFile(ledgerPath);
    const { gh } = makeGh();
    const { out, err, opts } = captureOpts(gh);

    const code = await dispatchEngineer({ kind: 'claim' }, opts);

    expect(code).toBe(0);
    expect(JSON.parse(out[0] ?? '')).toMatchObject({ kind: 'claim', allBlocked: true });
    expect(err.filter((line) => line.includes('stranded intake claim')))
      .toEqual(['released 1 stranded intake claim(s)']);
    expect(await readFile(ledgerPath)).toEqual(before);
  });
});
