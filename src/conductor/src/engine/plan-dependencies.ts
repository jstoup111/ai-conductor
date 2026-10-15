import {
  parsePlanTaskBodies,
  resolvePlanTaskReference,
} from './plan-task-parse.js';

const DEPENDENCIES_LINE = /^\s*\*\*Dependencies:\*\*\s*(.*?)\s*$/;
const FENCE_LINE = /^\s*(`{3,}|~{3,})(.*)$/;

export interface PlanDependencyViolation {
  code: 'dependencies-line' | 'malformed-dependencies' | 'unknown-dependency';
  message: string;
  taskId: string;
}

export interface PlanDependencyGraph {
  dependenciesByTaskId: ReadonlyMap<string, readonly string[]>;
  violations: readonly PlanDependencyViolation[];
}

function fencedLineStates(lines: string[]): boolean[] {
  const states: boolean[] = [];
  let openMarker: string | null = null;
  for (const line of lines) {
    const fence = line.match(FENCE_LINE);
    if (!fence) {
      states.push(openMarker !== null);
      continue;
    }

    const marker = fence[1];
    if (openMarker === null) {
      openMarker = marker;
    } else if (marker[0] === openMarker[0] && marker.length >= openMarker.length && !fence[2].trim()) {
      openMarker = null;
    }
    states.push(true);
  }
  return states;
}

/** Parses each task's direct Dependencies references without silently dropping invalid metadata. */
export function parsePlanDependencyGraph(planText: string): PlanDependencyGraph {
  const taskBodies = parsePlanTaskBodies(planText);
  const taskIds = new Set(taskBodies.keys());
  const dependenciesByTaskId = new Map<string, readonly string[]>();
  const violations: PlanDependencyViolation[] = [];

  for (const [taskId, body] of taskBodies) {
    const bodyLines = body.split('\n');
    const fenced = fencedLineStates(bodyLines);
    const dependencyLines = bodyLines
      .map((line, index) => (fenced[index] ? null : line.match(DEPENDENCIES_LINE)))
      .filter((match): match is RegExpMatchArray => match !== null);
    if (dependencyLines.length !== 1) {
      violations.push({
        code: 'dependencies-line',
        taskId,
        message: `Task ${taskId} must declare exactly one Dependencies line`,
      });
      continue;
    }

    const rawDependencies = dependencyLines[0][1].trim();
    if (rawDependencies.toLowerCase() === 'none') {
      dependenciesByTaskId.set(taskId, []);
      continue;
    }
    const resolved = resolvePlanTaskReference(
      rawDependencies
        .split(',')
        .map((segment) => segment.trim().replace(/^Tasks?\s+/i, ''))
        .join(','),
      taskIds,
    );
    if (resolved.kind === 'malformed') {
      violations.push({
        code: 'malformed-dependencies',
        taskId,
        message: `Task ${taskId} has malformed Dependencies "${rawDependencies}"; expected "none" or comma-separated task references (for example "Task 1, Tasks 2")`,
      });
      continue;
    }
    if (resolved.kind === 'unresolvable') {
      for (const dependencyId of resolved.ids) {
        violations.push({
          code: 'unknown-dependency',
          taskId,
          message: `Task ${dependencyId} cited by Task ${taskId}'s Dependencies is an unknown task id`,
        });
      }
      continue;
    }
    dependenciesByTaskId.set(taskId, resolved.ids);
  }

  return { dependenciesByTaskId, violations };
}

/** Returns every direct or indirect prerequisite for one task. */
export function transitiveDependencies(
  dependenciesByTaskId: ReadonlyMap<string, readonly string[]>,
  taskId: string,
): Set<string> {
  const dependencies = new Set<string>();
  const pending = [...(dependenciesByTaskId.get(taskId) ?? [])];
  while (pending.length > 0) {
    const dependencyId = pending.pop()!;
    if (dependencies.has(dependencyId)) continue;
    dependencies.add(dependencyId);
    pending.push(...(dependenciesByTaskId.get(dependencyId) ?? []));
  }
  return dependencies;
}
