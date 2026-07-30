import { describe, expect, it } from 'vitest';

import { createEpochAnchoredMonotonicClock } from '../../src/execution/epoch-clock.js';
import {
  epochAnchoredMonotonicClock,
  observeInterval,
  type IntervalClock,
  type ObservedInterval,
} from '../../src/execution/observed-interval.js';

function scriptedClock(...readings: number[]): IntervalClock {
  return {
    nowMs: () => {
      const reading = readings.shift();
      if (reading === undefined) {
        throw new Error('scripted clock exhausted');
      }
      return reading;
    },
  };
}

describe('observed execution intervals', () => {
  it('anchors monotonic readings to the Unix epoch', () => {
    const clock = createEpochAnchoredMonotonicClock({
      timeOrigin: 1_700_000_000_000,
      now: () => 12.75,
    });

    expect(clock.nowMs()).toBe(1_700_000_000_012.75);
  });

  it('measures the exact positive interval around an async operation', async () => {
    const clock = scriptedClock(1_000, 1_025);

    const observed = await observeInterval(clock, async () => 'complete');

    expect(observed).toEqual({
      value: 'complete',
      interval: { startedAtMs: 1_000, durationMs: 25 },
    });
  });

  it('preserves fractional millisecond precision', async () => {
    const clock = scriptedClock(10.25, 11.875);

    const { interval } = await observeInterval(clock, async () => undefined);

    expect(interval).toEqual({ startedAtMs: 10.25, durationMs: 1.625 });
  });

  it('cannot manufacture a negative interval when an injected clock regresses', async () => {
    const clock = scriptedClock(200, 199);

    const { interval } = await observeInterval(clock, async () => undefined);

    expect(interval).toEqual({ startedAtMs: 200, durationMs: 0 });
  });

  it('defines interval evidence independently from provider token usage', () => {
    const interval: ObservedInterval = { startedAtMs: 5, durationMs: 2 };

    expect(interval).toEqual({ startedAtMs: 5, durationMs: 2 });
  });

  it('provides the production clock through the same interval-clock contract', () => {
    const clock: IntervalClock = epochAnchoredMonotonicClock;

    expect(typeof clock.nowMs).toBe('function');
  });
});
