import { describe, it, expect } from 'vitest';
import { parsePriorityLabels, createPriorityResolver, type PriorityResolution } from '../src/engine/backlog-priority.js';
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
