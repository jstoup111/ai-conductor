// Covers: task:7, task:29
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseChildId, type ChildId } from '../../../src/engine/child-context.js';
import { acknowledgeQueueEntry, consumeLowestQueued, mergeQueueGeneration } from '../../../src/engine/routing/revalidation-queue.js';
import { readRepairMarker, readRevalidationQueue, readRouteRecord, transitionHost, writeRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor, repairMarkerRefFor, revalidationQueueRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { readRoutedGrowthSnapshot } from '../../../src/engine/routing/round-receipt.js';
import { emptyUnsettledReceipt, parseRoundId, type RegionGate, type RevalidationQueueEntry, type RevalidationQueueRecord, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { parseCommitSha } from '../../../src/engine/restack/restack-types.js';

function child(value: number): ChildId {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`invalid child ${value}`);
  return parsed;
}

function sha(letter: string): NonNullable<ReturnType<typeof parseCommitSha>> {
  const parsed = parseCommitSha(letter.repeat(40));
  if (!parsed) throw new Error(`invalid SHA ${letter}`);
  return parsed;
}

function entry(
  position: number,
  closure: string,
  gates: readonly RegionGate[],
  oldParent: string,
  newParent: string,
): RevalidationQueueEntry {
  const queuedChild = child(position);
  return {
    child: queuedChild,
    position: queuedChild,
    closureSha: sha(closure),
    gates,
    replay: { oldParent: sha(oldParent), newParent: sha(newParent) },
    state: 'queued',
  };
}

function queue(generation: number, entries: readonly RevalidationQueueEntry[]): RevalidationQueueRecord {
  return { generation, entries, outbox: [] };
}

async function durableQueueFixture() {
  const repo = await mkdtemp(join(tmpdir(), 'revalidation-queue-'));
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'queue@example.test']);
  await git(['config', 'user.name', 'Queue']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const closure = parseCommitSha((await git(['rev-parse', 'HEAD'])).stdout.trim())!;
  await git(['update-ref', closureRefFor('demo', child(2)), closure]);
  const head = closure;
  const record = queue(4, [
    { ...entry(2, 'a', ['test_suite'], 'b', 'c'), closureSha: closure, replay: { oldParent: head, newParent: head } },
    { ...entry(4, 'd', ['build_review'], 'e', 'f'), replay: { oldParent: head, newParent: head } },
  ]);
  const blob = (await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(record) })).stdout.trim();
  await git(['update-ref', revalidationQueueRefFor('demo'), blob]);
  return { repo, git };
}

async function seedClosedRound(
  subject: Awaited<ReturnType<typeof durableQueueFixture>>,
  overrides: Partial<RouteRecord> = {},
): Promise<void> {
  const roundId = overrides.roundId ?? parseRoundId('r1')!;
  const closed: RouteRecord = {
    roundId,
    sealedAuthored: 1,
    kind: 'audit',
    phase: 'closed',
    items: [{ findingId: 'prior-round', kind: 'audit', owner: child(1), host: child(1), reason: 'prior repair', fallback: [] }],
    allocation: { [child(1)]: { remTaskIds: ['rem-prior'], blockBodies: ['### Task rem-prior\n'] } },
    hosts: { [child(1)]: 'done' },
    currentHostIndex: 0,
    receipt: emptyUnsettledReceipt(),
    outbox: [],
    ...overrides,
  };
  const blob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(closed) })).stdout.trim();
  await subject.git(['update-ref', routeRecordRefFor('demo', roundId), blob]);
}

describe('revalidation queue generations', () => {
  it('acknowledges an operator host with the audit close rule, not the revalidate close rule', async () => {
    const subject = await durableQueueFixture();
    const roundId = parseRoundId('r1')!;
    try {
      const queueRecord = await readRevalidationQueue(subject.repo, 'demo', { git: subject.git });
      if (queueRecord.kind !== 'queue') throw new Error('missing queue');
      const closure = parseCommitSha((await subject.git(['rev-parse', closureRefFor('demo', child(2))])).stdout.trim());
      const tree = parseCommitSha((await subject.git(['rev-parse', `${closureRefFor('demo', child(2))}^{tree}`])).stdout.trim());
      if (!closure || !tree) throw new Error('invalid operator route pin');
      const operator: RouteRecord = {
        roundId, sealedAuthored: 0, kind: 'operator', phase: 'open', items: [],
        allocation: { [child(2)]: { remTaskIds: [], blockBodies: [] } },
        hosts: { [child(2)]: 'repairing' }, currentHostIndex: 0, receipt: emptyUnsettledReceipt(), outbox: [],
        entry: {
          host: child(2), pinnedBase: closure, tree,
          revalidation: { queueBlob: queueRecord.blob, generation: queueRecord.queue.generation, closureSha: closure },
        },
        operator: {
          origin: 'land', reason: 'reviewer request', operator: 'operator@example.test', entryStep: 'acceptance_specs',
          carried: [], otherTips: { 'feat/daemon-demo': closure },
          priorRegion: { statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }, verdicts: {} },
        },
      };
      const blob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(operator) })).stdout.trim();
      await subject.git(['update-ref', routeRecordRefFor('demo', roundId), blob]);
      const markerBlob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ host: child(2), roundId }) })).stdout.trim();
      await subject.git(['update-ref', repairMarkerRefFor('demo'), markerBlob]);
      const stored = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.git });
      if (stored.kind !== 'record') throw new Error('missing operator route');

      await expect(acknowledgeQueueEntry(subject.repo, 'demo', stored, child(2), { git: subject.git }))
        .resolves.toEqual({ kind: 'acknowledged', leavesRoundOpen: false });
      await expect(readRouteRecord(subject.repo, 'demo', roundId, { git: subject.git })).resolves.toMatchObject({
        kind: 'record', record: { phase: 'open', hosts: { 2: 'done' } },
      });
    } finally {
      await rm(subject.repo, { recursive: true, force: true });
    }
  });

  // Covers: task:29
  it('keeps the newer child closure and replay tuple while unioning its gates', () => {
    const earlier = entry(2, 'a', ['test_suite'], 'b', 'c');
    const newer = entry(2, 'd', ['build_review'], 'e', 'f');

    expect(mergeQueueGeneration(queue(6, [earlier]), [newer])).toEqual({
      generation: 7,
      entries: [{ ...newer, gates: ['test_suite', 'build_review'] }],
      outbox: [],
    });
  });

  // Covers: task:29
  it('orders merged children by position and advances the generation once', () => {
    const childFour = entry(4, 'a', ['test_suite'], 'b', 'c');
    const childTwo = entry(2, 'd', ['build_review'], 'e', 'f');

    const merged = mergeQueueGeneration(queue(9, [childFour]), [childTwo]);

    expect(merged.generation).toBe(10);
    expect(merged.entries).toEqual([childTwo, childFour]);
  });

  // Covers: task:29
  it('drops an acknowledged child while keeping every other queue entry unchanged', () => {
    const childOne = entry(1, 'a', ['test_suite'], 'b', 'c');
    const childTwo = entry(2, 'd', ['build_review'], 'e', 'f');

    expect(mergeQueueGeneration(queue(3, [childOne, childTwo]), [], { acknowledge: child(1) })).toEqual({
      generation: 4,
      entries: [childTwo],
      outbox: [],
    });
  });

  // Covers: task:33, task:36
  it('admits only the queue head, then acknowledges it with marker, route, closure and queue in one durable transaction', async () => {
    const subject = await durableQueueFixture();
    try {
      await seedClosedRound(subject);
      await expect(consumeLowestQueued(subject.repo, 'demo', { git: subject.git })).resolves.toEqual({ kind: 'admitted', roundId: expect.any(String), host: child(2) });
      const marker = await readRepairMarker(subject.repo, 'demo', { git: subject.git });
      expect(marker).toMatchObject({ kind: 'marker', marker: { host: 2, roundId: 'r2' } });
      const stored = await readRouteRecord(subject.repo, 'demo', parseRoundId('r2')!, { git: subject.git });
      if (stored.kind !== 'record') throw new Error('expected revalidate record');
      const repairing = transitionHost(stored, child(2), 'repairing', { credit: false });
      if (repairing.kind !== 'updated') throw new Error('expected admitted host transition');
      await writeRouteRecord(subject.repo, stored, repairing.record, { git: subject.git });
      const current = await readRouteRecord(subject.repo, 'demo', parseRoundId('r2')!, { git: subject.git });
      if (current.kind !== 'record') throw new Error('expected repairing record');
      const pinnedQueue = await readRevalidationQueue(subject.repo, 'demo', { git: subject.git });
      if (pinnedQueue.kind !== 'queue') throw new Error('expected pinned queue');
      const closure = parseCommitSha((await subject.git(['rev-parse', closureRefFor('demo', child(2))])).stdout.trim())!;
      const tree = parseCommitSha((await subject.git(['rev-parse', `${closure}^{tree}`])).stdout.trim())!;
      const pinned = {
        ...current.record,
        entry: { host: child(2), pinnedBase: closure, tree, revalidation: {
          queueBlob: pinnedQueue.blob, generation: pinnedQueue.queue.generation, closureSha: closure,
        } },
      };
      await writeRouteRecord(subject.repo, current, pinned, { git: subject.git });
      const acknowledged = await readRouteRecord(subject.repo, 'demo', parseRoundId('r2')!, { git: subject.git });
      if (acknowledged.kind !== 'record') throw new Error('expected pinned revalidate record');
      const calls: Array<{ readonly args: readonly string[]; readonly input?: string; readonly stdout: string }> = [];
      const git: GitRunner = async (args, options) => {
        const result = await subject.git(args, options);
        calls.push({ args: [...args], input: options?.input, stdout: result.stdout });
        return result;
      };
      await expect(acknowledgeQueueEntry(subject.repo, 'demo', acknowledged, child(2), { git }))
        .resolves.toEqual({ kind: 'acknowledged', leavesRoundOpen: false });
      const refWrites = calls.filter((call) => call.args[0] === 'update-ref');
      expect(refWrites).toEqual([expect.objectContaining({
        args: ['update-ref', '--stdin'],
        input: expect.stringMatching(new RegExp(
          `(?=.*delete ${repairMarkerRefFor('demo')} )(?=.*update ${routeRecordRefFor('demo', parseRoundId('r2')!)} )(?=.*verify ${closureRefFor('demo', child(2))} )(?=.*update ${revalidationQueueRefFor('demo')} )`,
          's',
        )),
      })]);
      const generationFiveQueueBlob = calls.find((call) => call.args[0] === 'hash-object' && call.input?.includes('"generation":5'))?.stdout.trim();
      expect(generationFiveQueueBlob).toMatch(/^[0-9a-f]{40}$/);
      expect(refWrites[0]?.input).toContain(`update ${revalidationQueueRefFor('demo')} ${generationFiveQueueBlob} ${pinnedQueue.blob}`);
      expect((await subject.git(['show-ref', '--verify', '--hash', `refs/conductor/demo/routes/r2`])).exitCode).toBe(0);
      await expect(readRepairMarker(subject.repo, 'demo', { git: subject.git })).resolves.toEqual({ kind: 'absent' });
      await expect(readRevalidationQueue(subject.repo, 'demo', { git: subject.git })).resolves.toMatchObject({
        kind: 'queue', queue: { generation: 5, entries: [expect.objectContaining({ child: 4 })], outbox: [expect.objectContaining({ event: expect.objectContaining({ type: 'child_revalidated', outcome: 'passed' }) })] },
      });
    } finally {
      await rm(subject.repo, { recursive: true, force: true });
    }
  });

  describe('authored denominator', () => {
    const routing = {
      cursor: { kind: 'active' },
      config: { stacked_prs: { enabled: true, route_whole_feature_fixes: true } },
    };

    it('seals no authored denominator on a revalidation round', async () => {
      const subject = await durableQueueFixture();
      try {
        await seedClosedRound(subject, { sealedAuthored: 17 });
        await expect(consumeLowestQueued(subject.repo, 'demo', { git: subject.git })).resolves.toMatchObject({ kind: 'admitted' });
        const stored = await readRouteRecord(subject.repo, 'demo', parseRoundId('r2')!, { git: subject.git });
        if (stored.kind !== 'record') throw new Error('expected revalidate record');
        expect(stored.record.kind).toBe('revalidate');
        expect(stored.record.sealedAuthored).toBeUndefined();
        await expect(readRoutedGrowthSnapshot(subject.repo, 'demo', routing, subject.git))
          .resolves.toMatchObject({ sealedAuthored: 17 });
      } finally {
        await rm(subject.repo, { recursive: true, force: true });
      }
    });

    it('ignores the zero denominator a legacy revalidation round recorded', async () => {
      const subject = await durableQueueFixture();
      try {
        await seedClosedRound(subject, { sealedAuthored: 17 });
        // Shape written before revalidation rounds stopped sealing a placeholder.
        await seedClosedRound(subject, {
          roundId: parseRoundId('r2')!, kind: 'revalidate', sealedAuthored: 0, items: [],
          allocation: { [child(1)]: { remTaskIds: [], blockBodies: [] } },
        });
        await expect(readRoutedGrowthSnapshot(subject.repo, 'demo', routing, subject.git))
          .resolves.toMatchObject({ sealedAuthored: 17 });
      } finally {
        await rm(subject.repo, { recursive: true, force: true });
      }
    });
  });
});
