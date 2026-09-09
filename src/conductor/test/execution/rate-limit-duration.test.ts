// Covers: task:1
import { describe, expect, it } from 'vitest';
import {
  inferRateLimitWaitSeconds,
  rateLimitDurationUnitAlternation,
  scaleRateLimitDurationSeconds,
} from '../../src/execution/rate-limit-duration.js';

describe('rateLimitDurationUnitAlternation', () => {
  it('lists every accepted unit literal longest-first', () => {
    expect(rateLimitDurationUnitAlternation).toBe(
      'seconds|minutes|second|minute|hours|secs|mins|hour|sec|min|hrs|hr|s|m|h',
    );
  });
});

describe('scaleRateLimitDurationSeconds', () => {
  it.each([
    ['SeCoNdS', 17, 17],
    ['SeCoNd', 17, 17],
    ['sEc', 17, 17],
    ['SeCs', 17, 17],
    ['S', 17, 17],
    ['MiNuTeS', 17, 1020],
    ['MiNuTe', 17, 1020],
    ['mIn', 17, 1020],
    ['MiNs', 17, 1020],
    ['M', 17, 1020],
    ['HoUrS', 2, 7200],
    ['HoUr', 2, 7200],
    ['hR', 2, 7200],
    ['hRs', 2, 7200],
    ['H', 2, 7200],
  ])('scales %s in mixed case', (unit, value, expectedSeconds) => {
    expect(scaleRateLimitDurationSeconds(value, unit)).toBe(expectedSeconds);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'returns nothing for an invalid duration value: %s',
    (value) => {
      expect(scaleRateLimitDurationSeconds(value, 'seconds')).toBeUndefined();
    },
  );
});

describe('inferRateLimitWaitSeconds', () => {
  it.each([
    [2, 300],
    [45, 2700],
    [450, 3600],
  ])('reads a bare %d as minutes and returns %d seconds within its bounds', (value, expectedSeconds) => {
    expect(inferRateLimitWaitSeconds(value)).toBe(expectedSeconds);
  });
});
