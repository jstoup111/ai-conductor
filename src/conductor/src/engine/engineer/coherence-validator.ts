// Coherence artifact parser (fail-closed shapes).
//
// Parses `.docs/coherence/<plan-stem>.md` — a committed traceability record
// mapping outcomes -> FRs -> stories -> tasks with per-row verdicts — into
// typed rows. Parse-don't-validate: a failed parse never throws and never
// collapses into one generic error. It returns a discriminated union whose
// failure branch carries the distinct reason (missing / empty / unparseable),
// so callers (land-spec.ts, in a later task) can reject with the right named
// gap instead of a catch-all message.
//
// This module is inert until wired into land-spec.ts.

import { splitStoryBlocks } from '../artifacts.js';
import { parsePlanTaskPaths } from '../plan-task-parse.js';

/** The four row classes a coherence artifact row may belong to. */
export type CoherenceRowClass = 'outcome' | 'fr' | 'story' | 'task';

/** A single parsed row of the coherence mapping table. */
export interface CoherenceRow {
  rowClass: CoherenceRowClass;
  id: string;
  citedIds: string[];
  verdict: string;
  quote: string;
}

/** Distinct fail-closed reasons a coherence artifact parse can be rejected for. */
export type CoherenceParseFailureReason =
  | 'missing-coherence-artifact'
  | 'empty-coherence-artifact'
  | 'unparseable-coherence-artifact';

export type CoherenceParseResult =
  | { ok: true; rows: CoherenceRow[] }
  | { ok: false; reason: CoherenceParseFailureReason };

const ROW_CLASSES: ReadonlySet<string> = new Set(['outcome', 'fr', 'story', 'task']);

/**
 * Strip surrounding whitespace and a single pair of matching straight/curly
 * quotes from a cell's text, so quoted evidence compares/reads cleanly.
 */
function unquote(cell: string): string {
  const trimmed = cell.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith('“') && trimmed.endsWith('”') && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Split a `| a | b | c |` markdown table row into its trimmed cell strings. */
function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  // Drop leading/trailing pipe, then split on interior pipes.
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((cell) => cell.trim());
}

/** True for a markdown table separator row, e.g. `| --- | --- | --- |`. */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

/**
 * Parse coherence artifact text into typed rows.
 *
 * @param text - The artifact file's contents, or `null` when the file does
 *   not exist on disk (the caller distinguishes "no file" from "empty file"
 *   before calling this — this function never touches the filesystem).
 */
export function parseCoherenceArtifact(text: string | null): CoherenceParseResult {
  if (text === null) {
    return { ok: false, reason: 'missing-coherence-artifact' };
  }
  if (text.trim().length === 0) {
    return { ok: false, reason: 'empty-coherence-artifact' };
  }

  const lines = text.split('\n');
  const tableRowLines: string[][] = [];
  let sawHeader = false;
  let sawSeparator = false;

  for (const line of lines) {
    const cells = splitRow(line);
    if (cells === null) continue;
    if (!sawHeader) {
      sawHeader = true;
      continue; // header row, skip
    }
    if (!sawSeparator) {
      if (!isSeparatorRow(cells)) {
        return { ok: false, reason: 'unparseable-coherence-artifact' };
      }
      sawSeparator = true;
      continue;
    }
    tableRowLines.push(cells);
  }

  if (!sawHeader || !sawSeparator || tableRowLines.length === 0) {
    return { ok: false, reason: 'unparseable-coherence-artifact' };
  }

  const rows: CoherenceRow[] = [];
  for (const cells of tableRowLines) {
    if (cells.length !== 5) {
      return { ok: false, reason: 'unparseable-coherence-artifact' };
    }
    const [rawRowClass, rawId, rawCitedIds, rawVerdict, rawQuote] = cells;
    const rowClass = rawRowClass.trim().toLowerCase();
    if (!ROW_CLASSES.has(rowClass)) {
      return { ok: false, reason: 'unparseable-coherence-artifact' };
    }
    const id = rawId.trim();
    const verdict = rawVerdict.trim();
    if (id.length === 0 || verdict.length === 0) {
      return { ok: false, reason: 'unparseable-coherence-artifact' };
    }
    const citedIds = rawCitedIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const quote = unquote(rawQuote);

    rows.push({
      rowClass: rowClass as CoherenceRowClass,
      id,
      citedIds,
      verdict,
      quote,
    });
  }

  return { ok: true, rows };
}

// --- Id cross-check against real artifacts (Task 6) ---

/** The real-artifact inputs a coherence artifact's cited ids are checked against. */
export interface CrossCheckInputs {
  /** Stories file contents, or null when unavailable. */
  storiesText: string | null;
  /** Plan file contents, or null when unavailable. */
  planText: string | null;
  /** PRD file contents, or null when unavailable (technical track). */
  prdText: string | null;
  /** Number of staged/committed intake outcome bullets (0 when none staged). */
  outcomeCount: number;
}

export type CrossCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'fabricated-id';
      /** The row class of the row that cited the fabricated id. */
      rowClass: CoherenceRowClass;
      /** The id of the row that cited the fabricated id. */
      rowId: string;
      /** The cited id that does not resolve against any real input. */
      fabricatedId: string;
    };

/** `FR-<n>` ids declared under a PRD's `## Functional Requirements` heading. */
function extractPrdFrIds(prdText: string | null): Set<string> {
  const ids = new Set<string>();
  if (!prdText) return ids;
  const headingIdx = prdText.search(/^##\s+Functional Requirements\s*$/im);
  if (headingIdx === -1) return ids;
  const afterHeading = prdText.slice(headingIdx);
  const nextHeadingMatch = afterHeading.slice(1).match(/\n##\s+/);
  const section = nextHeadingMatch
    ? afterHeading.slice(0, nextHeadingMatch.index! + 1)
    : afterHeading;
  const frRe = /\bFR-\d+[A-Za-z]?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = frRe.exec(section)) !== null) {
    ids.add(m[0].toUpperCase());
  }
  return ids;
}

/** `story-<id>` ids for every story block heading in the stories file. */
function extractStoryIds(storiesText: string | null): Set<string> {
  const ids = new Set<string>();
  if (!storiesText) return ids;
  for (const block of splitStoryBlocks(storiesText)) {
    if (block.id) ids.add(`story-${block.id}`);
  }
  return ids;
}

/** `task-<id>` ids for every task header in the plan file. */
function extractTaskIds(planText: string | null): Set<string> {
  const ids = new Set<string>();
  if (!planText) return ids;
  for (const id of parsePlanTaskPaths(planText).keys()) {
    ids.add(`task-${id}`);
  }
  return ids;
}

/** `outcome-<n>` ids, 1-indexed, one per staged/committed outcome bullet. */
function extractOutcomeIds(outcomeCount: number): Set<string> {
  const ids = new Set<string>();
  for (let n = 1; n <= outcomeCount; n++) ids.add(`outcome-${n}`);
  return ids;
}

/**
 * Cross-check every parsed coherence row's cited ids against the real
 * artifacts they claim to reference: story ids against the stories file,
 * task ids against the plan's task tree, FR ids against the PRD, and
 * outcome ids against the staged/committed outcome bullet count.
 *
 * Fail-closed: any single cited id that does not resolve against ANY of the
 * four real-id pools is a fabricated citation, and cross-check rejects
 * immediately naming the offending row and id (never silently drops it).
 */
export function crossCheckIds(
  rows: CoherenceRow[],
  inputs: CrossCheckInputs,
): CrossCheckResult {
  const storyIds = extractStoryIds(inputs.storiesText);
  const taskIds = extractTaskIds(inputs.planText);
  const frIds = extractPrdFrIds(inputs.prdText);
  const outcomeIds = extractOutcomeIds(inputs.outcomeCount);

  const knownIds = new Set<string>([...storyIds, ...taskIds, ...frIds, ...outcomeIds]);

  const poolByClass: Record<CoherenceRowClass, Set<string>> = {
    outcome: outcomeIds,
    fr: frIds,
    story: storyIds,
    task: taskIds,
  };

  for (const row of rows) {
    // The row's own subject id must resolve against the pool for its class
    // (a row about a nonexistent FR/story/task/outcome is itself fabricated).
    const ownId = row.rowClass === 'fr' ? row.id.toUpperCase() : row.id;
    if (!poolByClass[row.rowClass].has(ownId)) {
      return {
        ok: false,
        reason: 'fabricated-id',
        rowClass: row.rowClass,
        rowId: row.id,
        fabricatedId: row.id,
      };
    }
    for (const citedId of row.citedIds) {
      const normalized = /^FR-\d+[A-Za-z]?$/i.test(citedId) ? citedId.toUpperCase() : citedId;
      if (!knownIds.has(normalized)) {
        return {
          ok: false,
          reason: 'fabricated-id',
          rowClass: row.rowClass,
          rowId: row.id,
          fabricatedId: citedId,
        };
      }
    }
  }

  return { ok: true };
}
