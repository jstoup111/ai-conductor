import { performance } from 'node:perf_hooks';

export interface ObservedInterval {
  startedAtMs: number;
  durationMs: number;
}

export interface IntervalClock {
  nowMs(): number;
}

interface MonotonicPerformanceSource {
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

export const epochAnchoredMonotonicClock: IntervalClock =
  createEpochAnchoredMonotonicClock(performance);

export async function observeInterval<T>(
  clock: IntervalClock,
  operation: () => Promise<T>,
): Promise<{ value: T; interval: ObservedInterval }> {
  const startedAtMs = clock.nowMs();
  const value = await operation();
  const durationMs = Math.max(0, clock.nowMs() - startedAtMs);

  return { value, interval: { startedAtMs, durationMs } };
}
