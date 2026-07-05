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
});
