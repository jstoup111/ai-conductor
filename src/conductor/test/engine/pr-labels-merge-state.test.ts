// Covers: task:1
import { describe, expect, it } from 'vitest';
import {
  NEEDS_REMEDIATION_BODY_MARKER,
  prMergeState,
  type GhRunner,
} from '../../src/engine/pr-labels.js';

describe('prMergeState halt body marker', () => {
  it('returns the body marker status from its single PR view read', async () => {
    const fixtures = [
      { body: `halted\n${NEEDS_REMEDIATION_BODY_MARKER}`, expected: true },
      { body: 'ordinary PR body', expected: false },
      { expected: false },
    ];

    for (const fixture of fixtures) {
      const { expected, ...pr } = fixture;
      const calls: string[][] = [];
      const gh: GhRunner = async (args) => {
        calls.push(args);
        return {
          stdout: JSON.stringify({
            state: 'OPEN',
            mergeable: 'MERGEABLE',
            statusCheckRollup: [],
            labels: [],
            ...pr,
          }),
        };
      };

      const state = await prMergeState(gh, '/repo', 'https://github.com/owner/repo/pull/1');

      expect(state.hasHaltBodyMarker).toBe(expected);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        'pr', 'view', 'https://github.com/owner/repo/pull/1', '--json', 'state,mergeable,statusCheckRollup,labels,isDraft,body,mergeStateStatus,baseRefName,headRefOid',
      ]);
    }
  });
});

describe('prMergeState readiness fields', () => {
  it('requests and returns merge-state, base-ref, and head-ref fields while tolerating their absence', async () => {
    const fixtures = [
      {
        pr: { mergeStateStatus: 'DIRTY', baseRefName: 'main', headRefOid: 'abc123' },
        expected: { mergeStateStatus: 'DIRTY', baseRefName: 'main', headRefOid: 'abc123' },
      },
      {
        pr: {},
        expected: { mergeStateStatus: undefined, baseRefName: undefined, headRefOid: undefined },
      },
    ];

    for (const { pr, expected } of fixtures) {
      const calls: string[][] = [];
      const gh: GhRunner = async (args) => {
        calls.push(args);
        return {
          stdout: JSON.stringify({
            state: 'OPEN',
            mergeable: 'MERGEABLE',
            statusCheckRollup: [],
            labels: [],
            ...pr,
          }),
        };
      };

      const state = await prMergeState(gh, '/repo', 'https://github.com/owner/repo/pull/1');

      expect(state).toMatchObject(expected);
      expect(calls).toEqual([[
        'pr', 'view', 'https://github.com/owner/repo/pull/1', '--json',
        'state,mergeable,statusCheckRollup,labels,isDraft,body,mergeStateStatus,baseRefName,headRefOid',
      ]]);
    }
  });
});
