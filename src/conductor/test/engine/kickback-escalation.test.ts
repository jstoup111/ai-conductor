import { describe, it, expect } from 'vitest';
import {
  classifyBuildProgress,
  shouldEscalateKickback,
} from '../../src/engine/kickback-escalation.js';

describe('classifyBuildProgress', () => {
  it('is did-work when head changed', () => {
    expect(
      classifyBuildProgress({
        headBefore: 'abc123',
        headAfter: 'def456',
        resolvedBefore: 2,
        resolvedAfter: 2,
      }),
    ).toBe('did-work');
  });

  it('is did-work when resolvedAfter > resolvedBefore', () => {
    expect(
      classifyBuildProgress({
        headBefore: 'abc123',
        headAfter: 'abc123',
        resolvedBefore: 2,
        resolvedAfter: 3,
      }),
    ).toBe('did-work');
  });

  it('is no-work when neither head nor resolved count moved', () => {
    expect(
      classifyBuildProgress({
        headBefore: 'abc123',
        headAfter: 'abc123',
        resolvedBefore: 2,
        resolvedAfter: 2,
      }),
    ).toBe('no-work');
  });

  it('is no-work when both heads are null (unknown head treated conservatively)', () => {
    expect(
      classifyBuildProgress({
        headBefore: null,
        headAfter: null,
        resolvedBefore: 0,
        resolvedAfter: 0,
      }),
    ).toBe('no-work');
  });

  it('is idempotent across repeated calls with identical input', () => {
    const input = {
      headBefore: 'abc123',
      headAfter: 'abc123',
      resolvedBefore: 1,
      resolvedAfter: 1,
    };
    expect(classifyBuildProgress(input)).toBe(classifyBuildProgress(input));
  });
});

describe('shouldEscalateKickback', () => {
  it('halts on no-work + matching verdict + enabled', () => {
    const result = shouldEscalateKickback({
      progress: 'no-work',
      priorVerdict: false,
      nextVerdict: false,
      enabled: true,
    });
    expect(result.halt).toBe(true);
    expect(result.reason).toBeTruthy();
    expect(result.reason).toMatch(/no.?work|head|resolved|unchanged|verdict/i);
  });

  it('does not halt on did-work', () => {
    const result = shouldEscalateKickback({
      progress: 'did-work',
      priorVerdict: false,
      nextVerdict: false,
      enabled: true,
    });
    expect(result.halt).toBe(false);
  });

  it('does not halt when verdicts differ', () => {
    const result = shouldEscalateKickback({
      progress: 'no-work',
      priorVerdict: false,
      nextVerdict: true,
      enabled: true,
    });
    expect(result.halt).toBe(false);
  });

  it('does not halt when disabled', () => {
    const result = shouldEscalateKickback({
      progress: 'no-work',
      priorVerdict: false,
      nextVerdict: false,
      enabled: false,
    });
    expect(result.halt).toBe(false);
  });

  it('is idempotent across repeated calls with identical input', () => {
    const input = {
      progress: 'no-work' as const,
      priorVerdict: false,
      nextVerdict: false,
      enabled: true,
    };
    expect(shouldEscalateKickback(input)).toEqual(shouldEscalateKickback(input));
  });
});
