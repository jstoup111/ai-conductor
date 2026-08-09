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
  closeout: {
    durationMs: number;
    obligations: Readonly<Record<string, number>>;
  };
}

export interface MeasuredBuildTailRollup {
  state: 'measured';
  windows: readonly BuildTailWindowRollup[];
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

function closeoutDurations(events: readonly BuildTailEvent[]): BuildTailWindowRollup['closeout'] {
  const obligations: Record<string, number> = {};
  let durationMs = 0;
  for (const event of events) {
    if (
      event.type !== 'pipeline_closeout'
      || typeof event.obligation !== 'string'
      || typeof event.startedAt !== 'number'
      || typeof event.endedAt !== 'number'
    ) continue;
    const duration = event.endedAt - event.startedAt;
    durationMs += duration;
    obligations[event.obligation] = (obligations[event.obligation] ?? 0) + duration;
  }
  return { durationMs, obligations };
}

/**
 * Attribute each completed build window without inferring a first-pass task
 * segment from a re-entry that was already fully resolved at its first tick.
 */
export function computeBuildTailRollup(
  windows: readonly BuildWindow[],
): MeasuredBuildTailRollup {
  return {
    state: 'measured',
    windows: windows.map((window) => {
      const ticks = buildProgressTicks(window.events);
      const firstTick = ticks[0];
      const firstPass = firstTick !== undefined && firstTick.resolved < firstTick.total;
      const resolutionIndex = firstPass
        ? ticks.findIndex((tick) => tick.resolved === tick.total)
        : -1;
      const resolutionTick = resolutionIndex >= 0 ? ticks[resolutionIndex] : undefined;

      return {
        classification: firstPass ? 'first-pass' : 're-entry',
        taskExecution: resolutionTick === undefined
          ? undefined
          : {
            startedAt: window.startedAt,
            endedAt: resolutionTick.ts,
            durationMs: resolutionTick.ts - window.startedAt,
          },
        postResolutionTicks: (resolutionIndex >= 0 ? ticks.slice(resolutionIndex + 1) : ticks.slice(1))
          .map((tick) => ({
            ts: tick.ts,
            classification: tick.headMoved ? 'remediation' as const : 'closeout' as const,
          })),
        closeout: closeoutDurations(window.events),
      };
    }),
  };
}

function parseLedger(raw: string): BuildTailEvent[] {
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BuildTailEvent);
}

async function readOptionalLedger(path: string): Promise<BuildTailEvent[]> {
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
export async function readBuildWindows(worktreeDir: string): Promise<BuildWindow[]> {
  const pipelineDir = join(worktreeDir, '.pipeline');
  const engineEvents = parseLedger(
    await readFile(join(pipelineDir, 'events.jsonl'), 'utf8'),
  );
  const pipelineEvents = await readOptionalLedger(
    join(pipelineDir, 'pipeline-events.jsonl'),
  );
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
      windows.push({
        startedAt: current.startedAt,
        endedAt: event.ts,
        events: current.events,
      });
      current = undefined;
    }
  }
  return windows;
}
