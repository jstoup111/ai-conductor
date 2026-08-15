import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type BuildTailEvent = Record<string, unknown> & { ts: number };

/** A completed `build` step, with all merged ledger events that occurred within it. */
export interface BuildWindow {
  startedAt: number;
  endedAt: number;
  events: readonly BuildTailEvent[];
}

export interface BuildTailWindowRollup {
  classification: 'first-pass' | 're-entry';
  taskExecution: { startedAt: number; endedAt: number; durationMs: number } | undefined;
  postResolutionTicks: readonly {
    ts: number;
    classification: 'remediation' | 'closeout';
  }[];
  closeout:
    | { state: 'unrecorded' }
    | {
      state: 'recorded';
      durationMs: number;
      obligations: Readonly<Record<string, number>>;
    };
}

export interface MeasuredBuildTailRollup {
  state: 'measured';
  windows: readonly BuildTailWindowRollup[];
}

export interface PartialBuildTailRollup {
  state: 'partial';
  closeout?: Extract<BuildTailWindowRollup['closeout'], { state: 'recorded' }>;
}

export type BuildTailRollup =
  | MeasuredBuildTailRollup
  | PartialBuildTailRollup
  | { state: 'unavailable' };

export type BuildWindowsResult =
  | { state: 'measured'; windows: readonly BuildWindow[] }
  | PartialBuildTailRollup
  | { state: 'unavailable' };

export interface BuildReviewMetrics { readonly lapsToPass: number | undefined; readonly rubricFailureRates: Readonly<Record<string, { failures: number; judged: number }>>; readonly skipped: number; readonly cacheHits: number; readonly infrastructureFailures: number; }
/** Raw rubric outcomes are counted before accepted risks affect the outer verdict. */
export function computeBuildReviewMetrics(events: readonly BuildTailEvent[]): BuildReviewMetrics {
  const rubricFailureRates: Record<string, { failures: number; judged: number }> = {}; const laps: string[] = []; let pass: string | undefined; let skipped = 0; let cacheHits = 0; let infrastructureFailures = 0;
  for (const e of events) {
    if (e.type === 'build_review_rubric_result' && typeof e.rubric === 'string' && typeof e.lapId === 'string') { if (!laps.includes(e.lapId)) laps.push(e.lapId); const r = rubricFailureRates[e.rubric] ??= { failures: 0, judged: 0 }; r.judged++; if (e.verdict === 'FAIL') r.failures++; }
    else if (e.type === 'build_review_rubric_skipped') skipped++; else if (e.type === 'build_review_cache_hit') cacheHits++; else if (e.type === 'build_review_rubric_infrastructure_failure') infrastructureFailures++; else if (e.type === 'build_review_outer_verdict' && e.effectiveVerdict === 'PASS' && typeof e.lapId === 'string' && pass === undefined) pass = e.lapId;
  }
  return { lapsToPass: pass === undefined ? undefined : (laps.indexOf(pass) < 0 ? laps.length + 1 : laps.indexOf(pass) + 1), rubricFailureRates, skipped, cacheHits, infrastructureFailures };
}

interface BuildProgressTick {
  ts: number;
  resolved: number;
  total: number;
  headMoved: boolean;
}

function buildProgressTicks(events: readonly BuildTailEvent[]): BuildProgressTick[] {
  return events.flatMap((event) => (
    event.type === 'build_progress'
      && typeof event.resolved === 'number'
      && typeof event.total === 'number'
      ? [{
        ts: event.ts,
        resolved: event.resolved,
        total: event.total,
        headMoved: event.headMoved === true,
      }]
      : []
  ));
}

function closeoutDurations(
  events: readonly BuildTailEvent[],
): BuildTailWindowRollup['closeout'] | undefined {
  const obligations: Record<string, number> = {};
  let durationMs = 0;
  let recorded = false;
  for (const event of events) {
    if (event.type !== 'pipeline_closeout') continue;
    if (
      typeof event.obligation !== 'string'
      || typeof event.startedAt !== 'number'
      || typeof event.endedAt !== 'number'
      || event.endedAt < event.startedAt
    ) return undefined;
    const duration = event.endedAt - event.startedAt;
    durationMs += duration;
    obligations[event.obligation] = (obligations[event.obligation] ?? 0) + duration;
    recorded = true;
  }
  return recorded
    ? { state: 'recorded', durationMs, obligations }
    : { state: 'unrecorded' };
}

/**
 * Attribute each completed build window without inferring a first-pass task
 * segment from a re-entry that was already fully resolved at its first tick.
 */
export function computeBuildTailRollup(
  windows: readonly BuildWindow[],
): BuildTailRollup {
  if (windows.length === 0) return { state: 'unavailable' };
  const rollups: BuildTailWindowRollup[] = [];
  for (const window of windows) {
    if (window.endedAt < window.startedAt) return { state: 'partial' };
    const ticks = buildProgressTicks(window.events);
    if (ticks.length === 0) return { state: 'partial' };
    const closeout = closeoutDurations(window.events);
    if (closeout === undefined) return { state: 'partial' };
    const firstTick = ticks[0];
    const firstPass = firstTick.resolved < firstTick.total;
    const resolutionIndex = firstPass
      ? ticks.findIndex((tick) => tick.resolved === tick.total)
      : -1;
    const resolutionTick = resolutionIndex >= 0 ? ticks[resolutionIndex] : undefined;

    rollups.push({
      classification: firstPass ? 'first-pass' : 're-entry',
      taskExecution: resolutionTick === undefined
        ? undefined
        : {
          startedAt: window.startedAt,
          endedAt: resolutionTick.ts,
          durationMs: resolutionTick.ts - window.startedAt,
        },
      // A re-entry begins after task resolution, so all later ticks belong to
      // its tail. An unresolved first-pass window has no post-resolution
      // interval and must not relabel task execution as remediation.
      postResolutionTicks: (resolutionIndex >= 0
        ? ticks.slice(resolutionIndex + 1)
        : firstPass ? [] : ticks.slice(1))
        .map((tick) => ({
          ts: tick.ts,
          classification: tick.headMoved ? 'remediation' as const : 'closeout' as const,
        })),
      closeout,
    });
  }
  return {
    state: 'measured',
    windows: rollups,
  };
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function parseLedger(raw: string): BuildTailEvent[] | undefined {
  const events: BuildTailEvent[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const event = JSON.parse(line) as unknown;
      if (typeof event !== 'object' || event === null) return undefined;
      const timestamp = normalizeTimestamp((event as Record<string, unknown>).ts);
      if (timestamp === undefined) return undefined;
      events.push({ ...(event as Record<string, unknown>), ts: timestamp });
    } catch {
      return undefined;
    }
  }
  return events;
}

async function readOptionalLedger(path: string): Promise<BuildTailEvent[] | undefined> {
  try {
    return parseLedger(await readFile(path, 'utf8'));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Read both event ledgers, merge their shared event schema in stable timestamp
 * order, and return each completed build window.  Classification and degraded
 * result states are intentionally owned by later build-tail-rollup tasks.
 */
export async function readBuildWindows(worktreeDir: string): Promise<BuildWindowsResult> {
  const pipelineDir = join(worktreeDir, '.pipeline');
  const engineEvents = await readOptionalLedger(
    join(pipelineDir, 'events.jsonl'),
  );
  const pipelineEvents = await readOptionalLedger(
    join(pipelineDir, 'pipeline-events.jsonl'),
  );
  if (engineEvents === undefined || pipelineEvents === undefined) return { state: 'partial' };
  const events = [...engineEvents, ...pipelineEvents]
    .map((event, ordinal) => ({ event, ordinal }))
    .sort((left, right) => left.event.ts - right.event.ts || left.ordinal - right.ordinal)
    .map(({ event }) => event);

  const windows: BuildWindow[] = [];
  let current: { startedAt: number; events: BuildTailEvent[] } | undefined;
  for (const event of events) {
    if (event.type === 'step_started' && event.step === 'build') {
      current = { startedAt: event.ts, events: [event] };
      continue;
    }
    if (current === undefined) continue;

    current.events.push(event);
    if (event.type === 'step_completed' && event.step === 'build') {
      if (event.ts < current.startedAt) return { state: 'partial' };
      windows.push({
        startedAt: current.startedAt,
        endedAt: event.ts,
        events: current.events,
      });
      current = undefined;
    }
  }
  if (current !== undefined) return { state: 'partial' };
  if (windows.length > 0) return { state: 'measured', windows };

  const closeout = closeoutDurations(events);
  if (closeout === undefined) return { state: 'partial' };
  return closeout.state === 'recorded'
    ? { state: 'partial', closeout }
    : { state: 'unavailable' };
}
