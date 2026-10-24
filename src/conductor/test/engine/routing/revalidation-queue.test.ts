// Covers: task:29
import { describe, expect, it } from 'vitest';

import { parseChildId, type ChildId } from '../../../src/engine/child-context.js';
import { mergeQueueGeneration } from '../../../src/engine/routing/revalidation-queue.js';
import type { RegionGate, RevalidationQueueEntry, RevalidationQueueRecord } from '../../../src/engine/routing/route-types.js';
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
});
