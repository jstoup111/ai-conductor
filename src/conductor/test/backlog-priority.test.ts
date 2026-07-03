import { describe, it, expect } from 'vitest';
import {
  parsePriorityLabels,
  createPriorityResolver,
  orderBacklog,
  ghIssueLabelReader,
  type PriorityResolution,
  type ExecRunner,
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

  describe('zero-lookup cases — never call reader when not needed', () => {
    it('all-unlinked items: backlog with no sourceRef fields → zero reader calls', async () => {
      const callLog: string[] = [];
      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        return new Map<string, string[]>();
      };

      const resolver = createPriorityResolver(reader, console.log);

      const items: BacklogItem[] = [
        { slug: 'feature-1' }, // no sourceRef
        { slug: 'feature-2' }, // no sourceRef
        { slug: 'feature-3' }, // no sourceRef
      ];

      const result = await resolver.resolve(items, { refresh: true });

      // Verify zero reader calls
      expect(callLog).toEqual([]);

      // Verify all items get 'no-issue' band
      expect(result.mode).toBe('banded');
      expect(result.bands.get('feature-1')).toBe('no-issue');
      expect(result.bands.get('feature-2')).toBe('no-issue');
      expect(result.bands.get('feature-3')).toBe('no-issue');
    });

    it('empty backlog: empty items array → zero reader calls, empty resolution', async () => {
      const callLog: string[] = [];
      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        return new Map<string, string[]>();
      };

      const resolver = createPriorityResolver(reader, console.log);

      const items: BacklogItem[] = [];

      const result = await resolver.resolve(items, { refresh: true });

      // Verify zero reader calls
      expect(callLog).toEqual([]);

      // Verify empty resolution
      expect(result.mode).toBe('banded');
      expect(result.bands.size).toBe(0);
    });

    it('garbled marker (missing sourceRef): item without sourceRef treated as no-issue, reader never called', async () => {
      const callLog: string[] = [];
      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        return new Map<string, string[]>();
      };

      const resolver = createPriorityResolver(reader, console.log);

      const items: BacklogItem[] = [
        { slug: 'garbled-item' }, // sourceRef field missing (upstream garbled the marker)
      ];

      const result = await resolver.resolve(items, { refresh: true });

      // Verify reader never called (zero calls for the unlinked item)
      expect(callLog).toEqual([]);

      // Verify item treated as 'no-issue' (not 'unlabeled', not undefined)
      expect(result.mode).toBe('banded');
      expect(result.bands.get('garbled-item')).toBe('no-issue');
    });
  });

  describe('outage handling — fail-soft fallback + once-per-outage warning', () => {

  describe('missing/malformed data — 404s and empty labels as data, not outage', () => {
    it('not-found issue (404): reader returns not-found → item gets unlabeled band, others unchanged', async () => {
      const warnLog: string[] = [];
      const callLog: string[] = [];
      const labelMap = new Map<string, string[] | 'not-found'>([
        ['owner/repo#1', ['priority: high']],
        ['owner/repo#2', 'not-found'], // 404: deleted issue
        ['owner/repo#3', ['priority: low']],
      ]);

      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        const result = new Map<string, string[] | 'not-found'>();
        for (const ref of refs) {
          if (labelMap.has(ref)) {
            result.set(ref, labelMap.get(ref)!);
          }
        }
        return result;
      };

      const resolver = createPriorityResolver(reader, (msg: string) => warnLog.push(msg));

      const items: BacklogItem[] = [
        { slug: 'feature-1', sourceRef: 'owner/repo#1' },
        { slug: 'feature-2', sourceRef: 'owner/repo#2' }, // not-found
        { slug: 'feature-3', sourceRef: 'owner/repo#3' },
      ];

      const result = await resolver.resolve(items, { refresh: true });

      // Verify reader was called
      expect(callLog).toEqual(['read:owner/repo#1,owner/repo#2,owner/repo#3']);

      // Verify bands
      expect(result.mode).toBe('banded');
      expect(result.bands.get('owner/repo#1')).toBe('high');
      expect(result.bands.get('owner/repo#2')).toBe('unlabeled'); // not-found → unlabeled (data, not outage)
      expect(result.bands.get('owner/repo#3')).toBe('low');

      // Verify zero outage warnings for per-item missing data
      expect(warnLog).toEqual([]);
    });

    it('empty labels: reader returns empty array → item gets unlabeled band', async () => {
      const warnLog: string[] = [];
      const callLog: string[] = [];
      const labelMap = new Map<string, string[]>([
        ['owner/repo#1', []],  // no labels at all
        ['owner/repo#2', ['priority: medium']],
      ]);

      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        const result = new Map<string, string[] | 'not-found'>();
        for (const ref of refs) {
          if (labelMap.has(ref)) {
            result.set(ref, labelMap.get(ref)!);
          }
        }
        return result;
      };

      const resolver = createPriorityResolver(reader, (msg: string) => warnLog.push(msg));

      const items: BacklogItem[] = [
        { slug: 'feature-1', sourceRef: 'owner/repo#1' }, // empty labels
        { slug: 'feature-2', sourceRef: 'owner/repo#2' },
      ];

      const result = await resolver.resolve(items, { refresh: true });

      expect(callLog).toEqual(['read:owner/repo#1,owner/repo#2']);
      expect(result.mode).toBe('banded');
      expect(result.bands.get('owner/repo#1')).toBe('unlabeled'); // empty → unlabeled (no priority extracted)
      expect(result.bands.get('owner/repo#2')).toBe('medium');

      // No warnings for empty labels data
      expect(warnLog).toEqual([]);
    });

    it('closed issue: reader returns labels from closed issue → honors labels, ignores state', async () => {
      const warnLog: string[] = [];
      const callLog: string[] = [];
      const labelMap = new Map<string, string[]>([
        ['owner/repo#1', ['priority: high', 'status: closed']], // closed issue, but has priority label
        ['owner/repo#2', ['status: closed']], // closed with no priority
      ]);

      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        const result = new Map<string, string[] | 'not-found'>();
        for (const ref of refs) {
          if (labelMap.has(ref)) {
            result.set(ref, labelMap.get(ref)!);
          }
        }
        return result;
      };

      const resolver = createPriorityResolver(reader, (msg: string) => warnLog.push(msg));

      const items: BacklogItem[] = [
        { slug: 'feature-1', sourceRef: 'owner/repo#1' }, // closed with priority
        { slug: 'feature-2', sourceRef: 'owner/repo#2' }, // closed without priority
      ];

      const result = await resolver.resolve(items, { refresh: true });

      expect(callLog).toEqual(['read:owner/repo#1,owner/repo#2']);
      expect(result.mode).toBe('banded');
      expect(result.bands.get('owner/repo#1')).toBe('high'); // honors labels despite closed state
      expect(result.bands.get('owner/repo#2')).toBe('unlabeled'); // closed without priority → unlabeled

      // No warnings for closed issues
      expect(warnLog).toEqual([]);
    });

    it('malformed labels: reader returns non-priority labels → item gets unlabeled, no fallback triggered', async () => {
      const warnLog: string[] = [];
      const callLog: string[] = [];
      const labelMap = new Map<string, string[]>([
        ['owner/repo#1', ['bug', 'feature', 'documentation']], // labels but no priority
        ['owner/repo#2', ['priority: urgent']], // malformed priority (not high/medium/low)
        ['owner/repo#3', ['priority: high']],
      ]);

      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        const result = new Map<string, string[] | 'not-found'>();
        for (const ref of refs) {
          if (labelMap.has(ref)) {
            result.set(ref, labelMap.get(ref)!);
          }
        }
        return result;
      };

      const resolver = createPriorityResolver(reader, (msg: string) => warnLog.push(msg));

      const items: BacklogItem[] = [
        { slug: 'feature-1', sourceRef: 'owner/repo#1' }, // non-priority labels
        { slug: 'feature-2', sourceRef: 'owner/repo#2' }, // malformed priority
        { slug: 'feature-3', sourceRef: 'owner/repo#3' }, // valid priority
      ];

      const result = await resolver.resolve(items, { refresh: true });

      expect(callLog).toEqual(['read:owner/repo#1,owner/repo#2,owner/repo#3']);
      expect(result.mode).toBe('banded'); // stays in banded mode, no fallback
      expect(result.bands.get('owner/repo#1')).toBe('unlabeled'); // no priority label → unlabeled
      expect(result.bands.get('owner/repo#2')).toBe('unlabeled'); // malformed priority → unlabeled
      expect(result.bands.get('owner/repo#3')).toBe('high'); // valid priority honored

      // No warnings for per-item malformed data
      expect(warnLog).toEqual([]);
    });
  });
    it('reader throws → returns fallback, cache cleared, exactly one warn logged', async () => {
      const warnLog: string[] = [];
      const callLog: string[] = [];

      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        throw new Error('transport failure');
      };

      const resolver = createPriorityResolver(reader, (msg: string) => warnLog.push(msg));

      const items: BacklogItem[] = [{ slug: 'feature-1', sourceRef: 'owner/repo#1' }];

      // First call with reader throwing
      const result = await resolver.resolve(items, { refresh: true });

      expect(result.mode).toBe('fallback');
      expect(warnLog.length).toBe(1);
      expect(warnLog[0]).toContain('transport failure');
    });

    it('repeated failures → exactly one warning for entire outage', async () => {
      const warnLog: string[] = [];
      const callLog: string[] = [];

      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        throw new Error('transport failure');
      };

      const resolver = createPriorityResolver(reader, (msg: string) => warnLog.push(msg));

      const items: BacklogItem[] = [{ slug: 'feature-1', sourceRef: 'owner/repo#1' }];

      // First failing resolve call
      let result = await resolver.resolve(items, { refresh: true });
      expect(result.mode).toBe('fallback');
      expect(warnLog.length).toBe(1);

      // Second failing resolve call (same outage)
      result = await resolver.resolve(items, { refresh: true });
      expect(result.mode).toBe('fallback');
      // Should still have exactly 1 warning (no new warning added)
      expect(warnLog.length).toBe(1);
    });

    it('success resumes banded mode + resets warning flag', async () => {
      const warnLog: string[] = [];
      const callLog: string[] = [];
      let shouldFail = true;
      const labelMap = new Map<string, string[]>([['owner/repo#1', ['priority: high']]]);

      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        if (shouldFail) {
          throw new Error('transport failure');
        }
        const result = new Map<string, string[] | 'not-found'>();
        for (const ref of refs) {
          result.set(ref, labelMap.get(ref) || 'not-found');
        }
        return result;
      };

      const resolver = createPriorityResolver(reader, (msg: string) => warnLog.push(msg));

      const items: BacklogItem[] = [{ slug: 'feature-1', sourceRef: 'owner/repo#1' }];

      // First call: fails
      let result = await resolver.resolve(items, { refresh: true });
      expect(result.mode).toBe('fallback');
      expect(warnLog.length).toBe(1);

      // Second call: succeeds (reader no longer throws)
      shouldFail = false;
      result = await resolver.resolve(items, { refresh: true });
      expect(result.mode).toBe('banded');
      expect(result.bands.get('owner/repo#1')).toBe('high');
      // Warning count stays at 1 from the previous outage
      expect(warnLog.length).toBe(1);
    });

    it('new failure after recovery → warns again (new outage)', async () => {
      const warnLog: string[] = [];
      const callLog: string[] = [];
      let shouldFail = false;
      const labelMap = new Map<string, string[]>([['owner/repo#1', ['priority: high']]]);

      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        if (shouldFail) {
          throw new Error('transport failure');
        }
        const result = new Map<string, string[] | 'not-found'>();
        for (const ref of refs) {
          result.set(ref, labelMap.get(ref) || 'not-found');
        }
        return result;
      };

      const resolver = createPriorityResolver(reader, (msg: string) => warnLog.push(msg));

      const items: BacklogItem[] = [{ slug: 'feature-1', sourceRef: 'owner/repo#1' }];

      // First call: succeeds
      let result = await resolver.resolve(items, { refresh: true });
      expect(result.mode).toBe('banded');
      expect(result.bands.get('owner/repo#1')).toBe('high');
      expect(warnLog.length).toBe(0); // No warning on success

      // Second call: fails (new outage)
      shouldFail = true;
      result = await resolver.resolve(items, { refresh: true });
      expect(result.mode).toBe('fallback');
      expect(warnLog.length).toBe(1); // New warning for new outage

      // Third call: fails again (same outage)
      result = await resolver.resolve(items, { refresh: true });
      expect(result.mode).toBe('fallback');
      expect(warnLog.length).toBe(1); // Still only 1 warning
    });

    it('mid-scan partial failure → whole-scan fallback, cache cleared, warn logged', async () => {
      const warnLog: string[] = [];
      const callLog: string[] = [];
      let failOnSecondCall = false;

      let callCount = 0;
      const reader = async (refs: string[]) => {
        callLog.push(`read:${refs.join(',')}`);
        callCount++;
        if (failOnSecondCall && callCount > 0) {
          throw new Error('transport failure during scan');
        }
        const result = new Map<string, string[] | 'not-found'>();
        for (const ref of refs) {
          result.set(ref, []);
        }
        return result;
      };

      const resolver = createPriorityResolver(reader, (msg: string) => warnLog.push(msg));

      const items: BacklogItem[] = [
        { slug: 'feature-1', sourceRef: 'owner/repo#1' },
        { slug: 'feature-2', sourceRef: 'owner/repo#2' },
      ];

      // First refresh: succeeds, populates cache
      failOnSecondCall = false;
      let result = await resolver.resolve(items, { refresh: true });
      expect(result.mode).toBe('banded');
      expect(warnLog.length).toBe(0);

      // Second refresh: reader throws mid-scan
      failOnSecondCall = true;
      result = await resolver.resolve(items, { refresh: true });
      expect(result.mode).toBe('fallback'); // Whole-scan fallback, not partial banded
      expect(warnLog.length).toBe(1); // Exactly one warning
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

describe('orderBacklog — permutation and determinism properties', () => {
  /**
   * Helper: Simple seeded random number generator for reproducible test data.
   * Uses linear congruential generator.
   */
  function seededRandom(seed: number): () => number {
    return () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
  }

  /**
   * Helper: Generate randomized backlog items with predictable seed.
   */
  function generateRandomBacklog(
    count: number,
    seed: number
  ): BacklogItem[] {
    const rng = seededRandom(seed);
    const items: BacklogItem[] = [];

    for (let i = 0; i < count; i++) {
      const hasSourceRef = rng() > 0.3; // 70% have sourceRef
      const item: BacklogItem = {
        slug: `item-${i}`,
        sourceRef: hasSourceRef ? `issue-${Math.floor(rng() * 10)}` : undefined,
        createdAt: `2024-01-${(i % 28) + 1}`,
      };
      items.push(item);
    }

    return items;
  }

  /**
   * Helper: Extract all slugs from backlog items for comparison.
   */
  function extractSlugs(items: BacklogItem[]): string[] {
    return items.map((item) => item.slug);
  }

  /**
   * Helper: Check if array a is a permutation of array b (same multiset).
   */
  function isPermutation<T>(a: T[], b: T[]): boolean {
    if (a.length !== b.length) return false;
    const aCopy = [...a].sort();
    const bCopy = [...b].sort();
    return aCopy.every((val, idx) => val === bCopy[idx]);
  }

  describe('permutation property — output is exact permutation of input', () => {
    it('randomized input: verifies output is permutation (10 items, seeded)', () => {
      const seed = 12345;
      const items = generateRandomBacklog(10, seed);
      const inputSlugs = extractSlugs(items);

      const bands = new Map<string, PriorityResolution['bands'] extends Map<string, infer V> ? V : never>([
        ['issue-0', 'high'],
        ['issue-1', 'medium'],
        ['issue-2', 'low'],
      ]);
      const res: PriorityResolution = { mode: 'banded', bands };

      const result = orderBacklog(items, res);
      const outputSlugs = extractSlugs(result);

      // Verify permutation: same length, same multiset
      expect(result).toHaveLength(items.length);
      expect(isPermutation(inputSlugs, outputSlugs)).toBe(true);
    });

    it('randomized input: larger backlog (50 items, seeded)', () => {
      const seed = 67890;
      const items = generateRandomBacklog(50, seed);
      const inputSlugs = extractSlugs(items);

      // Create bands for all sourceRefs in the backlog
      const bands = new Map<string, PriorityResolution['bands'] extends Map<string, infer V> ? V : never>();
      for (let i = 0; i < 10; i++) {
        const priorities: Array<PriorityResolution['bands'] extends Map<string, infer V> ? V : never> = ['high', 'medium', 'low'];
        bands.set(`issue-${i}`, priorities[i % 3]);
      }
      const res: PriorityResolution = { mode: 'banded', bands };

      const result = orderBacklog(items, res);
      const outputSlugs = extractSlugs(result);

      // Verify exact permutation
      expect(result).toHaveLength(items.length);
      expect(isPermutation(inputSlugs, outputSlugs)).toBe(true);
    });

    it('no items added or dropped from output', () => {
      const items: BacklogItem[] = [
        { slug: 'x', sourceRef: 'issue-1' },
        { slug: 'y', sourceRef: 'issue-2' },
        { slug: 'z' },
      ];
      const bands = new Map([
        ['issue-1', 'high'],
        ['issue-2', 'low'],
      ]);
      const res: PriorityResolution = { mode: 'banded', bands };

      const result = orderBacklog(items, res);

      // Length preserved
      expect(result).toHaveLength(3);

      // All input slugs present
      const resultSlugs = new Set(result.map((item) => item.slug));
      expect(resultSlugs.has('x')).toBe(true);
      expect(resultSlugs.has('y')).toBe(true);
      expect(resultSlugs.has('z')).toBe(true);

      // No duplicates
      expect(resultSlugs.size).toBe(3);
    });

    it('other fields (sourceRef, createdAt) are not mutated', () => {
      const items: BacklogItem[] = [
        { slug: 'item-1', sourceRef: 'issue-99', createdAt: '2024-06-15' },
        { slug: 'item-2', sourceRef: 'issue-88', createdAt: '2024-07-20' },
      ];
      const bands = new Map([
        ['issue-99', 'high'],
        ['issue-88', 'medium'],
      ]);
      const res: PriorityResolution = { mode: 'banded', bands };

      const result = orderBacklog(items, res);

      // Find reordered items and verify fields preserved
      const item1Result = result.find((item) => item.slug === 'item-1');
      const item2Result = result.find((item) => item.slug === 'item-2');

      expect(item1Result?.sourceRef).toBe('issue-99');
      expect(item1Result?.createdAt).toBe('2024-06-15');
      expect(item2Result?.sourceRef).toBe('issue-88');
      expect(item2Result?.createdAt).toBe('2024-07-20');
    });
  });

  describe('determinism property — repeated calls produce identical results', () => {
    it('same input, called twice: output is identical', () => {
      const items: BacklogItem[] = [
        { slug: 'a', sourceRef: 'issue-x' },
        { slug: 'b', sourceRef: 'issue-y' },
        { slug: 'c' },
      ];
      const bands = new Map([
        ['issue-x', 'low'],
        ['issue-y', 'high'],
      ]);
      const res: PriorityResolution = { mode: 'banded', bands };

      const result1 = orderBacklog(items, res);
      const result2 = orderBacklog(items, res);

      // Verify identical output
      expect(result1).toEqual(result2);
      expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
    });

    it('same input, called three times: all outputs identical', () => {
      const items = generateRandomBacklog(20, 111);
      const bands = new Map<string, PriorityResolution['bands'] extends Map<string, infer V> ? V : never>([
        ['issue-0', 'high'],
        ['issue-5', 'medium'],
        ['issue-9', 'low'],
      ]);
      const res: PriorityResolution = { mode: 'banded', bands };

      const result1 = orderBacklog(items, res);
      const result2 = orderBacklog(items, res);
      const result3 = orderBacklog(items, res);

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
    });

    it('different resolution but same items: order changes consistently', () => {
      const items: BacklogItem[] = [
        { slug: 'a', sourceRef: 'issue-1' },
        { slug: 'b', sourceRef: 'issue-2' },
      ];

      // First resolution: issue-1 is high, issue-2 is low
      const res1: PriorityResolution = {
        mode: 'banded',
        bands: new Map([
          ['issue-1', 'high'],
          ['issue-2', 'low'],
        ]),
      };

      // Second resolution: issue-1 is low, issue-2 is high (reversed)
      const res2: PriorityResolution = {
        mode: 'banded',
        bands: new Map([
          ['issue-1', 'low'],
          ['issue-2', 'high'],
        ]),
      };

      const result1a = orderBacklog(items, res1);
      const result1b = orderBacklog(items, res1);
      const result2a = orderBacklog(items, res2);
      const result2b = orderBacklog(items, res2);

      // Each resolution is deterministic
      expect(result1a).toEqual(result1b);
      expect(result2a).toEqual(result2b);

      // But different resolutions yield different orders
      expect(result1a[0].slug).toBe('a'); // high comes first
      expect(result2a[0].slug).toBe('b'); // high comes first (now issue-2)
    });
  });

  describe('fallback/off modes — permutation property with mode preservation', () => {
    it('fallback mode: output is permutation, returns input order', () => {
      const items: BacklogItem[] = [
        { slug: 'first', sourceRef: 'issue-a' },
        { slug: 'second', sourceRef: 'issue-b' },
        { slug: 'third' },
      ];
      const res: PriorityResolution = { mode: 'fallback' };

      const result = orderBacklog(items, res);

      // Verify permutation
      expect(isPermutation(extractSlugs(items), extractSlugs(result))).toBe(true);

      // Verify input order preserved
      expect(result[0].slug).toBe('first');
      expect(result[1].slug).toBe('second');
      expect(result[2].slug).toBe('third');
    });

    it('fallback mode: deterministic (called twice)', () => {
      const items = generateRandomBacklog(15, 222);
      const res: PriorityResolution = { mode: 'fallback' };

      const result1 = orderBacklog(items, res);
      const result2 = orderBacklog(items, res);

      expect(result1).toEqual(result2);
    });

    it('off mode: output is permutation, returns input order', () => {
      const items: BacklogItem[] = [
        { slug: 'a' },
        { slug: 'b', sourceRef: 'issue-x' },
        { slug: 'c' },
      ];
      const res: PriorityResolution = { mode: 'off' };

      const result = orderBacklog(items, res);

      // Verify permutation
      expect(isPermutation(extractSlugs(items), extractSlugs(result))).toBe(true);

      // Verify input order preserved
      expect(result[0].slug).toBe('a');
      expect(result[1].slug).toBe('b');
      expect(result[2].slug).toBe('c');
    });

    it('off mode: deterministic (called twice)', () => {
      const items = generateRandomBacklog(25, 333);
      const res: PriorityResolution = { mode: 'off' };

      const result1 = orderBacklog(items, res);
      const result2 = orderBacklog(items, res);

      expect(result1).toEqual(result2);
    });

    it('fallback and off modes both preserve input order identically', () => {
      const items: BacklogItem[] = [
        { slug: 'item-1', sourceRef: 'issue-1' },
        { slug: 'item-2' },
        { slug: 'item-3', sourceRef: 'issue-3' },
      ];

      const fallbackRes: PriorityResolution = { mode: 'fallback' };
      const offRes: PriorityResolution = { mode: 'off' };

      const fallbackResult = orderBacklog(items, fallbackRes);
      const offResult = orderBacklog(items, offRes);

      // Both should preserve input order
      expect(extractSlugs(fallbackResult)).toEqual(['item-1', 'item-2', 'item-3']);
      expect(extractSlugs(offResult)).toEqual(['item-1', 'item-2', 'item-3']);
    });
  });

  describe('edge cases — permutation holds under edge conditions', () => {
    it('single item: permutation trivially true', () => {
      const items: BacklogItem[] = [{ slug: 'only' }];
      const res: PriorityResolution = { mode: 'fallback' };

      const result = orderBacklog(items, res);

      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('only');
    });

    it('empty input: returns empty output', () => {
      const items: BacklogItem[] = [];
      const res: PriorityResolution = { mode: 'banded', bands: new Map() };

      const result = orderBacklog(items, res);

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });

    it('all items with same band: permutation holds with stable order', () => {
      const items: BacklogItem[] = [
        { slug: 'z', sourceRef: 'issue-1' },
        { slug: 'a', sourceRef: 'issue-2' },
        { slug: 'm', sourceRef: 'issue-3' },
      ];
      const bands = new Map([
        ['issue-1', 'medium'],
        ['issue-2', 'medium'],
        ['issue-3', 'medium'],
      ]);
      const res: PriorityResolution = { mode: 'banded', bands };

      const result = orderBacklog(items, res);

      expect(isPermutation(extractSlugs(items), extractSlugs(result))).toBe(true);
      // Should preserve input order when all in same band
      expect(extractSlugs(result)).toEqual(['z', 'a', 'm']);
    });

    it('all items unlinked (no sourceRef): all in no-issue band, permutation holds', () => {
      const items: BacklogItem[] = [
        { slug: 'unlinked-1' },
        { slug: 'unlinked-2' },
        { slug: 'unlinked-3' },
      ];
      const res: PriorityResolution = { mode: 'banded', bands: new Map() };

      const result = orderBacklog(items, res);

      expect(isPermutation(extractSlugs(items), extractSlugs(result))).toBe(true);
      expect(result).toHaveLength(3);
      expect(result.every((item) => item.band === 'no-issue')).toBe(true);
    });
  });
});

describe('ghIssueLabelReader — GitHub issue label fetcher via gh REST API', () => {
  describe('test 1: Build gh api command from sourceRef', () => {
    it('parses owner/repo#N and builds correct gh api argv', async () => {
      const callLog: Array<{ args: string[] }> = [];
      const runner: ExecRunner = async (args: string[], opts: { cwd: string }) => {
        callLog.push({ args });
        return { stdout: JSON.stringify({ labels: [{ name: 'priority: high' }] }) };
      };

      const reader = ghIssueLabelReader(runner);
      await reader(['owner/repo#123']);

      expect(callLog).toHaveLength(1);
      const args = callLog[0].args;
      expect(args[0]).toBe('api');
      expect(args).toContain('repos');
      expect(args).toContain('owner');
      expect(args).toContain('repo');
      expect(args).toContain('issues');
      expect(args).toContain('123');
    });
  });

  describe('test 2: Cross-repo refs', () => {
    it('handles multiple sourceRefs from different repos', async () => {
      const callLog: Array<{ args: string[] }> = [];
      const runner: ExecRunner = async (args: string[], opts: { cwd: string }) => {
        callLog.push({ args });
        // Return response based on which issue is being queried
        if (args.includes('456')) {
          return { stdout: JSON.stringify({ labels: [{ name: 'priority: medium' }] }) };
        }
        return { stdout: JSON.stringify({ labels: [{ name: 'priority: high' }] }) };
      };

      const reader = ghIssueLabelReader(runner);
      const result = await reader(['owner1/repo1#123', 'owner2/repo2#456']);

      expect(callLog).toHaveLength(2);
      expect(result.size).toBe(2);
      expect(result.get('owner1/repo1#123')).toEqual(['priority: high']);
      expect(result.get('owner2/repo2#456')).toEqual(['priority: medium']);
    });
  });

  describe('test 3: Label extraction', () => {
    it('extracts label names from JSON response labels array', async () => {
      const runner: ExecRunner = async () => {
        return {
          stdout: JSON.stringify({
            labels: [
              { name: 'priority: high' },
              { name: 'bug' },
              { name: 'feature' },
            ],
          }),
        };
      };

      const reader = ghIssueLabelReader(runner);
      const result = await reader(['owner/repo#1']);

      expect(result.get('owner/repo#1')).toEqual(['priority: high', 'bug', 'feature']);
    });

    it('handles empty labels array', async () => {
      const runner: ExecRunner = async () => {
        return { stdout: JSON.stringify({ labels: [] }) };
      };

      const reader = ghIssueLabelReader(runner);
      const result = await reader(['owner/repo#1']);

      expect(result.get('owner/repo#1')).toEqual([]);
    });
  });

  describe('test 4: HTTP 404 → not-found', () => {
    it('non-existent issue returns not-found (404)', async () => {
      const runner: ExecRunner = async () => {
        const err = new Error('HTTP 404: Not Found');
        (err as any).status = 404;
        throw err;
      };

      const reader = ghIssueLabelReader(runner);
      const result = await reader(['owner/repo#999']);

      expect(result.get('owner/repo#999')).toBe('not-found');
    });

    it('multiple refs with one 404', async () => {
      let callCount = 0;
      const runner: ExecRunner = async (args: string[]) => {
        callCount++;
        if (args.includes('999')) {
          const err = new Error('HTTP 404: Not Found');
          (err as any).status = 404;
          throw err;
        }
        return { stdout: JSON.stringify({ labels: [{ name: 'priority: high' }] }) };
      };

      const reader = ghIssueLabelReader(runner);
      const result = await reader(['owner/repo#123', 'owner/repo#999', 'owner/repo#456']);

      expect(result.get('owner/repo#123')).toEqual(['priority: high']);
      expect(result.get('owner/repo#999')).toBe('not-found');
      expect(result.get('owner/repo#456')).toEqual(['priority: high']);
    });
  });

  describe('test 5: Transport failure/ENOENT → throw', () => {
    it('non-404 transport error throws', async () => {
      const runner: ExecRunner = async () => {
        throw new Error('network timeout');
      };

      const reader = ghIssueLabelReader(runner);

      await expect(reader(['owner/repo#1'])).rejects.toThrow('network timeout');
    });

    it('ENOENT error throws', async () => {
      const runner: ExecRunner = async () => {
        const err = new Error('ENOENT: no such file or directory');
        (err as any).code = 'ENOENT';
        throw err;
      };

      const reader = ghIssueLabelReader(runner);

      await expect(reader(['owner/repo#1'])).rejects.toThrow('ENOENT');
    });

    it('500 error throws', async () => {
      const runner: ExecRunner = async () => {
        const err = new Error('HTTP 500: Internal Server Error');
        (err as any).status = 500;
        throw err;
      };

      const reader = ghIssueLabelReader(runner);

      await expect(reader(['owner/repo#1'])).rejects.toThrow('HTTP 500');
    });
  });
});
