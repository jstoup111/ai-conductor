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

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { splitStoryBlocks, collectPlanCoverage } from '../artifacts.js';
import { parsePlanTaskPaths } from '../plan-task-parse.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { runOverlapScan, type RunOverlapScanArgs, type OverlapReport } from '../overlap-scan.js';
import { deriveDefaultBranch } from './authoring.js';
import type { AuthoringGuard } from './authoring-guard.js';
import {
  evaluateCoherenceWaiver,
  type CoherenceWaiverChangedFile,
} from './coherence-waiver.js';
import type { ComplexityTier, Track } from '../../types/index.js';

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
 * This layer checks presence/verdict of the outcome row itself AND that it
 * cites at least one real story id (`storyIds`) — a row with an affirmative
 * verdict but zero story citations is still a gap. Whether the row's cited
 * ids resolve to real stories/tasks/FRs in general is `crossCheckIds`'s
 * (Task 6) job, and callers are expected to run that check too (a coverage
 * row citing a fabricated story id is rejected there, not here).
 */
export function checkOutcomeCoverage(
  rows: CoherenceRow[],
  outcomeBullets: string[],
  storyIds: Set<string>,
): OutcomeCoverageResult {
  const outcomeRowsById = new Map<string, CoherenceRow>();
  for (const row of rows) {
    if (row.rowClass === 'outcome') outcomeRowsById.set(row.id, row);
  }

  for (let n = 1; n <= outcomeBullets.length; n++) {
    const gapId = `outcome-${n}`;
    const row = outcomeRowsById.get(gapId);
    const citesStory = !!row && row.citedIds.some((id) => storyIds.has(id));
    if (!row || NEGATIVE_VERDICTS.has(row.verdict.trim().toLowerCase()) || !citesStory) {
      return { ok: false, reason: 'outcome-gap', gapId, bullet: outcomeBullets[n - 1] };
    }
  }

  return { ok: true };
}

// --- Story-coverage layer (Task 9) ---

export type StoryCoverageResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'story-gap';
      /** The `story-<id>` id of the uncovered story. */
      gapId: string;
      /** The story's title, taken from its `## Story <id>: <title>` heading. */
      title: string;
    }
  | {
      ok: false;
      reason: 'unparseable-stories';
    };

/** The title portion of a `## Story <id>: <title>` heading, if present. */
function extractStoryTitle(blockText: string): string {
  const m = blockText.match(/^##\s+Story\s+[A-Za-z0-9.\-]+\s*:\s*(.*)$/im);
  return m ? m[1].trim() : '';
}

/**
 * Set-difference check: every story id declared in the stories file
 * (`splitStoryBlocks`) must be cited by ≥1 plan task's `**Story:**` line
 * (`collectPlanCoverage`). A story with no citing task is reported as a gap
 * naming the `story-<id>` id and the story's title.
 *
 * Fail-closed: a stories file with zero parseable story blocks (no `##
 * Story <id>:` headings at all) never trivially passes as "no stories to
 * cover" — it is rejected outright as `unparseable-stories`, so a corrupt or
 * malformed stories file can never masquerade as full coverage.
 */
export function checkStoryCoverage(
  storiesText: string | null,
  planText: string | null,
): StoryCoverageResult {
  const blocks = splitStoryBlocks(storiesText ?? '');
  const idBlocks = blocks.filter((b) => b.id);
  if (idBlocks.length === 0) {
    return { ok: false, reason: 'unparseable-stories' };
  }

  const covered = collectPlanCoverage(planText ?? '');

  for (const block of idBlocks) {
    const id = block.id!;
    if (!covered.has(`${id}|*`)) {
      return {
        ok: false,
        reason: 'story-gap',
        gapId: `story-${id}`,
        title: extractStoryTitle(block.text),
      };
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

// --- Orphan-task layer (Task 10) ---

export type OrphanTaskResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'orphan-task';
      /** The `task-<id>` id of the orphan task. */
      gapId: string;
      /** The task's title, taken from its `### Task <id>: <title>` heading. */
      title: string;
    };

/** A parsed plan task block: id, title, and its raw `**Story:**`/`**Type:**` lines. */
interface PlanTaskBlock {
  id: string;
  title: string;
  text: string;
}

/** Split plan text into `### Task <id>: <title>` blocks. */
function extractTaskBlocks(planText: string): PlanTaskBlock[] {
  const taskHeadingRe = /^###\s+Task\s+([A-Za-z0-9._-]+)\s*:?\s*(.*)$/i;
  const blocks: PlanTaskBlock[] = [];
  let current: { id: string; title: string; lines: string[] } | null = null;
  for (const line of planText.split('\n')) {
    const headingMatch = line.match(taskHeadingRe);
    if (headingMatch) {
      if (current) blocks.push({ id: current.id, title: current.title, text: current.lines.join('\n') });
      current = { id: headingMatch[1], title: headingMatch[2].trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push({ id: current.id, title: current.title, text: current.lines.join('\n') });
  return blocks;
}

/** The raw text of a task block's `**Story:**` line, or null if absent. */
function extractStoryLineRaw(blockText: string): string | null {
  const m = blockText.match(/^[ \t]*\*\*Story:\*\*[ \t]*(.*)$/im);
  return m ? m[1].trim() : null;
}

/** The raw text of a task block's `**Type:**` line, or null if absent. */
function extractTypeLineRaw(blockText: string): string | null {
  const m = blockText.match(/^[ \t]*\*\*Type:\*\*[ \t]*(.*)$/im);
  return m ? m[1].trim() : null;
}

/** Story ids (e.g. `1`, `1.2`) cited on a task block's `**Story:**` line(s). */
function extractCitedStoryIdsFromBlock(blockText: string): string[] {
  const ids: string[] = [];
  const storyRefRe = /\*\*Story:\*\*[ \t]*(?:story|epic)?[ \t]*([A-Za-z0-9.\-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = storyRefRe.exec(blockText)) !== null) {
    const id = m[1];
    if (/^(n\/?a|prerequisite|none|all)$/i.test(id)) continue;
    ids.push(id);
  }
  return ids;
}

const SUPPORTING_TYPES: ReadonlySet<string> = new Set(['infrastructure', 'refactor']);

/** True when a `**Story:**` line's raw text declares a non-empty supporting purpose. */
function declaresSupportingPurpose(storyLineRaw: string | null): boolean {
  if (!storyLineRaw) return false;
  const trimmed = storyLineRaw.trim();
  if (trimmed.length === 0) return false;
  if (/^(none|n\/a)$/i.test(trimmed)) return false;
  return true;
}

/**
 * Orphan-task rule (FR-5), mechanical form (per
 * adr-2026-07-22-coherence-gate-placement-and-validation-split): a plan task
 * is covered iff its `**Story:**` line cites at least one story id present
 * in the stories file, OR its `**Type:**` is `infrastructure` or `refactor`
 * AND its `**Story:**` line declares a non-empty supporting purpose (e.g.
 * `none (infrastructure: test scaffolding for S2)`). Anything else — a task
 * citing only nonexistent story ids, an infrastructure/refactor task with an
 * empty/missing `**Story:**` line, or a task with no `**Story:**` line whose
 * type is not infrastructure/refactor — is an orphan, reported naming the
 * `task-<id>` id and the task's title.
 */
export function checkOrphanTasks(
  storiesText: string | null,
  planText: string | null,
): OrphanTaskResult {
  const storyIds = new Set<string>();
  for (const block of splitStoryBlocks(storiesText ?? '')) {
    if (block.id) storyIds.add(block.id);
  }

  const taskBlocks = extractTaskBlocks(planText ?? '');

  for (const task of taskBlocks) {
    const storyLineRaw = extractStoryLineRaw(task.text);
    const typeLineRaw = extractTypeLineRaw(task.text);
    const type = (typeLineRaw ?? '').trim().toLowerCase();

    const citedStoryIds = extractCitedStoryIdsFromBlock(task.text);
    const citesRealStory = citedStoryIds.some((id) => storyIds.has(id));
    if (citesRealStory) continue;

    const isSupportingType = SUPPORTING_TYPES.has(type);
    if (isSupportingType && declaresSupportingPurpose(storyLineRaw)) continue;

    return {
      ok: false,
      reason: 'orphan-task',
      gapId: `task-${task.id}`,
      title: task.title,
    };
  }

  return { ok: true };
}

// --- Orphan-task layer (Task 10) helpers used above; layer order continues below ---

// --- Coverage-table consistency layer (Task 11) ---

export type CoverageTableResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'coverage-table-gap';
      /** The `claim-<row>` id of the offending table row (1-indexed data rows). */
      gapId: string;
      /** Human-readable explanation of what the table claims vs. what the task tree shows. */
      detail: string;
    };

/** A single row of the plan's `## Coverage Check (story → task)` table. */
interface CoverageTableRow {
  storyId: string;
  taskIds: string[];
}

/**
 * Parse the plan's `## Coverage Check` markdown table into `(storyId,
 * taskIds[])` pairs, reusing the same row/separator splitting
 * (`splitRow`/`isSeparatorRow`) already used to parse the coherence artifact
 * table above. Returns `null` when the plan has no such section (nothing to
 * reconcile — not a gap).
 */
function parseCoverageCheckTableRows(planText: string): CoverageTableRow[] | null {
  const headingIdx = planText.search(/^##\s+Coverage Check\b/im);
  if (headingIdx === -1) return null;

  const afterHeading = planText.slice(headingIdx);
  const nextHeadingMatch = afterHeading.slice(1).match(/\n##\s+/);
  const section = nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index! + 1) : afterHeading;

  const rows: CoverageTableRow[] = [];
  let sawHeader = false;
  let sawSeparator = false;
  for (const line of section.split('\n')) {
    const cells = splitRow(line);
    if (cells === null) continue;
    if (!sawHeader) {
      sawHeader = true;
      continue;
    }
    if (!sawSeparator) {
      if (!isSeparatorRow(cells)) continue;
      sawSeparator = true;
      continue;
    }
    if (cells.length < 2) continue;
    const storyId = cells[0].trim();
    const taskIds = cells[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    rows.push({ storyId, taskIds });
  }

  return rows;
}

/**
 * Reconcile the plan's `## Coverage Check (story → task)` table against the
 * plan's real task tree (the `### Task <id>` blocks and their `**Story:**`
 * citations). Two ways a row can lie: it cites a task id that doesn't exist
 * in the task tree at all, or it pairs a story with a task whose own
 * `**Story:**` line does not actually cite that story (the table and the
 * tree disagree about who covers what). Either is reported as `claim-<row>`
 * (1-indexed over the table's data rows), naming the offending id(s) — never
 * silently dropped. A plan with no Coverage Check table has nothing to
 * reconcile and passes trivially.
 */
export function checkCoverageTableConsistency(planText: string | null): CoverageTableResult {
  const text = planText ?? '';
  const rows = parseCoverageCheckTableRows(text);
  if (!rows || rows.length === 0) return { ok: true };

  const realTaskIds = new Set(extractTaskBlocks(text).map((b) => b.id));
  const taskStoryMap = extractTaskStoryIds(text);

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const { storyId, taskIds } = rows[i];
    for (const taskId of taskIds) {
      if (!realTaskIds.has(taskId)) {
        return {
          ok: false,
          reason: 'coverage-table-gap',
          gapId: `claim-${rowNum}`,
          detail: `coverage table row ${rowNum} cites task ${taskId} for story ${storyId}, but no task ${taskId} exists in the plan's task tree`,
        };
      }
      const citingTasksForStory = taskStoryMap.get(storyId);
      if (!citingTasksForStory || !citingTasksForStory.has(taskId)) {
        return {
          ok: false,
          reason: 'coverage-table-gap',
          gapId: `claim-${rowNum}`,
          detail: `coverage table row ${rowNum} claims task ${taskId} covers story ${storyId}, but task ${taskId}'s **Story:** line does not cite story ${storyId}`,
        };
      }
    }
  }

  return { ok: true };
}

// --- Aggregated deterministic gap report (Task 12) ---

/** The six coverage/consistency layers a gap can originate from, in fixed report order. */
export type CoherenceGapLayer =
  | 'outcome'
  | 'fr'
  | 'story'
  | 'orphan-task'
  | 'coverage-table'
  | 'duplicate-claim';

/** Fixed layer ordering used to sort an aggregated gap list before rendering. */
const GAP_LAYER_ORDER: readonly CoherenceGapLayer[] = [
  'outcome',
  'fr',
  'story',
  'orphan-task',
  'coverage-table',
  'duplicate-claim',
];

/**
 * A single normalized gap, ready to render, produced by any of the five
 * coverage/consistency layers. `item` is always the verbatim quoted evidence
 * (a bullet, a title, or a detail sentence) — never a bare id with no
 * context, so a single-gap report can never read as generic-only wording.
 */
export interface CoherenceGap {
  layer: CoherenceGapLayer;
  /** The gap's id, e.g. `outcome-2`, `FR-3`, `story-4`, `task-7`, `claim-2`. */
  gapId: string;
  /** The source artifact the gap was found in (e.g. `stories`, `plan`, `PRD`). */
  artifact: string;
  /** The verbatim quoted item (bullet text, title, or explanatory detail). */
  item: string;
}

/**
 * Render an aggregated gap list into one deterministic Markdown report.
 * Gaps are sorted by fixed layer order, then by their position within the
 * input list (a stable sort) — so identical input always renders byte-
 * identical output, and every gap's id, source artifact, and quoted item
 * appear on its own line (never collapsed into a single generic message).
 */
export function renderGapReport(gaps: CoherenceGap[]): string {
  if (gaps.length === 0) {
    return '# Coherence gaps\n\nNo gaps found.\n';
  }

  const sorted = [...gaps].sort(
    (a, b) => GAP_LAYER_ORDER.indexOf(a.layer) - GAP_LAYER_ORDER.indexOf(b.layer),
  );

  const lines = ['# Coherence gaps', ''];
  for (const gap of sorted) {
    lines.push(`- **${gap.gapId}** (${gap.artifact}): "${gap.item}"`);
  }
  return lines.join('\n') + '\n';
}

/** The real-artifact inputs the full coherence validator runs all five layers against. */
export interface ValidateCoherenceInputs {
  /** Parsed coherence artifact rows (Task 5), used by the outcome-coverage layer. */
  rows: CoherenceRow[];
  /** Verbatim staged/committed intake outcome bullets, in order. */
  outcomeBullets: string[];
  /** PRD file contents, or null on the technical track. */
  prdText: string | null;
  /** Stories file contents, or null when unavailable. */
  storiesText: string | null;
  /** Plan file contents, or null when unavailable. */
  planText: string | null;
}

export type ValidateCoherenceResult =
  | { ok: true }
  | { ok: false; gaps: CoherenceGap[]; report: string };

/**
 * Orchestrate all five coverage/consistency layers (outcome, FR, story,
 * orphan-task, coverage-table) and aggregate every gap they report into one
 * deterministic report, rather than stopping at the first failing layer.
 * Each layer independently returns at most one gap per call; this function
 * collects one gap per layer (when that layer fails) into a single list and
 * renders it with `renderGapReport`.
 */
export function validateCoherence(inputs: ValidateCoherenceInputs): ValidateCoherenceResult {
  const gaps: CoherenceGap[] = [];

  const outcomeResult = checkOutcomeCoverage(
    inputs.rows,
    inputs.outcomeBullets,
    extractStoryIds(inputs.storiesText),
  );
  if (!outcomeResult.ok) {
    gaps.push({
      layer: 'outcome',
      gapId: outcomeResult.gapId,
      artifact: 'intake outcomes',
      item: outcomeResult.bullet,
    });
  }

  const frResult = checkFrCoverage(inputs.prdText, inputs.storiesText, inputs.planText);
  if (!frResult.ok) {
    gaps.push({
      layer: 'fr',
      gapId: frResult.frId,
      artifact: 'PRD',
      item: frResult.storyId
        ? `${frResult.frId} is cited by story-${frResult.storyId} but no task covers that story`
        : `${frResult.frId} is not cited by any story's Requirement line`,
    });
  }

  const storyResult = checkStoryCoverage(inputs.storiesText, inputs.planText);
  if (!storyResult.ok) {
    if (storyResult.reason === 'unparseable-stories') {
      gaps.push({
        layer: 'story',
        gapId: 'stories-unparseable',
        artifact: 'stories',
        item: 'stories file has no parseable story blocks',
      });
    } else {
      gaps.push({
        layer: 'story',
        gapId: storyResult.gapId,
        artifact: 'stories',
        item: storyResult.title,
      });
    }
  }

  const orphanResult = checkOrphanTasks(inputs.storiesText, inputs.planText);
  if (!orphanResult.ok) {
    gaps.push({
      layer: 'orphan-task',
      gapId: orphanResult.gapId,
      artifact: 'plan',
      item: orphanResult.title,
    });
  }

  const coverageTableResult = checkCoverageTableConsistency(inputs.planText);
  if (!coverageTableResult.ok) {
    gaps.push({
      layer: 'coverage-table',
      gapId: coverageTableResult.gapId,
      artifact: 'plan',
      item: coverageTableResult.detail,
    });
  }

  if (gaps.length === 0) return { ok: true };
  return { ok: false, gaps, report: renderGapReport(gaps) };
}

// --- Duplicate-claim scan (Task 14, offline) ---
//
// Per adr-2026-07-22-coherence-waiver-and-duplicate-claim: the BLOCKING check
// reads only local git state — any `.docs/intake/*.md` reachable on the
// repo's default branch carrying the same `Source-Ref` as this spec's own
// sourceRef is a duplicate claim, refused naming the conflicting slug
// (waivable as `duplicate:<ref>`). This never touches the network; it is
// `git ls-tree`/`git show` against the already-fetched default branch only.
// The advisory open-PR warn path (separate function below) reuses
// overlap-scan.ts and is fail-open — it never blocks `scanDuplicateClaim`'s
// verdict.

export type DuplicateClaimResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'duplicate-claim';
      /** `duplicate:<ref>` — the waiver-vocabulary gap id for this duplicate. */
      gapId: string;
      /** The slug of the pre-existing intake marker that already claims this ref. */
      conflictingSlug: string;
      /** A ready-to-aggregate gap, shaped like the five-layer validator's gaps. */
      gap: CoherenceGap;
    };

/** `.docs/intake/<slug>.md` path -> slug, or null for a non-intake-marker path. */
function slugFromIntakeMarkerPath(path: string): string | null {
  const m = path.match(/^\.docs\/intake\/([^/]+)\.md$/);
  return m ? m[1] : null;
}

/**
 * Offline duplicate-intake-claim scan: does any `.docs/intake/*.md` marker
 * already committed on the repo's default branch carry the SAME `Source-Ref`
 * as `sourceRef` (this spec's own claim)?
 *
 * Reads git state only (`ls-tree` to enumerate, `show` to read blob contents
 * at the default-branch ref) — never the network, never the working tree.
 * `excludeSlug` (this spec's own slug, when its marker may already be present
 * on the default branch, e.g. a re-land) is skipped so a spec never flags
 * itself as its own duplicate.
 *
 * No usable `sourceRef` (unparseable/absent) is nothing to check against —
 * trivially passes, since a hand-authored non-intake spec makes no claim.
 */
export async function scanDuplicateClaim(
  repoPath: string,
  defaultBranch: string,
  sourceRef: string | undefined | null,
  options: { git?: GitRunner; excludeSlug?: string } = {},
): Promise<DuplicateClaimResult> {
  const ref = sourceRef?.trim();
  if (!ref) return { ok: true };

  const git = options.git ?? makeGitRunner(repoPath);

  const lsTree = await git(['ls-tree', '-r', '--name-only', defaultBranch, '--', '.docs/intake']);
  if (lsTree.exitCode !== 0) return { ok: true };

  const paths = lsTree.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const path of paths) {
    const slug = slugFromIntakeMarkerPath(path);
    if (!slug || slug === options.excludeSlug) continue;

    const show = await git(['show', `${defaultBranch}:${path}`]);
    if (show.exitCode !== 0) continue;

    const match = show.stdout.match(/^Source-Ref:\s*(\S+)/im);
    if (!match) continue;
    const candidateRef = match[1].trim();

    if (candidateRef.toLowerCase() === ref.toLowerCase()) {
      const gapId = `duplicate:${ref}`;
      return {
        ok: false,
        reason: 'duplicate-claim',
        gapId,
        conflictingSlug: slug,
        gap: {
          layer: 'duplicate-claim',
          gapId,
          artifact: 'intake',
          item: `${ref} is already claimed by intake marker \`.docs/intake/${slug}.md\``,
        },
      };
    }
  }

  return { ok: true };
}

// --- Advisory open-PR overlap warn (fail-open, reuses overlap-scan.ts) ---

/**
 * Advisory-only wrapper around `overlap-scan.ts`'s `runOverlapScan`, scoped
 * to this spec's `sourceRef` (the "--source-ref" reuse hook called for by
 * the ADR) so a coherence-check warn can flag an open sibling spec PR
 * claiming the same intake before either merges.
 *
 * Fail-open by construction: any thrown error (network error, unreachable
 * remote, etc.) is caught and swallowed into `null` — the warn is skipped,
 * never blocking `land`. `runOverlapScan` itself already degrades individual
 * step failures into `skipNotes` rather than throwing, but this wrapper is
 * the last line of defense for anything that still throws (e.g. an injected
 * `git`/`resolver` that rejects outright).
 */
export async function advisoryDuplicateClaimWarn(
  args: RunOverlapScanArgs,
): Promise<OverlapReport | null> {
  try {
    return await runOverlapScan(args);
  } catch {
    return null;
  }
}

// --- Entry guard: tier gating, layer degradation, no-retroactivity (Task 15) ---
//
// Per adr-2026-07-22-coherence-gate-placement-and-validation-split.md ("Tier
// exemption", "Track/origin degradation") the validator does not always run
// all five layers against every spec. `resolveRequiredLayers` is the single
// entry guard `land-spec.ts` (Task 16) calls before touching the fail-closed
// missing-artifact rule, so:
//
//   1. Tier S is exempt OUTRIGHT — the check runs and returns `disengaged`
//      before anything else is inspected (Story 14 ordering: the exemption
//      can never be misread as a "missing artifact" gap).
//   2. A "legacy" idea-attributable change set — one with no
//      `.docs/coherence/` file in it at all — predates the /coherence-check
//      step existing; the gate disengages entirely rather than rejecting a
//      spec that was never asked to author the artifact (no-retroactivity).
//   3. Otherwise the gate engages and derives which of the five coverage
//      layers are REQUIRED from committed signals only: no track marker (or
//      an explicit `product` track) requires the FR layer; a `technical`
//      track marker skips it. No persisted intake outcome bullets skips the
//      outcome layer; any outcome bullets require it. The story/orphan-task/
//      coverage-table layers are structural (they need no external marker)
//      and are always required once the gate is engaged.

/** The five coverage/consistency layers `validateCoherence` can enforce. */
export type CoherenceRequiredLayer =
  | 'outcome'
  | 'fr'
  | 'story'
  | 'orphan-task'
  | 'coverage-table';

export type RequiredLayersResult =
  | {
      /** The gate does not run at all for this spec. */
      engaged: false;
      /** Why the gate disengaged. */
      reason: 'tier-exempt' | 'legacy-change-set';
    }
  | {
      /** The gate runs; only the layers listed here are enforced. */
      engaged: true;
      layers: ReadonlySet<CoherenceRequiredLayer>;
    };

/**
 * Decide whether the coherence gate engages for this spec at all and, if so,
 * which layers it requires. Call this BEFORE any fail-closed missing-artifact
 * check (Story 14): a `disengaged` result must short-circuit the caller with
 * no further validator work, never fall through into a rejection path.
 *
 * @param worktree - the idea's worktree path. Not read directly by this
 *   function (tier/track/outcomes/changeSet are supplied pre-resolved by the
 *   caller) — accepted for parity with the other land-spec entry points and
 *   reserved for future direct-read callers.
 * @param tier - the spec's `.docs/complexity/<slug>.md` tier, or `undefined`
 *   when no tier marker exists.
 * @param track - the spec's `.docs/track/<slug>.md` track (via
 *   `parseTrack`), or `undefined` when no track marker exists. Mirrors land's
 *   own default: an absent marker defaults to `product`.
 * @param outcomes - the spec's staged/committed intake Desired-outcome
 *   bullets, in order. An empty array means no outcome layer is required.
 * @param changeSet - the idea-attributable path set (`resolveIdeaFiles`'s
 *   return value, or an equivalent list) for this spec's diff. Used only to
 *   detect the no-retroactivity trigger: no `.docs/coherence/` path present
 *   anywhere in it means this spec predates the /coherence-check step.
 */
export function resolveRequiredLayers(
  worktree: string,
  tier: ComplexityTier | undefined,
  track: Track | undefined,
  outcomes: readonly string[],
  changeSet: ReadonlySet<string> | readonly string[],
): RequiredLayersResult {
  void worktree;

  // 1. Tier exemption, checked first and unconditionally: never let a later
  // check (missing artifact, legacy change set) misclassify an exempt spec.
  if (tier === 'S') {
    return { engaged: false, reason: 'tier-exempt' };
  }

  // 2. No-retroactivity trigger: a legacy change set (no coherence artifact
  // anywhere in the idea-attributable diff) disengages the gate entirely.
  const changed = changeSet instanceof Set ? changeSet : new Set(changeSet);
  const hasCoherenceSignal = [...changed].some((p) => p.startsWith('.docs/coherence/'));
  if (!hasCoherenceSignal) {
    return { engaged: false, reason: 'legacy-change-set' };
  }

  // 3. Layer degradation: structural layers are always required once
  // engaged; marker-gated layers derive from committed signals.
  const layers = new Set<CoherenceRequiredLayer>(['story', 'orphan-task', 'coverage-table']);

  const effectiveTrack: Track = track ?? 'product';
  if (effectiveTrack === 'product') {
    layers.add('fr');
  }

  if (outcomes.length > 0) {
    layers.add('outcome');
  }

  return { engaged: true, layers };
}

// --- `runCoherenceGate` facade (Task 16) ───────────────────────────────────
//
// The single orchestration entry point `land-spec.ts` calls after the
// existing DRAFT-ADR gate. Wires together, in order: `resolveRequiredLayers`
// (tier exemption / no-retroactivity / layer degradation) -> parse the
// committed coherence artifact -> `crossCheckIds` (fabricated-citation
// fail-closed reject) -> `validateCoherence` (the five coverage/consistency
// layers, gated to only the required ones) -> the offline duplicate-claim
// scan -> waiver evaluation over any aggregated gaps. Throws a single Error
// naming every unresolved gap id on any unwaived failure; resolves silently
// (Story 13) on a coherent or gate-disengaged spec.

/** Enumerate this idea's changed files with git status codes, for the waiver's fresh-in-diff check. */
async function resolveChangedFilesForWaiver(
  worktreePath: string,
  canonicalPath: string,
  git: GitRunner,
): Promise<CoherenceWaiverChangedFile[]> {
  const defaultBranch = await deriveDefaultBranch(canonicalPath);

  const mergeBase = await git(['merge-base', 'HEAD', defaultBranch]);
  const committed: CoherenceWaiverChangedFile[] = [];
  if (mergeBase.exitCode === 0) {
    const base = mergeBase.stdout.trim();
    const diff = await git(['diff', '--name-status', base, 'HEAD']);
    if (diff.exitCode === 0) {
      for (const line of diff.stdout.trim().split('\n')) {
        if (line.trim() === '') continue;
        const parts = line.split('\t');
        const status = parts[0];
        const path = parts[parts.length - 1];
        committed.push({ status, path });
      }
    }
  }

  const status = await git(['status', '--porcelain', '--untracked-files=all']);
  const untracked: CoherenceWaiverChangedFile[] = [];
  if (status.exitCode === 0) {
    for (const line of status.stdout.trim().split('\n')) {
      if (line.trim() === '' || line.slice(0, 2) !== '??') continue;
      const path = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
      untracked.push({ status: 'A', path });
    }
  }

  return [...committed, ...untracked];
}

export interface RunCoherenceGateArgs {
  /** The per-idea worktree (cwd for all git/fs ops). */
  worktreePath: string;
  /** The target repo's registry canonical path (for default-branch derivation). */
  canonicalPath: string;
  /** `.docs/complexity/<slug>.md` tier, or undefined when no tier marker exists. */
  tier: ComplexityTier | undefined;
  /** `.docs/track/<slug>.md` track, or undefined when no track marker exists. */
  track: Track | undefined;
  /** This spec's intake source ref, or undefined/null for a chat/CLI-origin idea. */
  sourceRef: string | undefined | null;
  /** The plan stem (slug) used to key `.docs/coherence/<stem>.md`. */
  planStem: string;
  /** Stories file contents, or null when unavailable. */
  storiesText: string | null;
  /** Plan file contents, or null when unavailable. */
  planText: string | null;
  /** PRD file contents, or null on the technical track. */
  prdText: string | null;
  /** Verbatim staged/committed intake outcome bullets, in order. */
  outcomeBullets: readonly string[];
  /** The idea-attributable path set (`resolveIdeaFiles`'s return value). */
  ideaFiles: ReadonlySet<string> | readonly string[];
  /** Boundary guard (C1) — reused to assert the coherence artifact path stays in-repo. */
  guard: AuthoringGuard;
}

/**
 * Run the full coherence gate for this land. Resolves silently (no return
 * value) when the gate disengages (tier-S exemption, legacy change set) or
 * every layer passes / every gap is freshly waived. Throws a single
 * aggregated `Error` naming every unresolved gap id otherwise.
 */
export async function runCoherenceGate(args: RunCoherenceGateArgs): Promise<void> {
  const {
    worktreePath,
    canonicalPath,
    tier,
    track,
    sourceRef,
    planStem,
    storiesText,
    planText,
    prdText,
    outcomeBullets,
    ideaFiles,
    guard,
  } = args;

  const required = resolveRequiredLayers(worktreePath, tier, track, outcomeBullets, ideaFiles);
  if (!required.engaged) return;

  // Parse the committed coherence artifact (fail-closed on missing/empty/unparseable).
  const coherenceRelPath = `.docs/coherence/${planStem}.md`;
  const coherenceAbsPath = join(worktreePath, coherenceRelPath);
  guard.assertWriteAllowed(coherenceAbsPath);
  let coherenceText: string | null;
  try {
    coherenceText = await readFile(coherenceAbsPath, 'utf-8');
  } catch {
    coherenceText = null;
  }

  const parsed = parseCoherenceArtifact(coherenceText);
  if (!parsed.ok) {
    throw new Error(
      `landSpec: coherence gate: ${parsed.reason} at "${coherenceRelPath}". ` +
        'Run /coherence-check to author the traceability record before landing.',
    );
  }

  // Fabricated-citation fail-closed reject — never waivable (an evidentiary
  // defect, not a coverage gap).
  const crossCheck = crossCheckIds(parsed.rows, {
    storiesText,
    planText,
    prdText,
    outcomeCount: outcomeBullets.length,
  });
  if (!crossCheck.ok) {
    throw new Error(
      `landSpec: coherence gate: fabricated-id "${crossCheck.fabricatedId}" cited by ` +
        `${crossCheck.rowClass} row "${crossCheck.rowId}" — the coherence artifact cites an id ` +
        'that does not resolve against any real story/task/FR/outcome. Fix the record via ' +
        '/coherence-check before landing.',
    );
  }

  const effectivePrdText = required.layers.has('fr') ? prdText : null;
  const effectiveOutcomeBullets = required.layers.has('outcome') ? outcomeBullets : [];

  const coverage = validateCoherence({
    rows: parsed.rows,
    outcomeBullets: [...effectiveOutcomeBullets],
    prdText: effectivePrdText,
    storiesText,
    planText,
  });

  const gaps: CoherenceGap[] = coverage.ok ? [] : [...coverage.gaps];

  const git = makeGitRunner(worktreePath);
  const defaultBranch = await deriveDefaultBranch(canonicalPath);
  const duplicate = await scanDuplicateClaim(worktreePath, defaultBranch, sourceRef, {
    git,
    excludeSlug: planStem,
  });
  if (!duplicate.ok) {
    gaps.push(duplicate.gap);
  }

  if (gaps.length === 0) return;

  const changedFiles = await resolveChangedFilesForWaiver(worktreePath, canonicalPath, git);
  const readText = async (path: string): Promise<string | null> => {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      return null;
    }
  };

  const waiverVerdict = await evaluateCoherenceWaiver({
    gaps,
    changedFiles,
    readText,
    root: worktreePath,
  });
  if (waiverVerdict.ok) return;

  const report = renderGapReport(gaps);
  throw new Error(
    `landSpec: coherence gate blocked — ${waiverVerdict.reason}\n\n${report}`,
  );
}
