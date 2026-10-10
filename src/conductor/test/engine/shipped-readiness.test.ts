// Covers: task:2
import { describe, expect, it } from 'vitest';
import type { PrMergeState } from '../../src/engine/pr-labels.js';
import {
  classifyShippedReadiness,
  SHIPPED_READINESS_GRACE_MS,
  type ShippedReadinessObservation,
  type ShippedReadinessVerdict,
} from '../../src/engine/shipped-readiness.js';

const now = 1_700_000_000_000;

function state(overrides: Partial<PrMergeState> = {}): PrMergeState {
  return {
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    baseRefName: 'main',
    headRefOid: 'head-sha',
    hasFailingOrPendingChecks: false,
    labels: [],
    checksOutcome: 'green',
    isDraft: false,
    ...overrides,
  };
}

function observation(overrides: Partial<ShippedReadinessObservation> = {}): ShippedReadinessObservation {
  return {
    mergeabilityReread: 'not-needed',
    headFirstSeenAt: now - SHIPPED_READINESS_GRACE_MS,
    ...overrides,
  };
}

describe('classifyShippedReadiness', () => {
  it('returns exactly one fixed-precedence verdict for every readiness state', () => {
    const cases: Array<{
      title: string;
      state: PrMergeState;
      observation?: ShippedReadinessObservation;
      expected: ShippedReadinessVerdict;
    }> = [
      { title: 'ready with green checks', state: state(), expected: 'ready' },
      { title: 'draft before conflicting failed checks', state: state({ isDraft: true, mergeable: 'CONFLICTING', checksOutcome: 'failed' }), expected: 'draft' },
      { title: 'indeterminate after UNKNOWN mergeability reread', state: state({ mergeable: 'UNKNOWN' }), observation: observation({ mergeabilityReread: 'completed' }), expected: 'indeterminate' },
      { title: 'indeterminate after failed mergeability reread', state: state(), observation: observation({ mergeabilityReread: 'failed' }), expected: 'indeterminate' },
      { title: 'indeterminate for an undocumented merge state', state: state({ mergeStateStatus: 'SOMETHING_NEW' }), expected: 'indeterminate' },
      { title: 'conflicting before failed checks', state: state({ mergeable: 'CONFLICTING', checksOutcome: 'failed' }), expected: 'conflicting' },
      { title: 'conflicting when mergeable has DIRTY merge state', state: state({ mergeStateStatus: 'DIRTY' }), expected: 'conflicting' },
      {
        title: 'ci-failing before a pending check in a mixed rollup',
        state: state({
          checksOutcome: 'failed',
          hasFailingOrPendingChecks: true,
          statusCheckRollup: [
            { status: 'COMPLETED', conclusion: 'FAILURE' },
            { status: 'IN_PROGRESS' },
          ],
        }),
        expected: 'ci-failing',
      },
      { title: 'ci-pending with pending checks', state: state({ checksOutcome: 'pending', hasFailingOrPendingChecks: true }), expected: 'ci-pending' },
      { title: 'ci-pending for no checks inside the main grace period', state: state({ checksOutcome: 'none' }), observation: observation({ headFirstSeenAt: now - (29 * 60 * 1000) }), expected: 'ci-pending' },
      { title: 'no-checks for no checks after the main grace period', state: state({ checksOutcome: 'none' }), observation: observation({ headFirstSeenAt: now - (31 * 60 * 1000) }), expected: 'no-checks' },
      { title: 'ci-pending for no checks on a non-main base after the grace period', state: state({ checksOutcome: 'none', baseRefName: 'feat/c1/x' }), observation: observation({ headFirstSeenAt: now - (31 * 60 * 1000) }), expected: 'ci-pending' },
      { title: 'ready for BLOCKED merge state with green checks', state: state({ mergeStateStatus: 'BLOCKED' }), expected: 'ready' },
      { title: 'ready for BEHIND merge state with green checks', state: state({ mergeStateStatus: 'BEHIND' }), expected: 'ready' },
      { title: 'ready for CLEAN merge state with green checks', state: state({ mergeStateStatus: 'CLEAN' }), expected: 'ready' },
      { title: 'ready for DRAFT merge state with green checks when the PR is not a draft', state: state({ mergeStateStatus: 'DRAFT' }), expected: 'ready' },
      { title: 'ready for HAS_HOOKS merge state with green checks', state: state({ mergeStateStatus: 'HAS_HOOKS' }), expected: 'ready' },
      { title: 'ready for UNKNOWN merge state with green checks when mergeability is known', state: state({ mergeStateStatus: 'UNKNOWN' }), expected: 'ready' },
      { title: 'ready for UNSTABLE merge state with green checks', state: state({ mergeStateStatus: 'UNSTABLE' }), expected: 'ready' },
    ];

    for (const testCase of cases) {
      expect(classifyShippedReadiness(testCase.state, testCase.observation ?? observation(), now), testCase.title)
        .toBe(testCase.expected);
    }
  });
});
