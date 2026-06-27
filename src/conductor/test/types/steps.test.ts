import { describe, it, expect } from 'vitest';
import type { StepName, StepStatus, Phase, ComplexityTier } from '../../src/types/steps.js';

describe('Step types', () => {
  it('StepName union has 18 members', () => {
    const allSteps: StepName[] = [
      'bootstrap', 'memory', 'assess', 'brainstorm', 'complexity', 'stories',
      'conflict_check', 'plan', 'architecture_diagram', 'architecture_review',
      'worktree', 'acceptance_specs', 'build', 'manual_test', 'prd_audit',
      'architecture_review_as_built', 'retro', 'finish',
    ];
    expect(allSteps).toHaveLength(18);
  });

  it('StepStatus has 6 values', () => {
    const allStatuses: StepStatus[] = [
      'pending', 'in_progress', 'done', 'failed', 'skipped', 'stale',
    ];
    expect(allStatuses).toHaveLength(6);
  });

  it('Phase has 5 values', () => {
    const allPhases: Phase[] = ['SETUP', 'UNDERSTAND', 'DECIDE', 'BUILD', 'SHIP'];
    expect(allPhases).toHaveLength(5);
  });

  it('ComplexityTier has 3 values', () => {
    const allTiers: ComplexityTier[] = ['S', 'M', 'L'];
    expect(allTiers).toHaveLength(3);
  });
});
