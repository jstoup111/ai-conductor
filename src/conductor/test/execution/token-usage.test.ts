import { describe, expect, it } from 'vitest';
import { classifyMetering } from '../../src/engine/metering.js';
import { combineTokenUsage, withholdCost } from '../../src/execution/token-usage.js';

describe('token usage helpers', () => {
  it('keeps absent usage absent rather than inventing a zero', () => {
    expect(withholdCost(undefined)).toBeUndefined();
    expect(combineTokenUsage(undefined, undefined)).toBeUndefined();
  });

  it('withholds only the price, leaving the attempt cost-unmetered', () => {
    const usage = withholdCost({ input: 5, output: 2, cacheRead: 9, numTurns: 1, costUsd: 0.4, costSource: 'provider' });

    expect(usage).toEqual({ input: 5, output: 2, cacheRead: 9, numTurns: 1 });
    expect(classifyMetering(usage)).toBe('cost-unmetered');
  });

  it('returns the one side present unchanged', () => {
    const usage = { input: 3, output: 1, costUsd: 0.2, costSource: 'provider' as const };

    expect(combineTokenUsage(usage, undefined)).toBe(usage);
    expect(combineTokenUsage(undefined, usage)).toBe(usage);
  });

  it('sums two invocations exactly once each', () => {
    expect(combineTokenUsage(
      { input: 10, output: 2, cacheRead: 5, numTurns: 1, costUsd: 0.1, costSource: 'provider', attributedModel: 'a/one' },
      { input: 20, output: 4, cacheCreation: 7, numTurns: 2, costUsd: 0.3, costSource: 'provider', attributedModel: 'a/two' },
    )).toEqual({
      input: 30,
      output: 6,
      cacheRead: 5,
      cacheCreation: 7,
      numTurns: 3,
      costUsd: 0.4,
      costSource: 'provider',
      attributedModel: 'a/two',
    });
  });

  it('labels a sum that includes an estimate as an estimate', () => {
    expect(combineTokenUsage(
      { input: 1, output: 1, costUsd: 0.1, costSource: 'provider' },
      { input: 1, output: 1, costUsd: 0.2, costSource: 'rate-card' },
    )).toMatchObject({ costSource: 'rate-card' });
  });

  it('leaves the sum cost-unmetered when either side is unpriced, rather than a partial $', () => {
    const combined = combineTokenUsage(
      { input: 10, output: 2 },
      { input: 20, output: 4, costUsd: 0.3, costSource: 'provider' },
    );

    expect(combined).toEqual({ input: 30, output: 6 });
    expect(classifyMetering(combined)).toBe('cost-unmetered');
  });
});
