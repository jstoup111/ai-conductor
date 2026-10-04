// Covers: task:7, task:8
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

describe('Task 8 — bounded monitor priority lookup', () => {
  it('falls back without waiting for a stuck reader and refreshes on later passes', async () => {
    const resolver = {
      resolve: vi.fn(async (_items: unknown, _options: unknown) => new Promise<never>(() => {})),
    };

    const ordered = await orderMonitorQueue([halt('blocked', 'owner/repo#blocked')], resolver, { timeoutMs: 0 });

    expect({
      ordered: ordered.map(({ slug, band, orderingBasis }) => ({ slug, band, orderingBasis })),
      refreshes: resolver.resolve.mock.calls.map(([, options]) => options),
    }).toEqual({
      ordered: [{ slug: 'blocked', band: 'unresolved', orderingBasis: 'fallback' }],
      refreshes: [{ refresh: true }],
    });
  });
});

describe('Task 8 — monitor priority outage fallback', () => {
  it('keeps every halt in stable deferral-partition fallback order throughout an outage', async () => {
    const warnings: string[] = [];
    const resolver = createPriorityResolver(async () => {
      throw new Error('priority provider unavailable');
    }, (warning) => warnings.push(warning));
    const halts = [
      halt('deferred-critical', 'owner/repo#critical', true),
      halt('unseen-low', 'owner/repo#low'),
      halt('unseen-high', 'owner/repo#high'),
      halt('deferred-low', 'owner/repo#deferred-low', true),
    ];

    const first = await orderMonitorQueue(halts, resolver);
    const second = await orderMonitorQueue(halts, resolver);

    expect({
      warnings,
      first: first.map(({ slug, band, orderingBasis }) => ({ slug, band, orderingBasis })),
      byteIdentical: JSON.stringify(first) === JSON.stringify(second),
    }).toEqual({
      warnings: ['Priority resolution outage (reader failed): priority provider unavailable'],
      first: [
        { slug: 'unseen-low', band: 'unresolved', orderingBasis: 'fallback' },
        { slug: 'unseen-high', band: 'unresolved', orderingBasis: 'fallback' },
        { slug: 'deferred-critical', band: 'unresolved', orderingBasis: 'fallback' },
        { slug: 'deferred-low', band: 'unresolved', orderingBasis: 'fallback' },
      ],
      byteIdentical: true,
    });
  });

  it('restores priority-band ordering after the same resolver recovers', async () => {
    const warnings: string[] = [];
    let available = false;
    const resolver = createPriorityResolver(async (refs) => {
      if (!available) throw new Error('priority provider unavailable');
      return new Map(refs.map((ref) => [ref, ref.endsWith('#high') ? ['priority: high'] : ['priority: low']]));
    }, (warning) => warnings.push(warning));
    const halts = [
      halt('low', 'owner/repo#low'),
      halt('high', 'owner/repo#high'),
    ];

    const duringOutage = await orderMonitorQueue(halts, resolver);
    available = true;
    await resolver.resolve(halts.map(({ slug, sourceRef }) => ({ slug, ...(sourceRef === undefined ? {} : { sourceRef }) })), { refresh: true });
    const afterRecovery = await orderMonitorQueue(halts, resolver);

    expect({
      warnings,
      duringOutage: duringOutage.map(({ slug, orderingBasis }) => ({ slug, orderingBasis })),
      afterRecovery: afterRecovery.map(({ slug, band, orderingBasis }) => ({ slug, band, orderingBasis })),
    }).toEqual({
      warnings: ['Priority resolution outage (reader failed): priority provider unavailable'],
      duringOutage: [
        { slug: 'low', orderingBasis: 'fallback' },
        { slug: 'high', orderingBasis: 'fallback' },
      ],
      afterRecovery: [
        { slug: 'high', band: 'high', orderingBasis: 'priority-band' },
        { slug: 'low', band: 'low', orderingBasis: 'priority-band' },
      ],
    });
  });

  it('keeps missing issues unlabeled and unlinked halts in the inherited no-issue band', async () => {
    const resolver = createPriorityResolver(readerFor({
      'owner/repo#high': ['priority: high'],
      'owner/repo#missing': 'not-found',
    }), () => {});

    const ordered = await orderMonitorQueue([
      halt('missing', 'owner/repo#missing'),
      halt('high', 'owner/repo#high'),
      halt('unlinked', undefined),
    ], resolver);

    expect(ordered.map(({ slug, band, orderingBasis }) => ({ slug, band, orderingBasis }))).toEqual([
      { slug: 'unlinked', band: 'no-issue', orderingBasis: 'priority-band' },
      { slug: 'high', band: 'high', orderingBasis: 'priority-band' },
      { slug: 'missing', band: 'unlabeled', orderingBasis: 'priority-band' },
    ]);
  });
});
