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
export function parseScopeTrailers(
  commitMessage: string,
  stagedPaths?: readonly string[],
): ScopeTrailer[] {
  return commitMessage
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^Scope:\s+(\S.*?)\s+(?:—|-)\s+(\S.*)$/);
      if (match === null) return [];

      const path = match[1].trim();
      const rationale = match[2].trim();
      if (stagedPaths !== undefined && !stagedPaths.includes(path)) return [];

      return [{ path, rationale }];
    });
}
