import { createHash } from 'node:crypto';
import { isEngineAppendedRemediationTaskId } from './remediation-append.js';

export type RemediationClosureVerdict = 'resolved' | 'persists' | 'partial';

/** The stable fields of one persisted Done-when close record. */
export interface RemediationClosureCloseRecord {
  readonly check: string;
  readonly evidence: string;
  readonly source?: string;
}

/** The state needed to decide whether a task's current close was judged. */
export interface RemediationClosureCandidateState {
  readonly reopenCount: number;
  readonly verdicts: Readonly<Record<string, unknown>>;
}

export interface RemediationClosureCandidate {
  readonly taskId: string;
  readonly title?: string;
  readonly closeIdentity: string;
  readonly closeRecords: readonly RemediationClosureCloseRecord[];
}

export interface SelectRemediationClosureCandidatesInput {
  readonly status: unknown;
  readonly scopeTaskIds: readonly string[];
  readonly resolvedIds: ReadonlySet<string>;
  /** Current-plan task state, keyed by task id. */
  readonly state: Readonly<Record<string, RemediationClosureCandidateState>>;
  readonly openCitationTaskIds: ReadonlySet<string>;
}

/**
 * Identifies one close independently of provenance rewritten by rebase or
 * citation settlement.  The record order is intentional: it is the order in
 * which the task was closed, not an unordered bag of assertions.
 */
export function remediationCloseIdentity(
  taskId: string,
  reopenCount: number,
  records: readonly RemediationClosureCloseRecord[],
): string {
  const canonical = JSON.stringify({
    taskId,
    reopenCount,
    records: records.map(({ check, evidence }) => [check, evidence]),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface RemediationClosureVerdictResult {
  readonly taskId: string;
  readonly verdict: RemediationClosureVerdict;
  readonly rationale: string;
}

export type RemediationClosureValidation =
  | { readonly kind: 'valid'; readonly verdicts: readonly RemediationClosureVerdictResult[] }
  | { readonly kind: 'invalid'; readonly reason: string };

/** Provider-visible contract for one verdict per remediation-closure candidate. */
export const REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'verdict', 'rationale'],
        properties: {
          taskId: { type: 'string', pattern: '\\S' },
          verdict: { type: 'string', enum: ['resolved', 'persists', 'partial'] },
          rationale: { type: 'string', minLength: 1 },
        },
      },
    },
  },
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function closeRecords(value: unknown): readonly RemediationClosureCloseRecord[] {
  if (!Array.isArray(value)) return [];
  const records: RemediationClosureCloseRecord[] = [];
  for (const rawRecord of value) {
    const close = record(rawRecord);
    if (!close || typeof close.check !== 'string' || typeof close.evidence !== 'string') return [];
    records.push({
      check: close.check,
      evidence: close.evidence,
      ...(typeof close.source === 'string' ? { source: close.source } : {}),
    });
  }
  return records;
}

function statusRows(status: unknown): readonly Record<string, unknown>[] {
  const root = record(status);
  if (!root) return [];
  const tasks = root.tasks ?? root;
  if (Array.isArray(tasks)) return tasks.flatMap((value) => {
    const row = record(value);
    return row ? [row] : [];
  });
  return Object.entries(record(tasks) ?? {}).flatMap(([id, value]) => {
    const row = record(value);
    return row ? [{ ...row, ...(typeof row.id === 'string' ? {} : { id }) }] : [];
  });
}

/**
 * Selects only current resolved remediation closes eligible for the sibling
 * closure judgement.  This deliberately consumes resolved ids from the
 * shared resolver rather than reinterpreting row status or Task trailers.
 */
export function selectRemediationClosureCandidates(
  input: SelectRemediationClosureCandidatesInput,
): readonly RemediationClosureCandidate[] {
  const scope = new Set(input.scopeTaskIds);
  const candidates: RemediationClosureCandidate[] = [];
  for (const row of statusRows(input.status)) {
    if (typeof row.id !== 'string' || !isEngineAppendedRemediationTaskId(row.id) ||
      !scope.has(row.id) || !input.resolvedIds.has(row.id) || input.openCitationTaskIds.has(row.id)) continue;
    const records = closeRecords(row.doneWhen);
    if (records.length === 0 || records.some(({ source }) => source === 'pending-judgement')) continue;
    const taskState = input.state[row.id];
    const reopenCount = taskState?.reopenCount ?? 0;
    const closeIdentity = remediationCloseIdentity(row.id, reopenCount, records);
    if (taskState?.verdicts[closeIdentity] !== undefined) continue;
    candidates.push({
      taskId: row.id,
      ...(typeof row.title === 'string' ? { title: row.title } : {}),
      closeIdentity,
      closeRecords: records,
    });
  }
  return candidates;
}

export function validateRemediationClosureOutput(
  output: unknown,
  candidateIds: readonly string[],
): RemediationClosureValidation {
  const root = record(output);
  if (!root || Object.keys(root).some((key) => key !== 'verdicts') || !Array.isArray(root.verdicts)) {
    return { kind: 'invalid', reason: 'remediation closure judgement must be an object with verdicts' };
  }

  const expected = new Set(candidateIds);
  const seen = new Set<string>();
  const verdicts: RemediationClosureVerdictResult[] = [];
  for (const rawVerdict of root.verdicts) {
    const verdict = record(rawVerdict);
    if (!verdict ||
      Object.keys(verdict).some((key) => !['taskId', 'verdict', 'rationale'].includes(key)) ||
      typeof verdict.taskId !== 'string' || !verdict.taskId.trim() ||
      (verdict.verdict !== 'resolved' && verdict.verdict !== 'persists' && verdict.verdict !== 'partial') ||
      typeof verdict.rationale !== 'string' || !verdict.rationale.trim()) {
      return { kind: 'invalid', reason: 'remediation closure judgement has an invalid verdict' };
    }
    if (!expected.has(verdict.taskId)) {
      return { kind: 'invalid', reason: `remediation closure judgement has unexpected verdict for ${verdict.taskId}` };
    }
    if (seen.has(verdict.taskId)) {
      return { kind: 'invalid', reason: `remediation closure judgement has duplicate verdict for ${verdict.taskId}` };
    }
    seen.add(verdict.taskId);
    verdicts.push({
      taskId: verdict.taskId,
      verdict: verdict.verdict,
      rationale: verdict.rationale,
    });
  }
  if (seen.size !== expected.size) {
    return { kind: 'invalid', reason: 'remediation closure judgement omitted a candidate verdict' };
  }
  return { kind: 'valid', verdicts };
}
