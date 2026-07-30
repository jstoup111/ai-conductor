import { describe, expect, it } from 'vitest';
import {
  intersectIntervalUnions,
  intervalUnionDurationMs,
  unionIntervals,
} from '../../src/engine/timing-rollup.js';

describe('unionIntervals', () => {
  it.each([
    {
      name: 'disjoint intervals',
      input: [
        { startedAtMs: 0, durationMs: 10 },
        { startedAtMs: 20, durationMs: 5 },
      ],
      expected: [
        { startedAtMs: 0, durationMs: 10 },
        { startedAtMs: 20, durationMs: 5 },
      ],
    },
    {
      name: 'overlapping intervals',
      input: [
        { startedAtMs: 100, durationMs: 200 },
        { startedAtMs: 200, durationMs: 200 },
      ],
      expected: [{ startedAtMs: 100, durationMs: 300 }],
    },
    {
      name: 'nested intervals',
      input: [
        { startedAtMs: 0, durationMs: 100 },
        { startedAtMs: 25, durationMs: 10 },
      ],
      expected: [{ startedAtMs: 0, durationMs: 100 }],
    },
    {
      name: 'adjacent intervals',
      input: [
        { startedAtMs: 0, durationMs: 10 },
        { startedAtMs: 10, durationMs: 5 },
      ],
      expected: [{ startedAtMs: 0, durationMs: 15 }],
    },
    {
      name: 'duplicate intervals',
      input: [
        { startedAtMs: 5, durationMs: 10 },
        { startedAtMs: 5, durationMs: 10 },
      ],
      expected: [{ startedAtMs: 5, durationMs: 10 }],
    },
    {
      name: 'shuffled intervals',
      input: [
        { startedAtMs: 30, durationMs: 10 },
        { startedAtMs: 0, durationMs: 10 },
        { startedAtMs: 8, durationMs: 25 },
      ],
      expected: [{ startedAtMs: 0, durationMs: 40 }],
    },
  ])('returns the exact deterministic union for $name', ({ input, expected }) => {
    expect(unionIntervals(input)).toEqual({ intervals: expected, invalidIntervals: [] });
  });

  it('reports reversed and non-finite inputs without inflating the union', () => {
    const reversed = { startedAtMs: 20, durationMs: -10 };
    const nonFinite = { startedAtMs: Number.POSITIVE_INFINITY, durationMs: 50 };
    const result = unionIntervals([
      { startedAtMs: 0, durationMs: 10 },
      reversed,
      nonFinite,
    ]);

    expect(result).toEqual({
      intervals: [{ startedAtMs: 0, durationMs: 10 }],
      invalidIntervals: [reversed, nonFinite],
    });
  });
});

describe('intervalUnionDurationMs', () => {
  it('sums only the non-overlapping union', () => {
    expect(
      intervalUnionDurationMs([
        { startedAtMs: 0, durationMs: 20 },
        { startedAtMs: 10, durationMs: 20 },
        { startedAtMs: 50, durationMs: 5 },
      ]),
    ).toEqual({ durationMs: 35, invalidIntervals: [] });
  });
});

describe('intersectIntervalUnions', () => {
  it('returns the exact overlap between two interval sets', () => {
    expect(
      intersectIntervalUnions(
        [
          { startedAtMs: 0, durationMs: 20 },
          { startedAtMs: 30, durationMs: 20 },
        ],
        [
          { startedAtMs: 10, durationMs: 30 },
          { startedAtMs: 45, durationMs: 10 },
        ],
      ),
    ).toEqual({
      intervals: [
        { startedAtMs: 10, durationMs: 10 },
        { startedAtMs: 30, durationMs: 10 },
        { startedAtMs: 45, durationMs: 5 },
      ],
      invalidIntervals: [],
    });
  });
});
