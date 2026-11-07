import { performance } from 'node:perf_hooks';
import { createEpochAnchoredMonotonicClock } from './epoch-clock.js';
export type { ObservedInterval } from '../types/provider.js';
import type { ObservedInterval } from '../types/provider.js';


export interface IntervalClock {
  nowMs(): number;
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
