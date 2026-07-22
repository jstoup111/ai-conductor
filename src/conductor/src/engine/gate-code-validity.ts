// ── Re-dispatch code-validity decision (gate-code-validity-on-redispatch,
// .docs/decisions/adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md)
// ──
//
// Generalizes ADR-2026-07-20's post-rebase delta-aware gate preservation
// (`GATE_SURFACE` + `partitionDelta` in `gate-invalidation.ts`) to the
// re-dispatch/resume path: a judged gate verdict stamped with the HEAD SHA
// it was formed against (`codeStamp`, Task 1) should be preserved across
// re-dispatch if the code hasn't actually changed in that gate's surface
// since. Nothing calls `gateVerdictStillValid` yet — later tasks (5, 6, 7)
// wire it into the completion predicates.

import type { GitRunner } from './rebase.js';
import { originDefaultBranch, changedPathsBetween } from './rebase.js';
import { GATE_SURFACE, partitionDelta } from './gate-invalidation.js';

/** Minimal context the decision helper needs: an injected git runner rooted
 * at the project's working directory. Mirrors the `GitRunner` convention
 * used throughout `rebase.ts`/`gate-invalidation.ts` so tests can drive a
 * real scratch repo without a new git call-site pattern. */
export interface GateCodeValidityContext {
  projectRoot: string;
  git: GitRunner;
}

export type GateVerdictValidity = 'preserve' | 'rerun';

/**
 * Derive the feature's own claimed runtime surface `F` for `partitionDelta`:
 * the paths introduced/touched by the current branch relative to its
 * merge-base with the LOCAL copy of origin's default branch (no fetch — this
 * runs on the re-dispatch hot path, unlike `resolveBase`, which fetches).
 * Fails open to an empty surface (`[]`) on any discovery/compute failure —
 * that only widens `foreignSrc` at the expense of `featureSrc`, which is
 * conservative for `feature-runtime` gates (more likely to re-run, never
 * silently preserved on a real feature-surface change since `any-codetest`/
 * `all-runtime` gates don't consult `F` at all).
 */
async function deriveFeatureSurface(ctx: GateCodeValidityContext): Promise<string[]> {
  try {
    const branch = await originDefaultBranch(ctx.git);
    if (!branch) return [];
    const baseRef = `origin/${branch}`;
    const mergeBase = await ctx.git(['merge-base', baseRef, 'HEAD']);
    if (mergeBase.exitCode !== 0) return [];
    const base = mergeBase.stdout.trim();
    if (!base) return [];
    return await changedPathsBetween(ctx.git, base, 'HEAD');
  } catch {
    return [];
  }
}

/**
 * Decide whether a judged gate's verdict — stamped with `codeStamp`, the
 * HEAD SHA it was formed against — can be trusted (`preserve`) without a
 * re-run, or must be re-judged (`rerun`), given the CURRENT HEAD.
 *
 * Decision order (each step short-circuits to `rerun`; there is exactly one
 * `preserve` exit, the final surface check — invariant C5):
 *   1. No `codeStamp` (absent/null) → `rerun` (legacy/opt-out verdicts keep
 *      governing by mtime, unaffected by this helper).
 *   2. `codeStamp` unreachable in current history (orphaned by amend/rebase/
 *      reset, or not a real object at all) → `rerun` (#766 orphan guard —
 *      never wedge on a baseline that no longer exists).
 *   3. `git diff --name-only codeStamp..HEAD` uncomputable → `rerun`.
 *   4. Partition the delta by the gate's `GATE_SURFACE` kind: surface MISS →
 *      `preserve`; surface HIT → `rerun`.
 *
 * An unknown `gate` (not in `GATE_SURFACE`) fails closed to `rerun`.
 */
export async function gateVerdictStillValid(
  ctx: GateCodeValidityContext,
  gate: string,
  codeStamp: string | null | undefined,
): Promise<GateVerdictValidity> {
  if (!codeStamp) return 'rerun';

  const surface = GATE_SURFACE[gate];
  if (!surface) return 'rerun';

  const ancestry = await ctx.git(['merge-base', '--is-ancestor', codeStamp, 'HEAD']);
  if (ancestry.exitCode !== 0) return 'rerun';

  const diffResult = await ctx.git(['diff', '--name-only', `${codeStamp}..HEAD`]);
  if (diffResult.exitCode !== 0) return 'rerun';

  const delta = diffResult.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const F =
    surface === 'feature-runtime' || surface === 'all-runtime'
      ? await deriveFeatureSurface(ctx)
      : [];

  const { test, featureSrc, foreignSrc } = partitionDelta(delta, F);

  let isSurfaceMiss: boolean;
  switch (surface) {
    case 'feature-runtime':
      isSurfaceMiss = featureSrc.length === 0;
      break;
    case 'all-runtime':
      isSurfaceMiss = featureSrc.length === 0 && foreignSrc.length === 0;
      break;
    case 'any-codetest':
      isSurfaceMiss = test.length === 0 && featureSrc.length === 0 && foreignSrc.length === 0;
      break;
  }

  return isSurfaceMiss ? 'preserve' : 'rerun';
}
