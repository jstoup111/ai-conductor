import { describe, it, expect } from 'vitest';
import {
  EFFORT_ORDER,
  MODEL_TIER_ORDER,
  bumpEffort,
  bumpModel,
  escalateAttempt,
} from '../../src/engine/escalation.js';

describe('engine/escalation — ordering constants', () => {
  it('EFFORT_ORDER ascends low → max', () => {
    expect([...EFFORT_ORDER]).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('MODEL_TIER_ORDER ascends haiku → fable (upgrade direction)', () => {
    expect([...MODEL_TIER_ORDER]).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
  });
});

describe('engine/escalation — bumpEffort', () => {
  it('advances one rung', () => {
    expect(bumpEffort('low', 1)).toBe('medium');
    expect(bumpEffort('medium', 1)).toBe('high');
    expect(bumpEffort('high', 1)).toBe('xhigh');
    expect(bumpEffort('xhigh', 1)).toBe('max');
  });

  it('advances multiple rungs', () => {
    expect(bumpEffort('low', 2)).toBe('high');
    expect(bumpEffort('low', 4)).toBe('max');
  });

  it('clamps at the top (no overflow past max)', () => {
    expect(bumpEffort('max', 1)).toBe('max');
    expect(bumpEffort('max', 5)).toBe('max');
    expect(bumpEffort('xhigh', 10)).toBe('max');
  });

  it('is a no-op for zero / negative steps', () => {
    expect(bumpEffort('medium', 0)).toBe('medium');
    expect(bumpEffort('medium', -3)).toBe('medium');
  });

  it('passes through an unknown effort defensively', () => {
    // @ts-expect-error deliberately invalid effort
    expect(bumpEffort('turbo', 1)).toBe('turbo');
  });
});

describe('engine/escalation — bumpModel', () => {
  it('advances one tier', () => {
    expect(bumpModel('haiku', 1)).toBe('sonnet');
    expect(bumpModel('sonnet', 1)).toBe('opus');
    expect(bumpModel('opus', 1)).toBe('fable');
  });

  it('advances multiple tiers', () => {
    expect(bumpModel('haiku', 2)).toBe('opus');
    expect(bumpModel('sonnet', 2)).toBe('fable');
    expect(bumpModel('haiku', 3)).toBe('fable');
  });

  it('clamps at the top tier (no overflow past fable)', () => {
    expect(bumpModel('fable', 1)).toBe('fable');
    expect(bumpModel('fable', 9)).toBe('fable');
    expect(bumpModel('opus', 5)).toBe('fable');
  });

  it('is a no-op for zero / negative steps', () => {
    expect(bumpModel('sonnet', 0)).toBe('sonnet');
    expect(bumpModel('sonnet', -2)).toBe('sonnet');
  });

  it('passes through a base model absent from the tier order', () => {
    expect(bumpModel('claude-3-5-sonnet-20241022', 1)).toBe('claude-3-5-sonnet-20241022');
    expect(bumpModel('gpt-4', 2)).toBe('gpt-4');
  });
});

describe('engine/escalation — escalateAttempt', () => {
  it('S1: attempt 2 bumps effort one level, model unchanged', () => {
    expect(escalateAttempt('sonnet', 'medium', 2, true)).toEqual({
      model: 'sonnet',
      effort: 'high',
    });
  });

  it('S2: attempt 3 bumps model one tier, effort held at attempt-2 rung', () => {
    expect(escalateAttempt('sonnet', 'medium', 3, true)).toEqual({
      model: 'opus',
      effort: 'high',
    });
  });

  it('attempt 4 bumps model two tiers, effort still one rung', () => {
    expect(escalateAttempt('sonnet', 'medium', 4, true)).toEqual({
      model: 'fable',
      effort: 'high',
    });
  });

  it('attempt 1 (and below) returns the base unchanged', () => {
    expect(escalateAttempt('sonnet', 'medium', 1, true)).toEqual({
      model: 'sonnet',
      effort: 'medium',
    });
    expect(escalateAttempt('sonnet', 'medium', 0, true)).toEqual({
      model: 'sonnet',
      effort: 'medium',
    });
  });

  it('S6: base effort at max — effort bump is a no-op, model still climbs', () => {
    expect(escalateAttempt('sonnet', 'max', 2, true)).toEqual({
      model: 'sonnet',
      effort: 'max',
    });
    expect(escalateAttempt('sonnet', 'max', 3, true)).toEqual({
      model: 'opus',
      effort: 'max',
    });
  });

  it('S7: base model at fable — model bump is a no-op, effort still bumps', () => {
    expect(escalateAttempt('fable', 'medium', 2, true)).toEqual({
      model: 'fable',
      effort: 'high',
    });
    expect(escalateAttempt('fable', 'medium', 3, true)).toEqual({
      model: 'fable',
      effort: 'high',
    });
    expect(escalateAttempt('fable', 'medium', 5, true)).toEqual({
      model: 'fable',
      effort: 'high',
    });
  });

  it('S5: escalate=false pins the base across every attempt', () => {
    for (const attempt of [1, 2, 3, 4, 5]) {
      expect(escalateAttempt('sonnet', 'medium', attempt, false)).toEqual({
        model: 'sonnet',
        effort: 'medium',
      });
    }
  });
});
