import { describe, it, expect } from 'vitest';
import { classifyChecksOutcome, prMergeState } from '../../src/engine/pr-labels.js';

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
  });
});
