import { describe, it, expect } from 'vitest';
import { formatRetryReason, formatProgressDelta } from '../../src/engine/format-retry-line.js';

describe('format-retry-line', () => {
  describe('formatRetryReason', () => {
    it('(a) collapses multi-line input to single line', () => {
      const input = 'failed to build\ndue to missing\ndependencies';
      const result = formatRetryReason(input);
      expect(result).toBe('failed to build due to missing dependencies');
      expect(result).not.toContain('\n');
      expect(result).not.toContain('\r');
    });

    it('(b) truncates input longer than maxLen with trailing …', () => {
      const input = 'This is a very long error message that exceeds the maximum length limit for display';
      const result = formatRetryReason(input, 40);
      expect(result.length).toBeLessThanOrEqual(40);
      expect(result).toMatch(/…$/);
    });

    it('(c) returns "no reason recorded" for undefined input', () => {
      expect(formatRetryReason(undefined)).toBe('no reason recorded');
    });

    it('(c) returns "no reason recorded" for empty string input', () => {
      expect(formatRetryReason('')).toBe('no reason recorded');
    });

    it('(c) returns "no reason recorded" for whitespace-only input', () => {
      expect(formatRetryReason('   \n  \t  ')).toBe('no reason recorded');
    });

    it('(d) returns short single-line input unchanged', () => {
      const input = 'simple error';
      const result = formatRetryReason(input);
      expect(result).toBe('simple error');
    });

    it('handles multi-line with extra whitespace around newlines', () => {
      const input = 'line one  \n  \n  line two';
      const result = formatRetryReason(input);
      expect(result).toBe('line one line two');
      expect(result).not.toContain('\n');
    });

    it('uses default maxLen of 120 when not specified', () => {
      const longText = 'a'.repeat(150);
      const result = formatRetryReason(longText);
      expect(result.length).toBeLessThanOrEqual(120);
      expect(result).toMatch(/…$/);
    });

    it('truncates multi-line input to maxLen', () => {
      const input = 'first line\nsecond line that is very long\nthird line';
      const result = formatRetryReason(input, 25);
      expect(result.length).toBeLessThanOrEqual(25);
      expect(result).toMatch(/…$/);
    });
  });

  describe('formatProgressDelta', () => {
    it('(e) returns empty string when before is undefined', () => {
      expect(formatProgressDelta(undefined, 5)).toBe('');
    });

    it('(e) returns empty string when after is undefined', () => {
      expect(formatProgressDelta(5, undefined)).toBe('');
    });

    it('(e) returns empty string when both are undefined', () => {
      expect(formatProgressDelta(undefined, undefined)).toBe('');
    });

    it('(f) returns compact fragment when both args present', () => {
      expect(formatProgressDelta(10, 15)).toBe('10→15 tasks');
    });

    it('(f) handles same before and after values', () => {
      expect(formatProgressDelta(5, 5)).toBe('5→5 tasks');
    });

    it('(f) handles zero values', () => {
      expect(formatProgressDelta(0, 3)).toBe('0→3 tasks');
      expect(formatProgressDelta(3, 0)).toBe('3→0 tasks');
    });

    it('(f) handles large numbers', () => {
      expect(formatProgressDelta(1000, 1500)).toBe('1000→1500 tasks');
    });
  });
});
