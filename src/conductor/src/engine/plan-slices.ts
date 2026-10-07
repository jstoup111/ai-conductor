import {
  parsePlanTaskBodies,
  parsePlanTaskStoryLineIds,
  resolvePlanTaskReference,
  TASK_HEADER_PATTERN,
} from './plan-task-parse.js';
import { MAX_CHILD_ID } from './child-context.js';
import { isEngineAppendedRemediationTaskId } from './remediation-append.js';

export interface PlanSlice {
  position: number;
  title: string;
  taskIds: string[];
}

export interface PlanSliceViolation {
  code: string;
  message: string;
  position?: number;
  taskId?: string;
}

export type PlanSlicesValidation =
  | { kind: 'unsliced' }
  | { kind: 'sliced'; slices: PlanSlice[] }
  | { kind: 'invalid'; violations: PlanSliceViolation[] };

/** The slice position that owns each cited story, or every ownership refusal. */
export type StoryOwnershipValidation =
  | { kind: 'owned'; ownership: Readonly<Record<string, number>> }
  | { kind: 'invalid'; violations: PlanSliceViolation[] };

const FENCE_LINE = /^\s*(`{3,}|~{3,})(.*)$/;
const SLICES_HEADING = /^##\s+Slices\s*$/i;
const REQUIRED_HEADER = ['Slice', 'Title', 'Tasks'];
const TABLE_DELIMITER_CELL = /^:?-{3,}:?$/;
const DEPENDENCIES_LINE = /^\s*\*\*Dependencies:\*\*\s*(.*?)\s*$/;
const STORY_LINE = /^\s*\*\*Story:\*\*\s*(.*?)\s*$/i;
const TYPE_LINE = /^\s*\*\*Type:\*\*\s*(.*?)\s*$/i;

function taskType(body: string): string | undefined {
  return body.split('\n').map((line) => line.match(TYPE_LINE)?.[1].trim().toLowerCase()).find(Boolean);
}

function rawStoryLines(body: string): string[] {
  return body.split('\n')
    .map((line) => line.match(STORY_LINE)?.[1].trim())
    .filter((line): line is string => line !== undefined);
}

/**
 * Derives the sole owning slice for each story cited by sliced-plan tasks.
 *
 * `declaredStoryIds` is optional until the caller has read the companion
 * stories artifact. Without it this remains the Task 2 predicate: every
 * normalized token is treated as a story citation. With it, the predicate also
 * enforces the ADR's declared-story and supporting-purpose rules.
 */
export function deriveStoryOwnership(
  planText: string,
  slices: readonly PlanSlice[],
  declaredStoryIds?: ReadonlySet<string>,
): StoryOwnershipValidation {
  const violations: PlanSliceViolation[] = [];
  const positionsByStory = new Map<string, Set<number>>();
  const taskBodies = parsePlanTaskBodies(planText);

  for (const slice of slices) {
    for (const taskId of slice.taskIds) {
      if (isEngineAppendedRemediationTaskId(taskId)) continue;
      const body = taskBodies.get(taskId);
      if (body === undefined) continue;

      const storyLines = parsePlanTaskStoryLineIds(body);
      const rawLines = rawStoryLines(body);
      const type = taskType(body);
      const supportingPurpose = type === 'infrastructure' || type === 'refactor';

      for (let index = 0; index < storyLines.length; index += 1) {
        const ids = storyLines[index];
        if (ids.length === 0) continue;
        const rawLine = rawLines[index] ?? ids.join(', ');
        const hasDeclaredId = declaredStoryIds?.size === undefined
          ? true
          : ids.some((id) => declaredStoryIds.has(id));
        if (supportingPurpose && !hasDeclaredId) continue;

        if (ids.length > 1) {
          violations.push({
            code: 'multi-story-line',
            position: slice.position,
            taskId,
            message: `Task ${taskId} has multiple story ids on Story line "${rawLine}"`,
          });
        }

        for (const storyId of ids) {
          if (declaredStoryIds !== undefined && !declaredStoryIds.has(storyId)) {
            violations.push({
              code: 'unknown-story-id',
              position: slice.position,
              taskId,
              message: `Task ${taskId} cites unknown story ${storyId}`,
            });
            continue;
          }
          const positions = positionsByStory.get(storyId) ?? new Set<number>();
          positions.add(slice.position);
          positionsByStory.set(storyId, positions);
        }
      }
    }
  }

  for (const [storyId, positions] of positionsByStory) {
    if (positions.size > 1) {
      const listed = [...positions].sort((left, right) => left - right);
      violations.push({
        code: 'story-spans-children',
        message: `Story ${storyId} spans child positions ${listed.join(' and ')}`,
      });
    }
  }

  if (declaredStoryIds !== undefined) {
    for (const storyId of declaredStoryIds) {
      if (!positionsByStory.has(storyId)) {
        violations.push({
          code: 'story-unowned',
          message: `Story ${storyId} is owned by no child position`,
        });
      }
    }
  }

  if (violations.length > 0) return { kind: 'invalid', violations };
  const ownership: Record<string, number> = {};
  for (const [storyId, positions] of positionsByStory) ownership[storyId] = [...positions][0];
  return { kind: 'owned', ownership };
}

function fencedLineStates(lines: string[]): boolean[] {
  const states: boolean[] = [];
  let openMarker: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const fence = lines[index].match(FENCE_LINE);
    if (!fence) {
      states.push(openMarker !== null);
      continue;
    }

    const marker = fence[1];
    if (openMarker === null) {
      openMarker = marker;
      states.push(true);
      continue;
    }
    if (marker[0] === openMarker[0] && marker.length >= openMarker.length && !fence[2].trim()) {
      openMarker = null;
    }
    states.push(true);
  }
  return states;
}

function planTaskIds(lines: string[], fenced: boolean[]): Set<string> {
  const ids = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    if (fenced[index]) continue;
    const header = lines[index].match(TASK_HEADER_PATTERN);
    if (!header) continue;
    for (const id of (header[1] ?? header[2] ?? header[3] ?? header[4]).split(',')) {
      const trimmed = id.trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  return ids;
}

function tableCells(line: string | undefined): string[] | undefined {
  if (line === undefined) return undefined;
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return undefined;
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
}

/** Parses the optional ordered Slices manifest. Later rule tasks add violations to this owner. */
export function validatePlanSlices(planText: string): PlanSlicesValidation {
  const lines = planText.split('\n');
  const fenced = fencedLineStates(lines);
  const headingIndexes = lines
    .map((line, index) => (!fenced[index] && SLICES_HEADING.test(line) ? index : -1))
    .filter((index) => index !== -1);
  if (headingIndexes.length === 0) return { kind: 'unsliced' };

  const violations: PlanSliceViolation[] = [];
  if (headingIndexes.length > 1) {
    violations.push({
      code: 'multiple-sections',
      message: 'a plan may declare at most one Slices section',
    });
  }

  const headingIndex = headingIndexes[0];
  const firstTaskIndex = lines.findIndex((line, index) => !fenced[index] && TASK_HEADER_PATTERN.test(line));
  if (firstTaskIndex !== -1 && headingIndex > firstTaskIndex) {
    violations.push({
      code: 'section-placement',
      message: 'the Slices section must appear before the first task heading',
    });
  }

  let tableStart = headingIndex + 1;
  while (tableStart < lines.length && (!lines[tableStart].trim() || fenced[tableStart])) tableStart += 1;
  const header = tableCells(lines[tableStart]);
  if (!header || header.length !== REQUIRED_HEADER.length || header.some((cell, index) => cell !== REQUIRED_HEADER[index])) {
    violations.push({
      code: 'header-columns',
      message: 'the Slices table header columns must be exactly Slice, Title, Tasks',
    });
  }
  const delimiterLine = lines[tableStart + 1];
  const delimiter = tableCells(delimiterLine);
  if (!delimiter) {
    violations.push({
      code: 'missing-table',
      message: 'the Slices section must contain a pipe table with header columns Slice, Title, Tasks',
    });
  } else if (delimiter.length !== REQUIRED_HEADER.length || delimiter.some((cell) => !TABLE_DELIMITER_CELL.test(cell))) {
    violations.push({
      code: 'malformed-delimiter',
      message: `the Slices table delimiter "${delimiterLine}" must have exactly three markdown delimiter cells`,
    });
  }
  if (violations.length > 0) {
    return { kind: 'invalid', violations };
  }

  const taskIds = planTaskIds(lines, fenced);
  const slices: PlanSlice[] = [];
  const sliceHasTaskReferences: boolean[] = [];
  for (let index = tableStart + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || !line.trim().startsWith('|')) break;
    const cells = tableCells(line);
    if (!cells || cells.length !== REQUIRED_HEADER.length) {
      violations.push({
        code: 'malformed-row',
        message: `the Slices table row "${line}" must have exactly three cells`,
      });
      continue;
    }
    const resolved = cells[2] === ''
      ? undefined
      : resolvePlanTaskReference(cells[2], taskIds);
    const position = Number(cells[0]);
    if (!/^[1-9]\d*$/.test(cells[0])) {
      violations.push({
        code: 'invalid-position',
        message: `slice position "${cells[0]}" must be a positive integer`,
      });
    }
    if (!cells[1]) {
      violations.push({
        code: 'empty-title',
        position,
        message: `slice ${cells[0]} has an empty Title cell; titles must be non-empty`,
      });
    }
    if (resolved?.kind === 'malformed') {
      violations.push({
        code: 'malformed-tasks',
        position,
        message: `slice ${cells[0]} has a malformed Tasks cell "${cells[2]}"`,
      });
    }
    const resolvedIds: string[] = [];
    if (resolved?.kind !== 'malformed' && resolved !== undefined) {
      for (const reference of cells[2].split(',')) {
        const individual = resolvePlanTaskReference(reference, taskIds);
        if (individual.kind === 'resolved') {
          resolvedIds.push(...individual.ids);
        } else if (individual.kind === 'unresolvable') {
          for (const taskId of individual.ids) {
            violations.push({
              code: 'unknown-task',
              position,
              taskId,
              message: `Task ${taskId} cited by slice ${cells[0]} is an unknown task id`,
            });
          }
        }
      }
    }
    slices.push({
      position,
      title: cells[1],
      taskIds: [...new Set(resolvedIds)],
    });
    sliceHasTaskReferences.push(cells[2] !== '');
  }

  if (slices.length > MAX_CHILD_ID) {
    violations.push({
      code: 'max-slices',
      message: `plan declares ${slices.length} slices and the bound is ${MAX_CHILD_ID}`,
    });
  }

  const slicesByTaskId = new Map<string, number[]>();
  const sliceByTaskId = new Map<string, number>();
  const positions = new Set<number>();
  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    if (positions.has(slice.position)) {
      violations.push({
        code: 'duplicate-position',
        position: slice.position,
        message: `duplicate slice position ${slice.position}`,
      });
    }
    positions.add(slice.position);
    if (!sliceHasTaskReferences[index]) {
      violations.push({
        code: 'empty-slice',
        position: slice.position,
        message: `slice ${slice.position} is empty`,
      });
    }
    for (const taskId of slice.taskIds) {
      const memberships = slicesByTaskId.get(taskId) ?? [];
      memberships.push(slice.position);
      slicesByTaskId.set(taskId, memberships);
      if (!sliceByTaskId.has(taskId)) sliceByTaskId.set(taskId, slice.position);
    }
  }

  for (const taskId of taskIds) {
    if (isEngineAppendedRemediationTaskId(taskId)) continue;
    const memberships = slicesByTaskId.get(taskId) ?? [];
    if (memberships.length === 0) {
      violations.push({
        code: 'unassigned-task',
        taskId,
        message: `Task ${taskId} is in no slice`,
      });
    } else if (memberships.length > 1) {
      violations.push({
        code: 'duplicate-task-membership',
        taskId,
        message: `Task ${taskId} appears in slices ${memberships.join(' and ')}`,
      });
    }
  }

  const taskBodies = parsePlanTaskBodies(planText);
  const parsedTaskIds = new Set(taskBodies.keys());
  for (const [taskId, body] of taskBodies) {
    if (isEngineAppendedRemediationTaskId(taskId)) continue;
    const bodyLines = body.split('\n');
    const bodyFenced = fencedLineStates(bodyLines);
    const dependencyLines = bodyLines
      .map((line, index) => (bodyFenced[index] ? null : line.match(DEPENDENCIES_LINE)))
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
    if (rawDependencies.toLowerCase() === 'none') continue;
    const resolved = resolvePlanTaskReference(
      rawDependencies
        .split(',')
        .map((segment) => segment.trim().replace(/^Tasks?\s+/i, ''))
        .join(','),
      parsedTaskIds,
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
    const sourceSlice = sliceByTaskId.get(taskId);
    for (const dependencyId of resolved.ids) {
      const dependencySlice = sliceByTaskId.get(dependencyId);
      if (sourceSlice !== undefined && dependencySlice !== undefined && dependencySlice > sourceSlice) {
        violations.push({
          code: 'later-slice-dependency',
          taskId,
          message: `Task ${taskId} in slice ${sourceSlice} depends on Task ${dependencyId} in later slice ${dependencySlice}`,
        });
      }
    }
  }

  if (violations.length > 0) return { kind: 'invalid', violations };
  return { kind: 'sliced', slices: slices.sort((left, right) => left.position - right.position) };
}
