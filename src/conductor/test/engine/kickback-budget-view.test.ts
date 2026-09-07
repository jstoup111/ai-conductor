// Covers: task:10, task:12
import { describe, expect, it } from 'vitest';

import { kickbackBudgetView, renderKickbackBudgetView } from '../../src/engine/kickback-budget-view.js';

describe('kickback budget view', () => {
  it('renders the charged budget, reason, history, and mechanical faults', () => {
    const entry = {
      count: 2, cumulative: 5, treeHash: null, lastReason: 'grader finding', priorVerdict: true,
      resolvedBefore: 0, effectiveLimit: 6, mechanicalFaults: 1,
      adjustments: [{ id: 'raise-1', kind: 'raise' as const, beforeConsumed: 5, afterConsumed: 5,
        beforeLimit: 5, afterLimit: 6, operator: 'operator', rationale: 'one more pass',
        timestamp: '2026-09-06T00:00:00.000Z', haltGeneration: 'halt-1' }],
    };
    const rendered = renderKickbackBudgetView(entry, 'build_review', 5);
    expect(rendered).toContain('5/6 consumed; 1 remaining');
    expect(rendered).toContain('Latest reason: grader finding');
    expect(rendered).toContain('Adjustment history: raise raise-1');
    expect(rendered).toContain('Mechanical faults: 1');
  });

  it('does not invent adjustment history for a legacy entry', () => {
    const legacy = { count: 1, cumulative: 1, treeHash: null, lastReason: '', priorVerdict: false, resolvedBefore: 0 };
    expect(kickbackBudgetView(legacy, 'build_review', 5).adjustments).toBe('unavailable');
    expect(renderKickbackBudgetView(legacy, 'build_review', 5)).toContain('Adjustment history: unavailable');
  });
});
