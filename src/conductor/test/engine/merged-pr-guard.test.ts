/**
 * Tests for `checkMergedPrGuard` in src/engine/merged-pr-guard.ts (Task 1).
 *
 * Story: Guard verdict mapping — checkMergedPrGuard
 *
 * The guard wraps prMergeState and maps verdicts to 'merged' | 'proceed':
 * - MERGED → 'merged'
 * - OPEN/CLOSED/NOTFOUND/UNKNOWN → 'proceed' (fail-open)
 * - gh runner throws → 'proceed'
 * - prUrl undefined → 'proceed' with zero gh invocations
 */

import { describe, it, expect } from 'vitest';
import { checkMergedPrGuard } from '../../src/engine/merged-pr-guard.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

const PR_URL = 'https://github.com/foo/bar/pull/42';

/**
 * Scripted GhRunner that records calls and can simulate prMergeState verdicts.
 */
function fakeGh(
  verdict: 'MERGED' | 'OPEN' | 'CLOSED' | 'NOTFOUND' | 'UNKNOWN' | 'throw',
): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args, _opts) => {
    calls.push([...args]);
    if (verdict === 'throw') {
      throw new Error('gh runner failure');
    }
    return {
      stdout: JSON.stringify({
        state: verdict,
        mergeable: 'UNKNOWN',
        statusCheckRollup: [],
        labels: [],
      }),
    };
  };
  return { gh, calls };
}

describe('engine/merged-pr-guard — checkMergedPrGuard', () => {
  describe('verdict mapping', () => {
    it('MERGED → "merged"', async () => {
      const { gh } = fakeGh('MERGED');
      const result = await checkMergedPrGuard(gh, '/repo', PR_URL);
      expect(result).toBe('merged');
    });

    it('OPEN → "proceed"', async () => {
      const { gh } = fakeGh('OPEN');
      const result = await checkMergedPrGuard(gh, '/repo', PR_URL);
      expect(result).toBe('proceed');
    });

    it('CLOSED → "proceed"', async () => {
      const { gh } = fakeGh('CLOSED');
      const result = await checkMergedPrGuard(gh, '/repo', PR_URL);
      expect(result).toBe('proceed');
    });

    it('NOTFOUND → "proceed"', async () => {
      const { gh } = fakeGh('NOTFOUND');
      const result = await checkMergedPrGuard(gh, '/repo', PR_URL);
      expect(result).toBe('proceed');
    });

    it('UNKNOWN → "proceed"', async () => {
      const { gh } = fakeGh('UNKNOWN');
      const result = await checkMergedPrGuard(gh, '/repo', PR_URL);
      expect(result).toBe('proceed');
    });

    it('gh runner throws → "proceed"', async () => {
      const { gh } = fakeGh('throw');
      const result = await checkMergedPrGuard(gh, '/repo', PR_URL);
      expect(result).toBe('proceed');
    });
  });

  describe('no prUrl behavior', () => {
    it('undefined prUrl → "proceed" with zero gh invocations', async () => {
      const { gh, calls } = fakeGh('MERGED');
      const result = await checkMergedPrGuard(gh, '/repo', undefined);
      expect(result).toBe('proceed');
      expect(calls).toHaveLength(0);
    });
  });

  describe('logging', () => {
    it('logs gh errors at debug level', async () => {
      const logs: string[] = [];
      const { gh } = fakeGh('throw');
      await checkMergedPrGuard(gh, '/repo', PR_URL, (msg) => logs.push(msg));
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]).toContain('error');
    });
  });
});
