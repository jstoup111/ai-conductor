import { parseSourceRef as parseGithubSourceRef } from '../issue-ref.js';

export interface ParsedSourceRef {
  repo: string;
  issue: string;
}

/**
 * Parses a GitHub issue source ref of the form `owner/repo#n` into its
 * repo and issue number parts. Returns null when the ref does not match
 * that shape (missing `#n`, the issue part is not numeric, or the ref is a
 * non-GitHub grammar such as a Jira key).
 *
 * Compat shim over the shared `parseSourceRef` (issue-ref.ts): delegates
 * parsing and renames its `number` field to `issue` to preserve this
 * module's existing return shape for its callers.
 */
export function parseSourceRef(sourceRef: string): ParsedSourceRef | null {
  const parsed = parseGithubSourceRef(sourceRef);
  if (!parsed) return null;
  return { repo: parsed.repo, issue: parsed.number };
}
