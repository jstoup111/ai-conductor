import type { ObservedInterval } from '../execution/observed-interval.js';

export interface IntervalUnionResult {
  intervals: ObservedInterval[];
  invalidIntervals: unknown[];
}

function intervalEndMs(interval: ObservedInterval): number {
  return interval.startedAtMs + interval.durationMs;
}

function isValidInterval(value: unknown): value is ObservedInterval {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<ObservedInterval>;
  return (
    typeof candidate.startedAtMs === 'number' &&
    Number.isFinite(candidate.startedAtMs) &&
    typeof candidate.durationMs === 'number' &&
    Number.isFinite(candidate.durationMs) &&
    candidate.durationMs >= 0 &&
    Number.isFinite(candidate.startedAtMs + candidate.durationMs)
  );
}

export function unionIntervals(intervals: readonly unknown[]): IntervalUnionResult {
  const valid: ObservedInterval[] = [];
  const invalidIntervals: unknown[] = [];

  for (const interval of intervals) {
    if (isValidInterval(interval)) {
      valid.push(interval);
    } else {
      invalidIntervals.push(interval);
    }
  }

  valid.sort(
    (left, right) =>
      left.startedAtMs - right.startedAtMs ||
      intervalEndMs(left) - intervalEndMs(right),
  );

  const union: ObservedInterval[] = [];
  for (const interval of valid) {
    const previous = union.at(-1);
    if (!previous || interval.startedAtMs > intervalEndMs(previous)) {
      union.push({ ...interval });
      continue;
    }

    const mergedEndMs = Math.max(intervalEndMs(previous), intervalEndMs(interval));
    previous.durationMs = mergedEndMs - previous.startedAtMs;
  }

  return { intervals: union, invalidIntervals };
}

export function intersectIntervalUnions(
  leftIntervals: readonly unknown[],
  rightIntervals: readonly unknown[],
): IntervalUnionResult {
  const left = unionIntervals(leftIntervals);
  const right = unionIntervals(rightIntervals);
  const intersections: ObservedInterval[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.intervals.length && rightIndex < right.intervals.length) {
    const leftInterval = left.intervals[leftIndex];
    const rightInterval = right.intervals[rightIndex];
    const startMs = Math.max(leftInterval.startedAtMs, rightInterval.startedAtMs);
    const endMs = Math.min(intervalEndMs(leftInterval), intervalEndMs(rightInterval));

    if (startMs < endMs) {
      intersections.push({ startedAtMs: startMs, durationMs: endMs - startMs });
    }

    if (intervalEndMs(leftInterval) <= intervalEndMs(rightInterval)) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }

  return {
    intervals: intersections,
    invalidIntervals: [...left.invalidIntervals, ...right.invalidIntervals],
  };
}
