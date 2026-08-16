import type { BuildReviewFinding } from './build-review-domain.js';
import { parsePlanTaskPaths } from './plan-task-parse.js';

/** Renders concise plan locations for completeness findings that name a plan task. */
export function planContractPointers(
  findings: readonly BuildReviewFinding[],
  plan: string,
  planPath: string,
): readonly string[] {
  const planTaskPaths = parsePlanTaskPaths(plan);

  return findings.flatMap((finding) => {
    const { anchor } = finding;

    if (anchor.rubric === 'scope') {
      const matchingTaskIds = [...planTaskPaths]
        .filter(([, paths]) => paths.has(anchor.path))
        .map(([taskId]) => taskId);
      if (matchingTaskIds.length !== 1) return [];

      return [`plan contract: ${planPath} — Task ${matchingTaskIds[0]} (anchor: ${anchor.path})`];
    }

    if (anchor.rubric !== 'completeness') return [];

    const { planTask, missingOutcome } = anchor;
    const taskHeader = new RegExp(`^### Task ${escapeRegExp(planTask)}:`, 'm');
    if (!taskHeader.test(plan)) return [];

    return [`plan contract: ${planPath} — Task ${planTask} (anchor: ${missingOutcome})`];
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
