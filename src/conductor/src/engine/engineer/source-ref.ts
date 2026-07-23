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

/** Discriminated union over all supported work-ref grammars. */
export type WorkRef = GithubWorkRef;

/**
 * Parse a sourceRef string into a `WorkRef`, or null if it matches no known
 * grammar. Currently recognizes only the GitHub `owner/repo#N` grammar.
 */
export function parseWorkRef(sourceRef: string | undefined | null): WorkRef | null {
  if (!sourceRef) return null;

  const hash = sourceRef.lastIndexOf('#');
  if (hash <= 0 || hash === sourceRef.length - 1) return null;
  const repo = sourceRef.slice(0, hash);
  const number = sourceRef.slice(hash + 1);
  if (!/^\d+$/.test(number)) return null;
  return { kind: 'github', repo, number };
}
