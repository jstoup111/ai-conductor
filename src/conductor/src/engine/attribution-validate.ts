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
import { fileMatchesPlanPath } from './autoheal.js';

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

/**
 * Validate all citations for a task verdict entry.
 *
 * Checks each citation for:
 * - Reachability (exists in git object database)
 * - Ancestry (is an ancestor of headSha)
 * - Non-empty (has file changes)
 * - Not bookkeeping (not exempt engine commit)
 * - Path overlap (commit's files overlap task's declared Files: lines)
 *
 * Returns valid=true only if ALL citations pass ALL checks.
 * Records reasons for any failures.
 *
 * @param git - GitRunner for executing git commands
 * @param task - Task with ID and declared paths
 * @param verdictEntry - Verdict entry with citations to validate
 * @param headSha - The HEAD SHA to check ancestry against
 * @param bookkeepingCommits - Optional set of engine bookkeeping commit SHAs to exclude
 * @returns CitationValidationResult with valid flag and failure reasons
 */
export async function validateCitations(
  git: GitRunner,
  task: TaskForValidation,
  verdictEntry: VerdictResultForValidation,
  headSha: string,
  bookkeepingCommits?: Set<string>,
): Promise<CitationValidationResult> {
  const bookkeeping = bookkeepingCommits || new Set<string>();
  // No citations → nothing to validate (pass)
  if (!verdictEntry.citations || verdictEntry.citations.length === 0) {
    return { valid: true, reasons: [] };
  }

  const reasons: string[] = [];

  // Validate each citation
  for (const citation of verdictEntry.citations) {
    const sha = citation.sha;

    // Check 1: SHA is reachable
    const reachabilityCheck = await git(['cat-file', '-e', `${sha}^{commit}`]);
    if (reachabilityCheck.exitCode !== 0) {
      reasons.push(`Citation ${sha.slice(0, 7)} is unreachable (does not exist in repository)`);
      continue;
    }

    // Check 2: SHA is an ancestor of HEAD
    const ancestorCheck = await git(['merge-base', '--is-ancestor', sha, headSha]);
    if (ancestorCheck.exitCode !== 0) {
      reasons.push(`Citation ${sha.slice(0, 7)} is not an ancestor of HEAD`);
      continue;
    }

    // Check 3: Commit is not empty
    const emptyCheck = await git(['diff-tree', '--quiet', '-r', sha]);
    if (emptyCheck.exitCode === 0) {
      // --quiet with exit code 0 means no differences (empty commit)
      reasons.push(`Citation ${sha.slice(0, 7)} is empty (no file changes)`);
      continue;
    }

    // Check 4: Commit is not a bookkeeping commit
    if (isBookkeepingCommit(sha, bookkeeping)) {
      reasons.push(`Citation ${sha.slice(0, 7)} is a bookkeeping commit (engine-authored)`);
      continue;
    }

    // Check 5: Path overlap (if task has declared paths)
    if (task.paths.size > 0) {
      const files = await getFilesForCommit(git, sha);
      const overlap = files.filter((f) => {
        for (const p of task.paths) {
          if (fileMatchesPlanPath(f, p)) return true;
        }
        return false;
      });

      if (overlap.length === 0) {
        reasons.push(
          `Citation ${sha.slice(0, 7)} has no file overlap with task's declared paths. ` +
            `Commit touched [${files.slice(0, 3).join(', ')}${files.length > 3 ? ', ...' : ''}] ` +
            `but task expects paths like [${Array.from(task.paths).slice(0, 3).join(', ')}${task.paths.size > 3 ? ', ...' : ''}]`,
        );
        continue;
      }
    }
  }

  // If any validation failed, return invalid with reasons
  if (reasons.length > 0) {
    return { valid: false, reasons };
  }

  // All citations passed all checks
  return { valid: true, reasons: [] };
}
