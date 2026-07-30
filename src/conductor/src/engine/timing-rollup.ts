import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ObservedInterval } from '../execution/observed-interval.js';

export interface IntervalUnionResult {
  intervals: ObservedInterval[];
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

interface TimingEvidence {
  activeIntervals: unknown[];
  providerIntervals: unknown[];
  openExecutions: Map<string, number>;
  activeEvidenceIncomplete: boolean;
  providerEvidenceIncomplete: boolean;
}

function parseLedger(raw: string): Record<string, unknown>[] | null {
  const events: Record<string, unknown>[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed !== 'object' || parsed === null) return null;
      events.push(parsed as Record<string, unknown>);
    } catch {
      return null;
    }
  }
  return events;
}

function collectExecutionEvidence(
  event: Record<string, unknown>,
  evidence: TimingEvidence,
): 'step' | 'parallel' | undefined {
  const step = typeof event.step === 'string' ? event.step : undefined;
  const startKind = event.type === 'step_started'
    ? 'step'
    : event.type === 'parallel_started' ? 'parallel' : undefined;
  const terminalKind =
    event.type === 'step_completed' || event.type === 'step_failed'
      ? 'step'
      : event.type === 'parallel_completed' || event.type === 'parallel_failure'
        ? 'parallel'
        : undefined;

  if (startKind && step) {
    const key = `${startKind}:${step}`;
    evidence.openExecutions.set(key, (evidence.openExecutions.get(key) ?? 0) + 1);
  }
  if (terminalKind) {
    if (!step || !('activeInterval' in event)) evidence.activeEvidenceIncomplete = true;
    if (step) {
      const key = `${terminalKind}:${step}`;
      const count = evidence.openExecutions.get(key) ?? 0;
      if (count > 1) evidence.openExecutions.set(key, count - 1);
      else evidence.openExecutions.delete(key);
    }
    if ('activeInterval' in event) evidence.activeIntervals.push(event.activeInterval);
  }
  return terminalKind;
}

function collectProviderEvidence(
  event: Record<string, unknown>,
  terminalKind: 'step' | 'parallel' | undefined,
  evidence: TimingEvidence,
): void {
  const mayCarryProviderEvidence =
    terminalKind !== undefined || event.type === 'provider_attempt';
  if (
    mayCarryProviderEvidence &&
    'observedIntervals' in event &&
    !Array.isArray(event.observedIntervals)
  ) {
    evidence.providerEvidenceIncomplete = true;
  } else if (mayCarryProviderEvidence && Array.isArray(event.observedIntervals)) {
    evidence.providerIntervals.push(...event.observedIntervals);
  }
  if (
    event.type === 'provider_attempt' &&
    event.invoked === true &&
    (!Array.isArray(event.observedIntervals) || event.observedIntervals.length === 0)
  ) {
    evidence.providerEvidenceIncomplete = true;
  }
}

function collectTimingEvidence(events: readonly Record<string, unknown>[]): TimingEvidence {
  const activeIntervals: unknown[] = [];
  const providerIntervals: unknown[] = [];
  const openExecutions = new Map<string, number>();
  const evidence: TimingEvidence = {
    activeIntervals,
    providerIntervals,
    openExecutions,
    activeEvidenceIncomplete: false,
    providerEvidenceIncomplete: false,
  };
  for (const event of events) {
    collectProviderEvidence(event, collectExecutionEvidence(event, evidence), evidence);
  }
  return evidence;
}

function calculateTimingRollup(evidence: TimingEvidence): TimingRollup {
  const activeUnion = unionIntervals(evidence.activeIntervals);
  const providerUnion = unionIntervals(evidence.providerIntervals);
  const providerWithinActive = intersectIntervalUnions(
    activeUnion.intervals,
    providerUnion.intervals,
  );
  evidence.activeEvidenceIncomplete ||= activeUnion.invalidIntervals.length > 0;
  evidence.providerEvidenceIncomplete ||= providerUnion.invalidIntervals.length > 0;

  if (activeUnion.intervals.length === 0) {
    return evidence.activeEvidenceIncomplete || evidence.openExecutions.size > 0
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
    evidence.activeEvidenceIncomplete ||
    evidence.openExecutions.size > 0 ||
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
  if (evidence.providerEvidenceIncomplete) return { state: 'partial', activeMs };

  const providerActiveMs = Math.round(providerWithinActiveDurationMs);

  return {
    state: 'measured',
    activeMs,
    providerActiveMs,
    noProviderActiveMs: activeMs - providerActiveMs,
  };
}

export async function computeTimingRollup(
  worktreeDir: string,
): Promise<TimingRollup> {
  const raw = await readFile(
    join(worktreeDir, '.pipeline', 'events.jsonl'),
    'utf8',
  );
  const events = parseLedger(raw);
  return events === null
    ? { state: 'partial' }
    : calculateTimingRollup(collectTimingEvidence(events));
}
