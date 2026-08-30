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

describe('reduceBuildReviewAdjudication', () => {
  it.each([
    ['finalized non-action content', { currentSourceCount: 1, cases: [reject()], mechanical: 'healthy' }, 'pass'],
    ['new applied action', { currentSourceCount: 1, cases: [action()], mechanical: 'healthy' }, 'build'],
    ['pure below-cap mechanical failure', { currentSourceCount: 0, cases: [], mechanical: 'retry' }, 'mechanical-retry'],
    ['exhausted mechanical failure', { currentSourceCount: 0, cases: [], mechanical: 'halt' }, 'halt'],
    ['mixed action and infrastructure', { currentSourceCount: 1, cases: [action()], mechanical: 'retry' }, 'build'],
    ['unfinished action effect', { currentSourceCount: 1, cases: [action('reserved')], mechanical: 'healthy' }, 'halt'],
  ] as const)('%s selects %s', (_label, input, route) => {
    expect(reduceBuildReviewAdjudication(input).route).toBe(route);
  });

  it('retains the infrastructure blocker on a mixed action lap', () => {
    expect(reduceBuildReviewAdjudication({ currentSourceCount: 1, cases: [action()], mechanical: 'retry' }))
      .toMatchObject({ route: 'build', remainingMechanical: true });
  });
});
