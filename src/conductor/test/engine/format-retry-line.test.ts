import { describe, it, expect } from 'vitest';
import { formatRetryReason, formatProgressDelta } from '../../src/engine/format-retry-line.js';
import { composeContainmentAdvisoryOutput } from '../../src/engine/per-task-commit-floor.js';
import { renderDaemonEvent, stripAnsi } from '../../src/daemon-cli.js';

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

    // Covers: task:11
    it('keeps every pending task id ahead of titles in a bounded BUILD retry line', () => {
      const ids = ['1', '2', '3', '4', '5', '6'];
      const firstTitle = 'First task';
      const reason =
        `6/6 tasks pending/not completed: ${ids.join(', ')} — ` +
        ids.map((id, index) => `${id} "${index === 0 ? firstTitle : `A deliberately long task ${id} title that forces the retry line to truncate`}"`).join('; ');

      const result = formatRetryReason(reason);

      expect(result).toHaveLength(120);
      expect(result).not.toContain('\n');
      expect(result).not.toContain('\r');
      for (const id of ids) {
        expect(result).toContain(id);
        expect(result.indexOf(id)).toBeLessThan(result.indexOf(firstTitle));
      }

      const lines: string[] = [];
      renderDaemonEvent(
        { type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 2, reason },
        (line) => lines.push(stripAnsi(line)),
      );
      expect(lines).toEqual([`· ↻ build retry (try 2/2: ${result})`]);
    });

    it('truncates multi-line input to maxLen', () => {
      const input = 'first line\nsecond line that is very long\nthird line';
      const result = formatRetryReason(input, 25);
      expect(result.length).toBeLessThanOrEqual(25);
      expect(result).toMatch(/…$/);
    });

    it.each([
      ['a short review reason', 'review failed: missing coverage', 120],
      ['a review reason that exceeds the retry budget', `review failed: ${'x'.repeat(160)}`, 120],
    ])('keeps %s ahead of a containment advisory', (_caseName, reviewReason, maxLen) => {
      const output = composeContainmentAdvisoryOutput(
        reviewReason,
        ['Advisory: containment check unresolved; hook state is unavailable.'],
        false,
      );

      const result = formatRetryReason(output, maxLen);

      expect(result.startsWith(reviewReason.slice(0, Math.max(0, maxLen - 1)))).toBe(true);
      expect(result).not.toMatch(/^Advisory:/);
      if (reviewReason.length > maxLen) expect(result).toMatch(/…$/);
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
