import type { ScopeTrailer } from './scope-trailer.js';

const MAX_DERIVED_RATIONALE_LENGTH = 1_000;

export interface ScopeWideningRationale {
  rationale: string;
  derived: boolean;
}

/**
 * Prefer the commit's explicit Scope trailer. When a widening is not
 * explicitly authored, preserve the commit's non-Task message as reviewer
 * context rather than emitting a placeholder that cannot explain the change.
 */
export function resolveScopeWideningRationale(
  path: string,
  scopeTrailers: readonly ScopeTrailer[],
  commitMessage: string,
): ScopeWideningRationale {
  const trailer = scopeTrailers.find((scope) => scope.path === path);
  if (trailer !== undefined) return { rationale: trailer.rationale, derived: false };

  const rationale = commitMessage
    .split('\n')
    .filter((line) => !/^Task:\s/.test(line))
    .join('\n')
    .trim() || 'Commit message unavailable';

  return {
    rationale:
      rationale.length > MAX_DERIVED_RATIONALE_LENGTH
        ? `${rationale.slice(0, MAX_DERIVED_RATIONALE_LENGTH - 1)}…`
        : rationale,
    derived: true,
  };
}
