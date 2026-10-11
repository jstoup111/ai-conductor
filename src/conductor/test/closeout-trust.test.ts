import { describe, expect, it } from 'vitest';
import { closeoutDurationMs } from '../src/engine/closeout-trust.js';

describe('closeoutDurationMs', () => {
  // Covers: task:1
  it('returns the duration for a trusted two-minute closeout pair', () => {
    expect(closeoutDurationMs({
      startedAt: 1_788_044_947_584,
      endedAt: 1_788_045_067_584,
      ts: 1_788_045_067_790,
    })).toBe(120_000);
  });

  // Covers: task:1
  it('returns undefined for rejected closeout fixtures', () => {
    const rejectedFixtures = [
    ['both nanosecond timestamps', 1_788_044_947_584_758_500, 1_788_045_067_588_425_500, 1_788_045_067_790],
    ['mixed millisecond and nanosecond timestamps', 1_788_012_400_000, 178_801_157_372_296_540, 1_788_012_400_000],
    ['equal timestamps', 1_788_012_086_561, 1_788_012_086_561, 1_788_012_086_561],
    ['reversed timestamps', 1_788_012_086_562, 1_788_012_086_561, 1_788_012_086_562],
    ['a non-integer timestamp', 1_788_012_086_561.5, 1_788_012_086_562, 1_788_012_086_562],
    ['timestamps below the epoch floor', 100, 140, 140],
    ['an end timestamp beyond the future skew', 1_788_012_086_561, 1_788_012_146_562, 1_788_012_086_561],
    ] as const;

    for (const [_shape, startedAt, endedAt, ts] of rejectedFixtures) {
      expect(closeoutDurationMs({ startedAt, endedAt, ts })).toBeUndefined();
    }
  });

  it.each([
    ['startedAt', 'not-a-number', 1_788_012_086_562, 1_788_012_086_562],
    ['endedAt', 1_788_012_086_561, null, 1_788_012_086_562],
    ['ts', 1_788_012_086_561, 1_788_012_086_562, undefined],
  ])('returns undefined when %s is not a number', (_field, startedAt, endedAt, ts) => {
    expect(closeoutDurationMs({ startedAt, endedAt, ts })).toBeUndefined();
  });
});
