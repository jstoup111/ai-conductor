import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { ConductorEvent } from '../types/events.js';

export type PipelineCloseoutEvent = Extract<
  ConductorEvent,
  { type: 'pipeline_closeout' }
>;

/** Append a pipeline-owned closeout event without touching the engine ledger. */
export function appendCloseoutEvent(
  projectRoot: string,
  event: PipelineCloseoutEvent,
): void {
  const pipelineDir = join(projectRoot, '.pipeline');
  mkdirSync(pipelineDir, { recursive: true });
  appendFileSync(
    join(pipelineDir, 'pipeline-events.jsonl'),
    `${JSON.stringify(event)}\n`,
    'utf8',
  );
}
