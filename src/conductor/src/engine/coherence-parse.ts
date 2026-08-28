/** The five legacy row classes a coherence artifact row may belong to. */
export type LegacyCoherenceRowClass = 'outcome' | 'fr' | 'story' | 'task' | 'adr';

/** A row class in the coherence mapping table. */
export type CoherenceRowClass = LegacyCoherenceRowClass | 'criterion';

/** A single parsed row in the legacy five-column coherence mapping table. */
export interface LegacyCoherenceRow {
  rowClass: LegacyCoherenceRowClass;
  id: string;
  citedIds: string[];
  verdict: string;
  quote: string;
}

/** The only verdicts a criterion-level coverage claim may carry. */
export type CriterionVerdict = 'covered' | 'gap' | 'fail';

/** The authored answer to whether a criterion depends only on this feature's diff. */
export type CriterionDiffLocalityDisposition = 'diff-local' | 'outside-diff';

/** A parsed criterion-level claim, grounded by one or more plan-task citations. */
export interface CriterionCoherenceRow {
  rowClass: 'criterion';
  criterion: string;
  citedIds: string[];
  verdict: CriterionVerdict;
  quote: string;
  disposition: CriterionDiffLocalityDisposition | undefined;
}

/** A single parsed row of the coherence mapping table. */
export type CoherenceRow = LegacyCoherenceRow | CriterionCoherenceRow;

/** Distinct fail-closed reasons a coherence artifact parse can be rejected for. */
export type CoherenceParseFailureReason =
  | 'missing-coherence-artifact'
  | 'empty-coherence-artifact'
  | 'unparseable-coherence-artifact'
  | 'unparseable-criterion-row';

/** Source context for a structural parse failure that can be cited in the artifact. */
export interface CoherenceParseFailureDetail {
  line: number;
  message: string;
}

export type CoherenceParseResult =
  | { ok: true; rows: CoherenceRow[] }
  | { ok: false; reason: CoherenceParseFailureReason; detail?: CoherenceParseFailureDetail };

export const LEGACY_ROW_CLASSES: ReadonlySet<string> = new Set(['outcome', 'fr', 'story', 'task', 'adr']);

export function isCriterionVerdict(value: string): value is CriterionVerdict {
  return value === 'covered' || value === 'gap' || value === 'fail';
}

export function isCriterionDiffLocalityDisposition(
  value: string,
): value is CriterionDiffLocalityDisposition {
  return value === 'diff-local' || value === 'outside-diff';
}

/**
 * Strip surrounding whitespace and a single pair of matching straight/curly
 * quotes from a cell's text, so quoted evidence compares/reads cleanly.
 */
export function unquote(cell: string): string {
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
export function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  // Drop leading/trailing pipe, then split on interior pipes.
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((cell) => cell.trim());
}

/** True for a markdown table separator row, e.g. `| --- | --- | --- |`. */
export function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function structuralParseFailure(
  reason: CoherenceParseFailureReason,
  detail: CoherenceParseFailureDetail,
): Extract<CoherenceParseResult, { ok: false }> {
  return { ok: false, reason, detail };
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
  const tableRowLines: Array<{ cells: string[]; line: number }> = [];
  let sawHeader = false;
  let sawSeparator = false;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const cells = splitRow(line);
    if (cells === null) continue;
    if (!sawHeader) {
      sawHeader = true;
      continue; // header row, skip
    }
    if (!sawSeparator) {
      if (!isSeparatorRow(cells)) {
        return structuralParseFailure('unparseable-coherence-artifact', {
          line: lineNumber,
          message: 'separator row expected after coherence table header',
        });
      }
      sawSeparator = true;
      continue;
    }
    tableRowLines.push({ cells, line: lineNumber });
  }

  if (!sawHeader || !sawSeparator || tableRowLines.length === 0) {
    return { ok: false, reason: 'unparseable-coherence-artifact' };
  }

  const rows: CoherenceRow[] = [];
  for (const { cells, line } of tableRowLines) {
    const rawRowClass = cells[0];
    const rowClass = rawRowClass.trim().toLowerCase();
    if (rowClass === 'criterion') {
      if (cells.length !== 6) {
        return structuralParseFailure('unparseable-criterion-row', {
          line,
          message: `criterion row expected 6 and actual ${cells.length} cells`,
        });
      }
      const [, rawCriterion, rawCitedIds, rawVerdict, rawQuote, rawDisposition] = cells;
      const criterion = rawCriterion.trim();
      const verdict = rawVerdict.trim();
      const quote = unquote(rawQuote);
      if (criterion.length === 0) {
        return structuralParseFailure('unparseable-criterion-row', {
          line,
          message: 'criterion text must not be empty',
        });
      }
      if (!isCriterionVerdict(verdict)) {
        return structuralParseFailure('unparseable-criterion-row', {
          line,
          message: `unknown criterion verdict "${verdict}"`,
        });
      }
      const citedIds = rawCitedIds
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (citedIds.length === 0) {
        return structuralParseFailure('unparseable-criterion-row', {
          line,
          message: 'criterion row must cite at least one task id',
        });
      }
      const dispositionText = rawDisposition.trim();
      if (dispositionText && !isCriterionDiffLocalityDisposition(dispositionText)) {
        return structuralParseFailure('unparseable-criterion-row', {
          line,
          message: `unknown criterion disposition "${dispositionText}"`,
        });
      }
      const disposition: CriterionDiffLocalityDisposition | undefined =
        dispositionText === '' ? undefined : (dispositionText as CriterionDiffLocalityDisposition);

      rows.push({ rowClass, criterion, citedIds, verdict, quote, disposition });
      continue;
    }
    if (cells.length !== 5) {
      return structuralParseFailure('unparseable-coherence-artifact', {
        line,
        message: `legacy row expected 5 and actual ${cells.length} cells`,
      });
    }
    if (!LEGACY_ROW_CLASSES.has(rowClass)) {
      return structuralParseFailure('unparseable-coherence-artifact', {
        line,
        message: `unknown coherence row class "${rawRowClass}"`,
      });
    }
    const [, rawId, rawCitedIds, rawVerdict, rawQuote] = cells;
    const id = rawId.trim();
    const verdict = rawVerdict.trim();
    if (id.length === 0) {
      return structuralParseFailure('unparseable-coherence-artifact', {
        line,
        message: 'legacy row has empty id',
      });
    }
    if (verdict.length === 0) {
      return structuralParseFailure('unparseable-coherence-artifact', {
        line,
        message: 'legacy row has empty verdict',
      });
    }
    const citedIds = rawCitedIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const quote = unquote(rawQuote);

    rows.push({
      rowClass: rowClass as LegacyCoherenceRowClass,
      id,
      citedIds,
      verdict,
      quote,
    });
  }

  return { ok: true, rows };
}
