import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ObservedInterval } from '../execution/observed-interval.js';

export interface IntervalUnionResult {
  intervals: ObservedInterval[];
  invalidIntervals: unknown[];
}

export interface IntervalUnionDurationResult {
  durationMs: number;
  invalidIntervals: unknown[];
}

export interface MeasuredTimingRollup {
  state: 'measured';
  activeMs: number;
  providerActiveMs: number;
  noProviderActiveMs: number;
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

export function intervalUnionDurationMs(
  intervals: readonly unknown[],
): IntervalUnionDurationResult {
  const union = unionIntervals(intervals);
  return {
    durationMs: union.intervals.reduce(
      (total, interval) => total + interval.durationMs,
      0,
    ),
    invalidIntervals: union.invalidIntervals,
  };
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

export async function computeTimingRollup(
  worktreeDir: string,
): Promise<MeasuredTimingRollup> {
  const raw = await readFile(
    join(worktreeDir, '.pipeline', 'events.jsonl'),
    'utf8',
  );
  const activeIntervals: unknown[] = [];
  const providerIntervals: unknown[] = [];

  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    const event = JSON.parse(line) as Record<string, unknown>;
    if ('activeInterval' in event) {
      activeIntervals.push(event.activeInterval);
    }
    if (Array.isArray(event.observedIntervals)) {
      providerIntervals.push(...event.observedIntervals);
    }
  }

  const activeUnion = unionIntervals(activeIntervals);
  const providerWithinActive = intersectIntervalUnions(
    activeUnion.intervals,
    providerIntervals,
  );
  const activeMs = Math.round(
    activeUnion.intervals.reduce(
      (total, interval) => total + interval.durationMs,
      0,
    ),
  );
  const providerActiveMs = Math.round(
    providerWithinActive.intervals.reduce(
      (total, interval) => total + interval.durationMs,
      0,
    ),
  );

  return {
    state: 'measured',
    activeMs,
    providerActiveMs,
    noProviderActiveMs: activeMs - providerActiveMs,
  };
}
