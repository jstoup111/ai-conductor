import type { IntervalClock } from './observed-interval.js';

export interface MonotonicPerformanceSource {
  readonly timeOrigin: number;
  now(): number;
}

export function createEpochAnchoredMonotonicClock(
  source: MonotonicPerformanceSource,
): IntervalClock {
  return {
    nowMs: () => source.timeOrigin + source.now(),
  };
}
