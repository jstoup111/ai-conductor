import { describe, expect, it } from 'vitest';
import '../../../src/engine/self-host/live-containment.js';
import type { ContainmentVerdict } from '../../../src/engine/self-host/live-containment.js';

describe('ContainmentVerdict', () => {
  it('narrows evidence and reason by containment', () => {
    const contained: ContainmentVerdict = { contained: true, evidence: 'bubblewrap enforced' };
    const unavailable: ContainmentVerdict = { contained: false, reason: 'bubblewrap unavailable' };

    const invalidContained: ContainmentVerdict = {
      contained: true,
      evidence: 'bubblewrap enforced',
      // @ts-expect-error A contained verdict cannot carry failure-only detail.
      reason: 'bubblewrap unavailable',
    };
    const invalidUnavailable: ContainmentVerdict = {
      contained: false,
      // @ts-expect-error An unavailable verdict cannot carry containment-only detail.
      evidence: 'bubblewrap enforced',
      reason: 'bubblewrap unavailable',
    };

    const detail = (verdict: ContainmentVerdict): string => {
      if (verdict.contained) return verdict.evidence;
      return verdict.reason;
    };

    void invalidContained;
    void invalidUnavailable;

    expect([detail(contained), detail(unavailable)]).toEqual([
      'bubblewrap enforced',
      'bubblewrap unavailable',
    ]);
  });
});
