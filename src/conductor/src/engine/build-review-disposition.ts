import type { GitRunner } from './rebase.js';
import { assembleBuildReviewInputs, type BuildReviewInputs } from './build-review-inputs.js';

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

export type BuildReviewDisposition = 'stale-mirage' | 'genuine';

export interface BuildReviewDispositionResult {
  disposition: BuildReviewDisposition;
  /** The fresh recompute's full inputs (merge-base/diff/base-ref actually
   * used to classify), for callers that want to log/persist evidence. */
  fresh: BuildReviewInputs;
  /** Whether the freshly-resolved merge-base differs from the base the FAIL
   * verdict was originally graded against. */
  baseChanged: boolean;
  /** File paths extracted from the FAIL verdict's `reasons` text. */
  flaggedPaths: string[];
  /** File paths touched by the freshly recomputed diff. */
  freshDiffPaths: string[];
}

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

/**
 * Classify a build_review scope FAIL as `stale-mirage` vs `genuine`.
 *
 * `original` is the base evidence (`baseRef`/`mergeBase`) recorded on the
 * `BuildReviewInputs` that produced the FAIL verdict being disposed of;
 * `reasons` is that verdict's `reasons` array.
 */
export async function classifyBuildReviewDisposition(
  git: GitRunner,
  planPath: string,
  original: Pick<BuildReviewInputs, 'baseRef' | 'mergeBase'>,
  reasons: string[] | undefined,
): Promise<BuildReviewDispositionResult> {
  const fresh = await assembleBuildReviewInputs(git, planPath);

  const flaggedPaths = extractFlaggedPaths(reasons);
  const freshDiffPaths = diffTouchedPaths(fresh.diff);

  const baseChanged = fresh.mergeBase !== original.mergeBase;
  // No extractable paths → we cannot prove absence, so treat as persisting
  // (safe default: never mis-classify an unparseable FAIL as a mirage).
  const flaggedContentPersists =
    flaggedPaths.length === 0 || flaggedPaths.some((p) => freshDiffPaths.includes(p));

  const disposition: BuildReviewDisposition =
    baseChanged && !flaggedContentPersists ? 'stale-mirage' : 'genuine';

  return { disposition, fresh, baseChanged, flaggedPaths, freshDiffPaths };
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
  defaultBranch: string;
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

export async function runScopeFailDisposition(
  _opts: RunScopeFailDispositionOpts,
): Promise<Disposition> {
  throw new Error(
    'runScopeFailDisposition is not implemented yet (build-review-grades-plan-vs-diff-against-a-stale-o, Tasks 6-8)',
  );
}

/**
 * Resets the per-feature-session regrade counter (called at the start of a
 * fresh session) so the bound in `runScopeFailDisposition` never leaks across
 * sessions (Story 4 negative).
 */
export async function resetRegradeCounter(_root: string): Promise<void> {
  throw new Error(
    'resetRegradeCounter is not implemented yet (build-review-grades-plan-vs-diff-against-a-stale-o, Tasks 6-8)',
  );
}
