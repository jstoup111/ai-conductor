import { isProtectedArtifactPath, namesOwnFeature } from './protected-artifact-seal.js';
import { parsePlanTaskPaths } from './plan-task-parse.js';

export interface PlanProtectedTargetViolation {
  taskId: string;
  path: string;
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
      if (isProtectedArtifactPath(path) && !namesOwnFeature(path, planStem)) {
        report(taskId, path);
      }
    }
    for (const path of parsed.foreignProtectedReferencesByTaskId.get(taskId) ?? []) {
      if (!namesOwnFeature(path, planStem)) report(taskId, path);
    }
  }

  return violations;
}
