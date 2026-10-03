// Covers: task:5

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const resolverControl = vi.hoisted(() => ({ throwOnResolve: false }));

vi.mock('../../../src/engine/blocker-resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/blocker-resolver.js')>();
  return {
    ...actual,
    createBlockerResolver: (...args: Parameters<typeof actual.createBlockerResolver>) => {
      if (resolverControl.throwOnResolve) {
        return { resolve: async () => { throw new Error('injected resolver failure'); } };
      }
      return actual.createBlockerResolver(...args);
    },
  };
});

import { dispatchEngineer, type DispatchEngineerOpts } from '../../../src/engine/engineer-cli.js';
import { createConductStateLease } from '../../../src/engine/conduct-state-lease.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue } from '../../../src/engine/engineer/intake/queue.js';
import type { Envelope } from '../../../src/engine/engineer/intake/port.js';

const SOURCE = 'github-issues';
const HOLDER_PID = process.pid;

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

async function seed(...entries: Envelope[]): Promise<ReturnType<typeof createFileQueue>> {
  const queue = createFileQueue(join(engineerDir, 'inbox'));
  const ledger = createLedger(join(engineerDir, 'ledger.json'));
  for (const entry of entries) {
    await queue.enqueue(entry);
    await ledger.record({ source: entry.source, sourceRef: entry.sourceRef });
  }
  return queue;
}

function claimOptions(options: { blocked?: boolean; waitMs?: number } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[][] = [];
  const gh: DispatchEngineerOpts['gh'] = async (args) => {
    calls.push(args);
    if (args.at(-1)?.endsWith('/dependencies/blocked_by')) {
      return {
        stdout: options.blocked
          ? JSON.stringify([{ number: 999, repository_url: 'https://api.github.com/repos/o/a', state: 'open' }])
          : '[]',
      };
    }
    return { stdout: JSON.stringify({ labels: [] }) };
  };
  return {
    out,
    err,
    calls,
    opts: {
      engineerDir,
      gh,
      intakeClaimLeaseWaitMs: options.waitMs,
      print: (line: string) => out.push(line),
      printErr: (line: string) => err.push(line),
    } satisfies DispatchEngineerOpts,
  };
}

async function inboxNames(): Promise<string[]> {
  return (await readdir(join(engineerDir, 'inbox'))).sort();
}

async function assertLeaseAbsent(): Promise<void> {
  await expect(stat(join(engineerDir, 'inbox.lease'))).rejects.toMatchObject({ code: 'ENOENT' });
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-claim-lease-contention-'));
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
  resolverControl.throwOnResolve = false;
});

afterEach(async () => {
  resolverControl.throwOnResolve = false;
  await rm(workDir, { recursive: true, force: true });
});

describe('engineer claim intake lease contention', () => {
  it('does not walk B while A owns the inbox lease, then gives B a different entry after A releases', async () => {
    const first = envelope('501', '2026-10-03T00:00:00.000Z');
    const second = envelope('502', '2026-10-03T00:01:00.000Z');
    const queue = await seed(first, second);
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const holder = await createConductStateLease(join(engineerDir, 'inbox'), {
      label: 'intake claim', pid: HOLDER_PID, processIsLive: () => true,
    }).acquire();
    if (!holder.ok) throw new Error(holder.message);

    // Claim A while it owns the lease, so B must receive the other ref once it enters.
    const held = await queue.claim();
    if (!held) throw new Error('fixture did not provide claim A');
    await queue.ack(held);
    await ledger.transition(held.source, held.sourceRef, 'claimed');
    const beforeInbox = await inboxNames();
    const beforeLedger = await readFile(join(engineerDir, 'ledger.json'), 'utf8');
    const contender = claimOptions({ waitMs: 500 });
    let settled = false;
    const claimB = dispatchEngineer({ kind: 'claim' }, contender.opts).finally(() => { settled = true; });

    // B has only been allowed to reach lease acquisition; it cannot touch claim state.
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(await inboxNames()).toEqual(beforeInbox);
    expect(await readFile(join(engineerDir, 'ledger.json',), 'utf8')).toBe(beforeLedger);
    expect(contender.calls).toEqual([]);

    await holder.handle.release();
    expect(await claimB).toBe(0);
    expect(JSON.parse(contender.out[0])).toMatchObject({ kind: 'claim', sourceRef: second.sourceRef });
    expect(contender.err.filter((line) => line.includes('stranded intake claim'))).toEqual([]);
    await assertLeaseAbsent();
  });

  it('reports a live holder pid on timeout without changing the inbox or ledger', async () => {
    await seed(envelope('503', '2026-10-03T00:00:00.000Z'));
    const holder = await createConductStateLease(join(engineerDir, 'inbox'), {
      label: 'intake claim', pid: HOLDER_PID, processIsLive: () => true,
    }).acquire();
    if (!holder.ok) throw new Error(holder.message);
    const beforeInbox = await inboxNames();
    const beforeLedger = await readFile(join(engineerDir, 'ledger.json'), 'utf8');
    const contender = claimOptions({ waitMs: 0 });

    try {
      await expect(dispatchEngineer({ kind: 'claim' }, contender.opts))
        .rejects.toThrow(new RegExp(`claim in progress.*${HOLDER_PID}`));
      expect(await inboxNames()).toEqual(beforeInbox);
      expect(await readFile(join(engineerDir, 'ledger.json'), 'utf8')).toBe(beforeLedger);
      expect(contender.calls).toEqual([]);
    } finally {
      await holder.handle.release();
    }
  });

  it('releases the lease after claim, empty, and all-blocked outcomes so a following claim acquires', async () => {
    const claimed = envelope('504', '2026-10-03T00:00:00.000Z');
    await seed(claimed);
    const successful = claimOptions();
    expect(await dispatchEngineer({ kind: 'claim' }, successful.opts)).toBe(0);
    await assertLeaseAbsent();

    const empty = claimOptions({ waitMs: 0 });
    expect(await dispatchEngineer({ kind: 'claim' }, empty.opts)).toBe(0);
    expect(JSON.parse(empty.out[0])).toMatchObject({ kind: 'claim', empty: true });
    await assertLeaseAbsent();

    await seed(envelope('505', '2026-10-03T00:01:00.000Z'));
    const blocked = claimOptions({ blocked: true });
    expect(await dispatchEngineer({ kind: 'claim' }, blocked.opts)).toBe(0);
    expect(JSON.parse(blocked.out[0])).toMatchObject({ kind: 'claim', allBlocked: true });
    await assertLeaseAbsent();

    const following = claimOptions({ blocked: true, waitMs: 0 });
    expect(await dispatchEngineer({ kind: 'claim' }, following.opts)).toBe(0);
    await assertLeaseAbsent();
  });

  it('releases its lease and every drained envelope when the resolver throws', async () => {
    const first = envelope('506', '2026-10-03T00:00:00.000Z');
    const second = envelope('507', '2026-10-03T00:01:00.000Z');
    await seed(first, second);
    resolverControl.throwOnResolve = true;
    const failing = claimOptions();

    await expect(dispatchEngineer({ kind: 'claim' }, failing.opts))
      .rejects.toThrow('injected resolver failure');
    expect(await inboxNames()).toEqual([
      '2026-10-03T00_00_00.000Z__506.json',
      '2026-10-03T00_01_00.000Z__507.json',
    ]);
    await assertLeaseAbsent();

    resolverControl.throwOnResolve = false;
    const following = claimOptions({ waitMs: 0 });
    expect(await dispatchEngineer({ kind: 'claim' }, following.opts)).toBe(0);
    await assertLeaseAbsent();
  });
});
