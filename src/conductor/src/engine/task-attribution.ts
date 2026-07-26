import { TASK_ID_PATTERN } from './plan-task-parse.js';

export interface TaskAttributionInput {
  taskId: unknown;
  seededTaskIds: readonly string[];
  knownTaskIds?: readonly string[];
  expectedTaskId?: string;
}

export type TaskAttributionDiagnosticCode = 'empty' | 'malformed' | 'unknown' | 'stale' | 'mismatched';

export type TaskAttributionValidation =
  | { taskId: string }
  | { diagnostic: { code: TaskAttributionDiagnosticCode; value: string } };

const TASK_ID = new RegExp(`^${TASK_ID_PATTERN}$`);

function sanitizedTaskId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '<empty>';
  return value.replace(/[^\x20-\x7e]/g, '?').slice(0, 128);
}

export function validateTaskAttribution(input: TaskAttributionInput): TaskAttributionValidation {
  const value = sanitizedTaskId(input.taskId);
  if (value === '<empty>') return { diagnostic: { code: 'empty', value } };
  if (typeof input.taskId !== 'string' || !TASK_ID.test(input.taskId)) {
    return { diagnostic: { code: 'malformed', value } };
  }
  if (!input.seededTaskIds.includes(input.taskId)) {
    const code = input.knownTaskIds?.includes(input.taskId) ? 'stale' : 'unknown';
    return { diagnostic: { code, value } };
  }
  if (input.expectedTaskId !== undefined && input.taskId !== input.expectedTaskId) {
    return { diagnostic: { code: 'mismatched', value } };
  }
  return { taskId: input.taskId };
}
