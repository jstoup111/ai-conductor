import { describe, it, expect } from 'vitest';
import { parseRateLimitWaitSeconds } from '../../src/execution/claude-provider.js';

describe('parseRateLimitWaitSeconds', () => {
  it('extracts seconds from "Please retry after 450 seconds"', () => {
    const output = 'Please retry after 450 seconds';
    expect(parseRateLimitWaitSeconds(output)).toBe(450);
  });

  it('extracts seconds from "Error: retry in 120 seconds"', () => {
    const output = 'Error: retry in 120 seconds';
    expect(parseRateLimitWaitSeconds(output)).toBe(120);
  });

  it('extracts seconds from "You hit a rate limit. Please try again after 60 seconds"', () => {
    const output = 'You hit a rate limit. Please try again after 60 seconds';
    expect(parseRateLimitWaitSeconds(output)).toBe(60);
  });

  // Minutes heuristic: treat values < 60 as minutes, convert to seconds
  it('applies minutes heuristic to "try again in 5 minutes"', () => {
    const output = 'try again in 5 minutes';
    expect(parseRateLimitWaitSeconds(output)).toBe(300); // 5 * 60
  });

  it('applies minutes heuristic to "You have been rate limited. Try again in 15 minutes."', () => {
    const output = 'You have been rate limited. Try again in 15 minutes.';
    expect(parseRateLimitWaitSeconds(output)).toBe(900); // 15 * 60
  });

  it('does not apply minutes heuristic to "Please retry after 120 seconds"', () => {
    const output = 'Please retry after 120 seconds';
    expect(parseRateLimitWaitSeconds(output)).toBe(120); // 120 >= 60, no conversion
  });

  it('applies minutes heuristic to "retry after 59 seconds"', () => {
    const output = 'retry after 59 seconds';
    expect(parseRateLimitWaitSeconds(output)).toBe(3540); // 59 * 60
  });

  // Time-based reset patterns with frozen "now" for deterministic testing
  describe('time-based reset patterns', () => {
    it('parses "resets at 23:00" from 8 PM UTC', () => {
      const output = 'rate limit hit. resets at 23:00';
      const now = new Date('2026-07-05T20:00:00Z'); // 8 PM UTC
      expect(parseRateLimitWaitSeconds(output, now)).toBe(10800); // 3 hours = 10800 seconds
    });

    it('parses "resets 11pm" from 8 PM UTC', () => {
      const output = 'rate limit hit. resets 11pm';
      const now = new Date('2026-07-05T20:00:00Z'); // 8 PM UTC
      expect(parseRateLimitWaitSeconds(output, now)).toBe(10800); // 3 hours = 10800 seconds
    });

    it('handles next-day rollover: "resets at 23:00" from 11:30 PM UTC', () => {
      const output = 'resets at 23:00';
      const now = new Date('2026-07-05T23:30:00Z'); // 11:30 PM UTC
      expect(parseRateLimitWaitSeconds(output, now)).toBe(84600); // ~23.5 hours to tomorrow 11 PM
    });

    it('handles next-day rollover: "resets 3am" from 11 PM UTC', () => {
      const output = 'resets 3am';
      const now = new Date('2026-07-05T23:00:00Z'); // 11 PM UTC
      expect(parseRateLimitWaitSeconds(output, now)).toBe(14400); // 4 hours to 3 AM next day
    });

    it('parses "resets at 23:30" from 8 PM UTC', () => {
      const output = 'resets at 23:30';
      const now = new Date('2026-07-05T20:00:00Z'); // 8 PM UTC
      expect(parseRateLimitWaitSeconds(output, now)).toBe(12600); // 3.5 hours = 12600 seconds
    });

    it('handles edge case: "resets 1pm" from 12 PM UTC (1 hour away)', () => {
      const output = 'resets 1pm';
      const now = new Date('2026-07-05T12:00:00Z'); // 12 PM UTC (noon)
      expect(parseRateLimitWaitSeconds(output, now)).toBe(3600); // 1 hour = 3600 seconds
    });

    it('returns fallback when no time pattern is found', () => {
      const output = 'Some error without time info';
      const now = new Date('2026-07-05T20:00:00Z');
      expect(parseRateLimitWaitSeconds(output, now)).toBe(0); // Falls back to 0 (no match)
    });
  });
});
