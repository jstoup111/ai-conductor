// Covers: task:19
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { selectNextHost } from '../../../src/engine/routing/routed-exit.js';
import { parseCommitSha } from '../../../src/engine/restack/restack-types.js';
import type { RevalidationQueueEntry, RevalidationQueueRecord, RouteRecord, HostState } from '../../../src/engine/routing/route-types.js';

const child1 = parseChildId(1)!;
const child2 = parseChildId(2)!;
const leaf = parseChildId(3)!;
const queueEntry: RevalidationQueueEntry = {
  child: child1,
  position: child1,
  closureSha: parseCommitSha('a'.repeat(40))!,
  gates: ['test_suite'],
  replay: { oldParent: parseCommitSha('b'.repeat(40))!, newParent: parseCommitSha('c'.repeat(40))! },
  state: 'queued',
};

function record(
  hosts: Readonly<Record<number, HostState>>,
  currentHostIndex = 0,
): Pick<RouteRecord, 'hosts' | 'currentHostIndex'> {
  return { hosts, currentHostIndex };
}

function queue(entries: boolean): Pick<RevalidationQueueRecord, 'entries'> {
  return { entries: entries ? [queueEntry] : [] };
}

describe('routed host progression', () => {
  it.each([
    {
      name: 'selects the next pending child after a restacked child',
      record: record({ [child1]: 'restacked', [child2]: 'pending', [leaf]: 'pending' }),
      queue: queue(false),
      expected: { kind: 'child-host', host: child2, index: 1 },
    },
    {
      name: 'selects the pending leaf after every child settles and the queue is empty',
      record: record({ [child1]: 'restacked', [child2]: 'done', [leaf]: 'pending' }, 1),
      queue: queue(false),
      expected: { kind: 'leaf-host', host: leaf, index: 2 },
    },
    {
      name: 'selects the queue before a pending leaf',
      record: record({ [child1]: 'restacked', [child2]: 'done', [leaf]: 'pending' }, 1),
      queue: queue(true),
      expected: { kind: 'queue' },
    },
    {
      name: 'never selects a rerouted child',
      record: record({ [child1]: 'rerouted', [child2]: 'pending', [leaf]: 'pending' }),
      queue: queue(false),
      expected: { kind: 'child-host', host: child2, index: 1 },
    },
    {
      name: 'settles after every child and the leaf settle',
      record: record({ [child1]: 'restacked', [child2]: 'rerouted', [leaf]: 'done' }, 1),
      queue: queue(false),
      expected: { kind: 'settled' },
    },
  ])('$name', async ({ record: route, queue: revalidationQueue, expected }) => {
    await expect(selectNextHost('', route, revalidationQueue, { leaf })).resolves.toEqual(expected);
  });

  it('keeps every allocated host below an unallocated sealed leaf ahead of the queue', async () => {
    await expect(selectNextHost(
      '',
      record({ [child1]: 'restacked', [child2]: 'pending' }),
      queue(true),
      { leaf },
    )).resolves.toEqual({ kind: 'child-host', host: child2, index: 1 });
  });
});
