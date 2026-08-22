import { parsePlanTaskDoneWhen, parsePlanTaskIds } from './plan-task-parse.js';

export type PlanDoneWhenViolationReason = 'missing' | 'too-few' | 'too-many' | 'blank';
export interface PlanDoneWhenViolation { readonly taskId: string; readonly reason: PlanDoneWhenViolationReason }

/** Mechanical land-time shape rule; deliberately has no filesystem boundary. */
export function validatePlanDoneWhen(planText: string): readonly PlanDoneWhenViolation[] {
  const parsed = parsePlanTaskDoneWhen(planText);
  const violations: PlanDoneWhenViolation[] = [];
  for (const taskId of parsePlanTaskIds(planText)) {
    if (!parsed.has(taskId)) { violations.push({ taskId, reason: 'missing' }); continue; }
    const criteria = parsed.get(taskId) ?? [];
    if (criteria.length === 0 || criteria.some((criterion) => !criterion.trim())) violations.push({ taskId, reason: 'blank' });
    else if (criteria.length < 2) violations.push({ taskId, reason: 'too-few' });
    else if (criteria.length > 5) violations.push({ taskId, reason: 'too-many' });
  }
  return violations;
}
