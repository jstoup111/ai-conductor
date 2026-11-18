/**
 * Dependency-free task-block grammar shared by plan readers and deterministic
 * remediation-block merging. Keeping this below the policy-heavy plan parser
 * lets restack replay use the same block boundaries without creating a cycle.
 */

/** Task IDs accept alphanumerics plus dots, underscores, and hyphens. */
export const TASK_ID_PATTERN = '[A-Za-z0-9._-]+';

/** Shared task-header grammar for parsers that identify complete task blocks. */
export const TASK_HEADER_PATTERN =
  /^#{1,6}\s+(?:Task\s+([A-Za-z0-9._,\s-]+?)(?::|\s[—–])|Task\s+([A-Za-z._,-]*\d[A-Za-z0-9._,-]*)\s*$|(T\d[A-Za-z0-9._,\s-]*?)(?::|\s[—–])|(T\d[A-Za-z0-9._,-]*)\s*$)/;

export const MARKDOWN_HEADING = /^(#{1,6})(?:\s|$)/;
const FENCE_LINE = /^\s*(`{3,}|~{3,})(.*)$/;

/** Yields every line while excluding fenced examples from structural parsing. */
export function* linesWithFenceState(text: string): Generator<{ line: string; fenced: boolean }> {
  let openMarker: string | null = null;
  for (const line of text.split('\n')) {
    const fence = line.match(FENCE_LINE);
    if (fence) {
      const marker = fence[1];
      if (openMarker === null) {
        openMarker = marker;
        yield { line, fenced: true };
        continue;
      }
      if (marker[0] === openMarker[0] && marker.length >= openMarker.length && !fence[2].trim()) {
        openMarker = null;
        yield { line, fenced: true };
        continue;
      }
    }
    yield { line, fenced: openMarker !== null };
  }
}

/** Expands task-list headings and numeric ranges using the shared ID grammar. */
export function expandTaskIds(raw: string): string[] {
  const ids: string[] = [];
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let number = start; number <= end; number++) ids.push(String(number));
    } else if (new RegExp(`^${TASK_ID_PATTERN}$`).test(trimmed)) {
      ids.push(trimmed);
    }
  }
  return ids;
}

/** A task heading and its committed body, both retaining authored line endings. */
export interface ParsedPlanTaskBlock {
  readonly heading: string;
  readonly body: string;
}

/**
 * Returns the heading and committed body for every recognized task. A task
 * ends at the next Markdown heading at its level or above; fenced prose is
 * illustration rather than structure.
 */
export function parsePlanTaskBlocks(text: string): Map<string, ParsedPlanTaskBlock> {
  const result = new Map<string, ParsedPlanTaskBlock>();
  let currentIds: string[] = [];
  let currentLevel = 0;
  let currentHeading = '';
  let bodyLines: string[] = [];

  const saveCurrentBlock = () => {
    if (currentIds.length === 0) return;
    const block = { heading: currentHeading, body: bodyLines.join('\n') };
    for (const id of currentIds) result.set(id, block);
    currentIds = [];
  };

  for (const { line, fenced } of linesWithFenceState(text)) {
    const heading = fenced ? null : line.match(MARKDOWN_HEADING);
    if (heading && currentIds.length > 0 && heading[1].length <= currentLevel) saveCurrentBlock();

    const headerMatch = fenced ? null : line.match(TASK_HEADER_PATTERN);
    if (headerMatch) {
      saveCurrentBlock();
      currentIds = expandTaskIds(headerMatch[1] ?? headerMatch[2] ?? headerMatch[3] ?? headerMatch[4]);
      currentLevel = line.match(MARKDOWN_HEADING)![1].length;
      currentHeading = line;
      bodyLines = [];
      continue;
    }

    if (currentIds.length > 0) bodyLines.push(line);
  }

  saveCurrentBlock();
  return result;
}
