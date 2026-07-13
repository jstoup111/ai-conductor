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
 * Result of parsing a **Wired-into:** line. This is deliberately a
 * discriminated union — not a bare object — so follow-up kinds (e.g.
 * malformed declarations, or inheritance shorthand like plan
 * `same as Task N`) can be added as new `kind` variants without reshaping
 * callers, which should already be switching on `.kind`.
 *
 * - `declared`: an ordered list of path#symbol call sites.
 * - `no_new_surface`: `none (no new production surface)` — the task adds
 *   no new reachable surface, so there is nothing to wire in.
 * - `inert`: `none (inert until <ref>)` — the surface exists but is not
 *   yet reachable; `ref` points at what will activate it (a tracking
 *   issue or a repo-relative path).
 * - `malformed`: the line's content doesn't match any of the accepted
 *   forms; `message` names the offending text and lists the accepted
 *   forms so the author can fix it.
 */
export type WiredIntoParseResult =
  | WiredIntoDeclared
  | WiredIntoNoNewSurface
  | WiredIntoInert
  | WiredIntoMalformed; // | WiredIntoInherited (future kind)

export interface WiredIntoDeclared {
  kind: 'declared';
  sites: WiredIntoSite[];
}

export interface WiredIntoNoNewSurface {
  kind: 'no_new_surface';
}

export interface WiredIntoInert {
  kind: 'inert';
  ref: InertRef;
}

export interface WiredIntoMalformed {
  kind: 'malformed';
  message: string;
}

/**
 * The currently-implemented accepted forms, used verbatim in malformed-line
 * error messages. `same as Task N` (inheritance shorthand) is not listed
 * here — it is not implemented yet (Task 4's scope), so the error message
 * must not claim it is accepted.
 */
const ACCEPTED_FORMS = [
  'declared site(s) (e.g. `path/to/file.ts#symbol`, comma-separated)',
  '`none (no new production surface)`',
  '`none (inert until <ref>)`',
];

function malformed(text: string): WiredIntoMalformed {
  return {
    kind: 'malformed',
    message: `**Wired-into:** value "${text}" does not match any accepted form. Accepted forms are: ${ACCEPTED_FORMS.join('; ')}.`,
  };
}

/** A GitHub issue reference: `owner/repo#number`. */
export interface InertIssueRef {
  form: 'issue';
  owner: string;
  repo: string;
  number: number;
}

/** A repo-relative path reference — anything not shaped like an issue ref. */
export interface InertPathRef {
  form: 'path';
  path: string;
}

export type InertRef = InertIssueRef | InertPathRef;

/** `none (no new production surface)`, case-insensitive. */
const NO_NEW_SURFACE = /^none\s*\(\s*no new production surface\s*\)$/i;

/** `none (inert until <ref>)`, case-insensitive; captures the ref text. */
const INERT_UNTIL = /^none\s*\(\s*inert until\s+(.+?)\s*\)$/i;

/** `owner/repo#number`, e.g. `jstoup111/ai-conductor#999`. */
const ISSUE_REF = /^([^\s/]+)\/([^\s/#]+)#(\d+)$/;

function classifyInertRef(text: string): InertRef {
  const issueMatch = text.match(ISSUE_REF);
  if (issueMatch) {
    return {
      form: 'issue',
      owner: issueMatch[1],
      repo: issueMatch[2],
      number: Number(issueMatch[3]),
    };
  }
  return { form: 'path', path: text };
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

  if (NO_NEW_SURFACE.test(rest)) {
    return { kind: 'no_new_surface' };
  }

  const inertMatch = rest.match(INERT_UNTIL);
  if (inertMatch) {
    return { kind: 'inert', ref: classifyInertRef(inertMatch[1].trim()) };
  }

  const sites: WiredIntoSite[] = [];
  for (const raw of rest.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const entryMatch = token.match(SITE_ENTRY);
    if (!entryMatch) {
      return malformed(rest);
    }
    sites.push({ path: entryMatch[1], symbol: entryMatch[2] });
  }

  return { kind: 'declared', sites };
}

/**
 * Render a parsed **Wired-into:** result back to its canonical line text.
 * Round-trips with `parseWiredIntoLine`: `parseWiredIntoLine(serializeWiredInto(x))`
 * reproduces an equivalent parse of `x` for any well-formed result.
 */
export function serializeWiredInto(result: WiredIntoParseResult): string {
  switch (result.kind) {
    case 'declared':
      return `**Wired-into:** ${result.sites.map((s) => `${s.path}#${s.symbol}`).join(', ')}`;
    case 'no_new_surface':
      return '**Wired-into:** none (no new production surface)';
    case 'inert': {
      const refText =
        result.ref.form === 'issue'
          ? `${result.ref.owner}/${result.ref.repo}#${result.ref.number}`
          : result.ref.path;
      return `**Wired-into:** none (inert until ${refText})`;
    }
    case 'malformed':
      return `**Wired-into:** ${result.message}`;
  }
}
