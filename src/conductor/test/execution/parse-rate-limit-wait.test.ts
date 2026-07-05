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
});
