import { parsePlanTaskDoneWhen, parsePlanTaskTitles } from './plan-task-parse.js';

/** A complete plan-task projection used to judge joint satisfiability. */
export interface ConflictTaskTableRow {
  readonly id: string;
  readonly title: string;
  readonly doneWhen: readonly string[];
}

/**
 * Projects every plan task into the conflict judge's task table.
 *
 * Remediation ids are ordinary plan headings and deliberately remain in this
 * table. Slice membership is not part of this projection: it is operational
 * sequencing metadata rather than an input to a satisfiability judgement.
 */
export function buildConflictTaskTable(planText: string): ConflictTaskTableRow[] {
  const titles = parsePlanTaskTitles(planText);
  const doneWhen = parsePlanTaskDoneWhen(planText);

  return [...titles].map(([id, title]) => ({
    id,
    title,
    doneWhen: doneWhen.get(id) ?? [],
  }));
}
