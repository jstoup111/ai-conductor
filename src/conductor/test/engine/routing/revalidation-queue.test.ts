// Covers: task:29
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseChildId, type ChildId } from '../../../src/engine/child-context.js';
import { acknowledgeQueueEntry, consumeLowestQueued, mergeQueueGeneration } from '../../../src/engine/routing/revalidation-queue.js';
import { readRepairMarker, readRevalidationQueue, readRouteRecord, transitionHost, writeRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor, revalidationQueueRefFor } from '../../../src/engine/routing/routing-refs.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { parseRoundId, type RegionGate, type RevalidationQueueEntry, type RevalidationQueueRecord } from '../../../src/engine/routing/route-types.js';
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

describe('revalidation queue generations', () => {
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
      await expect(consumeLowestQueued(subject.repo, 'demo', { git: subject.git })).resolves.toEqual({ kind: 'admitted', roundId: expect.any(String), host: child(2) });
      const marker = await readRepairMarker(subject.repo, 'demo', { git: subject.git });
      expect(marker).toMatchObject({ kind: 'marker', marker: { host: 2, roundId: 'r1' } });
      const stored = await readRouteRecord(subject.repo, 'demo', parseRoundId('r1')!, { git: subject.git });
      if (stored.kind !== 'record') throw new Error('expected revalidate record');
      const repairing = transitionHost(stored, child(2), 'repairing', { credit: false });
      if (repairing.kind !== 'updated') throw new Error('expected admitted host transition');
      await writeRouteRecord(subject.repo, stored, repairing.record, { git: subject.git });
      const current = await readRouteRecord(subject.repo, 'demo', parseRoundId('r1')!, { git: subject.git });
      if (current.kind !== 'record') throw new Error('expected repairing record');
      await expect(acknowledgeQueueEntry(subject.repo, 'demo', current, child(2), { git: subject.git }))
        .resolves.toEqual({ kind: 'acknowledged', leavesRoundOpen: false });
      await expect(readRepairMarker(subject.repo, 'demo', { git: subject.git })).resolves.toEqual({ kind: 'absent' });
      await expect(readRevalidationQueue(subject.repo, 'demo', { git: subject.git })).resolves.toMatchObject({
        kind: 'queue', queue: { generation: 5, entries: [expect.objectContaining({ child: 4 })], outbox: [expect.objectContaining({ event: expect.objectContaining({ type: 'child_revalidated', outcome: 'passed' }) })] },
      });
    } finally {
      await rm(subject.repo, { recursive: true, force: true });
    }
  });
});
