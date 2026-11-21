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

export function featureSimplifyRecordPath(activeChild?: ChildId): string {
  const owner = activeChild === undefined ? 'feature' : `child-${activeChild}`;
  return `.pipeline/audit-trail/${owner}-simplification.md`;
}
