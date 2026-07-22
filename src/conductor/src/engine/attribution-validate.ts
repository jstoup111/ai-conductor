/**
 * Engine-side citation validator for semantic attribution.
 *
 * PURPOSE:
 * Validates that citations in a verdict entry are honest and correctly anchored.
 * This is the engine's last defense against verifier claims: even if a verifier
 * session claims "task 7 is satisfied by commit X," the engine refuses to stamp
 * that claim unless X genuinely exists and touches the task's work surface.
 *
 * VALIDATION PIPELINE (fail-fast, all-or-nothing):
 * For each citation SHA in a verdict entry:
 *   1. Reachability: SHA exists in git object database (`git cat-file -e`)
 *   2. Ancestry: SHA is an ancestor of HEAD (`git merge-base --is-ancestor`)
 *   3. Non-empty: Commit has file changes (`git diff-tree --quiet` returns non-zero)
 *   4. Not bookkeeping: SHA is not in the engine's bookkeeping exclusion set
 *   5. Path overlap: Commit's diffs overlap task's declared Files: lines
 *      (using segment-anchored suffix matching via `fileMatchesPlanPath`)
 *
 * PASS CONDITION:
 * ALL citations pass ALL five checks → valid=true, reasons=[]
 *
 * FAIL CONDITION:
 * ANY citation fails ANY check → valid=false, reasons=[one or more failure reasons]
 *
 * REASONING:
 * A single bad citation invalidates the entire verdict for that task. This is
 * intentional: semantic attribution requires the engine to trust the verifier's
 * judgment AT THE SURFACE LEVEL (is the diff evidence of the task? does it touch
 * the named files?), but the engine is never expected to trust that the verifier
 * correctly resolved git ancestry, reachability, or bookkeeping status. If a
 * verifier claims task 7 is done via commit X, and X doesn't exist or isn't an
 * ancestor, the engine refuses to stamp — full stop, no partial credit.
 *
 * REUSES FILEPLANPATH FROM AUTOHEAL.TS:
 * Path overlap check uses the same segment-anchored matching rule as the
 * mechanical autoheal lane: exact match OR a suffix match at a `/` boundary.
 * This keeps evidence-grade — "trail.ts" never matches "audit-trail.ts".
 */

import type { GitRunner } from './rebase.js';

/**
 * A verdict result entry with citations to validate.
 * Minimal interface — only fields used by citation validation.
 */
export interface VerdictResultForValidation {
  taskId: string;
  verdict: 'satisfied' | 'unsatisfied' | 'no-verdict';
  citations?: Array<{ sha: string; rationale: string }>;
}

/**
 * Task information for path overlap checking.
 */
export interface TaskForValidation {
  taskId: string;
  paths: ReadonlySet<string>;
}

/**
 * Result of citation validation.
 */
export interface CitationValidationResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Check if a commit was made with CONDUCT_ENGINE_COMMIT=1 (bookkeeping).
 * Engine bookkeeping commits are those marked by the engine during their
 * creation and passed to the validator via the bookkeepingCommits set.
 *
 * @param sha - The commit SHA to check
 * @param bookkeepingCommits - Set of SHAs known to be bookkeeping commits
 * @returns true if the SHA is in the bookkeeping set
 */
function isBookkeepingCommit(sha: string, bookkeepingCommits: Set<string>): boolean {
  return bookkeepingCommits.has(sha);
}

/**
 * Get the list of files changed by a commit.
 */
async function getFilesForCommit(git: GitRunner, sha: string): Promise<string[]> {
  const result = await git(['diff-tree', '--name-only', '-r', sha]);
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

