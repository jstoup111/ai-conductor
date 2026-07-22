/**
 * Push-evidence gate — determines if HEAD has been pushed to its upstream
 * tracking branch using only local git operations (no network, deterministic).
 *
 * Part of ADR-2026-07-06 (daemon false-ship guard). This module is injected
 * into the finish completion gate to verify that a PR branch has actually been
 * pushed before converging `DONE` with `finish-choice=pr`.
 *
 * Design constraints:
 *   - Pure local git operations: no network, no fail-open holes.
 *   - Injectable git runner for test injection (follows pr-labels.ts pattern).
 *   - Returns true (pushed), false (not pushed), null (indeterminate/error).
 *   - When the injection is absent, the gate is skipped (fail-open for non-git
 *     environments, legacy callers — CompletionContext injection is optional).
 */

import type { GitRunner } from './pr-labels.js';

/**
 * Determine if HEAD has been pushed to its upstream tracking branch.
 *
 * Logic:
 * 1. Resolve the upstream ref via `git rev-parse --symbolic-full-name @{u}`.
 * 2. If that fails, fall back to `refs/remotes/origin/<branch>` (derived from
 *    the current branch name via `git rev-parse --abbrev-ref HEAD`).
 * 3. Test ancestry via `git merge-base --is-ancestor HEAD <ref>`:
 *    - Exit 0 → true (HEAD is an ancestor, push succeeded).
 *    - Exit 1 → false (HEAD is not an ancestor, push hasn't happened).
 *    - Any other error (exit code ≥2, spawn failure) → null (indeterminate).
 *
 * @param runGit - Injectable git runner
 * @param cwd - Working directory (repository root)
 * @returns Promise<boolean | null>
 *   - true: HEAD is pushed (ancestor of upstream ref)
 *   - false: HEAD is not pushed
 *   - null: indeterminate (git error, not a repo, git missing, etc.)
 */
export async function headPushedToUpstream(
  runGit: GitRunner,
  cwd: string,
): Promise<boolean | null> {
  try {
    // ── Step 1: Resolve the upstream tracking ref ─────────────────────────────
    let upstreamRef: string;
    try {
      const { stdout } = await runGit(['rev-parse', '--symbolic-full-name', '@{u}'], {
        cwd,
      });
      upstreamRef = stdout.trim();
    } catch {
      // Fallback: derive from current branch name
      try {
        const { stdout: branchOut } = await runGit(
          ['rev-parse', '--abbrev-ref', 'HEAD'],
          { cwd },
        );
        const branch = branchOut.trim();
        upstreamRef = `refs/remotes/origin/${branch}`;
      } catch {
        // Can't determine branch or upstream — return null (indeterminate)
        return null;
      }
    }

    if (!upstreamRef) {
      // Upstream ref is empty — return null (indeterminate)
      return null;
    }

    // ── Step 2: Test ancestry via git merge-base --is-ancestor ────────────────
    try {
      // If this succeeds (exit 0), HEAD is an ancestor → return true
      await runGit(['merge-base', '--is-ancestor', 'HEAD', upstreamRef], { cwd });
      return true;
    } catch (err) {
      // Check if this is the "not an ancestor" case (exit code 1)
      // Node's child_process module sets error.code to the exit code
      const exitCode = (err as { code?: number }).code;
      if (exitCode === 1) {
        // exit 1 from merge-base --is-ancestor means HEAD is NOT an ancestor
        return false;
      }
      // Any other error (exit code ≥2, ENOENT, spawn failure) → indeterminate
      return null;
    }
  } catch {
    // Outer try-catch: any unexpected error → indeterminate
    return null;
  }
}
