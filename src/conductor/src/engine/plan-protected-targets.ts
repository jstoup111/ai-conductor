import { PROTECTED_ARTIFACT_DIRECTORIES, namesOwnFeature } from './protected-artifact-seal.js';
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

  for (const [taskId, paths] of parsePlanTaskPaths(planText)) {
    for (const path of paths) {
      const isProtectedArtifact = PROTECTED_ARTIFACT_DIRECTORIES.some(
        (directory) => path.startsWith(`${directory}/`),
      );
      if (isProtectedArtifact && !namesOwnFeature(path, planStem)) {
        violations.push({ taskId, path });
      }
    }
  }

  return violations;
}
