import { appendFileSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ConductorEvent } from '../types/events.js';
import {
  createConductStateLease,
  type ConductStateLease,
  type ConductStateLeaseOptions,
} from './conduct-state-lease.js';

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
  | TaskPlanGapExternalEvent
  | KickbackBudgetAdjustmentAuthorizationEvent;

export type KickbackBudgetAdjustmentAuthorizationEvent = Extract<ConductorEvent,
  { type: 'kickback_budget_adjustment_authorized' }>;

export type KickbackBudgetAuthorizationAppendResult =
  | { ok: true; kind: 'appended' | 'already-recorded' }
  | { ok: false; kind: 'refused'; message: string };

export interface AppendKickbackBudgetAuthorizationOptions {
  /** Test seam for contention, interruption, and ownership-loss refusal. */
  lease?: ConductStateLease;
  leaseOptions?: Omit<ConductStateLeaseOptions, 'label'>;
}

const PIPELINE_EVENTS_LEDGER = 'pipeline-events.jsonl';

function pipelineEventsPath(projectRoot: string): string {
  return join(projectRoot, '.pipeline', PIPELINE_EVENTS_LEDGER);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function existingAuthorization(
  value: unknown,
  adjustmentId: string,
): KickbackBudgetAdjustmentAuthorizationEvent | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return record.type === 'kickback_budget_adjustment_authorized' &&
    record.adjustmentId === adjustmentId
    ? record as KickbackBudgetAdjustmentAuthorizationEvent
    : undefined;
}

async function readExternalLedger(path: string): Promise<unknown[]> {
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const lines = contents.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((line) => JSON.parse(line));
}

/** Append a pipeline-owned closeout event without touching the engine ledger. */
export function appendCloseoutEvent(
  projectRoot: string,
  event: ExternalPipelineEvent,
): void {
  const pipelineDir = join(projectRoot, '.pipeline');
  mkdirSync(pipelineDir, { recursive: true });
  appendFileSync(
    join(pipelineDir, PIPELINE_EVENTS_LEDGER),
    `${JSON.stringify(event)}\n`,
    'utf8',
  );
}

/**
 * Append an operator's authorization once. The external-process writer shares
 * the pipeline event schema but cannot use the engine's in-memory emitter, so
 * the sibling ledger is serialized with a bounded local lease.
 */
export async function appendKickbackBudgetAuthorization(
  projectRoot: string,
  event: KickbackBudgetAdjustmentAuthorizationEvent,
  options: AppendKickbackBudgetAuthorizationOptions = {},
): Promise<KickbackBudgetAuthorizationAppendResult> {
  const ledgerPath = pipelineEventsPath(projectRoot);
  const lease = options.lease ?? createConductStateLease(ledgerPath, {
    ...options.leaseOptions,
    label: 'pipeline event ledger',
  });
  const acquired = await lease.acquire();
  if (!acquired.ok) return { ok: false, kind: 'refused', message: acquired.message };

  try {
    let records: unknown[];
    try {
      records = await readExternalLedger(ledgerPath);
    } catch (error) {
      return {
        ok: false,
        kind: 'refused',
        message: `Unable to read pipeline event ledger: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const existing = records
      .map((record) => existingAuthorization(record, event.adjustmentId))
      .find((record): record is KickbackBudgetAdjustmentAuthorizationEvent => record !== undefined);
    if (existing !== undefined) {
      return canonicalJson(existing) === canonicalJson(event)
        ? { ok: true, kind: 'already-recorded' }
        : { ok: false, kind: 'refused', message: 'pipeline event ledger already contains a conflicting adjustment authorization' };
    }

    try {
      await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
      await writeFile(ledgerPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
      return { ok: true, kind: 'appended' };
    } catch (error) {
      return {
        ok: false,
        kind: 'refused',
        message: `Unable to append pipeline event ledger: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } finally {
    await acquired.handle.release();
  }
}
