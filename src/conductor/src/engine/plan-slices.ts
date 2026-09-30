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
  const headingIndex = lines.findIndex((line, index) => !fenced[index] && SLICES_HEADING.test(line));
  if (headingIndex === -1) return { kind: 'unsliced' };

  let tableStart = headingIndex + 1;
  while (tableStart < lines.length && (!lines[tableStart].trim() || fenced[tableStart])) tableStart += 1;
  // Manifest grammar validation is intentionally added by Task 5. Task 3 owns
  // extracting the well-formed table that later rules validate.
  if (!tableCells(lines[tableStart]) || !tableCells(lines[tableStart + 1])) {
    return { kind: 'sliced', slices: [] };
  }

  const taskIds = planTaskIds(lines, fenced);
  const slices: PlanSlice[] = [];
  for (let index = tableStart + 2; index < lines.length; index += 1) {
    if (fenced[index]) break;
    const cells = tableCells(lines[index]);
    if (!cells || cells.length !== 3) break;
    const resolved = resolvePlanTaskReference(cells[2], taskIds);
    slices.push({
      position: Number(cells[0]),
      title: cells[1],
      taskIds: resolved.kind === 'malformed' ? [] : resolved.ids,
    });
  }

  return { kind: 'sliced', slices: slices.sort((left, right) => left.position - right.position) };
}
