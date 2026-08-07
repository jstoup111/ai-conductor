export interface ScopeTrailer {
  path: string;
  rationale: string;
}

/**
 * Extracts valid Scope trailers from a commit message.
 *
 * A widening is intentionally scoped to one commit message; callers must pass
 * the parsed trailers only while evaluating that commit's staged paths.
 */
export function parseScopeTrailers(commitMessage: string): ScopeTrailer[] {
  return commitMessage
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^Scope:\s+(.+?)\s+(?:—|-)\s+(.+)$/);
      if (match === null) return [];

      return [{ path: match[1], rationale: match[2] }];
    });
}
