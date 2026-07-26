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

/** Advisory task-local context for one concurrently active provider attempt. */
export interface ActiveTaskTelemetry {
  taskId: string;
  context: Readonly<Record<string, unknown>>;
}

/** Terminal lifecycle outcomes that retire advisory task telemetry. */
export type TaskTerminalReason = 'completed' | 'failed' | 'cancelled' | 'interrupted';

/** A terminal event whose task id has already passed plan-local validation. */
export interface TaskTelemetryRetirement {
  taskId: string;
  terminalReason: TaskTerminalReason;
}

/** The result of an advisory task-row replacement attempt. */
export interface TaskTelemetryReplacementResult {
  activeTasks: ActiveTaskTelemetry[];
  diagnostic?: TaskAttributionDiagnosticCode;
}

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

/**
 * Adds an active task without granting it any workspace-global authority.
 * A repeat activation is deliberately a no-op so the original context stays
 * associated with that task while sibling tasks remain independently active.
 */
export function activateTaskTelemetry(
  activeTasks: readonly ActiveTaskTelemetry[],
  task: ActiveTaskTelemetry,
): ActiveTaskTelemetry[] {
  return activeTasks.some(({ taskId }) => taskId === task.taskId) ? [...activeTasks] : [...activeTasks, task];
}

/**
 * Retires only the task identified by an already-validated terminal event.
 * This is deliberately a pure telemetry transition: it grants no mutation
 * authority and does not determine task completion.
 */
export function retireTaskTelemetry(
  activeTasks: readonly ActiveTaskTelemetry[],
  retirement: TaskTelemetryRetirement,
): ActiveTaskTelemetry[] {
  return activeTasks.filter(({ taskId }) => taskId !== retirement.taskId);
}

/**
 * Replaces only the named telemetry row when the replacement is a current,
 * exact plan id. Invalid replacement input is reported as telemetry and leaves
 * every active row intact; it never relabels a concurrent sibling.
 */
export function replaceTaskTelemetry(
  activeTasks: readonly ActiveTaskTelemetry[],
  taskId: string,
  replacement: TaskAttributionInput,
): TaskTelemetryReplacementResult {
  const validated = validateTaskAttribution(replacement);
  if ('diagnostic' in validated) {
    return { activeTasks: [...activeTasks], diagnostic: validated.diagnostic.code };
  }
  return {
    activeTasks: activeTasks.map((task) =>
      task.taskId === taskId ? { ...task, taskId: validated.taskId } : task,
    ),
  };
}
