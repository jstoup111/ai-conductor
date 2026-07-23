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

// --- Outcome-coverage layer (Task 7) ---

/** Verdicts treated as affirmative coverage for the outcome-coverage layer. */
const NEGATIVE_VERDICTS: ReadonlySet<string> = new Set(['gap', 'missing', 'uncovered', 'fail']);

export type OutcomeCoverageResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'outcome-gap';
      /** The `outcome-<n>` id (1-indexed) of the uncovered bullet. */
      gapId: string;
      /** The verbatim staged outcome bullet with no affirmative coverage. */
      bullet: string;
    };

/**
 * Set-difference check: every staged intake outcome bullet must have a
 * corresponding `outcome-<n>` row in the coherence artifact with an
 * affirmative verdict. A bullet with no row at all, or whose row carries a
 * negative verdict (gap/missing/uncovered/fail), is reported as a gap naming
 * the `outcome-<n>` id and quoting the bullet verbatim — never silently
 * dropped.
 *
 * This layer only checks presence/verdict of the outcome row itself; whether
 * the row's cited ids resolve to real stories/tasks is `crossCheckIds`'s
 * (Task 6) job, and callers are expected to run that check too (a coverage
 * row citing a fabricated story id is rejected there, not here).
 */
export function checkOutcomeCoverage(
  rows: CoherenceRow[],
  outcomeBullets: string[],
): OutcomeCoverageResult {
  const outcomeRowsById = new Map<string, CoherenceRow>();
  for (const row of rows) {
    if (row.rowClass === 'outcome') outcomeRowsById.set(row.id, row);
  }

  for (let n = 1; n <= outcomeBullets.length; n++) {
    const gapId = `outcome-${n}`;
    const row = outcomeRowsById.get(gapId);
    if (!row || NEGATIVE_VERDICTS.has(row.verdict.trim().toLowerCase())) {
      return { ok: false, reason: 'outcome-gap', gapId, bullet: outcomeBullets[n - 1] };
    }
  }

  return { ok: true };
}

// --- FR-coverage layer (Task 8) ---

/** `storyId -> Set<FR-N>` from each story block's `**Requirement:**` line(s). */
function extractStoryRequirementFrIds(storiesText: string | null): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!storiesText) return map;
  for (const block of splitStoryBlocks(storiesText)) {
    if (!block.id) continue;
    const reqLineRe = /\*\*Requirement:\*\*\s*([^\n]*)/gi;
    const frs = new Set<string>();
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = reqLineRe.exec(block.text)) !== null) {
      const frRe = /\bFR-\d+[A-Za-z]?\b/gi;
      let frMatch: RegExpExecArray | null;
      while ((frMatch = frRe.exec(lineMatch[1])) !== null) {
        frs.add(frMatch[0].toUpperCase());
      }
    }
    if (frs.size > 0) map.set(block.id, frs);
  }
  return map;
}

/** `storyId -> Set<taskId>` from each plan task block's `**Story:**` line(s). */
function extractTaskStoryIds(planText: string | null): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!planText) return map;

  const taskHeadingRe = /^###\s+Task\s+([A-Za-z0-9._-]+)/i;
  const blocks: { id: string; text: string }[] = [];
  let currentId: string | null = null;
  let currentLines: string[] = [];
  for (const line of planText.split('\n')) {
    const headingMatch = line.match(taskHeadingRe);
    if (headingMatch) {
      if (currentId) blocks.push({ id: currentId, text: currentLines.join('\n') });
      currentId = headingMatch[1];
      currentLines = [line];
    } else if (currentId) {
      currentLines.push(line);
    }
  }
  if (currentId) blocks.push({ id: currentId, text: currentLines.join('\n') });

  for (const block of blocks) {
    const storyRefRe = /\*\*Story:\*\*\s*(?:story|epic)?\s*([A-Za-z0-9.\-]+)/gi;
    let storyMatch: RegExpExecArray | null;
    while ((storyMatch = storyRefRe.exec(block.text)) !== null) {
      const storyId = storyMatch[1];
      if (/^(n\/?a|prerequisite|none|all)$/i.test(storyId)) continue;
      if (!map.has(storyId)) map.set(storyId, new Set());
      map.get(storyId)!.add(block.id);
    }
  }
  return map;
}

export type FrCoverageResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'fr-gap';
      /** The `FR-<n>` id with no covering story, or with a story but no task. */
      frId: string;
      /**
       * The story id that cites the FR but has no covering task — set only
       * for the transitive gap case, so the report names both the FR and
       * the story rather than masking the story-level break as a plain
       * uncovered-FR gap.
       */
      storyId?: string;
    };

/**
 * Two-hop set-difference check: every PRD FR must be cited by ≥1 story's
 * `**Requirement:**` line, and at least one of those citing stories must in
 * turn be cited by ≥1 plan task's `**Story:**` line. An FR cited by no
 * story is an uncovered-FR gap; an FR whose only citing stor(y/ies) have no
 * covering task is a transitive gap naming both the FR and the story — the
 * story-level break is never silently masked as a plain FR gap.
 *
 * A technical-track spec has no PRD (`prdText === null`); FR-10 makes that
 * a trivial pass rather than a gap — no phantom requirement layer.
 */
export function checkFrCoverage(
  prdText: string | null,
  storiesText: string | null,
  planText: string | null,
): FrCoverageResult {
  const frIds = extractPrdFrIds(prdText);
  if (frIds.size === 0) return { ok: true };

  const storyFrMap = extractStoryRequirementFrIds(storiesText);
  const taskStoryMap = extractTaskStoryIds(planText);

  const frToStories = new Map<string, Set<string>>();
  for (const [storyId, frs] of storyFrMap) {
    for (const fr of frs) {
      if (!frToStories.has(fr)) frToStories.set(fr, new Set());
      frToStories.get(fr)!.add(storyId);
    }
  }

  for (const fr of frIds) {
    const citingStories = frToStories.get(fr);
    if (!citingStories || citingStories.size === 0) {
      return { ok: false, reason: 'fr-gap', frId: fr };
    }
    const hasCoveringTask = [...citingStories].some(
      (storyId) => (taskStoryMap.get(storyId)?.size ?? 0) > 0,
    );
    if (!hasCoveringTask) {
      const storyId = [...citingStories].sort()[0];
      return { ok: false, reason: 'fr-gap', frId: fr, storyId };
    }
  }

  return { ok: true };
}
