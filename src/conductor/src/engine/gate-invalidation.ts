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
  // Grades the diff; any code/test path (including test-only) re-grades it.
  build_review: 'any-codetest',
  wiring_check: 'all-runtime',
  // Runtime behavior can be affected by foreign main-side runtime changes;
  // only a test/docs-only delta is safe to preserve (ADR-2026-07-20).
  manual_test: 'all-runtime',
  prd_audit: 'feature-runtime',
  architecture_review_as_built: 'feature-runtime',
};

/**
 * Partition of a post-rebase delta `D` relative to the feature's claimed
 * surface `F`:
 * - `test`: paths in `D` that are test paths (per `isTestPath`).
 * - `featureSrc`: runtime source paths in `D` that are also in `F`.
 * - `foreignSrc`: runtime source paths in `D` that are NOT in `F`.
 *
 * The three groups are disjoint by construction, and
 * `featureSrc ∪ foreignSrc` equals `D` filtered to runtime source paths.
 */
export interface DeltaPartition {
  test: string[];
  featureSrc: string[];
  foreignSrc: string[];
}

export function partitionDelta(D: string[], F: string[]): DeltaPartition {
  const featureSet = new Set(F);
  const result: DeltaPartition = { test: [], featureSrc: [], foreignSrc: [] };

  for (const path of D) {
    if (isTestPath(path)) {
      result.test.push(path);
    } else if (isRuntimeSourcePath(path)) {
      if (featureSet.has(path)) {
        result.featureSrc.push(path);
      } else {
        result.foreignSrc.push(path);
      }
    }
  }

  return result;
}

/**
 * Preserve/invalidate decision table for the post-rebase judged tail
 * (ADR-2026-07-20). `D` is the rebase delta (`changedCodePaths`), `F` is the
 * feature's claimed surface (`mergeBase..preTree`). `ranManualTest` gates
 * whether `manual_test` is considered at all — if it never ran this rebase
 * cycle, it is not a preserve/invalidate candidate and is excluded from both
 * lists.
 *
 * Per gate surface kind (see `GATE_SURFACE`):
 * - 'feature-runtime' (prd_audit, architecture_review_as_built): preserved
 *   iff `featureSrc` is empty.
 * - 'all-runtime' (build_review, wiring_check): preserved iff both
 *   `featureSrc` and `foreignSrc` are empty.
 * - 'any-codetest' (manual_test): preserved iff `D` is entirely empty
 *   (test ∪ featureSrc ∪ foreignSrc all empty).
 */
export function classifyGateInvalidation(
  D: string[],
  F: string[],
  ranManualTest: boolean,
): { preserved: string[]; invalidated: string[] } {
  const { test, featureSrc, foreignSrc } = partitionDelta(D, F);
  const preserved: string[] = [];
  const invalidated: string[] = [];

  for (const [gate, surface] of Object.entries(GATE_SURFACE)) {
    if (gate === 'manual_test' && !ranManualTest) {
      continue;
    }

    let isPreserved: boolean;
    switch (surface) {
      case 'feature-runtime':
        isPreserved = featureSrc.length === 0;
        break;
      case 'all-runtime':
        isPreserved = featureSrc.length === 0 && foreignSrc.length === 0;
        break;
      case 'any-codetest':
        isPreserved = test.length === 0 && featureSrc.length === 0 && foreignSrc.length === 0;
        break;
    }

    (isPreserved ? preserved : invalidated).push(gate);
  }

  return { preserved, invalidated };
}
