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
