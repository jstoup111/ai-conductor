// Covers: task:7
import { describe, expect, it, vi } from 'vitest';

import { createPriorityResolver, type IssueLabelReader } from '../../../src/engine/backlog-priority.js';
import {
  orderMonitorQueue,
  type OrderableMonitorHalt,
} from '../../../src/engine/monitor/ordering.js';

function halt(
  slug: string,
  sourceRef: string | undefined,
  deferred = false,
): OrderableMonitorHalt {
  return {
    project: '/projects/alpha',
    projectName: 'alpha',
    slug,
    reason: `${slug} needs attention`,
    haltClass: 'needs-human',
    ...(sourceRef === undefined ? {} : { sourceRef }),
    deferred,
  };
}

function readerFor(labels: Record<string, string[] | 'not-found'>): IssueLabelReader {
  return async (refs) => new Map(refs.map((ref) => [ref, labels[ref] ?? 'not-found']));
}

describe('Task 7 — monitor queue ordering', () => {
  it('partitions unseen halts before deferred halts and orders each partition by the inherited band rank', async () => {
    const resolver = createPriorityResolver(readerFor({
      'owner/repo#critical': ['priority: critical'],
      'owner/repo#high': ['priority: high'],
      'owner/repo#low': ['priority: low'],
      'owner/repo#unlabeled': ['bug'],
    }), () => {});

    const ordered = await orderMonitorQueue([
      halt('deferred-critical', 'owner/repo#critical', true),
      halt('unseen-low', 'owner/repo#low'),
      halt('unseen-unlabeled', 'owner/repo#unlabeled'),
      halt('unseen-high', 'owner/repo#high'),
      halt('unseen-unlinked', undefined),
      halt('deferred-low', 'owner/repo#low', true),
    ], resolver);

    expect(ordered.map(({ slug, band, orderingBasis }) => ({ slug, band, orderingBasis }))).toEqual([
      { slug: 'unseen-unlinked', band: 'no-issue', orderingBasis: 'priority-band' },
      { slug: 'unseen-high', band: 'high', orderingBasis: 'priority-band' },
      { slug: 'unseen-low', band: 'low', orderingBasis: 'priority-band' },
      { slug: 'unseen-unlabeled', band: 'unlabeled', orderingBasis: 'priority-band' },
      { slug: 'deferred-critical', band: 'critical', orderingBasis: 'priority-band' },
      { slug: 'deferred-low', band: 'low', orderingBasis: 'priority-band' },
    ]);
  });

  it('is byte-stable for equal bands across removal and an unrelated halt joining the pass', async () => {
    const resolver = createPriorityResolver(readerFor({
      'owner/repo#equal-a': ['priority: medium'],
      'owner/repo#equal-b': ['priority: medium'],
      'owner/repo#equal-c': ['priority: medium'],
      'owner/repo#new-high': ['priority: high'],
    }), () => {});
    const equal = [
      halt('equal-a', 'owner/repo#equal-a'),
      halt('equal-b', 'owner/repo#equal-b'),
      halt('equal-c', 'owner/repo#equal-c'),
    ];

    const first = await orderMonitorQueue(equal, resolver);
    const identical = await orderMonitorQueue(equal, resolver);
    const removed = await orderMonitorQueue([equal[0], equal[2]], resolver);
    const joined = await orderMonitorQueue([...equal, halt('new-high', 'owner/repo#new-high')], resolver);

    expect({
      byteIdentical: JSON.stringify(first) === JSON.stringify(identical),
      afterRemoval: removed.map(({ slug }) => slug),
      afterJoin: joined.map(({ slug }) => slug),
    }).toEqual({
      byteIdentical: true,
      afterRemoval: ['equal-a', 'equal-c'],
      afterJoin: ['new-high', 'equal-a', 'equal-b', 'equal-c'],
    });
  });

  it('keeps the remaining unseen equal-band halts in their prior order after one is deferred', async () => {
    const resolver = createPriorityResolver(readerFor({
      'owner/repo#equal-a': ['priority: medium'],
      'owner/repo#equal-b': ['priority: medium'],
      'owner/repo#equal-c': ['priority: medium'],
    }), () => {});
    const equal = [
      halt('equal-a', 'owner/repo#equal-a'),
      halt('equal-b', 'owner/repo#equal-b'),
      halt('equal-c', 'owner/repo#equal-c'),
    ];

    const first = await orderMonitorQueue(equal, resolver);
    const recomputed = await orderMonitorQueue([
      equal[0],
      halt('equal-b', 'owner/repo#equal-b', true),
      equal[2],
    ], resolver);

    expect({
      first: first.map(({ slug }) => slug),
      afterDeferral: recomputed.map(({ slug }) => slug),
    }).toEqual({
      first: ['equal-a', 'equal-b', 'equal-c'],
      afterDeferral: ['equal-a', 'equal-c', 'equal-b'],
    });
  });

  it('retains an unresolved linked issue and remains byte-stable when no item has a priority label', async () => {
    const resolver = createPriorityResolver(readerFor({
      'owner/repo#missing': 'not-found',
      'owner/repo#unlabeled-a': ['bug'],
      'owner/repo#unlabeled-b': ['chore'],
    }), () => {});
    const halts = [
      halt('missing', 'owner/repo#missing'),
      halt('unlabeled-a', 'owner/repo#unlabeled-a'),
      halt('unlabeled-b', 'owner/repo#unlabeled-b'),
    ];

    const first = await orderMonitorQueue(halts, resolver);
    const second = await orderMonitorQueue(halts, resolver);

    expect({
      first: first.map(({ slug, band }) => ({ slug, band })),
      byteIdentical: JSON.stringify(first) === JSON.stringify(second),
    }).toEqual({
      first: [
        { slug: 'missing', band: 'unlabeled' },
        { slug: 'unlabeled-a', band: 'unlabeled' },
        { slug: 'unlabeled-b', band: 'unlabeled' },
      ],
      byteIdentical: true,
    });
  });

  it('uses the shared resolver cache once per repeated reference and retains every halt with fallback attribution on failure', async () => {
    const lookups: string[][] = [];
    const warnings: string[] = [];
    const reader = vi.fn(async (refs: string[]) => {
      lookups.push(refs);
      throw new Error('priority provider unavailable');
    });
    const resolver = createPriorityResolver(reader, (warning) => warnings.push(warning));

    const ordered = await orderMonitorQueue([
      halt('first', 'owner/repo#same'),
      halt('second', 'owner/repo#same'),
      halt('unlinked', undefined),
    ], resolver);

    expect({
      lookups,
      warnings,
      ordered: ordered.map(({ slug, band, orderingBasis }) => ({ slug, band, orderingBasis })),
    }).toEqual({
      lookups: [['owner/repo#same']],
      warnings: ['Priority resolution outage (reader failed): priority provider unavailable'],
      ordered: [
        { slug: 'first', band: 'unresolved', orderingBasis: 'fallback' },
        { slug: 'second', band: 'unresolved', orderingBasis: 'fallback' },
        { slug: 'unlinked', band: 'unresolved', orderingBasis: 'fallback' },
      ],
    });
  });
});
