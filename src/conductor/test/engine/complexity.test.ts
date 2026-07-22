import { describe, it, expect } from 'vitest';
import {
  classifySignal,
  assessTier,
  hasInsufficientInfo,
  tierFromSizeLabel,
  tierFromSizeLabels,
} from '../../src/engine/complexity.js';
import { escalateAttempt } from '../../src/engine/escalation.js';
import type { ComplexityTier } from '../../src/types/index.js';

type Signal = 'models' | 'integrations' | 'auth' | 'stateMachines' | 'stories';

describe('complexity', () => {
  describe('classifySignal', () => {
    // models: 1-3=S, 4-7=M, 8+=L
    it.each([
      ['models', 1, 'S'],
      ['models', 3, 'S'],
      ['models', 4, 'M'],
      ['models', 7, 'M'],
      ['models', 8, 'L'],
      ['models', 20, 'L'],
    ] as [Signal, number, ComplexityTier][])(
      'classifies %s=%d as %s',
      (signal, count, expected) => {
        expect(classifySignal(signal, count)).toBe(expected);
      },
    );

    // integrations: 0=S, 1-2=M, 3+=L
    it.each([
      ['integrations', 0, 'S'],
      ['integrations', 1, 'M'],
      ['integrations', 2, 'M'],
      ['integrations', 3, 'L'],
      ['integrations', 10, 'L'],
    ] as [Signal, number, ComplexityTier][])(
      'classifies %s=%d as %s',
      (signal, count, expected) => {
        expect(classifySignal(signal, count)).toBe(expected);
      },
    );

    // auth: 0=S, 1=M, 2+=L
    it.each([
      ['auth', 0, 'S'],
      ['auth', 1, 'M'],
      ['auth', 2, 'L'],
      ['auth', 5, 'L'],
    ] as [Signal, number, ComplexityTier][])(
      'classifies %s=%d as %s',
      (signal, count, expected) => {
        expect(classifySignal(signal, count)).toBe(expected);
      },
    );

    // stateMachines: 0=S, 1=M, 2+=L
    it.each([
      ['stateMachines', 0, 'S'],
      ['stateMachines', 1, 'M'],
      ['stateMachines', 2, 'L'],
    ] as [Signal, number, ComplexityTier][])(
      'classifies %s=%d as %s',
      (signal, count, expected) => {
        expect(classifySignal(signal, count)).toBe(expected);
      },
    );

    // stories: 1-5=S, 6-15=M, 16+=L
    it.each([
      ['stories', 1, 'S'],
      ['stories', 5, 'S'],
      ['stories', 6, 'M'],
      ['stories', 15, 'M'],
      ['stories', 16, 'L'],
      ['stories', 50, 'L'],
    ] as [Signal, number, ComplexityTier][])(
      'classifies %s=%d as %s',
      (signal, count, expected) => {
        expect(classifySignal(signal, count)).toBe(expected);
      },
    );
  });

  describe('assessTier', () => {
    it('returns S when majority is S', () => {
      expect(
        assessTier({
          models: 'S',
          integrations: 'S',
          auth: 'S',
          stateMachines: 'M',
          stories: 'L',
        }),
      ).toBe('S');
    });

    it('returns M when majority is M', () => {
      expect(
        assessTier({
          models: 'M',
          integrations: 'M',
          auth: 'M',
          stateMachines: 'S',
          stories: 'L',
        }),
      ).toBe('M');
    });

    it('returns L when majority is L', () => {
      expect(
        assessTier({
          models: 'L',
          integrations: 'L',
          auth: 'L',
          stateMachines: 'S',
          stories: 'M',
        }),
      ).toBe('L');
    });

    it('breaks S/M tie toward M (higher)', () => {
      // 2S, 2M, 1L => tie between S and M, breaks to M
      expect(
        assessTier({
          models: 'S',
          integrations: 'S',
          auth: 'M',
          stateMachines: 'M',
          stories: 'L',
        }),
      ).toBe('M');
    });

    it('breaks M/L tie toward L (higher)', () => {
      // 2M, 2L, 1S => tie between M and L, breaks to L
      expect(
        assessTier({
          models: 'M',
          integrations: 'M',
          auth: 'L',
          stateMachines: 'L',
          stories: 'S',
        }),
      ).toBe('L');
    });
  });

  describe('hasInsufficientInfo', () => {
    it('returns true for fewer than 3 signals', () => {
      expect(hasInsufficientInfo(0)).toBe(true);
      expect(hasInsufficientInfo(1)).toBe(true);
      expect(hasInsufficientInfo(2)).toBe(true);
    });

    it('returns false for 3 or more signals', () => {
      expect(hasInsufficientInfo(3)).toBe(false);
      expect(hasInsufficientInfo(5)).toBe(false);
    });
  });

  describe('tierFromSizeLabel', () => {
    it('maps a label containing size: S to tier S', () => {
      expect(tierFromSizeLabel('size: S')).toBe('S');
    });

    it('escalation still applies to the resulting S-tier config on attempt 2', () => {
      const tier = tierFromSizeLabel('size: S');
      expect(tier).toBe('S');
      const result = escalateAttempt('sonnet', 'low', 2, true);
      expect(result.effort).toBe('medium');
    });
  });

  describe('tierFromSizeLabels', () => {
    it('finds the size label among unrelated labels', () => {
      expect(tierFromSizeLabels(['size: S', 'bug'])).toBe('S');
    });

    it('returns undefined when no label matches', () => {
      expect(tierFromSizeLabels(['bug'])).toBeUndefined();
    });

    it('returns undefined for an empty array', () => {
      expect(tierFromSizeLabels([])).toBeUndefined();
    });
  });
});
