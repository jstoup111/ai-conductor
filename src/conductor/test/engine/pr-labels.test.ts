import { describe, it, expect } from 'vitest';
import { classifyChecksOutcome, prMergeState, isMergeable } from '../../src/engine/pr-labels.js';

describe('checksOutcome classification', () => {
  describe('classifyChecksOutcome', () => {
    it('returns "failed" when rollup has one FAILURE + one PENDING', () => {
      const checks = [
        { status: 'COMPLETED', conclusion: 'FAILURE' },
        { status: 'IN_PROGRESS', conclusion: null },
      ];
      expect(classifyChecksOutcome(checks)).toBe('failed');
    });

    it('returns "pending" when all checks are running (IN_PROGRESS)', () => {
      const checks = [
        { status: 'IN_PROGRESS', conclusion: null },
        { status: 'IN_PROGRESS', conclusion: null },
      ];
      expect(classifyChecksOutcome(checks)).toBe('pending');
    });

    it('returns "green" when all checks are passing (SUCCESS)', () => {
      const checks = [
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
      ];
      expect(classifyChecksOutcome(checks)).toBe('green');
    });

    it('returns "none" when rollup is empty', () => {
      expect(classifyChecksOutcome([])).toBe('none');
    });

    it('returns "none" when rollup is null', () => {
      expect(classifyChecksOutcome(null as any)).toBe('none');
    });

    it('returns "none" when rollup is undefined', () => {
      expect(classifyChecksOutcome(undefined as any)).toBe('none');
    });

    // Adversarial / negative cases (Task 2)
    it('returns "pending" when entry has missing status', () => {
      const checks = [
        { status: undefined, conclusion: null },
      ];
      expect(classifyChecksOutcome(checks)).toBe('pending');
    });

    it('returns "pending" when entry has null status', () => {
      const checks = [
        { status: null, conclusion: null },
      ];
      expect(classifyChecksOutcome(checks)).toBe('pending');
    });

    it('returns "pending" when entry has garbage status (non-standard value)', () => {
      const checks = [
        { status: 'GARBAGE_STATUS', conclusion: null },
      ];
      expect(classifyChecksOutcome(checks)).toBe('pending');
    });

    it('returns "pending" when entry has missing conclusion on completed check', () => {
      const checks = [
        { status: 'COMPLETED', conclusion: undefined },
      ];
      expect(classifyChecksOutcome(checks)).toBe('pending');
    });

    it('returns "pending" when entry has garbage conclusion (non-standard value)', () => {
      const checks = [
        { status: 'COMPLETED', conclusion: 'GARBAGE_CONCLUSION' },
      ];
      expect(classifyChecksOutcome(checks)).toBe('pending');
    });

    it('returns "failed" when mixed with one valid FAILURE and one malformed entry', () => {
      const checks = [
        { status: 'COMPLETED', conclusion: 'FAILURE' },
        { status: 'GARBAGE', conclusion: 'GARBAGE' },
      ];
      expect(classifyChecksOutcome(checks)).toBe('failed');
    });

    it('returns "pending" when all entries are malformed (no FAILURE)', () => {
      const checks = [
        { status: 'GARBAGE', conclusion: undefined },
        { status: undefined, conclusion: 'GARBAGE' },
        {},
      ];
      expect(classifyChecksOutcome(checks)).toBe('pending');
    });

    it('does not throw on malformed entries', () => {
      const malformedChecks = [
        null,
        undefined,
        { status: 'GARBAGE' },
        { conclusion: 'GARBAGE' },
        {} as any,
      ];
      // Filter out null/undefined before passing to classifyChecksOutcome
      const checks = malformedChecks.filter(
        (c) => c !== null && c !== undefined,
      );
      expect(() => classifyChecksOutcome(checks)).not.toThrow();
    });
  });

  describe('prMergeState integration', () => {
    it('includes checksOutcome in the returned state', async () => {
      const fakeGhRunner = async () => ({
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [
            { status: 'COMPLETED', conclusion: 'SUCCESS' },
          ],
          labels: [],
        }),
      });

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      expect(state).toHaveProperty('checksOutcome');
      expect(state.checksOutcome).toBe('green');
    });

    it('classifies checksOutcome as failed with mixed FAILURE+PENDING', async () => {
      const fakeGhRunner = async () => ({
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [
            { status: 'COMPLETED', conclusion: 'FAILURE' },
            { status: 'IN_PROGRESS', conclusion: null },
          ],
          labels: [],
        }),
      });

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      expect(state.checksOutcome).toBe('failed');
    });

    it('classifies checksOutcome as pending with all IN_PROGRESS', async () => {
      const fakeGhRunner = async () => ({
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [
            { status: 'IN_PROGRESS', conclusion: null },
            { status: 'IN_PROGRESS', conclusion: null },
          ],
          labels: [],
        }),
      });

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      expect(state.checksOutcome).toBe('pending');
    });

    it('classifies checksOutcome as none with empty rollup', async () => {
      const fakeGhRunner = async () => ({
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [],
          labels: [],
        }),
      });

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      expect(state.checksOutcome).toBe('none');
    });

    it('classifies checksOutcome as none with null rollup', async () => {
      const fakeGhRunner = async () => ({
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: null,
          labels: [],
        }),
      });

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      expect(state.checksOutcome).toBe('none');
    });

    // Adversarial cases (Task 2)
    it('classifies checksOutcome as pending with malformed entries (missing status/conclusion)', async () => {
      const fakeGhRunner = async () => ({
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [
            { status: undefined, conclusion: null },
            { status: 'GARBAGE', conclusion: undefined },
          ],
          labels: [],
        }),
      });

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      expect(state.checksOutcome).toBe('pending');
      // Ensure no throw occurred
      expect(state).toHaveProperty('checksOutcome');
    });

    it('classifies checksOutcome as failed even with one malformed entry if real failure present', async () => {
      const fakeGhRunner = async () => ({
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [
            { status: 'COMPLETED', conclusion: 'FAILURE' },
            { status: 'GARBAGE', conclusion: 'GARBAGE' },
          ],
          labels: [],
        }),
      });

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      expect(state.checksOutcome).toBe('failed');
    });

    it('returns checksOutcome "none" for ERROR_SENTINEL (gh runner error)', async () => {
      const fakeGhRunner = async () => {
        throw new Error('transient error');
      };

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      expect(state.checksOutcome).toBe('none');
      expect(state.state).toBe('UNKNOWN');
      expect(state.mergeable).toBe('UNKNOWN');
    });

    it('returns checksOutcome "none" for NOTFOUND_SENTINEL (PR not found)', async () => {
      const fakeGhRunner = async () => {
        throw new Error('could not resolve to PullRequest');
      };

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      expect(state.checksOutcome).toBe('none');
      expect(state.state).toBe('NOTFOUND');
      expect(state.mergeable).toBe('UNKNOWN');
    });

    it('preserves isMergeable behavior with green checks and new checksOutcome field', async () => {
      const fakeGhRunner = async () => ({
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [
            { status: 'COMPLETED', conclusion: 'SUCCESS' },
          ],
          labels: [],
        }),
      });

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      // isMergeable should still work correctly
      expect(isMergeable(state)).toBe(true);
      expect(state.checksOutcome).toBe('green');
    });

    it('preserves isMergeable as false when checks are pending', async () => {
      const fakeGhRunner = async () => ({
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [
            { status: 'IN_PROGRESS', conclusion: null },
          ],
          labels: [],
        }),
      });

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      expect(isMergeable(state)).toBe(false);
      expect(state.checksOutcome).toBe('pending');
      expect(state.hasFailingOrPendingChecks).toBe(true);
    });

    it('preserves isMergeable as false when checks are failed', async () => {
      const fakeGhRunner = async () => ({
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [
            { status: 'COMPLETED', conclusion: 'FAILURE' },
          ],
          labels: [],
        }),
      });

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      expect(isMergeable(state)).toBe(false);
      expect(state.checksOutcome).toBe('failed');
      expect(state.hasFailingOrPendingChecks).toBe(true);
    });

    it('preserves hasFailingOrPendingChecks with no checks (green rollup)', async () => {
      const fakeGhRunner = async () => ({
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [],
          labels: [],
        }),
      });

      const state = await prMergeState(fakeGhRunner, '/tmp', 'https://github.com/owner/repo/pull/1');
      expect(state.hasFailingOrPendingChecks).toBe(false);
      expect(state.checksOutcome).toBe('none');
    });
  });
});
