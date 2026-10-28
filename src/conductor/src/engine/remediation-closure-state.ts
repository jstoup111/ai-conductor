import { join } from 'node:path';
import { createEngineStateStore, type EngineState } from './engine-state-store.js';
import { repairPlanIdentity } from './repair-obligations.js';

export type RemediationClosureVerdict = 'resolved' | 'persists' | 'partial' | 'unjudged';
export type RemediationClosureDisposition = 'reopened' | 'left-closed' | 'bound-exhausted';

export interface RemediationClosureVerdictRecord {
  verdict: RemediationClosureVerdict;
  rationale: string;
  disposition: RemediationClosureDisposition;
  applied: boolean;
}

export interface RemediationClosureTaskState {
  reopenCount: number;
  verdicts: Record<string, RemediationClosureVerdictRecord>;
}

export interface RemediationClosureState {
  version: 1;
  plans: Record<string, { tasks: Record<string, RemediationClosureTaskState> }>;
}

export type RemediationClosureStateReadResult =
  | { kind: 'present'; state: RemediationClosureState }
  | { kind: 'incompatible'; message: string };

export interface RemediationClosureVerdictToRecord {
  taskId: string;
  closeIdentity: string;
  verdict: RemediationClosureVerdict;
  rationale: string;
  disposition: RemediationClosureDisposition;
}

const MALFORMED_RECORD_MESSAGE = 'Engine state contains a malformed remediation-closure verdict record';
const verdicts = new Set<RemediationClosureVerdict>(['resolved', 'persists', 'partial', 'unjudged']);
const dispositions = new Set<RemediationClosureDisposition>(['reopened', 'left-closed', 'bound-exhausted']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => Object.hasOwn(value, key));
}

function isVerdictRecord(value: unknown): value is RemediationClosureVerdictRecord {
  return isRecord(value) && hasOnlyKeys(value, ['verdict', 'rationale', 'disposition', 'applied']) &&
    typeof value.verdict === 'string' && verdicts.has(value.verdict as RemediationClosureVerdict) &&
    typeof value.rationale === 'string' && typeof value.disposition === 'string' &&
    dispositions.has(value.disposition as RemediationClosureDisposition) && typeof value.applied === 'boolean';
}

function isTaskState(value: unknown): value is RemediationClosureTaskState {
  return isRecord(value) && hasOnlyKeys(value, ['reopenCount', 'verdicts']) &&
    typeof value.reopenCount === 'number' && Number.isSafeInteger(value.reopenCount) && value.reopenCount >= 0 &&
    isRecord(value.verdicts) && Object.values(value.verdicts).every(isVerdictRecord);
}

function isRemediationClosureState(value: unknown): value is RemediationClosureState {
  return isRecord(value) && hasOnlyKeys(value, ['version', 'plans']) && value.version === 1 &&
    isRecord(value.plans) && Object.values(value.plans).every((plan) => isRecord(plan) &&
      hasOnlyKeys(plan, ['tasks']) && isRecord(plan.tasks) && Object.values(plan.tasks).every(isTaskState));
}

function parseState(state: Readonly<EngineState>): RemediationClosureStateReadResult {
  const raw = state.remediationClosure;
  if (raw === undefined) return { kind: 'present', state: { version: 1, plans: {} } };
  if (!isRemediationClosureState(raw)) {
    return { kind: 'incompatible', message: MALFORMED_RECORD_MESSAGE };
  }
  return { kind: 'present', state: structuredClone(raw) };
}

function engineStatePath(projectRoot: string): string {
  return join(projectRoot, '.pipeline', 'engine-state.json');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validateRecordInput(record: RemediationClosureVerdictToRecord): void {
  if (!record.taskId.trim() || !record.closeIdentity.trim() || !record.rationale.trim() ||
    !verdicts.has(record.verdict) || !dispositions.has(record.disposition)) {
    throw new Error('Remediation closure verdict requires a task id, close identity, valid verdict, rationale, and disposition');
  }
}

export async function readRemediationClosureState(projectRoot: string): Promise<RemediationClosureStateReadResult> {
  const result = await createEngineStateStore(engineStatePath(projectRoot)).read();
  if (!result.ok) return { kind: 'incompatible', message: result.message };
  return parseState(result.value);
}

export async function recordRemediationClosureVerdicts(
  projectRoot: string,
  planPath: string,
  records: readonly RemediationClosureVerdictToRecord[],
): Promise<void> {
  for (const record of records) validateRecordInput(record);
  const planIdentity = repairPlanIdentity(projectRoot, planPath);
  const result = await createEngineStateStore(engineStatePath(projectRoot)).update((current) => {
    const parsed = parseState(current);
    if (parsed.kind === 'incompatible') throw new Error(parsed.message);
    const section = clone(parsed.state);
    const plan = section.plans[planIdentity] ?? { tasks: {} };
    section.plans[planIdentity] = plan;
    for (const record of records) {
      const task = plan.tasks[record.taskId] ?? { reopenCount: 0, verdicts: {} };
      plan.tasks[record.taskId] = task;
      if (task.verdicts[record.closeIdentity] === undefined) {
        task.verdicts[record.closeIdentity] = {
          verdict: record.verdict,
          rationale: record.rationale,
          disposition: record.disposition,
          applied: false,
        };
      }
    }
    return { ...current, remediationClosure: section };
  });
  if (!result.ok) throw new Error(`Failed to record remediation-closure verdicts (${result.kind}): ${result.message}`);
}

export async function markRemediationClosureApplied(
  projectRoot: string,
  planPath: string,
  taskId: string,
  closeIdentity: string,
): Promise<void> {
  const planIdentity = repairPlanIdentity(projectRoot, planPath);
  const result = await createEngineStateStore(engineStatePath(projectRoot)).update((current) => {
    const parsed = parseState(current);
    if (parsed.kind === 'incompatible') throw new Error(parsed.message);
    const section = clone(parsed.state);
    const task = section.plans[planIdentity]?.tasks[taskId];
    const verdict = task?.verdicts[closeIdentity];
    if (!task || !verdict) throw new Error('Remediation closure verdict is missing');
    if (!verdict.applied) {
      verdict.applied = true;
      task.reopenCount += 1;
    }
    return { ...current, remediationClosure: section };
  });
  if (!result.ok) throw new Error(`Failed to mark remediation-closure verdict applied (${result.kind}): ${result.message}`);
}
