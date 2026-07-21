/**
 * intake-label-sync: parsing and label-diff logic for the intake-label-sync GitHub Action.
 *
 * The Action (.github/workflows/intake-label-sync.yml) triggers on issues[opened, edited]
 * for issues filed via .github/ISSUE_TEMPLATE/intake.yml. GitHub issue-form submissions
 * render as a structured markdown body: each field's `label` becomes an `### <label>`
 * heading, followed by the submitted value on the next non-blank line(s).
 *
 * This module is pure (no network, no gh calls) so it is unit-testable without a live
 * GitHub API. The workflow's inline script imports these functions to parse the issue
 * body and compute which labels to add, then applies them via the REST API.
 */

export type ParsedIntakeForm = {
  priority: 'critical' | 'high' | 'medium' | 'low';
  size: 'S' | 'M' | 'L';
  /** Issue numbers this issue is blocked by, parsed from the "Depends on" field. */
  blockedBy: number[];
};

const DEFAULT_PRIORITY = 'medium' as const;
const DEFAULT_SIZE = 'M' as const;

/**
 * Extract the raw value submitted under a given issue-form field heading.
 *
 * Issue-form bodies render each field as:
 *   ### <Label>
 *
 *   <value>
 *
 * Returns the text of the first non-empty line following the heading, or undefined
 * if the heading isn't present or has no content (e.g. "_No response_").
 */
function extractField(body: string, heading: string): string | undefined {
  const headingRegex = new RegExp(`^###\\s+${heading}\\s*$`, 'im');
  const match = headingRegex.exec(body);
  if (!match) return undefined;

  const rest = body.slice(match.index + match[0].length);
  // Stop at the next heading (or end of body)
  const nextHeadingIdx = rest.search(/^###\s+/m);
  const section = nextHeadingIdx === -1 ? rest : rest.slice(0, nextHeadingIdx);

  const lines = section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return undefined;
  const value = lines[0];
  if (value === '_No response_') return undefined;
  return value;
}

/**
 * Parse the Priority field. Closed vocabulary, exact match (case-sensitive),
 * consistent with the intake.yml dropdown options. Falls back to 'medium'
 * for anything unparsable — matches parsePriorityLabels' vocabulary but is
 * intentionally permissive on input source (raw field text, not a label list).
 */
function parsePriorityField(body: string): 'critical' | 'high' | 'medium' | 'low' {
  const raw = extractField(body, 'Priority');
  if (raw === 'critical' || raw === 'high' || raw === 'medium' || raw === 'low') {
    return raw;
  }
  return DEFAULT_PRIORITY;
}

/**
 * Parse the Size field. Closed vocabulary, exact match — consistent with
 * parseSizeLabel's rules (^size: (S|M|L)$ once labelized): no case variants,
 * no partial matches. Falls back to 'M' for anything unparsable.
 */
function parseSizeField(body: string): 'S' | 'M' | 'L' {
  const raw = extractField(body, 'Size');
  if (raw === 'S' || raw === 'M' || raw === 'L') {
    return raw;
  }
  return DEFAULT_SIZE;
}

/**
 * Parse the "Depends on" field into a list of issue numbers.
 * Accepts "none", empty, or unparsable content as "no dependencies".
 * Extracts all `#<digits>` references from the field text.
 */
function parseDependsOnField(body: string): number[] {
  const raw = extractField(body, 'Depends on');
  if (!raw) return [];
  const matches = raw.matchAll(/#(\d+)/g);
  const numbers = [...matches].map((m) => Number(m[1]));
  return [...new Set(numbers)];
}

/**
 * Parse an intake issue-form body into its structured fields.
 * Never throws — unparsable/missing fields fall back to documented defaults
 * (priority: medium, size: M, blockedBy: []).
 */
export function parseIntakeFormBody(body: string): ParsedIntakeForm {
  return {
    priority: parsePriorityField(body ?? ''),
    size: parseSizeField(body ?? ''),
    blockedBy: parseDependsOnField(body ?? ''),
  };
}

/**
 * Compute the full set of labels this issue should carry after sync, given
 * the parsed form and its current labels. Idempotent: labels already present
 * are not duplicated; stale priority:/size:/blocked_by: labels from a prior
 * edit are replaced (not accumulated) so re-editing never leaves duplicates
 * or contradictory bands.
 */
export function computeLabelsToApply(parsed: ParsedIntakeForm, currentLabels: string[]): string[] {
  const kept = currentLabels.filter(
    (l) => !/^priority:/.test(l) && !/^size:/.test(l) && !/^blocked_by:/.test(l),
  );

  const next = new Set(kept);
  next.add(`priority:${parsed.priority}`);
  next.add(`size:${parsed.size}`);
  for (const n of parsed.blockedBy) {
    next.add(`blocked_by:#${n}`);
  }

  return [...next];
}
