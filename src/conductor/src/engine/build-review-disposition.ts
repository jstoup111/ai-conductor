import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GitRunner } from './rebase.js';
import { changedPathsBetween, resolveFreshBase } from './rebase.js';

// ── Task 6: pure scope-FAIL classifier ───────────────────────────────────────
//
// Classifies a build_review scope FAIL as `stale-mirage` (the flagged content
// only appeared because grading ran against a stale base — a fresh recompute
// would not have flagged it) vs `genuine` (the flagged content persists under
// a fresh recompute — a real scope violation). Runs BEFORE any rework routing
// decision. Pure with respect to git state: reuses `assembleBuildReviewInputs`
// (Task 3's fresh-base resolver), which only ever reads — a stale-tracking-ref
// fetch updates remote-tracking refs, never local HEAD/branches/history — so
// this classifier never mutates git history (Story 6).
//
// Task 6 wires this classifier to run; it does NOT yet act on the result
// (skip rework / invalidate-and-regrade is Task 7's `runScopeFailDisposition`,
// stubbed below).

/**
 * Extract file-path-like tokens cited in a FAIL verdict's free-form
 * `reasons` strings (there is no structured "flagged paths" field on
 * `BuildReviewVerdict` — this recovers path mentions from prose, e.g. "diff
 * touches src/foo/bar.ts which is out of scope"). Conservative regex:
 * `word/word.../word.ext` sequences.
 */
export function extractFlaggedPaths(reasons: string[] | undefined): string[] {
  if (!reasons || reasons.length === 0) return [];
  const pathRe = /(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]+/g;
  const found = new Set<string>();
  for (const reason of reasons) {
    const matches = reason.match(pathRe);
    if (matches) for (const m of matches) found.add(m);
  }
  return [...found];
}

/** File paths touched by a unified diff, read from its `diff --git a/x b/y` headers. */
export function diffTouchedPaths(diff: string): string[] {
  const out = new Set<string>();
  const headerRe = /^diff --git a\/(.+?) b\/(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(diff)) !== null) {
    out.add(m[1]);
    out.add(m[2]);
  }
  return [...out];
}

// ── Tasks 7-8 stub (not yet implemented) ─────────────────────────────────────

/**
 * TODO(build-review-grades-plan-vs-diff-against-a-stale-o, Tasks 6-8): the
 * deterministic, hard-bounded disposition layer for a build_review scope
 * FAIL. Given the base the FAILing verdict graded and the paths it flagged,
 * re-verifies against a freshly-resolved base:
 *
 *   - flagged content absent from the fresh diff → the verdict graded a stale
 *     view ('invalidated'): discard it, invoke `regrade` (re-run build_review)
 *     exactly once per feature-session, never dispatch rework.
 *   - flagged content persists under the fresh base → genuine out-of-scope
 *     work ('kicked-to-build'): route to build rework unchanged.
 *   - a second stale-mirage detection in the same feature-session ('halt'):
 *     never re-enters grading; HALT carries the graded/fresh base shas,
 *     flagged paths, and the regrade count consumed.
 *
 * The engine never mutates git history in this path — no rebase, reset, or
 * deletion. Not yet implemented (this stub exists only so acceptance specs
 * load and fail on assertion rather than on import).
 */

export interface RunScopeFailDispositionOpts {
  git: GitRunner;
  /** Feature-session worktree root — where the regrade counter is persisted. */
  root: string;
  /** The merge-base sha the FAILing verdict was actually graded against. */
  gradedBaseSha: string;
  /** Repo-relative paths the verdict cited as out-of-scope. */
  flaggedPaths: string[];
  /** Re-runs build_review against fresh inputs; injected so callers never
   * dispatch an agent session directly from this layer. */
  regrade: () => Promise<'pass' | 'fail'>;
}

export type Disposition =
  | { kind: 'invalidated'; freshBaseSha: string; regradeResult: 'pass' | 'fail' }
  | { kind: 'kicked-to-build' }
  | {
      kind: 'halt';
      gradedBaseSha: string;
      freshBaseSha: string;
      flaggedPaths: string[];
      regradeCount: number;
    };

// ── Task 7: per-feature-session regrade counter ──────────────────────────────
//
// Persisted at `.pipeline/build-review-regrade.json`, scoped to the current
// worktree/feature-session. Records how many times a `stale-mirage`
// disposition has consumed its one allowed regrade THIS session, so Task 8's
// hard bound (a second detection HALTs instead of re-entering grading) has
// somewhere durable to read from — this module only ever increments/resets
// it; the HALT decision itself is Task 8's.

export const REGRADE_COUNTER_PATH = '.pipeline/build-review-regrade.json';

interface RegradeCounterState {
  count: number;
}

async function readRegradeCounterState(root: string): Promise<RegradeCounterState> {
  try {
    const raw = await readFile(join(root, REGRADE_COUNTER_PATH), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).count === 'number'
    ) {
      return { count: (parsed as Record<string, unknown>).count as number };
    }
  } catch {
    // Missing/unreadable/unparseable — treat as a fresh session (count 0).
  }
  return { count: 0 };
}

async function writeRegradeCounterState(root: string, state: RegradeCounterState): Promise<void> {
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(
    join(root, REGRADE_COUNTER_PATH),
    JSON.stringify(state, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * The number of stale-mirage regrades already consumed this feature-session
 * (0 if none, or the counter is absent/unparseable). Exported for Task 8's
 * HALT-on-second-detection bound to read without re-deriving the storage
 * shape.
 */
export async function readRegradeCount(root: string): Promise<number> {
  return (await readRegradeCounterState(root)).count;
}

/** Increments the counter and returns the new count. */
export async function incrementRegradeCounter(root: string): Promise<number> {
  const next = (await readRegradeCounterState(root)).count + 1;
  await writeRegradeCounterState(root, { count: next });
  return next;
}

/**
 * Resets the per-feature-session regrade counter (called at the start of a
 * fresh session) so the bound in `runScopeFailDisposition` never leaks across
 * sessions (Story 4 negative).
 */
export async function resetRegradeCounter(root: string): Promise<void> {
  // Reset only an EXISTING counter. A missing counter already reads as count 0
  // (`readRegradeCounterState` treats absent/unparseable as a fresh session),
  // so writing one buys nothing and would create an otherwise unnecessary
  // `.pipeline/` directory as a side effect.
  const counterExists = await access(join(root, REGRADE_COUNTER_PATH))
    .then(() => true)
    .catch(() => false);
  if (!counterExists) return;
  await writeRegradeCounterState(root, { count: 0 });
}

/**
 * Bounded disposition for a build_review scope FAIL (Story 3-4). Re-verifies
 * the FAIL against a freshly-resolved base (`resolveFreshBase`, read-only —
 * never mutates git history, Story 6):
 *
 *   - flagged content absent from the fresh diff AND the graded base was
 *     actually stale → `invalidated`: the caller discards the stale verdict
 *     and this function re-runs `regrade` exactly once per feature-session
 *     (never dispatches rework).
 *   - flagged content persists, or the graded base was already fresh →
 *     `kicked-to-build`: routes to build rework unchanged from today.
 *   - a second stale-mirage detection in the same feature-session → `halt`,
 *     carrying the graded/fresh base shas, flagged paths, and the regrade
 *     count already consumed; `regrade` is never invoked (no re-entering
 *     grading past the bound).
 */
export async function runScopeFailDisposition(
  opts: RunScopeFailDispositionOpts,
): Promise<Disposition> {
  const { git, root, gradedBaseSha, flaggedPaths, regrade } = opts;

  const fresh = await resolveFreshBase(git, {});
  let freshBaseSha = gradedBaseSha;
  if (fresh.kind === 'remote') {
    const rev = await git(['rev-parse', fresh.ref]);
    if (rev.exitCode === 0 && rev.stdout.trim()) {
      freshBaseSha = rev.stdout.trim();
    }
  }

  const baseChanged = freshBaseSha !== gradedBaseSha;
  // One-directional diff from the merge-base of the fresh base and HEAD —
  // NOT a two-way `diff freshBaseSha HEAD`, which would also surface paths
  // the fresh base has moved past (e.g. a second merged PR HEAD never saw),
  // wrongly reporting them as "touched by HEAD" and masking a genuine
  // stale-mirage detection.
  const mergeBase = await git(['merge-base', freshBaseSha, 'HEAD']);
  const diffBase = mergeBase.exitCode === 0 && mergeBase.stdout.trim()
    ? mergeBase.stdout.trim()
    : freshBaseSha;
  const freshDiffPaths = await changedPathsBetween(git, diffBase, 'HEAD');
  const flaggedContentPersists =
    flaggedPaths.length === 0 || flaggedPaths.some((p) => freshDiffPaths.includes(p));

  if (!baseChanged || flaggedContentPersists) {
    return { kind: 'kicked-to-build' };
  }

  const alreadyConsumed = await readRegradeCount(root);
  if (alreadyConsumed >= 1) {
    return {
      kind: 'halt',
      gradedBaseSha,
      freshBaseSha,
      flaggedPaths,
      regradeCount: alreadyConsumed,
    };
  }

  await incrementRegradeCounter(root);
  const regradeResult = await regrade();
  return { kind: 'invalidated', freshBaseSha, regradeResult };
}

// ── build_review FAIL routing decision (#989) ─────────────────────────────────

/**
 * Where a `build_review` verdict should send the loop next.
 *
 * `'build'`  — a local diff defect the builder can fix in place (today's path).
 * `'remediate'` — the failure implicates the PLAN, not just the diff; dispatch
 *                 the remediation planner and let it choose the target step.
 * `'none'`   — nothing to route (a PASS verdict).
 */
export type BuildReviewFailRoute = 'build' | 'remediate' | 'none';

/**
 * Derive the routing decision deterministically from the grader verdict that
 * is already on disk — no extra LLM-judged field, no prompt change.
 *
 * Rule: a **completeness** failure means the diff does not cover everything the
 * plan describes. Repeatedly kicking that back to `build` is what produces the
 * "different legitimate finding every lap" signature of an under-decomposed
 * plan task, so it goes to `remediate`, which can route per-gap (build /
 * acceptance_specs / plan / …) or HALT for a human. The other three rubric
 * items (tautology, scope, rootCause) are local diff defects — they keep
 * kicking straight back to `build`.
 *
 * A FAIL with no completeness signal at all fails open to `'build'`, preserving
 * today's behavior. Kickback counting semantics are untouched (see #984).
 */
export function buildReviewFailRoute(verdict: {
  verdict: string;
  rubric?: { tautology?: boolean; scope?: boolean; rootCause?: boolean; completeness?: boolean };
  findings?: { completeness?: string[] };
}): BuildReviewFailRoute {
  if (verdict.verdict !== 'FAIL') return 'none';
  const completenessFailed =
    verdict.rubric?.completeness === true || (verdict.findings?.completeness?.length ?? 0) > 0;
  return completenessFailed ? 'remediate' : 'build';
}
