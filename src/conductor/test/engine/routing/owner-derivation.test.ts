// Covers: task:20
import { describe, expect, it } from 'vitest';
import type { CoverageBindingEnvelope } from '../../../src/engine/coverage-binding-envelope.js';
import { deriveTaskBoundOwner } from '../../../src/engine/routing/owner-derivation.js';

const envelope: Pick<CoverageBindingEnvelope, 'sliceMembership'> = {
  sliceMembership: {
    taskSlices: { T1: 1, T2: 2, T3: 3 },
    titles: ['First', 'Second', 'Third'],
  },
};

const remTaskId = 'rem-prd-audit-T1';
const remPlan = [
  `### Task ${remTaskId}: Repair audit finding`,
  '**Child:** 1',
].join('\n');

describe('deriveTaskBoundOwner', () => {
  it('derives an authored task owner from the sealed task slice', () => {
    expect(deriveTaskBoundOwner({
      taskIds: ['T1'], envelope, planText: '', appendedChildren: {}, declaredPositions: [1, 2, 3],
    })).toEqual({ kind: 'owned', owner: 1, reason: 'task-slice' });
  });

  it('prefers a remediation task committed Child line over the cached membership', () => {
    expect(deriveTaskBoundOwner({
      taskIds: [remTaskId], envelope, planText: remPlan,
      appendedChildren: { [remTaskId]: 2 }, declaredPositions: [1, 2, 3],
    })).toEqual({ kind: 'owned', owner: 1, reason: 'rem-child-line' });
  });

  it('uses cached remediation membership when the committed Child line is absent', () => {
    expect(deriveTaskBoundOwner({
      taskIds: [remTaskId], envelope, planText: `### Task ${remTaskId}: Repair audit finding`,
      appendedChildren: { [remTaskId]: 1 }, declaredPositions: [1, 2, 3],
    })).toEqual({ kind: 'owned', owner: 1, reason: 'rem-cache' });
  });

  it('uses the earliest owner for work bound to several tasks', () => {
    expect(deriveTaskBoundOwner({
      taskIds: ['T2', 'T3'], envelope, planText: '', appendedChildren: {}, declaredPositions: [1, 2, 3],
    })).toEqual({ kind: 'owned', owner: 2, reason: 'multi-task-earliest' });
  });

  it('does not accept a judgement dependency', () => {
    deriveTaskBoundOwner({
      taskIds: ['T1'], envelope, planText: '', appendedChildren: {}, declaredPositions: [1, 2, 3],
      // @ts-expect-error Task-bound owner derivation is mechanical.
      judge: () => 1,
    });
  });
});
