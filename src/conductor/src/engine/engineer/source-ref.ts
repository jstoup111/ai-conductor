// engineer/source-ref.ts — generalized work-ref parsing (GitHub grammar for now).
//
// A `WorkRef` is a discriminated union over the source systems a sourceRef string
// can identify. Today only the GitHub grammar (`owner/repo#N`) is supported; Jira
// key support (`PROJ-123`) lands in a later task and will add a sibling `kind`.
//
// The GitHub branch's semantics are copied verbatim from issue-ref.ts's
// `parseSourceRef`: lenient on the repo segment (any non-empty prefix before the
// LAST `#`), strict on the number (digits only).

/** A parsed GitHub `owner/repo#N` reference. */
export type GithubWorkRef = { kind: 'github'; repo: string; number: string };

/** A parsed Jira `PROJ-123` reference. */
export type JiraWorkRef = { kind: 'jira'; key: string };

/** Discriminated union over all supported work-ref grammars. */
export type WorkRef = GithubWorkRef | JiraWorkRef;

/** Grammar for a Jira issue key: an uppercase project prefix, then `-`, then digits. */
export const JIRA_KEY_GRAMMAR = /^[A-Z][A-Z0-9]+-\d+$/;

/**
 * Parse a sourceRef string into a `WorkRef`, or null if it matches no known
 * grammar. Recognizes the GitHub `owner/repo#N` grammar and the Jira
 * `PROJ-123` grammar. Jira is only checked when the ref contains no `#`,
 * keeping the two grammars disjoint.
 */
export function parseWorkRef(sourceRef: string | undefined | null): WorkRef | null {
  if (!sourceRef) return null;

  const hash = sourceRef.lastIndexOf('#');
  if (hash <= 0 || hash === sourceRef.length - 1) {
    if (!sourceRef.includes('#') && JIRA_KEY_GRAMMAR.test(sourceRef)) {
      return { kind: 'jira', key: sourceRef };
    }
    return null;
  }
  const repo = sourceRef.slice(0, hash);
  const number = sourceRef.slice(hash + 1);
  if (!/^\d+$/.test(number)) return null;
  return { kind: 'github', repo, number };
}

/**
 * Strict `owner/repo#N` grammar used by call sites (e.g. label-sync) that
 * must not widen their accepted set to include Jira or other lenient
 * `parseWorkRef` grammars. Deliberately restrictive: `[\w.-]+/[\w.-]+#\d+`,
 * no whitespace, no leading/trailing slop. Returns the GitHub `WorkRef` shape
 * or null.
 */
export function strictSlugGithubRef(ref: string): GithubWorkRef | null {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(ref);
  if (!m) return null;
  return { kind: 'github', repo: m[1], number: m[2] };
}

/**
 * Split an `owner/repo` slug into its `{ owner, repo }` parts, or null if
 * malformed (missing slash, empty owner/repo segment, or more than one slash).
 */
export function splitOwnerRepo(slug: string): { owner: string; repo: string } | null {
  if (!slug) return null;
  const parts = slug.split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  return { owner, repo };
}

/**
 * Format a `WorkRef` back into its sourceRef string form. Guards against
 * emitting malformed output by re-parsing the formatted string and throwing
 * if it does not structurally match the input `WorkRef`.
 */
export function formatWorkRef(ref: WorkRef): string {
  const formatted = ref.kind === 'github' ? `${ref.repo}#${ref.number}` : ref.key;

  const reparsed = parseWorkRef(formatted);
  if (!reparsed || reparsed.kind !== ref.kind || JSON.stringify(reparsed) !== JSON.stringify(ref)) {
    throw new Error(`formatWorkRef: formatted output "${formatted}" does not re-parse to an equivalent WorkRef`);
  }

  return formatted;
}
