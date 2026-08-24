import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { ConductorEvent } from '../types/events.js';

export type PipelineCloseoutEvent = Extract<ConductorEvent, { type: 'pipeline_closeout' }>;
export type BuildReviewExternalEvent = Extract<ConductorEvent,
  { type:
    | 'build_review_disposition_accepted'
    | 'build_review_reduced_coverage_accepted'
    | 'build_review_disposition_refused'
    | 'build_review_outer_verdict' }> & { ts: string };
export type TaskPlanGapExternalEvent = Extract<ConductorEvent, { type: 'loop_halt' }> & {
  haltClass: 'plan-gap';
  ts: string;
};
export type ExternalPipelineEvent =
  | PipelineCloseoutEvent
  | BuildReviewExternalEvent
  | TaskPlanGapExternalEvent;

/** Append a pipeline-owned closeout event without touching the engine ledger. */
export function appendCloseoutEvent(
  projectRoot: string,
  event: ExternalPipelineEvent,
): void {
  const pipelineDir = join(projectRoot, '.pipeline');
  mkdirSync(pipelineDir, { recursive: true });
  appendFileSync(
    join(pipelineDir, 'pipeline-events.jsonl'),
    `${JSON.stringify(event)}\n`,
    'utf8',
  );
}
