/**
 * CI fix eligibility, hint builder, and resolver for failed check remediation.
 *
 * Provides:
 * - `buildCiFixHint`: Fetches failing check names and log excerpts
 * - `isEligibleForCiFix`: Eligibility gates for ci-fix dispatch
 * - `runCiFix`: Resolver orchestration (Tasks 17–20)
 */

import type { GhRunner } from './pr-labels.js';
import type { WatchEntry } from './mergeable-sweep.js';
import type { PrMergeState } from './pr-labels.js';
import type { HarnessConfig } from '../types/config.js';
import { logOutcome, isResolutionInFlight, withResolveWorktree } from './autoresolve.js';
import { execa } from 'execa';

/**
 * Build a RETRY hint from failing checks and their logs.
 *
 * Story: TR-4 happy (hint names failing checks + includes log excerpt)
 *
 * Fetches `gh pr checks --json` to get the list of checks, identifies failed ones,
 * then calls `gh run view --log-failed` for each to get log excerpts.
 * Returns a bounded-length hint string suitable for injecting into a fix session.
 *
 * @param gh The GhRunner to execute commands
 * @param cwd Working directory for gh commands
 * @param prUrl The PR URL to fetch checks for
 * @returns A hint string containing check names and log excerpts
 */
export async function buildCiFixHint(
  gh: GhRunner,
  cwd: string,
  prUrl: string,
): Promise<string> {
  try {
    // Fetch the list of checks for this PR
    const checksResult = await gh(['pr', 'checks', prUrl, '--json'], { cwd });
    const checksData = JSON.parse(checksResult.stdout);

    // Extract failed checks with their run links
    const failedChecks: Array<{ name: string; url?: string }> = [];

    if (checksData.checkSuites && Array.isArray(checksData.checkSuites)) {
      for (const suite of checksData.checkSuites) {
        if (suite.checkRuns && Array.isArray(suite.checkRuns)) {
          for (const run of suite.checkRuns) {
            if (run.conclusion === 'FAILURE') {
              failedChecks.push({
                name: run.name,
                url: run.detailsUrl,
              });
            }
          }
        }
      }
    }

    // Build the hint from failed checks
    const lines: string[] = ['CI checks failed:'];

    for (const check of failedChecks) {
      lines.push(`\n• ${check.name}`);

      // Add the link if available
      if (check.url) {
        lines.push(`  ${check.url}`);
      }

      // Try to fetch logs for this check
      if (check.url) {
        try {
          // Extract run ID from the details URL (GitHub Actions run URL format)
          const runIdMatch = check.url.match(/\/runs\/(\d+)/);
          if (runIdMatch) {
            const runId = runIdMatch[1];
            const logsResult = await gh(['run', 'view', runId, '--log-failed'], { cwd });
            const logLines = logsResult.stdout.split('\n');

            // Include first few log lines (bounded length)
            const maxLogLines = 10;
            const excerpt = logLines.slice(0, maxLogLines).join('\n');
            if (excerpt.trim()) {
              lines.push('  Log excerpt:');
              lines.push('  ' + excerpt.split('\n').join('\n  '));
            }
          }
        } catch (err) {
          // Degrade gracefully: log fetch failed, continue with just the check name and link
          // (Task 16: negative path)
        }
      }
    }

    // Return non-empty hint even if all checks were added without logs
    if (failedChecks.length > 0) {
      return lines.join('\n');
    }

    return '';
  } catch (err) {
    // If gh call fails, return empty hint
    return '';
  }
}

/**
 * Result of eligibility check. When `eligible` is false, `reason` explains why.
 */
export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Determine if a PR is eligible for CI fix dispatch.
 *
 * Checks all eligibility gates in this order:
 *   1. Attempts < 2 (cap gate)
 *   2. PR does not have needs-remediation label (sticky)
 *   3. PR mergeable !== 'CONFLICTING' (conflict resolution takes precedence)
 *   4. No resolution in flight (shared serial guard)
 *   5. Cooldown elapsed since last CI fix attempt
 *
 * Each rejection is logged with a reason. The function returns early on the
 * first rejection for efficiency.
 *
 * Story: Task 13 negative-path (cap reached → no dispatch; needs-remediation
 * suppression; CONFLICTING → skip, no burn); Task 14 negative-path (serial guard,
 * cooldown)
 *
 * @param entry The watch entry for this PR
 * @param prState The current PR merge state (from gh)
 * @param cfg The harness configuration (may be undefined)
 * @param now The current timestamp for any time-based checks
 * @param logger Optional logging function (default: console.log). When the PR
 *               is deemed ineligible, one `skipped(<reason>)` outcome line
 *               is emitted via {@link logOutcome}.
 */
export async function isEligibleForCiFix(
  entry: WatchEntry,
  prState: PrMergeState,
  cfg: HarnessConfig | undefined,
  now: Date,
  logger?: (msg: string) => void,
): Promise<EligibilityResult> {
  const result = await evaluateEligibilityGates(entry, prState, cfg, now);

  if (!result.eligible) {
    const log = logger ?? console.log;
    logOutcome(log, entry.prUrl, 'eligibility', `skipped(${result.reason})`);
  }

  return result;
}

/**
 * Evaluate the eligibility gates without any logging side effect. Extracted
 * from {@link isEligibleForCiFix} so the outcome line is emitted exactly
 * once, at the single call site, regardless of which gate rejected the PR.
 */
async function evaluateEligibilityGates(
  entry: WatchEntry,
  prState: PrMergeState,
  cfg: HarnessConfig | undefined,
  now: Date,
): Promise<EligibilityResult> {
  // Gate 1: Attempts < 2 (cap gate)
  // Task 13: cap reached → ineligible, no counter change
  const attemptCap = 2;
  if ((entry.ciFixAttempts ?? 0) >= attemptCap) {
    return {
      eligible: false,
      reason: `attempt limit reached: ${entry.ciFixAttempts ?? 0} >= ${attemptCap} (cap)`,
    };
  }

  // Gate 2: No needs-remediation label (sticky)
  // Task 13: needs-remediation present → ineligible (sticky escalation)
  if (prState.labels.includes('needs-remediation')) {
    return {
      eligible: false,
      reason: `PR has needs-remediation label (sticky)`,
    };
  }

  // Gate 3: Mergeable !== 'CONFLICTING' (conflict resolution takes precedence)
  // Task 13: CONFLICTING → ineligible (conflict-precedence)
  if (prState.mergeable === 'CONFLICTING') {
    return {
      eligible: false,
      reason: `PR mergeable is CONFLICTING; conflict resolution takes precedence (conflict-precedence)`,
    };
  }

  // Gate 4: Shared serial guard (Task 14)
  // Task 14: any resolution in flight → defer without counter burn (serial)
  if (isResolutionInFlight()) {
    return {
      eligible: false,
      reason: `resolution already in flight for another PR; serial guard`,
    };
  }

  // Gate 5: Cooldown elapsed (Task 14)
  // Task 14: lastCiFixAt within cooldown → ineligible (cooldown)
  if (entry.lastCiFixAt) {
    const lastAttemptTime = new Date(entry.lastCiFixAt);
    const cooldownMinutes = cfg?.ci_watch?.cooldownMinutes ?? 60;
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const elapsedMs = now.getTime() - lastAttemptTime.getTime();

    if (elapsedMs < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - elapsedMs) / (60 * 1000));
      return {
        eligible: false,
        reason: `cooldown not elapsed: ${remainingMinutes} minutes remaining (cooldown)`,
      };
    }
  }

  // All gates passed
  return { eligible: true };
}

/**
 * Result of a CI fix attempt.
 */
export type CiFixOutcome = { kind: 'changed' } | { kind: 'noop' } | { kind: 'branch-gone' };

/**
 * Resolver worktree lifecycle for CI fix execution.
 *
 * Story: TR-4 happy (isolated worktree, stale cleanup, teardown both outcomes);
 * negative (worktree creation fails → non-throwing abort)
 *
 * Task 17: fetches origin, validates the PR branch exists, creates an isolated
 * worktree at the branch tip via {@link withResolveWorktree}, runs the fix-runner
 * callback inside, and cleans up the worktree both on success and on throw.
 *
 * If the branch doesn't exist after fetch, aborts with a logged reason and returns
 * { kind: 'branch-gone' } without throwing, preserving the primary checkout.
 *
 * @param entry The watch entry for this PR
 * @param branch The PR's source branch name (e.g., "feat/fix")
 * @param hint A RETRY hint string to pass to the fix-runner (e.g., failing check names)
 * @param deps Dependencies for the fix execution
 * @param deps.fixRunner The injected fix-runner callback (worktreePath → CiFixOutcome)
 * @param logger Optional logging function for abort/error messages
 * @returns CiFixOutcome describing the result
 */
export async function runCiFix(
  entry: WatchEntry,
  branch: string,
  hint: string,
  deps: {
    fixRunner: (worktreePath: string) => Promise<CiFixOutcome>;
  },
  logger?: (msg: string) => void,
): Promise<CiFixOutcome> {
  const log = logger ?? console.log;
  const { repoCwd, slug, prUrl } = entry;

  try {
    // Step 1: Fetch origin to ensure we have the latest branches
    try {
      await execa('git', ['fetch', 'origin'], { cwd: repoCwd });
    } catch (err) {
      // Fetch failed, but continue — the branch might still be available locally
      log(`${prUrl}: fetch origin failed (continuing): ${err}`);
    }

    // Step 2: Verify the branch exists
    // Check both local and remote branches
    const localCheck = await execa('git', ['rev-parse', '--verify', branch], {
      cwd: repoCwd,
      reject: false,
    });

    const remoteCheck = await execa('git', ['rev-parse', '--verify', `origin/${branch}`], {
      cwd: repoCwd,
      reject: false,
    });

    if (localCheck.exitCode !== 0 && remoteCheck.exitCode !== 0) {
      // Branch doesn't exist anywhere
      log(`${prUrl}: branch not found: ${branch} (branch-gone)`);
      return { kind: 'branch-gone' };
    }

    // Step 3: Create a worktree at the branch tip and run the fix-runner
    // Use the remote branch if it exists, otherwise use the local branch
    const branchToUse = remoteCheck.exitCode === 0 ? `origin/${branch}` : branch;

    const outcome = await withResolveWorktree(slug, branchToUse, repoCwd, async (worktreePath) => {
      // Run the fix-runner callback inside the worktree
      return await deps.fixRunner(worktreePath);
    });

    return outcome;
  } catch (err) {
    // Any unhandled error in worktree setup gets logged but re-thrown
    log(`${prUrl}: unexpected error in ci-fix resolver: ${err}`);
    throw err;
  }
}
