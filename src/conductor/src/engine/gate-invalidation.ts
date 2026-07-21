// ── Post-rebase delta-aware gate invalidation (ADR
// .docs/decisions/adr-2026-07-20-post-rebase-delta-aware-invalidation.md) ──
//
// This module is currently inert — nothing imports it yet. It will grow
// `partitionDelta` and `classifyGateInvalidation` in later plan tasks; for
// now it defines only the path predicates and the gate→surface map they
// feed.

import { isCodeOrTestPath } from './rebase.js';

/**
 * Test-path convention shared with the wiring-reachability gate
 * (`isTestPath` in wiring-probe.ts): a path is test-only if it matches
 * `.test.` anywhere in the file name, or lives under a `test/` or
 * `__tests__/` directory.
 */
export function isTestPath(path: string): boolean {
  if (path.includes('.test.')) return true;
  const segments = path.split('/');
  return segments.includes('test') || segments.includes('__tests__');
}

/**
 * True iff `path` is runtime/production source: a code-or-test path
 * (per `isCodeOrTestPath` in rebase.ts — excludes docs/CHANGELOG/README)
 * that is NOT itself a test path.
 */
export function isRuntimeSourcePath(path: string): boolean {
  return isCodeOrTestPath(path) && !isTestPath(path);
}

/**
 * How a judged gate's claimed surface relates to a delta partition:
 * - 'feature-runtime': only the feature's own runtime source paths matter.
 * - 'all-runtime': any runtime source path in the repo matters.
 * - 'any-codetest': any code-or-test path (including test-only changes)
 *   matters.
 *
 * Deliberately excludes `build` — this map only covers the judged gates
 * this ADR's invalidation logic re-runs.
 */
export type GateSurfaceKind = 'feature-runtime' | 'all-runtime' | 'any-codetest';

export const GATE_SURFACE: Record<string, GateSurfaceKind> = {
  build_review: 'all-runtime',
  wiring_check: 'all-runtime',
  manual_test: 'any-codetest',
  prd_audit: 'feature-runtime',
  architecture_review_as_built: 'feature-runtime',
};
