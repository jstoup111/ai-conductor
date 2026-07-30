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

export type TimingRollup =
  | MeasuredTimingRollup
  | { state: 'partial'; activeMs?: number }
  | { state: 'unavailable' };

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
): Promise<TimingRollup> {
  const raw = await readFile(
    join(worktreeDir, '.pipeline', 'events.jsonl'),
    'utf8',
  );
  const activeIntervals: unknown[] = [];
  const providerIntervals: unknown[] = [];
  const openExecutions = new Map<string, number>();
  let activeEvidenceIncomplete = false;
  let providerEvidenceIncomplete = false;

  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed !== 'object' || parsed === null) return { state: 'partial' };
      event = parsed as Record<string, unknown>;
    } catch {
      return { state: 'partial' };
    }

    const step = typeof event.step === 'string' ? event.step : undefined;
    const startKind =
      event.type === 'step_started'
        ? 'step'
        : event.type === 'parallel_started'
          ? 'parallel'
          : undefined;
    const terminalKind =
      event.type === 'step_completed' || event.type === 'step_failed'
        ? 'step'
        : event.type === 'parallel_completed' || event.type === 'parallel_failure'
          ? 'parallel'
          : undefined;
    if (startKind && step) {
      const key = `${startKind}:${step}`;
      openExecutions.set(key, (openExecutions.get(key) ?? 0) + 1);
    }
    if (terminalKind) {
      if (!step || !('activeInterval' in event)) activeEvidenceIncomplete = true;
      if (step) {
        const key = `${terminalKind}:${step}`;
        const count = openExecutions.get(key) ?? 0;
        if (count > 1) openExecutions.set(key, count - 1);
        else openExecutions.delete(key);
      }
    }
    if (terminalKind && 'activeInterval' in event) {
      activeIntervals.push(event.activeInterval);
    }
    const mayCarryProviderEvidence =
      terminalKind !== undefined || event.type === 'provider_attempt';
    if (
      mayCarryProviderEvidence &&
      'observedIntervals' in event &&
      !Array.isArray(event.observedIntervals)
    ) {
      providerEvidenceIncomplete = true;
    } else if (mayCarryProviderEvidence && Array.isArray(event.observedIntervals)) {
      providerIntervals.push(...event.observedIntervals);
    }
    if (
      event.type === 'provider_attempt' &&
      event.invoked === true &&
      (!Array.isArray(event.observedIntervals) || event.observedIntervals.length === 0)
    ) {
      providerEvidenceIncomplete = true;
    }
  }

  const activeUnion = unionIntervals(activeIntervals);
  const providerUnion = unionIntervals(providerIntervals);
  const providerWithinActive = intersectIntervalUnions(
    activeUnion.intervals,
    providerUnion.intervals,
  );
  activeEvidenceIncomplete ||= activeUnion.invalidIntervals.length > 0;
  providerEvidenceIncomplete ||= providerUnion.invalidIntervals.length > 0;

  if (activeUnion.intervals.length === 0) {
    return activeEvidenceIncomplete || openExecutions.size > 0
      ? { state: 'partial' }
      : { state: 'unavailable' };
  }

  const providerDurationMs = providerUnion.intervals.reduce(
    (total, interval) => total + interval.durationMs,
    0,
  );
  const providerWithinActiveDurationMs = providerWithinActive.intervals.reduce(
    (total, interval) => total + interval.durationMs,
    0,
  );
  if (
    activeEvidenceIncomplete ||
    openExecutions.size > 0 ||
    providerDurationMs !== providerWithinActiveDurationMs
  ) {
    return { state: 'partial' };
  }

  const activeMs = Math.round(
    activeUnion.intervals.reduce(
      (total, interval) => total + interval.durationMs,
      0,
    ),
  );
  if (providerEvidenceIncomplete) return { state: 'partial', activeMs };

  const providerActiveMs = Math.round(providerWithinActiveDurationMs);

  return {
    state: 'measured',
    activeMs,
    providerActiveMs,
    noProviderActiveMs: activeMs - providerActiveMs,
  };
}
