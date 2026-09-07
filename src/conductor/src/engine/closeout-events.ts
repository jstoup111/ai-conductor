import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
export type KickbackBudgetExternalEvent = Extract<ConductorEvent, { type: 'kickback_budget_adjustment_authorized' }>;
export type ExternalPipelineEvent =
  | PipelineCloseoutEvent
  | BuildReviewExternalEvent
  | TaskPlanGapExternalEvent
  | KickbackBudgetExternalEvent;

/** Append a pipeline-owned closeout event without touching the engine ledger. */
export function appendCloseoutEvent(
  projectRoot: string,
  event: ExternalPipelineEvent,
): void {
  const pipelineDir = join(projectRoot, '.pipeline');
  mkdirSync(pipelineDir, { recursive: true });
  const eventPath = join(pipelineDir, 'pipeline-events.jsonl');
  // Authorization replay is keyed by its durable adjustment id. This makes a
  // command-entry reconciliation safe after a crash between event and apply.
  if (event.type === 'kickback_budget_adjustment_authorized' && existsSync(eventPath)) {
    const alreadyRecorded = readFileSync(eventPath, 'utf8').split('\n').some((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        return typeof parsed === 'object' && parsed !== null &&
          (parsed as { type?: unknown }).type === event.type &&
          (parsed as { adjustmentId?: unknown }).adjustmentId === event.adjustmentId;
      } catch { return false; }
    });
    if (alreadyRecorded) return;
  }
  appendFileSync(
    eventPath,
    `${JSON.stringify(event)}\n`,
    'utf8',
  );
}
