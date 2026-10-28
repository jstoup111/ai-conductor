// Covers: tasks:40,41,42,101,102, task:rem-as-built-W13
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { admitRound, reconcileRounds } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRepairMarker, readRouteRecord, writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { repairMarkerRefFor, revalidationQueueRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseCommitSha } from '../../../src/engine/restack/restack-types.js';
import { parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';

const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const c3 = parseChildId(3)!;
const roundId = parseRoundId('r1')!;

const input = {
  roundId,
  sealedAuthored: 1,
  kind: 'audit' as const,
  items: [{ findingId: 'finding', kind: 'audit' as const, owner: c1, host: c1, reason: 'task-slice', fallback: [] }],
  allocation: { [c1]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] } },
};

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'round-admission-'));
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Routing']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await writeSliceTopologyFixture(repo, {
    slug: 'demo',
    sliceMembership: { taskSlices: { T1: 1, T2: 2, T3: 3 }, titles: ['child one', 'child two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  });
  return { repo, git };
}

async function writeRecord(subject: Awaited<ReturnType<typeof fixture>>, record: RouteRecord): Promise<void> {
  const blob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(record) })).stdout.trim();
  await subject.git(['update-ref', routeRecordRefFor('demo', record.roundId), blob]);
}

async function writeQueue(subject: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  const sha = parseCommitSha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim())!;
  const blob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({
    generation: 1,
    entries: [{ child: c1, position: c1, closureSha: sha, gates: ['test_suite'], replay: { oldParent: sha, newParent: sha }, state: 'queued' }],
    outbox: [],
  }) })).stdout.trim();
  await subject.git(['update-ref', revalidationQueueRefFor('demo'), blob]);
}

function openAudit(record: RouteRecord, hosts: RouteRecord['hosts'], currentHostIndex = 0): RouteRecord {
  return { ...record, phase: 'open', hosts, currentHostIndex, outbox: [] };
}

describe('routed-round admission (real local Git)', () => {
  // Covers: task:rem-prd-audit-rem-prd-audit-rem-vg6-s6-1
  it('reports quiescent when closed route history has neither a marker nor queued work', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', input);
      if (created.kind !== 'created') throw new Error(created.kind);
      const closed: RouteRecord = {
        ...created.record,
        phase: 'closed',
        hosts: { [c1]: 'done' },
      };
      const blob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(closed) })).stdout.trim();
      await subject.git(['update-ref', routeRecordRefFor('demo', roundId), blob]);

      await expect(reconcileRounds(subject.repo, 'demo')).resolves.toEqual({ kind: 'quiescent' });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('writes a prepared record then atomically opens its first marker and phase events', async () => {
    const subject = await fixture();
    try {
      const calls: { args: readonly string[]; input?: string }[] = [];
      const git: GitRunner = async (args, options) => {
        calls.push({ args, input: options?.input });
        return subject.git(args, options);
      };
      const created = await createRouteRecord(subject.repo, 'demo', input, { git });
      if (created.kind !== 'created') throw new Error(created.kind);
      expect(created.record).toMatchObject({ phase: 'prepared', hosts: { 1: 'pending' }, outbox: [] });
      const eventsPath = join(subject.repo, '.pipeline', 'events.jsonl');
      const persister = new EventPersister(eventsPath, new ConductorEventEmitter());
      const admitted = await admitRound(subject.repo, 'demo', created.record, c1, {
        git,
        persist: (event) => persister.persistDurably(event),
      });
      expect(admitted).toMatchObject({ kind: 'admitted', record: { phase: 'open', hosts: { 1: 'admitted' } } });
      expect(await readRepairMarker(subject.repo, 'demo')).toMatchObject({ kind: 'marker', marker: { roundId, host: c1 } });
      // `admitRound` does not return the route that its caller passes to
      // navigateBack until both admission occurrences are in the spine.
      expect((await readFile(eventsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))).toEqual([
        expect.objectContaining({ type: 'routed_repair_phase', roundId, host: c1, phase: 'admitted', credit: false }),
        expect.objectContaining({ type: 'remediation_routed', roundId }),
      ]);
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toMatchObject({
        kind: 'record',
        record: { outbox: [] },
      });
      const writes = calls.filter((call) => call.args[0] === 'update-ref');
      expect(writes).toHaveLength(4);
      expect(writes[1]?.input).toContain(`update ${repairMarkerRefFor('demo')}`);
      expect(writes[1]?.input).toContain('verify refs/conductor/demo/restack/journal ');
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:rem-prd-audit-W8, S5.10
  it('refuses a concurrent marker without mutating the prepared record', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', input);
      if (created.kind !== 'created') throw new Error(created.kind);
      const markerBlob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ host: 1, roundId: 'r9' }) })).stdout.trim();
      await subject.git(['update-ref', repairMarkerRefFor('demo'), markerBlob]);
      expect(await admitRound(subject.repo, 'demo', created.record, c1)).toEqual({
        kind: 'refused',
        detail: 'routing round r9 is already open; cannot admit r1',
      });
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toMatchObject({ kind: 'record', record: { phase: 'prepared', hosts: { 1: 'pending' } } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:1
  it('admits a revalidate round when the open audit round can only yield the queue', async () => {
    const subject = await fixture();
    try {
      const audit = await createRouteRecord(subject.repo, 'demo', { ...input, allocation: { [c1]: { remTaskIds: [], blockBodies: [] }, [c3]: { remTaskIds: [], blockBodies: [] } } });
      const revalidate = await createRouteRecord(subject.repo, 'demo', { ...input, roundId: parseRoundId('r2')!, kind: 'revalidate', allocation: { [c1]: { remTaskIds: [], blockBodies: [] } } });
      if (audit.kind !== 'created' || revalidate.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(audit.record, { [c1]: 'restacked', [c3]: 'pending' }));
      await writeQueue(subject);

      await expect(admitRound(subject.repo, 'demo', revalidate.record, c1)).resolves.toMatchObject({ kind: 'admitted' });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'marker', marker: { roundId: 'r2', host: c1 } });
      await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({ kind: 'record', record: { phase: 'open' } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:1
  it('refuses a second audit round while another open round has pending work', async () => {
    const subject = await fixture();
    try {
      const first = await createRouteRecord(subject.repo, 'demo', input);
      const second = await createRouteRecord(subject.repo, 'demo', { ...input, roundId: parseRoundId('r2')! });
      if (first.kind !== 'created' || second.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(first.record, { [c1]: 'pending' }));

      await expect(admitRound(subject.repo, 'demo', second.record, c1)).resolves.toMatchObject({ kind: 'refused', fence: true, detail: expect.stringContaining('r1') });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toEqual({ kind: 'absent' });
      await expect(readRouteRecord(subject.repo, 'demo', parseRoundId('r2')!)).resolves.toMatchObject({ kind: 'record', record: { phase: 'prepared' } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:1
  it.each(['admitted', 'repairing', 'built'] as const)('refuses revalidation while an open audit host is %s', async (state) => {
    const subject = await fixture();
    try {
      const audit = await createRouteRecord(subject.repo, 'demo', input);
      const revalidate = await createRouteRecord(subject.repo, 'demo', { ...input, roundId: parseRoundId('r2')!, kind: 'revalidate' });
      if (audit.kind !== 'created' || revalidate.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(audit.record, { [c1]: state }));
      await expect(admitRound(subject.repo, 'demo', revalidate.record, c1)).resolves.toMatchObject({ kind: 'refused', fence: true });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toEqual({ kind: 'absent' });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:1
  it('refuses revalidation when an open round would select a pending child host', async () => {
    const subject = await fixture();
    try {
      const audit = await createRouteRecord(subject.repo, 'demo', { ...input, allocation: { [c1]: { remTaskIds: [], blockBodies: [] }, [c2]: { remTaskIds: [], blockBodies: [] }, [c3]: { remTaskIds: [], blockBodies: [] } } });
      const revalidate = await createRouteRecord(subject.repo, 'demo', { ...input, roundId: parseRoundId('r2')!, kind: 'revalidate' });
      if (audit.kind !== 'created' || revalidate.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(audit.record, { [c1]: 'restacked', [c2]: 'pending', [c3]: 'pending' }));
      await expect(admitRound(subject.repo, 'demo', revalidate.record, c1)).resolves.toMatchObject({ kind: 'refused', fence: true });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toEqual({ kind: 'absent' });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:1
  it('refuses an unreadable open record at the fence', async () => {
    const subject = await fixture();
    try {
      const candidate = await createRouteRecord(subject.repo, 'demo', input);
      if (candidate.kind !== 'created') throw new Error(candidate.kind);
      const badBlob = (await subject.git(['hash-object', '-w', '--stdin'], { input: '{bad json' })).stdout.trim();
      await subject.git(['update-ref', routeRecordRefFor('demo', parseRoundId('r9')!), badBlob]);
      await expect(admitRound(subject.repo, 'demo', candidate.record, c1)).resolves.toMatchObject({ kind: 'refused', fence: true, detail: expect.stringContaining('r9') });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:rem-as-built-W11
  it('refuses an illegal host or round phase lifecycle update without writing a route ref', async () => {
    for (const preState of [
      { name: 'host state', apply: (record: RouteRecord): RouteRecord => ({ ...record, hosts: { ...record.hosts, [c1]: 'built' } }) },
      { name: 'round phase', apply: (record: RouteRecord): RouteRecord => ({ ...record, phase: 'closed' }) },
    ]) {
      const subject = await fixture();
      try {
        const created = await createRouteRecord(subject.repo, 'demo', input);
        if (created.kind !== 'created') throw new Error(created.kind);
        const stored = await readRouteRecord(subject.repo, 'demo', roundId);
        if (stored.kind !== 'record') throw new Error('record unavailable');
        const calls: { args: readonly string[]; input?: string }[] = [];
        const git: GitRunner = async (args, options) => {
          calls.push({ args, input: options?.input });
          return subject.git(args, options);
        };
        const illegal = preState.apply(stored.record);
        expect(await writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: stored, record: illegal }], { git }))
          .toEqual({ kind: 'unavailable' });
        expect(calls.filter((call) => call.args[0] === 'update-ref')).toHaveLength(0);
        expect(await readRepairMarker(subject.repo, 'demo')).toEqual({ kind: 'absent' });
        expect(await readRouteRecord(subject.repo, 'demo', roundId)).toEqual(stored);
      } finally { await rm(subject.repo, { recursive: true, force: true }); }
    }
  });

  it('aborts an orphaned prepared round and sends an admitted one back to build', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', input);
      if (created.kind !== 'created') throw new Error(created.kind);
      expect(await reconcileRounds(subject.repo, 'demo')).toEqual({ kind: 'aborted', roundId: 'r1' });
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toEqual({ kind: 'absent' });

      const opened = await createRouteRecord(subject.repo, 'demo', input);
      if (opened.kind !== 'created') throw new Error(opened.kind);
      await admitRound(subject.repo, 'demo', opened.record, c1);
      expect(await reconcileRounds(subject.repo, 'demo')).toEqual({ kind: 'navigate-leaf-to-build', roundId: 'r1', host: c1 });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:20
  it('carries an operator host entry step through reconciliation', async () => {
    const subject = await fixture();
    try {
      const tip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
      const created = await createRouteRecord(subject.repo, 'demo', {
        ...input,
        kind: 'operator',
        operator: {
          origin: 'rewind', reason: 'recheck the suite', operator: 'operator@example.test', entryStep: 'test_suite',
          carried: [], otherTips: { 'feat/daemon-demo': tip as never },
          priorRegion: { statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }, verdicts: {} },
        },
      });
      if (created.kind !== 'created') throw new Error(created.kind);
      await expect(admitRound(subject.repo, 'demo', created.record, c1)).resolves.toMatchObject({ kind: 'admitted' });
      await expect(reconcileRounds(subject.repo, 'demo')).resolves.toEqual({
        kind: 'navigate-leaf-to-build', roundId: 'r1', host: c1, entryStep: 'test_suite',
      });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('refuses a fenced transaction when a restack journal appears before commit', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', input);
      if (created.kind !== 'created') throw new Error(created.kind);
      const stored = await readRouteRecord(subject.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('record unavailable');
      const raced: GitRunner = async (args, options) => {
        if (args[0] === 'update-ref' && args[1] === '--stdin') {
          const journal = parseCommitSha((await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({}) })).stdout.trim())!;
          await subject.git(['update-ref', 'refs/conductor/demo/restack/journal', journal]);
        }
        return subject.git(args, options);
      };
      const next: RouteRecord = { ...stored.record, phase: 'open', hosts: { [c1]: 'admitted' } };
      expect(await writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: stored, record: next }], { git: raced }))
        .toEqual({ kind: 'cas-failed' });
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toEqual(stored);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });
});
