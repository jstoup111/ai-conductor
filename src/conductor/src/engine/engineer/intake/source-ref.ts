export interface ParsedSourceRef {
  repo: string;
  issue: string;
}

const SOURCE_REF_PATTERN = /^(.+)#(\d+)$/;

/**
 * Parses a GitHub issue source ref of the form `owner/repo#n` into its
 * repo and issue number parts. Returns null when the ref does not match
 * that shape (missing `#n`, or the issue part is not numeric).
 */
export function parseSourceRef(sourceRef: string): ParsedSourceRef | null {
  const match = SOURCE_REF_PATTERN.exec(sourceRef);
  if (!match) {
    return null;
  }

  const [, repo, issue] = match;
  return { repo, issue };
}
