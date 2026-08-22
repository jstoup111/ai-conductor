import { TASK_HEADER_PATTERN, parsePlanTaskDoneWhen } from './plan-task-parse.js';

export type PlanDoneWhenViolationReason = 'missing' | 'too-few' | 'too-many' | 'blank';
export interface PlanDoneWhenViolation { readonly taskId: string; readonly reason: PlanDoneWhenViolationReason }

function taskIds(text: string): string[] {
  const ids: string[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(TASK_HEADER_PATTERN);
    if (!match) continue;
    for (const raw of (match[1] ?? match[2] ?? match[3] ?? match[4]).split(',')) {
      const id = raw.trim();
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** Mechanical land-time shape rule; deliberately has no filesystem boundary. */
export function validatePlanDoneWhen(planText: string): readonly PlanDoneWhenViolation[] {
  const parsed = parsePlanTaskDoneWhen(planText);
  const violations: PlanDoneWhenViolation[] = [];
  for (const taskId of taskIds(planText)) {
    if (!parsed.has(taskId)) { violations.push({ taskId, reason: 'missing' }); continue; }
    const criteria = parsed.get(taskId) ?? [];
    if (criteria.length === 0 || criteria.every((criterion) => !criterion.trim())) violations.push({ taskId, reason: 'blank' });
    else if (criteria.length < 2) violations.push({ taskId, reason: 'too-few' });
    else if (criteria.length > 5) violations.push({ taskId, reason: 'too-many' });
  }
  return violations;
}
