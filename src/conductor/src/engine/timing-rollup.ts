import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { intersectIntervalUnions, unionIntervals } from './interval-algebra.js';

export interface MeasuredTimingRollup {
  state: 'measured';
  activeMs: number;
  providerActiveMs: number;
  noProviderActiveMs: number;
}

export type TimingRollup =
  | MeasuredTimingRollup
  | { state: 'partial'; activeMs?: number; reason?: 'empty-active-union' }
  | { state: 'unavailable' };

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

async function readTimingLedger(path: string): Promise<Record<string, unknown>[] | null> {
  try {
    return parseLedger(await readFile(path, 'utf8'));
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null;
  }
}

interface TimingEvidence {
  activeIntervals: unknown[];
  providerIntervals: unknown[];
  openExecutions: Map<string, number>;
  closedParallelExecutions: Set<string>;
  activeEvidenceIncomplete: boolean;
  providerEvidenceIncomplete: boolean;
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
    if (startKind === 'parallel') evidence.closedParallelExecutions.delete(key);
    evidence.openExecutions.set(key, (evidence.openExecutions.get(key) ?? 0) + 1);
  }
  if (terminalKind) {
    const key = step ? `${terminalKind}:${step}` : undefined;
    const closesKnownParallelExecution =
      terminalKind === 'parallel'
      && key !== undefined
      && !evidence.openExecutions.has(key)
      && evidence.closedParallelExecutions.has(key);
    const hasActiveInterval = 'activeInterval' in event;
    if (!step || (!hasActiveInterval && !closesKnownParallelExecution)) {
      evidence.activeEvidenceIncomplete = true;
    }
    if (step) {
      const executionKey = `${terminalKind}:${step}`;
      const count = evidence.openExecutions.get(executionKey) ?? 0;
      if (count > 1) evidence.openExecutions.set(executionKey, count - 1);
      else evidence.openExecutions.delete(executionKey);
      if (
        terminalKind === 'parallel'
        && count <= 1
        && (count > 0 || hasActiveInterval)
      ) {
        evidence.closedParallelExecutions.add(executionKey);
      }
    }
    if (hasActiveInterval) evidence.activeIntervals.push(event.activeInterval);
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
    closedParallelExecutions: new Set(),
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
      ? { state: 'partial', reason: 'empty-active-union' }
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
  const pipelineDir = join(worktreeDir, '.pipeline');
  const [events, pipelineEvents] = await Promise.all([
    readTimingLedger(join(pipelineDir, 'events.jsonl')),
    readTimingLedger(join(pipelineDir, 'pipeline-events.jsonl')),
  ]);
  return events === null || pipelineEvents === null
    ? { state: 'partial' }
    : calculateTimingRollup(collectTimingEvidence([...events, ...pipelineEvents]));
}
