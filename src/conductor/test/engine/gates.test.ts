import { describe, it, expect } from 'vitest';
import type { ConductState } from '../../src/types/index.js';
import { checkGate, isGatingStep, canSkipStep } from '../../src/engine/gates.js';

describe('engine/gates', () => {
  // --- checkGate ---

  describe('checkGate', () => {
    it('passes when all prerequisites are done', () => {
      const state: ConductState = { architecture_review: 'done' };
      const result = checkGate('stories', state);
      expect(result.passed).toBe(true);
    });

    it('passes when prerequisites are skipped', () => {
      const state: ConductState = { architecture_review: 'skipped' };
      const result = checkGate('stories', state);
      expect(result.passed).toBe(true);
    });

    it('passes when prerequisites are stale (critical for gates)', () => {
      const state: ConductState = { architecture_review: 'stale' };
      const result = checkGate('stories', state);
      expect(result.passed).toBe(true);
    });

    it('fails when prerequisite is pending', () => {
      const state: ConductState = {};
      const result = checkGate('stories', state);
      expect(result.passed).toBe(false);
      if (!result.passed) {
        expect(result.reason).toContain('architecture_review');
        expect(result.unsatisfied).toEqual(['architecture_review']);
      }
    });

    it('fails when prerequisite is failed', () => {
      const state: ConductState = { architecture_review: 'failed' };
      const result = checkGate('stories', state);
      expect(result.passed).toBe(false);
      if (!result.passed) expect(result.unsatisfied).toEqual(['architecture_review']);
    });

    it('fails when prerequisite is in_progress', () => {
      const state: ConductState = { architecture_review: 'in_progress' };
      const result = checkGate('stories', state);
      expect(result.passed).toBe(false);
    });

    it('passes for steps with no prerequisites', () => {
      const state: ConductState = {};
      const result = checkGate('worktree', state);
      expect(result.passed).toBe(true);
    });

    it('returns specific error for stories prereq', () => {
      const state: ConductState = {};
      const result = checkGate('conflict_check', state);
      expect(result.passed).toBe(false);
      if (!result.passed) {
        expect(result.reason).toContain('stories');
      }
    });

    it('returns specific error for plan prereq', () => {
      const state: ConductState = {};
      const result = checkGate('build', state);
      expect(result.passed).toBe(false);
      if (!result.passed) {
        expect(result.reason).toContain('plan');
      }
    });

    it('checks all prerequisites for finish', () => {
      // finish requires rebase (which itself follows architecture_review_as_built)
      const state: ConductState = {};
      const result = checkGate('finish', state);
      expect(result.passed).toBe(false);
      if (!result.passed) {
        expect(result.reason).toContain('rebase');
      }
    });

    describe('SHIP tail: architecture_review_as_built → rebase → finish', () => {
      it('allows rebase after a satisfied as-built review', () => {
        expect(
          checkGate('rebase', { architecture_review_as_built: 'done' }),
        ).toEqual({ passed: true });
      });

      it('blocks rebase when the as-built review is unsatisfied', () => {
        const result = checkGate('rebase', {
          architecture_review_as_built: 'failed',
        });

        expect(result).toEqual({
          passed: false,
          reason: 'Prerequisites not satisfied: architecture_review_as_built',
          unsatisfied: ['architecture_review_as_built'],
        });
      });

      it('accepts a valid skipped as-built prerequisite', () => {
        expect(
          checkGate('rebase', { architecture_review_as_built: 'skipped' }),
        ).toEqual({ passed: true });
      });

      it('blocks rebase after a failed validation-group as-built member', () => {
        // The validation-group join persists each failed member as `failed`;
        // rebase must read that member state rather than bypassing the join.
        const result = checkGate('rebase', {
          architecture_review_as_built: 'failed',
        });

        expect(result.passed).toBe(false);
        if (!result.passed) {
          expect(result.unsatisfied).toEqual(['architecture_review_as_built']);
        }
      });
    });

    it('uses only the Task 2-style state when test_suite is marked done', () => {
      // The stale proof belongs to the tree-attesting boundary re-check, not
      // prerequisite evaluation. checkGate must preserve its state-only D4
      // contract and let build_review's already-done prerequisites pass.
      const state: ConductState = {
        wiring_check: 'done',
        test_suite: 'done',
        build_review: 'failed',
      };

      expect(checkGate('build_review', state)).toEqual({ passed: true });
    });
  });

  // --- isGatingStep ---

  describe('isGatingStep', () => {
    it('stories is gating', () => {
      expect(isGatingStep('stories')).toBe(true);
    });

    it('plan is gating', () => {
      expect(isGatingStep('plan')).toBe(true);
    });

    it('acceptance_specs is gating', () => {
      expect(isGatingStep('acceptance_specs')).toBe(true);
    });

    it('finish is gating', () => {
      expect(isGatingStep('finish')).toBe(true);
    });

    it('conflict_check is gating', () => {
      expect(isGatingStep('conflict_check')).toBe(true);
    });

    it('explore is not gating', () => {
      expect(isGatingStep('explore')).toBe(false);
    });

    it('build is structural, not gating', () => {
      expect(isGatingStep('build')).toBe(false);
    });

    it('memory is not gating', () => {
      expect(isGatingStep('memory')).toBe(false);
    });
  });

  // --- canSkipStep ---

  describe('canSkipStep', () => {
    it('gating steps cannot be skipped', () => {
      expect(canSkipStep('stories')).toBe(false);
      expect(canSkipStep('plan')).toBe(false);
      expect(canSkipStep('finish')).toBe(false);
    });

    it('non-gating steps can be skipped', () => {
      expect(canSkipStep('explore')).toBe(true);
      expect(canSkipStep('memory')).toBe(true);
      expect(canSkipStep('architecture_diagram')).toBe(true);
    });
  });
});
