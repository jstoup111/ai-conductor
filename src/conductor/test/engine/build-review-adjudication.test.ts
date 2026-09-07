import { describe, expect, it } from 'vitest';

import { reduceBuildReviewAdjudication } from '../../src/engine/build-review-adjudication.js';
import type { RemediationCaseRecord } from '../../src/engine/remediation-case-store.js';

const action = (status: 'reserved' | 'applied' | 'failed' = 'applied'): RemediationCaseRecord => ({
  id: 'case-action', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'fix it',
  confidence: 'high', resolution: 'open', sources: [{ sourceId: 'finding-1', outcome: 'acted', recordedAt: '2026-08-30T00:00:00.000Z' }],
  effect: status === 'applied'
    ? { id: 'effect-action', kind: 'action', status, workOrderId: 'order-1' }
    : status === 'failed'
      ? { id: 'effect-action', kind: 'action', status, diagnostic: 'write failed' }
      : { id: 'effect-action', kind: 'action', status },
});

const reject = (): RemediationCaseRecord => ({
  id: 'case-reject', domain: 'build_review', disposition: 'reject', priority: 'low', rationale: 'not actionable',
  confidence: 'high', resolution: 'open', sources: [{ sourceId: 'finding-1', outcome: 'rejected', recordedAt: '2026-08-30T00:00:00.000Z' }], effect: { kind: 'none' },
});

const reducerInput = (overrides: Partial<Parameters<typeof reduceBuildReviewAdjudication>[0]> = {}) => ({
  currentSourceIds: ['finding-1'],
  cases: [reject()],
  mechanical: 'healthy' as const,
  ...overrides,
});

describe('reduceBuildReviewAdjudication', () => {
  it.each([
    ['finalized non-action content', reducerInput(), 'pass'],
    ['new applied action', reducerInput({ cases: [action()] }), 'build'],
    ['pure below-cap mechanical failure', reducerInput({ currentSourceIds: [], cases: [], mechanical: 'retry' }), 'mechanical-retry'],
    ['exhausted mechanical failure', reducerInput({ currentSourceIds: [], cases: [], mechanical: 'halt' }), 'halt'],
    ['mixed action and infrastructure', reducerInput({ cases: [action()], mechanical: 'retry' }), 'build'],
    ['unfinished action effect', reducerInput({ cases: [action('reserved')] }), 'halt'],
  ] as const)('%s selects %s', (_label, input, route) => {
    expect(reduceBuildReviewAdjudication(input).route).toBe(route);
  });

  it('retains the infrastructure blocker on a mixed action lap', () => {
    expect(reduceBuildReviewAdjudication(reducerInput({ cases: [action()], mechanical: 'retry' })))
      .toMatchObject({ route: 'build', remainingMechanical: true });
  });

  it('halts rather than passing when current source coverage is incomplete or contradictory', () => {
    expect(reduceBuildReviewAdjudication(reducerInput({ currentSourceIds: ['finding-1', 'finding-2'] })).route).toBe('halt');
    expect(reduceBuildReviewAdjudication(reducerInput({
      cases: [reject(), { ...reject(), id: 'case-conflict', sources: [{ ...reject().sources[0], outcome: 'merged' }] }],
    })).route).toBe('halt');
  });

  it('never routes an old applied action to BUILD when it covers no current source', () => {
    expect(reduceBuildReviewAdjudication(reducerInput({
      currentSourceIds: ['finding-2'],
      cases: [action()],
    })).route).toBe('halt');
  });
});
