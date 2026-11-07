import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConductorEvent } from '../types/events.js';
import { createConductStateLease } from './conduct-state-lease.js';

/** The only externally-written events admitted from the sibling pipeline ledger. */
export const ADMITTED_EXTERNAL_PIPELINE_EVENT_TYPES = [
  'build_review_disposition_accepted',
  'build_review_reduced_coverage_accepted',
  'build_review_disposition_refused',
  'build_review_outer_verdict',
  'github_operation_failed',
  'kickback_budget_adjustment_authorized',
] as const satisfies readonly ConductorEvent['type'][];

export type AdmittedExternalPipelineEventType =
  (typeof ADMITTED_EXTERNAL_PIPELINE_EVENT_TYPES)[number];
export type BuildReviewExternalEvent = Extract<ConductorEvent,
  { type: Exclude<AdmittedExternalPipelineEventType, 'kickback_budget_adjustment_authorized' | 'github_operation_failed'> }> & { ts: string };
export type GithubOperationFailedExternalEvent = Extract<ConductorEvent,
  { type: 'github_operation_failed' }> & { ts: string };
export type ExternalPipelineEvent =
  | BuildReviewExternalEvent
  | GithubOperationFailedExternalEvent
  | Extract<ConductorEvent, { type: 'kickback_budget_adjustment_authorized' }>;
export type KickbackBudgetExternalEvent = Extract<ExternalPipelineEvent,
  { type: 'kickback_budget_adjustment_authorized' }>;

function pipelineEventPath(projectRoot: string): string {
  return join(projectRoot, '.pipeline', 'pipeline-events.jsonl');
}

function authorizationEventAlreadyRecorded(eventPath: string, adjustmentId: string): boolean {
  return existsSync(eventPath) && readFileSync(eventPath, 'utf8').split('\n').some((line) => {
    try {
      const parsed: unknown = JSON.parse(line);
      return typeof parsed === 'object' && parsed !== null &&
        (parsed as { type?: unknown }).type === 'kickback_budget_adjustment_authorized' &&
        (parsed as { adjustmentId?: unknown }).adjustmentId === adjustmentId;
    } catch { return false; }
  });
}

/** Append a pipeline-owned closeout event without touching the engine ledger. */
export function appendCloseoutEvent(
  projectRoot: string,
  event: ExternalPipelineEvent,
): void {
  const pipelineDir = join(projectRoot, '.pipeline');
  mkdirSync(pipelineDir, { recursive: true });
  const eventPath = pipelineEventPath(projectRoot);
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

/**
 * Atomically record an operator-authorized budget adjustment.  Unlike the
 * generic closeout writer, this carries the ADR-required exactly-once
 * adjustment-id invariant, so its check and append share one writer lease.
 */
export async function appendKickbackBudgetAuthorizationEvent(
  projectRoot: string,
  event: KickbackBudgetExternalEvent,
): Promise<void> {
  const eventPath = pipelineEventPath(projectRoot);
  mkdirSync(join(projectRoot, '.pipeline'), { recursive: true });
  const lease = createConductStateLease(eventPath, { label: 'kickback-budget-authorization-events' });
  const acquired = await lease.acquire();
  if (!acquired.ok) throw new Error(acquired.message);

  let appended = false;
  try {
    if (authorizationEventAlreadyRecorded(eventPath, event.adjustmentId)) return;
    appendFileSync(eventPath, `${JSON.stringify(event)}\n`, 'utf8');
    appended = true;
  } finally {
    const released = await acquired.handle.release();
    if (!released.ok && appended) throw new Error(released.message);
  }
}

/** Read the authorization ledger at the same serialization boundary as its writer. */
export async function readKickbackBudgetAuthorizationEvents(projectRoot: string): Promise<string> {
  const eventPath = pipelineEventPath(projectRoot);
  mkdirSync(join(projectRoot, '.pipeline'), { recursive: true });
  const lease = createConductStateLease(eventPath, { label: 'kickback-budget-authorization-events' });
  const acquired = await lease.acquire();
  if (!acquired.ok) throw new Error(acquired.message);

  try {
    return existsSync(eventPath) ? readFileSync(eventPath, 'utf8') : '';
  } finally {
    await acquired.handle.release();
  }
}
