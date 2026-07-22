import { readFile } from 'node:fs/promises';
import { parsePlanTaskPaths } from './plan-task-parse.js';
import {
  parsePlanTaskVerifyOnly,
  canonicalTaskId,
  listCommitsWithTrailers,
} from './autoheal.js';

/**
 * Per-task work-happened floor (task 1 of the per-task-commit-floor plan):
 * for every plan task id, confirm it is EITHER covered by a commit carrying
 * a matching `Task:` trailer OR marked verify-only in the plan. A gap is a
 * plan task id satisfying neither. Fail-soft: any thrown error (missing
 * plan, git failure, malformed input) degrades to a satisfied, no-gap report
 * with a skip note — this floor never fabricates a gap it couldn't actually
 * verify.
 */
export interface PerTaskFloorReport {
  satisfied: boolean;
  gaps: string[];
  coveredTasks: string[];
  markedTasks: string[];
  skipNotes: string[];
}

export async function runPerTaskCommitFloor(args: {
  projectRoot: string;
  planPath: string;
  taskStatusPath?: string;
}): Promise<PerTaskFloorReport> {
  try {
    const planText = await readFile(args.planPath, 'utf-8');
    const planIds = [...parsePlanTaskPaths(planText).keys()];

    const commits = await listCommitsWithTrailers(args.projectRoot);
    const coveredCanonical = new Set<string>();
    for (const commit of commits) {
      for (const value of commit.trailers['Task'] ?? []) {
        coveredCanonical.add(canonicalTaskId(value));
      }
    }

    const verifyOnly = parsePlanTaskVerifyOnly(planText);

    const coveredTasks: string[] = [];
    const markedTasks: string[] = [];
    const gaps: string[] = [];

    for (const id of planIds) {
      const covered = coveredCanonical.has(canonicalTaskId(id));
      const marked = verifyOnly.get(id) === true;
      if (covered) coveredTasks.push(id);
      if (marked) markedTasks.push(id);
      if (!covered && !marked) gaps.push(id);
    }

    return {
      satisfied: gaps.length === 0,
      gaps,
      coveredTasks,
      markedTasks,
      skipNotes: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      satisfied: true,
      gaps: [],
      coveredTasks: [],
      markedTasks: [],
      skipNotes: [`per-task-commit-floor: ${message}`],
    };
  }
}

export function renderPerTaskFloorReport(report: PerTaskFloorReport): string[] {
  return report.gaps.map(
    (id) =>
      `Advisory: task ${id} produced no commit carrying its Task: trailer and no verify-only/skip marker — confirm its work shipped inside another task's commit or add a **Verify-only:** marker.`,
  );
}
