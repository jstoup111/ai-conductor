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
import { logOutcome } from './autoresolve.js';

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
 *
 * Each rejection is logged with a reason. The function returns early on the
 * first rejection for efficiency.
 *
 * Story: Task 13 negative-path (cap reached → no dispatch; needs-remediation
 * suppression; CONFLICTING → skip, no burn)
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

  // All gates passed
  return { eligible: true };
}
