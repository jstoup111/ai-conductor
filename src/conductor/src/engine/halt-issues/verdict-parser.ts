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
  repo?: string;
  haltAt?: string;
}

export interface VerdictParseResult {
  entries: VerdictEntry[];
  unparseable: number;
}

/**
 * Parse verdicts from monitor log text.
 *
 * @param logText - Raw monitor log text containing HALT verdicts
 * @param repo - Repository identifier (injected, not parsed from text)
 * @returns Object with entries array (deduplicated by issue) and unparseable count
 */
export function parseVerdicts(logText: string, repo: string): VerdictParseResult {
  // Regex pattern: HALT <slug> -> filed #<issue_number>
  // Capture groups:
  // 1. slug: word characters and hyphens
  // 2. issue: digits (issue number)
  const verdictPattern = /HALT\s+([\w-]+)\s+->\s+filed\s+#(\d+)/g;

  const entries: Map<string, VerdictEntry> = new Map();
  let unparseable = 0;

  // Extract all haltAt timestamps from NEW HALT lines
  // Pattern: NEW HALT: <timestamp> [daemon] ✋ <slug>
  // We extract both the timestamp and the slug from each NEW HALT line
  const haltAtLinePattern = /NEW HALT:\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}).*?\[daemon\]\s*✋\s*([\w-]+)/g;
  const haltAtMap: Map<string, string> = new Map();
  let haltMatch;

  while ((haltMatch = haltAtLinePattern.exec(logText)) !== null) {
    const timestamp = haltMatch[1];
    const slug = haltMatch[2];

    // Keep the newest (latest) timestamp for each slug
    // ISO timestamps sort lexicographically correctly
    const existingTimestamp = haltAtMap.get(slug);
    if (!existingTimestamp || timestamp > existingTimestamp) {
      haltAtMap.set(slug, timestamp);
    }
  }

  let match;
  while ((match = verdictPattern.exec(logText)) !== null) {
    const slug = match[1];
    const issue = match[2];
    const haltAt = haltAtMap.get(slug);

    // Dedupe by issue number - store in a Map keyed by issue
    entries.set(issue, { slug, issue, repo, haltAt });
  }

  // Count malformed verdicts (HALT followed by filed but missing parts)
  // Pattern: HALT (without slug) or filed # (without number)
  // We look for "HALT ->" patterns that don't match the full verdict pattern
  const allHaltFiledAttempts = logText.match(/HALT[^#]*?filed\s*#/g) || [];
  const validVerdictsCount = entries.size;
  unparseable = Math.max(0, allHaltFiledAttempts.length - validVerdictsCount);

  return {
    entries: Array.from(entries.values()),
    unparseable
  };
}
