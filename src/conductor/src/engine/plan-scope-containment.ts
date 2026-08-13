import { fileMatchesPlanPath } from './autoheal.js';
import { MACHINERY_AUTHORED_PATHS } from './build-review-inputs.js';
import type { ScopeTrailer } from './scope-trailer.js';

export interface ScopeContainmentTask {
  id: string;
  status: string;
  files?: readonly string[];
}

export interface ScopeContainmentInput {
  stagedPaths: readonly string[];
  task?: ScopeContainmentTask;
  taskId?: string;
  tasks?: readonly ScopeContainmentTask[];
  scopeTrailers?: readonly ScopeTrailer[];
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
  taskId,
  tasks,
  scopeTrailers = [],
}: ScopeContainmentInput): ScopeContainmentResult {
  const taskRows = tasks ?? (task === undefined ? [] : [task]);
  const activeTaskId = taskId ?? task?.id;

  if (
    activeTaskId === undefined ||
    !taskRows.some((row) => row.files !== undefined)
  ) {
    return { allowed: true };
  }

  const activeTask = task ?? taskRows.find((row) => row.id === activeTaskId);
  const declaredFiles = activeTask?.files;

  if (
    activeTask === undefined ||
    activeTask.status !== 'in_progress' ||
    declaredFiles === undefined ||
    declaredFiles.length === 0
  ) {
    return { allowed: true };
  }

  const offendingPaths = stagedPaths.filter(
    (path) =>
      !MACHINERY_AUTHORED_PATHS.some((machineryPath) => path.startsWith(machineryPath)) &&
      !declaredFiles.some((declaredPath) => fileMatchesPlanPath(path, declaredPath)) &&
      !declaredFiles.some((declaredPath) =>
        fileMatchesPlanPath(path, declaredPath.replace(/(\.[^./]+)$/, '.test$1')),
      ) &&
      !scopeTrailers.some((trailer) => fileMatchesPlanPath(path, trailer.path)),
  );

  return offendingPaths.length === 0
    ? { allowed: true }
    : { allowed: false, taskId: activeTask.id, offendingPaths };
}
