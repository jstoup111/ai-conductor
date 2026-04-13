import { describe, it, expect } from 'vitest';
import type { ConductState } from '../../src/types/index.js';
import { checkGate, isGatingStep, canSkipStep } from '../../src/engine/gates.js';

describe('engine/gates', () => {
  // --- checkGate ---

  describe('checkGate', () => {
    it('passes when all prerequisites are done', () => {
      const state: ConductState = { brainstorm: 'done' };
      const result = checkGate('stories', state);
      expect(result.passed).toBe(true);
    });

    it('passes when prerequisites are skipped', () => {
      const state: ConductState = { brainstorm: 'skipped' };
      const result = checkGate('stories', state);
      expect(result.passed).toBe(true);
    });

    it('passes when prerequisites are stale (critical for gates)', () => {
      const state: ConductState = { brainstorm: 'stale' };
      const result = checkGate('stories', state);
      expect(result.passed).toBe(true);
    });

    it('fails when prerequisite is pending', () => {
      const state: ConductState = {};
      const result = checkGate('stories', state);
      expect(result.passed).toBe(false);
      if (!result.passed) {
        expect(result.reason).toContain('brainstorm');
      }
    });

    it('fails when prerequisite is failed', () => {
      const state: ConductState = { brainstorm: 'failed' };
      const result = checkGate('stories', state);
      expect(result.passed).toBe(false);
    });

    it('fails when prerequisite is in_progress', () => {
      const state: ConductState = { brainstorm: 'in_progress' };
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
      // finish requires retro
      const state: ConductState = {};
      const result = checkGate('finish', state);
      expect(result.passed).toBe(false);
      if (!result.passed) {
        expect(result.reason).toContain('retro');
      }
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

    it('brainstorm is not gating', () => {
      expect(isGatingStep('brainstorm')).toBe(false);
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
      expect(canSkipStep('brainstorm')).toBe(true);
      expect(canSkipStep('memory')).toBe(true);
      expect(canSkipStep('retro')).toBe(true);
    });
  });
});
