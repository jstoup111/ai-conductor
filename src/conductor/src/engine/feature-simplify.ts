import type { ChildId } from './child-context.js';

/**
 * Whole-feature simplify floor (adr-2026-08-03-uncommitted-work-floor-under-build-completion D9).
 *
 * BUILD hands off to `build_review` only after one whole-feature simplify pass
 * records a CLEAN verdict in this record. The record lives under the gitignored
 * audit trail and survives remediation laps, so the pass runs once per feature
 * (or stacked child). The filesystem check lives with the build predicate in
 * `artifacts.ts` (`featureSimplifyMissingReason`).
 */
export const FEATURE_SIMPLIFY_REQUIRED_PREFIX = 'whole-feature simplify pass required:';

/** The verdict line a CLEAN record carries (optionally followed by counts). */
export const FEATURE_SIMPLIFY_CLEAN_VERDICT = '## Verdict: CLEAN';

export function recordsCleanFeatureSimplify(text: string): boolean {
  return text.split(/\r?\n/).some((line) => {
    if (!line.startsWith(FEATURE_SIMPLIFY_CLEAN_VERDICT)) return false;
    const rest = line.slice(FEATURE_SIMPLIFY_CLEAN_VERDICT.length);
    return rest === '' || /^\W/.test(rest);
  });
}

export function featureSimplifyRecordPath(activeChild?: ChildId): string {
  const owner = activeChild === undefined ? 'feature' : `child-${activeChild}`;
  return `.pipeline/audit-trail/${owner}-simplification.md`;
}
