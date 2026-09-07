import { parsePlanTaskBodies } from './plan-task-parse.js';

export const PLAN_TASK_WARNING_BOUNDARY = 21;
export const PLAN_TASK_HARD_STOP_BOUNDARY = 41;

export type PlanTaskCountBand = 'normal' | 'warning' | 'hard-stop';

export interface PlanTaskCountClassification {
  readonly taskCount: number;
  readonly band: PlanTaskCountBand;
}

export interface DocumentedPlanTaskBands {
  readonly warningBoundary: number;
  readonly hardStopBoundary: number;
}

export type PlanTaskCountValidation =
  | { readonly kind: 'authorized'; readonly rationale: string }
  | { readonly kind: 'unauthorized'; readonly taskCount: number }
  | { readonly kind: 'malformed'; readonly taskCount: number };

const SCOPE_EXCEPTION_HEADER = /^\s*\*\*Scope-exception:\*\*\s*(.*)$/gim;
const DOCUMENTED_PLAN_TASK_BANDS = /^\|\s*\d+-\d+\s*\|[^\n]*\r?\n^\|\s*(\d+)-\d+\s*\|[^\n]*\r?\n^\|\s*(\d+)\+\s*\|/m;

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

/** Reads the warning and hard-stop boundaries from the plan skill's band table. */
export function parseDocumentedPlanTaskBands(skillText: string): DocumentedPlanTaskBands | undefined {
  const match = skillText.match(DOCUMENTED_PLAN_TASK_BANDS);
  if (!match) return undefined;

  return {
    warningBoundary: Number(match[1]),
    hardStopBoundary: Number(match[2]),
  };
}

/** Mechanical land-time exception rule; deliberately has no filesystem boundary. */
export function validatePlanTaskCount(planText: string): PlanTaskCountValidation | undefined {
  const { taskCount, band } = classifyPlanTaskCount(planText);
  if (band !== 'hard-stop') return undefined;

  const declarations = [...planText.matchAll(SCOPE_EXCEPTION_HEADER)];
  if (declarations.length === 0) return { kind: 'unauthorized', taskCount };
  if (declarations.length !== 1) return { kind: 'malformed', taskCount };

  const rationale = declarations[0][1].trim();
  if (!rationale) return { kind: 'malformed', taskCount };

  return { kind: 'authorized', rationale };
}
