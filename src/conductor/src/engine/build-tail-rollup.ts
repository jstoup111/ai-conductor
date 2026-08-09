import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type BuildTailEvent = Record<string, unknown> & { ts: number };

/** A completed `build` step, with all merged ledger events that occurred within it. */
export interface BuildWindow {
  startedAt: number;
  endedAt: number;
  events: readonly BuildTailEvent[];
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
