import { describe, it, expect } from 'vitest';
import {
  getRecoveryOptions,
  handleRecoveryChoice,
  shouldRetry,
  isRateLimitError,
} from '../../src/engine/recovery.js';

describe('recovery', () => {
  describe('getRecoveryOptions', () => {
    it('returns 5 options for non-gating step', () => {
      const opts = getRecoveryOptions('brainstorm', false);
      expect(opts).toHaveLength(5);
      expect(opts).toContain('retry');
      expect(opts).toContain('interactive');
      expect(opts).toContain('back');
      expect(opts).toContain('skip');
      expect(opts).toContain('quit');
    });

    it('returns 4 options for gating step (no skip)', () => {
      const opts = getRecoveryOptions('build', true);
      expect(opts).toHaveLength(4);
      expect(opts).toContain('retry');
      expect(opts).toContain('interactive');
      expect(opts).toContain('back');
      expect(opts).toContain('quit');
      expect(opts).not.toContain('skip');
    });
  });

  describe('handleRecoveryChoice', () => {
    it('returns retry action', () => {
      expect(handleRecoveryChoice('retry', false)).toEqual({ action: 'retry' });
    });

    it('returns skip action for non-gating', () => {
      expect(handleRecoveryChoice('skip', false)).toEqual({ action: 'skip' });
    });

    it('returns blocked for skip on gating step', () => {
      const result = handleRecoveryChoice('skip', true);
      expect(result.action).toBe('blocked');
      expect((result as { action: 'blocked'; reason: string }).reason).toBeTruthy();
    });

    it('returns interactive action', () => {
      expect(handleRecoveryChoice('interactive', false)).toEqual({
        action: 'interactive',
      });
    });

    it('returns back action', () => {
      expect(handleRecoveryChoice('back', false)).toEqual({ action: 'back' });
    });

    it('returns quit action', () => {
      expect(handleRecoveryChoice('quit', false)).toEqual({ action: 'quit' });
    });
  });

  describe('shouldRetry', () => {
    it('returns true for retry count 0, 1, 2', () => {
      expect(shouldRetry(0)).toBe(true);
      expect(shouldRetry(1)).toBe(true);
      expect(shouldRetry(2)).toBe(true);
    });

    it('returns false for retry count 3 and above', () => {
      expect(shouldRetry(3)).toBe(false);
      expect(shouldRetry(4)).toBe(false);
    });

    it('respects custom maxRetries', () => {
      expect(shouldRetry(4, 5)).toBe(true);
      expect(shouldRetry(5, 5)).toBe(false);
    });
  });

  describe('isRateLimitError', () => {
    it('returns true for "rate limit"', () => {
      expect(isRateLimitError('Error: rate limit exceeded')).toBe(true);
    });

    it('returns true for "429"', () => {
      expect(isRateLimitError('HTTP 429 Too Many Requests')).toBe(true);
    });

    it('returns true for "overloaded"', () => {
      expect(isRateLimitError('server overloaded')).toBe(true);
    });

    it('returns true for "usage limit"', () => {
      expect(isRateLimitError('usage limit reached')).toBe(true);
    });

    it('returns false for normal output', () => {
      expect(isRateLimitError('All good')).toBe(false);
    });
  });
});
