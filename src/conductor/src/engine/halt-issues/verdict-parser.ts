/**
 * Verdict parser for halt-monitor logs.
 * Extracts HALT verdicts from monitor log text.
 *
 * A verdict has the form: `HALT <slug> -> filed #<issue>`
 * or embedded within text: `...HALT <slug> -> filed #<issue>...`
 *
 * This parser:
 * 1. Finds all `HALT <slug> -> filed #<issue>` patterns using global regex scan
 * 2. Ignores `covered by` verdicts entirely
 * 3. Dedupes by issue number (later matches overwrite earlier ones with same issue)
 * 4. Counts malformed/unparseable verdicts (e.g., missing slug or number)
 *
 * The function is pure: no I/O, no side effects.
 */

export interface VerdictEntry {
  slug: string;
  issue: string;
}

export interface VerdictParseResult {
  entries: VerdictEntry[];
  unparseable: number;
}

/**
 * Parse verdicts from monitor log text.
 *
 * @param logText - Raw monitor log text containing HALT verdicts
 * @returns Object with entries array (deduplicated by issue) and unparseable count
 */
export function parseVerdicts(logText: string): VerdictParseResult {
  // Regex pattern: HALT <slug> -> filed #<issue_number>
  // Capture groups:
  // 1. slug: word characters and hyphens
  // 2. issue: digits (issue number)
  const verdictPattern = /HALT\s+([\w-]+)\s+->\s+filed\s+#(\d+)/g;

  const entries: Map<string, VerdictEntry> = new Map();
  let unparseable = 0;

  let match;
  while ((match = verdictPattern.exec(logText)) !== null) {
    const slug = match[1];
    const issue = match[2];

    // Dedupe by issue number - store in a Map keyed by issue
    entries.set(issue, { slug, issue });
  }

  // Count malformed verdicts (HALT followed by filed but missing parts)
  // Pattern: HALT (without slug) or filed # (without number)
  // We look for "HALT ->" patterns that don't match the full verdict pattern
  const malformedPattern = /HALT\s*->\s*filed\s*#/g;
  const allMatches = logText.match(malformedPattern) || [];
  // Only count those that don't have a valid slug+number before the arrow
  unparseable = allMatches.length - Array.from(entries.values()).length;

  // Correct unparseable count: look for HALT tokens that appear to have filed verdict syntax
  // but are malformed (e.g., "HALT -> filed #" with no slug or issue number)
  const allHaltFiledAttempts = logText.match(/HALT[^#]*?filed\s*#/g) || [];
  const validVerdictsCount = entries.size;
  unparseable = Math.max(0, allHaltFiledAttempts.length - validVerdictsCount);

  return {
    entries: Array.from(entries.values()),
    unparseable
  };
}
