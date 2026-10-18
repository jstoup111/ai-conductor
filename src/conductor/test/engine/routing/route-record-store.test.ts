// Covers: task:5
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import {
  createRouteRecord,
  readRepairMarker,
  readRevalidationQueue,
  readRouteRecord,
  writeRouteRecord,
} from '../../../src/engine/routing/route-record-store.js';
import type { CreateRouteRecordInput } from '../../../src/engine/routing/route-record-store.js';
import { repairMarkerRefFor, revalidationQueueRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { journalRefFor, writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';

const roundId = parseRoundId('r1');
if (!roundId) throw new Error('r1 must be a valid route round');
const c1 = parseChildId(1);
if (!c1) throw new Error('1 must be a valid child id');

const routeRecord: RouteRecord = {
  roundId,
  sealedAuthored: 1,
  kind: 'audit',
  phase: 'open',
  items: [{ findingId: 'finding-1', kind: 'audit', owner: c1, host: c1, reason: 'task ownership', fallback: [] }],
  allocation: { [c1]: { remTaskIds: ['rem-4'], blockBodies: ['### Task rem-4\n'] } },
  hosts: { [c1]: 'repairing' },
  currentHostIndex: 0,
  receipt: emptyUnsettledReceipt(),
  outbox: [],
};


function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw);
  if (!parsed) throw new Error(`expected commit sha, received ${raw}`);
  return parsed;
}

async function createRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'route-record-store-'));
  const git = makeGitRunner(repo);
  try {
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'routing@example.invalid']);
    await git(['config', 'user.name', 'Route record store']);
    await writeFile(join(repo, 'base.txt'), 'base\n');
    await git(['add', 'base.txt']);
    await git(['commit', '-qm', 'base']);
    return { repo, git };
  } catch (error) {
    await rm(repo, { recursive: true, force: true });
    throw error;
  }
}

async function writeRef(fixture: Awaited<ReturnType<typeof createRepo>>, ref: string, value: unknown): Promise<CommitSha> {
  const blob = sha((await fixture.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(value) })).stdout.trim());
  await fixture.git(['update-ref', ref, blob]);
  return blob;
}

async function routeFixture(fixture: Awaited<ReturnType<typeof createRepo>>, record: RouteRecord = routeRecord): Promise<CommitSha> {
  return writeRef(fixture, routeRecordRefFor('demo', record.roundId), record);
}

async function journalFixture(
  fixture: Awaited<ReturnType<typeof createRepo>>,
  state: RestackJournal['state'],
): Promise<void> {
  const base = sha((await fixture.git(['rev-parse', 'HEAD'])).stdout.trim());
  const journal: RestackJournal = {
    opId: 'route-store-journal' as RestackOpId,
    cause: 'feature-repair',
    committer: { name: 'Routing', email: 'routing@example.test', date: '2030-01-01T00:00:00Z' },
    dirtyPaths: [],
    refs: [],
    ranges: [],
    children: [],
    state,
    owner: { host: 'test-host', pid: 1, processStartTime: '1' },
  };
  const blob = await writeRestackJournalBlob(fixture.repo, journal);
  await fixture.git(['update-ref', journalRefFor('demo'), blob]);
  expect(base).toBeTruthy();
}

describe('ref-backed route record store', () => {
  it('reads typed route records, markers and queues, distinguishing absent and unreadable route records', async () => {
    const fixture = await createRepo();
    try {
      const storedBlob = await routeFixture(fixture);
      const markerBlob = await writeRef(fixture, repairMarkerRefFor('demo'), { host: 1, roundId: 'r1' });
      const queueBlob = await writeRef(fixture, revalidationQueueRefFor('demo'), {
        generation: 2,
        entries: [{ child: 1, closureSha: 'a'.repeat(40), state: 'pending' }],
        outbox: [],
      });

      expect(await readRouteRecord(fixture.repo, 'demo', roundId)).toEqual({
        kind: 'record',
        slug: 'demo',
        blob: storedBlob,
        record: {
          ...routeRecord,
          receipt: { laps: {}, growth: 0, taskless: {}, echo: {}, acks: {} },
        },
      });
      expect(await readRepairMarker(fixture.repo, 'demo')).toEqual({ kind: 'marker', slug: 'demo', blob: markerBlob, marker: { host: 1, roundId } });
      expect(await readRevalidationQueue(fixture.repo, 'demo')).toEqual({
        kind: 'queue',
        slug: 'demo',
        queue: { generation: 2, entries: [{ child: 1, closureSha: 'a'.repeat(40), state: 'pending' }], outbox: [] },
        blob: queueBlob,
      });

      expect(await readRouteRecord(fixture.repo, 'demo', parseRoundId('r2')!)).toEqual({ kind: 'absent' });
      const invalidBlob = await writeRef(fixture, routeRecordRefFor('demo', parseRoundId('r3')!), { route: 'not a record' });
      expect(await readRouteRecord(fixture.repo, 'demo', parseRoundId('r3')!)).toEqual({ kind: 'unreadable', blob: invalidBlob });
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('updates an existing record through a fenced update-ref transaction with the stored blob as its CAS old value', async () => {
    const fixture = await createRepo();
    try {
      await routeFixture(fixture);
      const stored = await readRouteRecord(fixture.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('expected stored route record');
      const calls: { args: readonly string[]; input?: string }[] = [];
      const realGit = makeGitRunner(fixture.repo);
      const git: GitRunner = async (args, options) => {
        calls.push({ args, input: options?.input });
        return realGit(args, options);
      };

      const result = await writeRouteRecord(fixture.repo, stored, { ...routeRecord, phase: 'closed' }, { git });

      expect(result.kind).toBe('updated');
      const update = calls.find((call) => call.args[0] === 'update-ref');
      expect(update).toEqual({
        args: ['update-ref', '--stdin'],
        input: expect.stringContaining(`start\nupdate ${routeRecordRefFor('demo', roundId)} `),
      });
      expect(update?.input).toContain(` ${stored.blob}\nverify ${journalRefFor('demo')} ${'0'.repeat(40)}\nprepare\ncommit\n`);
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('preserves a concurrent writer when the route-record CAS loses', async () => {
    const fixture = await createRepo();
    try {
      await routeFixture(fixture);
      const stored = await readRouteRecord(fixture.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('expected stored route record');
      const concurrent = { ...routeRecord, phase: 'closed' as const };
      let replaced = false;
      const realGit = makeGitRunner(fixture.repo);
      const git: GitRunner = async (args, options) => {
        if (!replaced && args[0] === 'update-ref') {
          replaced = true;
          await writeRef(fixture, routeRecordRefFor('demo', roundId), concurrent);
        }
        return realGit(args, options);
      };

      expect(await writeRouteRecord(fixture.repo, stored, {
        ...routeRecord,
        phase: 'prepared',
        hosts: { [c1]: 'pending' },
      }, { git })).toEqual({ kind: 'cas-failed' });
      expect(await readRouteRecord(fixture.repo, 'demo', roundId)).toMatchObject({ kind: 'record', record: concurrent });
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('refuses malformed route records before create or update can move a route ref', async () => {
    const fixture = await createRepo();
    try {
      const malformedExistingTask = {
        ...routeRecord,
        items: [{ ...routeRecord.items[0]!, existingTask: true }],
      } as unknown as RouteRecord;
      const malformedLifecycle = {
        ...routeRecord,
        phase: 'closed' as const,
        hosts: { [c1]: 'pending' as const },
      };

      expect(await createRouteRecord(fixture.repo, 'demo', malformedExistingTask as unknown as CreateRouteRecordInput)).toEqual({ kind: 'unavailable' });
      expect(await readRouteRecord(fixture.repo, 'demo', roundId)).toEqual({ kind: 'absent' });

      await routeFixture(fixture);
      const stored = await readRouteRecord(fixture.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('expected stored route record');
      expect(await writeRouteRecord(fixture.repo, stored, malformedExistingTask)).toEqual({ kind: 'unavailable' });
      expect(await writeRouteRecord(fixture.repo, stored, malformedLifecycle)).toEqual({ kind: 'unavailable' });
      expect(await readRouteRecord(fixture.repo, 'demo', roundId)).toEqual(stored);
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('refuses writes while a restack journal is open and permits them after it is applied', async () => {
    const fixture = await createRepo();
    try {
      await routeFixture(fixture);
      const stored = await readRouteRecord(fixture.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('expected stored route record');
      await journalFixture(fixture, 'moved');

      expect(await writeRouteRecord(fixture.repo, stored, { ...routeRecord, phase: 'closed' })).toEqual({ kind: 'restack-journal-open' });
      expect(await readRouteRecord(fixture.repo, 'demo', roundId)).toEqual(stored);

      await journalFixture(fixture, 'applied');
      expect(await writeRouteRecord(fixture.repo, stored, { ...routeRecord, phase: 'closed' })).toMatchObject({ kind: 'updated' });
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

});
