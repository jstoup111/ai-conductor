// Covers: task:4

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const renameSpy = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      renameSpy(...args);
      return actual.rename(...args);
    },
  };
});

import { dispatchEngineer, type DispatchEngineerOpts } from '../../../src/engine/engineer-cli.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue } from '../../../src/engine/engineer/intake/queue.js';
import type { Envelope } from '../../../src/engine/engineer/intake/port.js';

const SOURCE = 'github-issues';

let workDir: string;
let engineerDir: string;

function envelope(id: string, receivedAt: string): Envelope {
  return {
    id,
    source: SOURCE,
    sourceRef: `o/a#${id}`,
    text: `idea ${id}`,
    status: 'pending',
    receivedAt,
  };
}

function gh(args: string[]) {
  if (args[0] === 'issue' && args[1] === 'list') return Promise.resolve({ stdout: '[]' });
  return Promise.resolve({ stdout: '{}' });
}

function captureOpts() {
  const out: string[] = [];
  const err: string[] = [];
  const opts: DispatchEngineerOpts = {
    engineerDir,
    gh,
    print: (line) => out.push(line),
    printErr: (line) => err.push(line),
  };
  return { out, err, opts };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-claim-strand-recovery-'));
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
  renameSpy.mockClear();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('engineer claim stranded-envelope recovery', () => {
  it('releases pending-ledger strands before the guarded claim walk and reports their count once', async () => {
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const stranded = envelope('701', '2026-10-01T00:00:00.000Z');
    const later = envelope('702', '2026-10-01T00:01:00.000Z');
    await queue.enqueue(stranded);
    await queue.enqueue(later);
    await queue.claim();
    await ledger.record({ source: SOURCE, sourceRef: stranded.sourceRef });
    await ledger.record({ source: SOURCE, sourceRef: later.sourceRef });

    const { out, err, opts } = captureOpts();
    const code = await dispatchEngineer({ kind: 'claim' }, opts);

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: stranded.sourceRef });
    expect(err.filter((line) => line.includes('stranded intake claim')))
      .toEqual(['released 1 stranded intake claim(s)']);
    expect((await queue.list()).map(({ sourceRef }) => sourceRef)).toEqual([later.sourceRef]);
    expect((await queue.listClaimed()).map(({ sourceRef }) => sourceRef)).toEqual([]);
    expect((await ledger.get(SOURCE, stranded.sourceRef))?.status).toBe('claimed');
  });

  it('recovers a later critical strand before the walk and claims it ahead of an earlier low entry', async () => {
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const low = envelope('705', '2026-10-01T00:00:00.000Z');
    const critical = envelope('706', '2026-10-01T00:01:00.000Z');
    await queue.enqueue(low);
    await queue.enqueue(critical);
    await queue.claim();
    await queue.claim();
    await queue.release(low);
    await ledger.record({ source: SOURCE, sourceRef: critical.sourceRef });

    const labelReadRefs: string[] = [];
    const labels: Record<string, string> = {
      [low.sourceRef]: 'priority: low',
      [critical.sourceRef]: 'priority: critical',
    };
    const { out, opts } = captureOpts();
    opts.gh = async (args) => {
      const endpoint = args[1] ?? '';
      const issueMatch = /^repos\/o\/a\/issues\/(\d+)$/.exec(endpoint);
      if (args[0] === 'api' && issueMatch) {
        const sourceRef = `o/a#${issueMatch[1]}`;
        labelReadRefs.push(sourceRef);
        return { stdout: JSON.stringify({ labels: [{ name: labels[sourceRef] }] }) };
      }
      return { stdout: '[]' };
    };

    const code = await dispatchEngineer({ kind: 'claim' }, opts);
    const recoveredRefs = [critical.sourceRef];

    expect(code).toBe(0);
    expect(recoveredRefs.every((sourceRef) => labelReadRefs.includes(sourceRef))).toBe(true);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: critical.sourceRef });
  });

  it('recovers a dead lease owner and strands before claiming, then releases the lease', async () => {
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const winner = envelope('707', '2026-10-01T00:00:00.000Z');
    const remaining = envelope('708', '2026-10-01T00:01:00.000Z');
    await queue.enqueue(winner);
    await queue.enqueue(remaining);
    await queue.claim();
    await queue.claim();
    await ledger.record({ source: SOURCE, sourceRef: winner.sourceRef });
    await ledger.record({ source: SOURCE, sourceRef: remaining.sourceRef });
    await mkdir(join(engineerDir, 'inbox.lease'));
    await writeFile(join(engineerDir, 'inbox.lease', 'owner.json'), JSON.stringify({
      version: 1,
      pid: 999_999_999,
      token: 'dead-owner',
      acquiredAt: '2026-10-01T00:00:00.000Z',
    }));

    const { out, err, opts } = captureOpts();
    const code = await dispatchEngineer({ kind: 'claim' }, opts);

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: winner.sourceRef });
    await expect(stat(join(engineerDir, 'inbox.lease'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await queue.list()).map(({ sourceRef }) => sourceRef)).toEqual([remaining.sourceRef]);
    expect((await queue.listClaimed()).map(({ sourceRef }) => sourceRef)).toEqual([]);
    expect(err.filter((line) => line.includes('stranded intake claim')))
      .toEqual(['released 2 stranded intake claim(s)']);
  });

  it('does not rename an inbox file before the claim walk when no strands need recovery', async () => {
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const first = envelope('703', '2026-10-01T00:00:00.000Z');
    const later = envelope('704', '2026-10-01T00:01:00.000Z');
    await queue.enqueue(first);
    await queue.enqueue(later);
    await ledger.record({ source: SOURCE, sourceRef: first.sourceRef });
    await ledger.record({ source: SOURCE, sourceRef: later.sourceRef });
    renameSpy.mockClear();

    const { out, err, opts } = captureOpts();
    const code = await dispatchEngineer({ kind: 'claim' }, opts);

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: first.sourceRef });
    expect((await queue.list()).map(({ sourceRef }) => sourceRef)).toEqual([later.sourceRef]);
    expect(err.filter((line) => line.includes('stranded intake claim'))).toEqual([]);

    const inboxRenames = renameSpy.mock.calls.filter(([from, to]) =>
      typeof from === 'string' && typeof to === 'string' && from.includes('/inbox/') && to.includes('/inbox/'),
    );
    expect(inboxRenames.map(([from, to]) => [basename(String(from)), basename(String(to))])).toEqual([
      ['2026-10-01T00_00_00.000Z__703.json', '2026-10-01T00_00_00.000Z__703.claimed'],
      ['2026-10-01T00_01_00.000Z__704.json', '2026-10-01T00_01_00.000Z__704.claimed'],
      ['2026-10-01T00_01_00.000Z__704.claimed', '2026-10-01T00_01_00.000Z__704.json'],
    ]);
  });
});
