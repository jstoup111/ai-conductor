import { fileMatchesPlanPath } from './autoheal.js';

export interface ScopeContainmentTask {
  id: string;
  files: readonly string[];
}

export interface ScopeContainmentInput {
  stagedPaths: readonly string[];
  task: ScopeContainmentTask;
}

export type ScopeContainmentResult =
  | { allowed: true }
  | { allowed: false; taskId: string; offendingPaths: string[] };

/**
 * Determines whether every staged path is declared by the active plan task.
 *
 * Git supplies repository-relative paths while plans commonly name suffixes,
 * so this deliberately delegates matching to the shared plan-path primitive.
 */
export function evaluateScopeContainment({
  stagedPaths,
  task,
}: ScopeContainmentInput): ScopeContainmentResult {
  const offendingPaths = stagedPaths.filter(
    (path) => !task.files.some((declaredPath) => fileMatchesPlanPath(path, declaredPath)),
  );

  return offendingPaths.length === 0
    ? { allowed: true }
    : { allowed: false, taskId: task.id, offendingPaths };
}
