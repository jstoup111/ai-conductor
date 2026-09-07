import { parsePlanTaskBodies } from './plan-task-parse.js';

export const PLAN_TASK_WARNING_BOUNDARY = 21;
export const PLAN_TASK_HARD_STOP_BOUNDARY = 41;

export type PlanTaskCountBand = 'normal' | 'warning' | 'hard-stop';

export interface PlanTaskCountClassification {
  readonly taskCount: number;
  readonly band: PlanTaskCountBand;
}

/** Mechanical plan-shape classification; deliberately has no filesystem boundary. */
export function classifyPlanTaskCount(planText: string): PlanTaskCountClassification {
  const taskCount = parsePlanTaskBodies(planText).size;
  const band: PlanTaskCountBand = taskCount < PLAN_TASK_WARNING_BOUNDARY
    ? 'normal'
    : taskCount < PLAN_TASK_HARD_STOP_BOUNDARY
      ? 'warning'
      : 'hard-stop';

  return { taskCount, band };
}
