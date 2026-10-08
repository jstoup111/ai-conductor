// Covers: task:8
import { describe, expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));
import {
  customStepsInPerChildRegion,
  deriveStoryOwnership,
  evaluateStackEligibility,
} from '../../src/engine/plan-slices.js';

const complexityPath = '.docs/complexity/stacked-delivery.md';

describe('evaluateStackEligibility', () => {
  it.each(['M', 'L'] as const)('accepts tier %s with sign-off, bounded slices, and no coupled custom', (tier) => {
    expect(evaluateStackEligibility({
      tier,
      signoff: 'approved',
      slicePositions: [1, 2],
      maxSlices: 2,
      regionCoupledSteps: [],
      complexityPath,
    })).toEqual({ kind: 'eligible' });
  });

  it('lists tier and absent-sign-off refusals together', () => {
    expect(evaluateStackEligibility({
      tier: 'S',
      signoff: undefined,
      slicePositions: [1],
      maxSlices: 1,
      regionCoupledSteps: [],
      complexityPath,
    })).toEqual({
      kind: 'ineligible',
      reasons: [
        'stacked delivery requires tier M or L (found S)',
        `no operator stacking sign-off is recorded in ${complexityPath}`,
      ],
    });
  });

  it('lists the configured slice bound and per-child-region custom step', () => {
    expect(evaluateStackEligibility({
      tier: 'M',
      signoff: 'approved',
      slicePositions: [1, 2],
      maxSlices: 1,
      regionCoupledSteps: [{ name: 'lint_gate', coupling: 'in-region' }],
      complexityPath,
    })).toEqual({
      kind: 'ineligible',
      reasons: [
        'plan declares 2 slices, exceeding stacked_prs.max_slices = 1',
        'custom step lint_gate is inside the per-child region',
      ],
    });
  });

  it('refuses positions above the child ceiling, missing tiers, and loop-coupled customs', () => {
    expect(evaluateStackEligibility({
      tier: undefined,
      signoff: 'approved',
      slicePositions: [12],
      maxSlices: 12,
      regionCoupledSteps: [{ name: 'prep', coupling: 'loop-coupled' }],
      complexityPath,
    })).toEqual({
      kind: 'ineligible',
      reasons: [
        'stacked delivery requires tier M or L (found no tier)',
        'slice position 12 is above the MAX_CHILD_ID ceiling of 9',
        'custom step prep is coupled to the per-child loop',
      ],
    });
  });

  it('exports the pure predicates without filesystem access', () => {
    expect(typeof customStepsInPerChildRegion).toBe('function');
    expect(typeof deriveStoryOwnership).toBe('function');
    expect(typeof evaluateStackEligibility).toBe('function');
    evaluateStackEligibility({
      tier: 'M', signoff: 'approved', slicePositions: [1], maxSlices: 1,
      regionCoupledSteps: [], complexityPath,
    });

    expect(readFile).not.toHaveBeenCalled();
    expect(readdir).not.toHaveBeenCalled();
  });
});
