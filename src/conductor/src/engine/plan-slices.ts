import { resolvePlanTaskReference, TASK_HEADER_PATTERN } from './plan-task-parse.js';

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

const FENCE_LINE = /^\s*(`{3,}|~{3,})(.*)$/;
const SLICES_HEADING = /^##\s+Slices\s*$/i;
const REQUIRED_HEADER = ['Slice', 'Title', 'Tasks'];

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

function tableCells(line: string): string[] | undefined {
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
  if (!tableCells(lines[tableStart + 1])) {
    violations.push({
      code: 'missing-table',
      message: 'the Slices section must contain a pipe table with header columns Slice, Title, Tasks',
    });
  }
  if (violations.length > 0) {
    return { kind: 'invalid', violations };
  }

  const taskIds = planTaskIds(lines, fenced);
  const slices: PlanSlice[] = [];
  for (let index = tableStart + 2; index < lines.length; index += 1) {
    if (fenced[index]) break;
    const cells = tableCells(lines[index]);
    if (!cells || cells.length !== 3) break;
    const resolved = resolvePlanTaskReference(cells[2], taskIds);
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
    if (resolved.kind === 'malformed') {
      violations.push({
        code: 'malformed-tasks',
        position,
        message: `slice ${cells[0]} has a malformed Tasks cell "${cells[2]}"`,
      });
    }
    slices.push({
      position,
      title: cells[1],
      taskIds: resolved.kind === 'malformed' ? [] : resolved.ids,
    });
  }

  if (violations.length > 0) return { kind: 'invalid', violations };
  return { kind: 'sliced', slices: slices.sort((left, right) => left.position - right.position) };
}
