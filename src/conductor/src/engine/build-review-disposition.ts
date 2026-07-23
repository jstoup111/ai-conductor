import type { GitRunner } from './rebase.js';

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
