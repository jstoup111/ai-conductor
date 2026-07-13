// A task's **Wired-into:** line is the authoring-time declaration of which
// call site(s) actually reach the new code (the wiring reachability gate).
// Matches `**Wired-into:**`, with an optional list bullet — same style as
// autoheal.ts's FILES_LINE.
export const WIRED_INTO_LINE = /^\s*(?:[-*]\s+)?\*\*Wired-into(?:\s+[^*]*?)?\s*:?\s*\*\*\s*:?\s*(.*)$/i;

/** A single declared call site: `path#symbol`. */
export interface WiredIntoSite {
  path: string;
  symbol: string;
}

/**
 * Result of parsing a **Wired-into:** line. Only the `declared` kind is
 * implemented today (an ordered list of path#symbol sites). This is
 * deliberately a discriminated union — not a bare object — so follow-up
 * kinds (e.g. explicit "none" forms, malformed declarations, or
 * inheritance shorthand like plan `same as Task N`) can be added as new
 * `kind` variants without reshaping callers, which should already be
 * switching on `.kind`.
 */
export type WiredIntoParseResult = WiredIntoDeclared; // | WiredIntoNone | WiredIntoMalformed | WiredIntoInherited (future kinds)

export interface WiredIntoDeclared {
  kind: 'declared';
  sites: WiredIntoSite[];
}

/** One `path#symbol` entry, optionally wrapped in backticks. */
const SITE_ENTRY = /^`?([^`#\s]+)#([^`\s]+?)`?$/;

/**
 * Parse a **Wired-into:** markdown line into its declared sites, in the
 * order they appear. Entries are comma-separated `path#symbol` pairs, each
 * optionally wrapped in backticks (`` `src/a.ts#foo` ``).
 */
export function parseWiredIntoLine(line: string): WiredIntoParseResult {
  const match = line.match(WIRED_INTO_LINE);
  const rest = match ? match[1].trim() : line.trim();

  const sites: WiredIntoSite[] = [];
  for (const raw of rest.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const entryMatch = token.match(SITE_ENTRY);
    if (!entryMatch) continue;
    sites.push({ path: entryMatch[1], symbol: entryMatch[2] });
  }

  return { kind: 'declared', sites };
}
