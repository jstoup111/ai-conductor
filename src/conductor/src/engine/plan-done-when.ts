import {
  isMalformedTestTag,
  parsePlanTaskBodies,
  parsePlanTaskDoneWhen,
  TEST_DONE_WHEN_TAG,
} from './plan-task-parse.js';

export type PlanDoneWhenViolationReason =
  | 'missing'
  | 'too-few'
  | 'too-many'
  | 'blank'
  | 'malformed-test-tag';
export interface PlanDoneWhenViolation {
  readonly taskId: string;
  readonly reason: PlanDoneWhenViolationReason;
  /** Present when the violation is specific to one authored completion check. */
  readonly check?: string;
}

/** Mechanical land-time shape rule; deliberately has no filesystem boundary. */
export function validatePlanDoneWhen(planText: string): readonly PlanDoneWhenViolation[] {
  const parsed = parsePlanTaskDoneWhen(planText);
  const violations: PlanDoneWhenViolation[] = [];
  for (const taskId of parsePlanTaskBodies(planText).keys()) {
    if (parsed.malformedTaskIds.has(taskId)) {
      violations.push({ taskId, reason: 'blank' });
      continue;
    }
    if (!parsed.has(taskId)) {
      violations.push({ taskId, reason: 'missing' });
      continue;
    }
    const criteria = parsed.get(taskId) ?? [];
    const malformedTags = criteria.filter(isMalformedTestTag);
    if (malformedTags.length > 0) {
      for (const check of malformedTags) {
        violations.push({ taskId, reason: 'malformed-test-tag', check });
      }
    } else if (
      criteria.length === 0
      || criteria.some((criterion) => !criterion.trim() || criterion.trim() === TEST_DONE_WHEN_TAG)
    ) {
      violations.push({ taskId, reason: 'blank' });
    } else if (criteria.length < 2) {
      violations.push({ taskId, reason: 'too-few' });
    } else if (criteria.length > 5) {
      violations.push({ taskId, reason: 'too-many' });
    }
  }
  return violations;
}
