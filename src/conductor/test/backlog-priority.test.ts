import { describe, it, expect } from 'vitest';
import {
  parsePriorityLabels,
  createPriorityResolver,
  orderBacklog,
  type PriorityResolution,
} from '../src/engine/backlog-priority.js';
import type { BacklogItem } from '../src/engine/daemon.js';

describe('parsePriorityLabels — extract priority from issue labels', () => {
  describe('positive cases', () => {
    it('single high priority label returns high', () => {
      expect(parsePriorityLabels(['priority: high'])).toBe('high');
    });

    it('single medium priority label returns medium', () => {
      expect(parsePriorityLabels(['priority: medium'])).toBe('medium');
    });

    it('single low priority label returns low', () => {
      expect(parsePriorityLabels(['priority: low'])).toBe('low');
    });

    it('multiple priority labels returns highest (high > medium)', () => {
      expect(parsePriorityLabels(['priority: low', 'priority: high'])).toBe('high');
    });

    it('mixed labels with priority extracted correctly', () => {
      expect(parsePriorityLabels(['bug', 'intake', 'priority: medium'])).toBe('medium');
    });

    it('all three priority levels present returns highest', () => {
      expect(parsePriorityLabels(['priority: low', 'priority: medium', 'priority: high'])).toBe('high');
    });
  });

  describe('negative cases — unknown labels', () => {
    it('unknown priority value "urgent" returns undefined', () => {
      expect(parsePriorityLabels(['priority: urgent'])).toBeUndefined();
    });

    it('unknown priority value "critical" returns undefined', () => {
      expect(parsePriorityLabels(['priority: critical'])).toBeUndefined();
    });

    it('unknown priority value "P0" returns undefined', () => {
      expect(parsePriorityLabels(['priority: P0'])).toBeUndefined();
    });

    it('wrong case "Priority: High" returns undefined', () => {
      expect(parsePriorityLabels(['Priority: High'])).toBeUndefined();
    });

    it('wrong separator format "priority-high" returns undefined', () => {
      expect(parsePriorityLabels(['priority-high'])).toBeUndefined();
    });

    it('extra whitespace "priority:  high" returns undefined', () => {
      expect(parsePriorityLabels(['priority:  high'])).toBeUndefined();
    });

    it('no space after colon "priority:high" returns undefined', () => {
      expect(parsePriorityLabels(['priority:high'])).toBeUndefined();
    });

    it('trailing whitespace "priority: high " returns undefined', () => {
      expect(parsePriorityLabels(['priority: high '])).toBeUndefined();
    });

    it('leading whitespace " priority: high" returns undefined', () => {
      expect(parsePriorityLabels([' priority: high'])).toBeUndefined();
    });
  });

  describe('negative cases — empty/malformed inputs', () => {
    it('empty array returns undefined', () => {
      expect(parsePriorityLabels([])).toBeUndefined();
    });

    it('array with only non-priority labels returns undefined', () => {
      expect(parsePriorityLabels(['bug', 'feature', 'intake'])).toBeUndefined();
    });

    it('array with empty string returns undefined', () => {
      expect(parsePriorityLabels([''])).toBeUndefined();
    });

    it('array with whitespace-only string returns undefined', () => {
      expect(parsePriorityLabels(['   '])).toBeUndefined();
    });
  });

  describe('determinism — side effects', () => {
    it('repeated calls with same input return same result', () => {
      const labels = ['priority: high', 'bug'];
      const result1 = parsePriorityLabels(labels);
      const result2 = parsePriorityLabels(labels);
      const result3 = parsePriorityLabels(labels);
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
      expect(result1).toBe('high');
    });

    it('does not mutate input array', () => {
      const labels = ['priority: medium', 'feature'];
      const originalLength = labels.length;
      parsePriorityLabels(labels);
      expect(labels.length).toBe(originalLength);
      expect(labels).toEqual(['priority: medium', 'feature']);
    });

    it('handles repeated priority labels deterministically', () => {
      const labels = ['priority: low', 'priority: high', 'priority: low'];
      expect(parsePriorityLabels(labels)).toBe('high');
    });
  });

  describe('mixed valid and invalid labels', () => {
    it('one valid priority label ignores invalid ones', () => {
      expect(parsePriorityLabels(['priority: urgent', 'priority: high', 'Priority: Low'])).toBe('high');
    });

    it('multiple invalid priority formats ignored, mixed labels returned', () => {
      expect(
        parsePriorityLabels(['priority-high', 'Priority: High', 'priority: medium', 'bug'])
      ).toBe('medium');
    });
  });
});

describe('createPriorityResolver — stateful resolver with caching', () => {
  describe('refresh fetch — fetch all linked refs, update cache', () => {
    it('resolve with refresh: true fetches all refs via reader', async () => {
      const callLog: string[] = [];
      const labelMap = new Map<string, string[]>([
        ['owner/repo#1', ['priority: high', 'bug']],
        ['owner/repo#2', ['priority: low']],
      ]);

      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        const result = new Map<string, string[] | 'not-found'>();
        for (const ref of refs) {
          result.set(ref, labelMap.get(ref) || 'not-found');
        }
        return result;
      };

      const resolver = createPriorityResolver(reader, console.log);

      const items: BacklogItem[] = [
        { slug: 'feature-1', sourceRef: 'owner/repo#1' },
        { slug: 'feature-2', sourceRef: 'owner/repo#2' },
      ];

      const result = await resolver.resolve(items, { refresh: true });

      expect(callLog).toEqual(['read:owner/repo#1,owner/repo#2']);
      expect(result.mode).toBe('banded');
      expect(result.bands.get('owner/repo#1')).toBe('high');
      expect(result.bands.get('owner/repo#2')).toBe('low');
    });

    it('handles items with no sourceRef (no-issue band)', async () => {
      const callLog: string[] = [];
      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        return new Map<string, string[]>();
      };

      const resolver = createPriorityResolver(reader, console.log);

      const items: BacklogItem[] = [
        { slug: 'feature-1' }, // no sourceRef
        { slug: 'feature-2', sourceRef: 'owner/repo#2' },
      ];

      const result = await resolver.resolve(items, { refresh: true });

      expect(callLog).toEqual(['read:owner/repo#2']);
      expect(result.mode).toBe('banded');
      expect(result.bands.get('feature-1')).toBe('no-issue');
      expect(result.bands.get('owner/repo#2')).toBe('unlabeled');
    });
  });

  describe('cached local scan — return cached bands with zero reader calls', () => {
    it('resolve with refresh: false uses cache, no reader calls', async () => {
      const callLog: string[] = [];
      const labelMap = new Map<string, string[]>([
        ['owner/repo#1', ['priority: high']],
        ['owner/repo#2', ['priority: medium']],
      ]);

      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        const result = new Map<string, string[] | 'not-found'>();
        for (const ref of refs) {
          result.set(ref, labelMap.get(ref) || 'not-found');
        }
        return result;
      };

      const resolver = createPriorityResolver(reader, console.log);

      const items: BacklogItem[] = [
        { slug: 'feature-1', sourceRef: 'owner/repo#1' },
        { slug: 'feature-2', sourceRef: 'owner/repo#2' },
      ];

      // First call: refresh to populate cache
      await resolver.resolve(items, { refresh: true });
      expect(callLog).toEqual(['read:owner/repo#1,owner/repo#2']);

      // Second call: cached scan with refresh: false
      callLog.length = 0;
      const result = await resolver.resolve(items, { refresh: false });

      expect(callLog).toEqual([]); // no reader calls
      expect(result.mode).toBe('banded');
      expect(result.bands.get('owner/repo#1')).toBe('high');
      expect(result.bands.get('owner/repo#2')).toBe('medium');
    });
  });

  describe('changed label on refresh — re-fetch, update cache', () => {
    it('resolve with refresh: true re-fetches, cache updates on label change', async () => {
      const callLog: string[] = [];
      let labelMap = new Map<string, string[]>([
        ['owner/repo#1', ['priority: low']],
      ]);

      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        const result = new Map<string, string[] | 'not-found'>();
        for (const ref of refs) {
          result.set(ref, labelMap.get(ref) || 'not-found');
        }
        return result;
      };

      const resolver = createPriorityResolver(reader, console.log);

      const items: BacklogItem[] = [
        { slug: 'feature-1', sourceRef: 'owner/repo#1' },
      ];

      // First refresh: label is 'low'
      let result = await resolver.resolve(items, { refresh: true });
      expect(result.mode).toBe('banded');
      expect(result.bands.get('owner/repo#1')).toBe('low');
      expect(callLog).toEqual(['read:owner/repo#1']);

      // Change the label in the fake reader
      labelMap = new Map<string, string[]>([
        ['owner/repo#1', ['priority: high']],
      ]);
      callLog.length = 0;

      // Second refresh: should re-fetch and get new label
      result = await resolver.resolve(items, { refresh: true });
      expect(result.mode).toBe('banded');
      expect(result.bands.get('owner/repo#1')).toBe('high');
      expect(callLog).toEqual(['read:owner/repo#1']);
    });
  });
});

describe('orderBacklog — banded stable sort with priority resolution', () => {
  it('unlinked first: items with no sourceRef go to no-issue band', () => {
    const items: BacklogItem[] = [
      { slug: 'item-a', sourceRef: 'issue-1' },
      { slug: 'item-b' }, // no sourceRef
      { slug: 'item-c', sourceRef: 'issue-2' },
    ];
    const bands = new Map([
      ['issue-1', 'medium'],
      ['issue-2', 'low'],
    ]);
    const res: PriorityResolution = { mode: 'banded', bands };

    const result = orderBacklog(items, res);

    // Unlinked item-b should come first (no-issue band = 0)
    expect(result[0].slug).toBe('item-b');
    expect(result[1].slug).toBe('item-a'); // medium
    expect(result[2].slug).toBe('item-c'); // low
  });

  it('high → medium → low order: three items with explicit band assignments', () => {
    const items: BacklogItem[] = [
      { slug: 'item-a', sourceRef: 'issue-a' },
      { slug: 'item-b', sourceRef: 'issue-b' },
      { slug: 'item-c', sourceRef: 'issue-c' },
    ];
    const bands = new Map([
      ['issue-a', 'low'],
      ['issue-b', 'high'],
      ['issue-c', 'medium'],
    ]);
    const res: PriorityResolution = { mode: 'banded', bands };

    const result = orderBacklog(items, res);

    // Order should be: high (issue-b) → medium (issue-c) → low (issue-a)
    expect(result[0].slug).toBe('item-b');
    expect(result[1].slug).toBe('item-c');
    expect(result[2].slug).toBe('item-a');
  });

  it('low beats unlabeled: items with low band come before unlabeled items', () => {
    const items: BacklogItem[] = [
      { slug: 'item-unlabeled', sourceRef: 'issue-no-band' }, // has sourceRef but no band → unlabeled
      { slug: 'item-low', sourceRef: 'issue-low' },
    ];
    const bands = new Map([
      ['issue-low', 'low'],
    ]);
    const res: PriorityResolution = { mode: 'banded', bands };

    const result = orderBacklog(items, res);

    // low (rank 3) should come before unlabeled (rank 4)
    expect(result[0].slug).toBe('item-low');
    expect(result[1].slug).toBe('item-unlabeled');
  });

  it('same-band stable order: multiple items in same band keep input order', () => {
    const items: BacklogItem[] = [
      { slug: 'item-a', sourceRef: 'issue-a', createdAt: '2024-01-03' },
      { slug: 'item-b', sourceRef: 'issue-b', createdAt: '2024-01-01' },
      { slug: 'item-c', sourceRef: 'issue-c', createdAt: '2024-01-02' },
    ];
    const bands = new Map([
      ['issue-a', 'medium'],
      ['issue-b', 'medium'],
      ['issue-c', 'medium'],
    ]);
    const res: PriorityResolution = { mode: 'banded', bands };

    const result = orderBacklog(items, res);

    // All in same band, so input order preserved
    expect(result[0].slug).toBe('item-a');
    expect(result[1].slug).toBe('item-b');
    expect(result[2].slug).toBe('item-c');
  });

  it('all medium unchanged: backlog of all medium items returns identical to input', () => {
    const items: BacklogItem[] = [
      { slug: 'item-1', sourceRef: 'issue-1' },
      { slug: 'item-2', sourceRef: 'issue-2' },
      { slug: 'item-3', sourceRef: 'issue-3' },
    ];
    const bands = new Map([
      ['issue-1', 'medium'],
      ['issue-2', 'medium'],
      ['issue-3', 'medium'],
    ]);
    const res: PriorityResolution = { mode: 'banded', bands };

    const result = orderBacklog(items, res);

    // Output should be identical to input
    expect(result).toHaveLength(items.length);
    expect(result[0].slug).toBe(items[0].slug);
    expect(result[1].slug).toBe(items[1].slug);
    expect(result[2].slug).toBe(items[2].slug);
  });

  it('band annotation: output items have band field set', () => {
    const items: BacklogItem[] = [
      { slug: 'item-high', sourceRef: 'issue-high' },
      { slug: 'item-medium', sourceRef: 'issue-medium' },
      { slug: 'item-unlinked' },
    ];
    const bands = new Map([
      ['issue-high', 'high'],
      ['issue-medium', 'medium'],
    ]);
    const res: PriorityResolution = { mode: 'banded', bands };

    const result = orderBacklog(items, res);

    // Check that band field is set on each item
    expect(result[0].band).toBe('no-issue'); // unlinked
    expect(result[1].band).toBe('high');
    expect(result[2].band).toBe('medium');
  });

  it('fallback mode: returns input order without band annotations', () => {
    const items: BacklogItem[] = [
      { slug: 'item-a' },
      { slug: 'item-b' },
      { slug: 'item-c' },
    ];
    const res: PriorityResolution = { mode: 'fallback' };

    const result = orderBacklog(items, res);

    // Should return in input order
    expect(result[0].slug).toBe('item-a');
    expect(result[1].slug).toBe('item-b');
    expect(result[2].slug).toBe('item-c');
  });

  it('off mode: returns input order without band annotations', () => {
    const items: BacklogItem[] = [
      { slug: 'item-a' },
      { slug: 'item-b' },
      { slug: 'item-c' },
    ];
    const res: PriorityResolution = { mode: 'off' };

    const result = orderBacklog(items, res);

    // Should return in input order
    expect(result[0].slug).toBe('item-a');
    expect(result[1].slug).toBe('item-b');
    expect(result[2].slug).toBe('item-c');
  });

  it('pure function: does not mutate input items', () => {
    const items: BacklogItem[] = [
      { slug: 'item-a', sourceRef: 'issue-a' },
    ];
    const itemsCopy = JSON.parse(JSON.stringify(items));
    const bands = new Map([['issue-a', 'high']]);
    const res: PriorityResolution = { mode: 'banded', bands };

    orderBacklog(items, res);

    // Input should not be modified (except band field may be added)
    expect(items[0].slug).toBe(itemsCopy[0].slug);
    expect(items[0].sourceRef).toBe(itemsCopy[0].sourceRef);
  });

  it('complex scenario: mixed bands with stable ordering within bands', () => {
    const items: BacklogItem[] = [
      { slug: 'a1', sourceRef: 'issue-a' },
      { slug: 'b1', sourceRef: 'issue-b' },
      { slug: 'c1' },
      { slug: 'a2', sourceRef: 'issue-a2' },
      { slug: 'd1', sourceRef: 'issue-d' },
      { slug: 'b2', sourceRef: 'issue-b2' },
    ];
    const bands = new Map([
      ['issue-a', 'low'],
      ['issue-b', 'high'],
      ['issue-a2', 'low'],
      ['issue-d', 'medium'],
      ['issue-b2', 'high'],
    ]);
    const res: PriorityResolution = { mode: 'banded', bands };

    const result = orderBacklog(items, res);

    // Expected order:
    // no-issue: c1 (index 2 in original)
    // high: b1 (index 1 in original), b2 (index 5 in original)
    // medium: d1 (index 4 in original)
    // low: a1 (index 0 in original), a2 (index 3 in original)

    expect(result[0].slug).toBe('c1');   // no-issue
    expect(result[1].slug).toBe('b1');   // high (first)
    expect(result[2].slug).toBe('b2');   // high (second)
    expect(result[3].slug).toBe('d1');   // medium
    expect(result[4].slug).toBe('a1');   // low (first)
    expect(result[5].slug).toBe('a2');   // low (second)
  });
});
