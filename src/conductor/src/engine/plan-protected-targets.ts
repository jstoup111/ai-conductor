import { isProtectedArtifactPath, namesOwnFeature } from './protected-artifact-seal.js';
import { parsePlanTaskPaths } from './plan-task-parse.js';

export interface PlanProtectedTargetViolation {
  taskId: string;
  path: string;
}

/**
 * True for a path carrying an angle-bracketed placeholder segment, such as
 * `.docs/plans/<slug>.md`.
 *
 * Such a path names a shape, not a file: `<` and `>` never appear in this
 * repository's artifact names, so no checkout can contain it and no edit can
 * target it. It must not be read as naming a protected artifact.
 *
 * Without this, `namesOwnFeature` compared the literal basename `<slug>`
 * against the feature stem, found no match, and the citation was treated as
 * another feature's sealed artifact. Any task that has to *describe* a plan
 * path — a remediation task for the plan appender cannot avoid it — was
 * redirected away from BUILD on the strength of its own documentation.
 */
function namesPlaceholderPath(path: string): boolean {
  return /<[^/>]*>/.test(path);
}

export function scanPlanProtectedTargets(
  planText: string,
  planStem: string,
): PlanProtectedTargetViolation[] {
  const violations: PlanProtectedTargetViolation[] = [];
  const seen = new Set<string>();
  const report = (taskId: string, path: string) => {
    const key = `${taskId}\u0000${path}`;
    if (!seen.has(key)) {
      seen.add(key);
      violations.push({ taskId, path });
    }
  };

  const parsed = parsePlanTaskPaths(planText, planStem);
  for (const [taskId, paths] of parsed) {
    for (const path of paths) {
      if (
        isProtectedArtifactPath(path) &&
        !namesPlaceholderPath(path) &&
        !namesOwnFeature(path, planStem)
      ) {
        report(taskId, path);
      }
    }
    for (const path of parsed.foreignProtectedReferencesByTaskId.get(taskId) ?? []) {
      if (!namesPlaceholderPath(path) && !namesOwnFeature(path, planStem)) report(taskId, path);
    }
  }

  return violations;
}
