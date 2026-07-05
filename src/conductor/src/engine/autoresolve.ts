/**
 * Auto-resolve eligibility gate for open PR conflicts.
 *
 * Determines whether a PR is eligible for automatic conflict resolution
 * by checking all gating conditions: feature enabled, PR not merged/closed,
 * no sticky labels, cooldown elapsed, attempts < cap, state is valid.
 */

import type { HarnessConfig } from '../types/config.js';
import { resolveRebaseResolutionAttempts } from './resolved-config.js';
import type { WatchEntry } from './mergeable-sweep.js';
import type { PrMergeState } from './pr-labels.js';

/**
 * File system interface — injected for testability.
 * In production, this wraps node fs.promises.
 */
export interface AutoresolveFs {
  /**
   * Check if a worktree directory exists at the given path.
   * @param path The worktree path to check (e.g., `.worktrees/<slug>`)
   */
  worktreeExists(path: string): Promise<boolean>;
}

/**
 * Result of eligibility check. When `eligible` is false, `reason` explains why.
 */
export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Determine if a PR is eligible for auto-resolution.
 *
 * Checks all eligibility gates in this order:
 *   1. Feature enabled in config
 *   2. PR state is not MERGED, CLOSED, or UNKNOWN
 *   3. PR does not have needs-remediation label (sticky)
 *   4. Cooldown time has elapsed since last attempt
 *   5. Attempt count is below the configured cap
 *   6. Worktree does not already exist (avoiding concurrent prepares)
 *
 * Each rejection is logged with a reason. The function returns early on the
 * first rejection for efficiency.
 *
 * @param entry The watch entry for this PR
 * @param prState The current PR merge state (from gh)
 * @param cfg The harness configuration (may be undefined)
 * @param now The current timestamp for cooldown calculation
 * @param fs Injected fs module for testability
 */
export async function isEligibleForResolve(
  entry: WatchEntry,
  prState: PrMergeState,
  cfg: HarnessConfig | undefined,
  now: Date,
  fs: AutoresolveFs,
): Promise<EligibilityResult> {
  // Gate 1: Feature enabled
  const autoresolveEnabled = cfg?.mergeable_autoresolve?.enabled ?? false;
  if (!autoresolveEnabled) {
    return {
      eligible: false,
      reason: 'autoresolve disabled in config',
    };
  }

  // Gate 2: PR state is valid (not merged/closed/unknown)
  if (prState.state === 'MERGED') {
    return {
      eligible: false,
      reason: `PR is MERGED; pruned from watch`,
    };
  }
  if (prState.state === 'CLOSED') {
    return {
      eligible: false,
      reason: `PR is CLOSED; pruned from watch`,
    };
  }
  if (prState.state === 'UNKNOWN') {
    return {
      eligible: false,
      reason: `PR state is UNKNOWN; skipped until next sweep`,
    };
  }

  // Gate 3: No needs-remediation label (sticky)
  if (prState.labels.includes('needs-remediation')) {
    return {
      eligible: false,
      reason: `PR has needs-remediation label (sticky escalation)`,
    };
  }

  // Gate 4: Cooldown elapsed
  if (entry.lastResolveAt) {
    const lastAttemptTime = new Date(entry.lastResolveAt);
    const cooldownMinutes = cfg?.mergeable_autoresolve?.cooldownMinutes ?? 60;
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const elapsedMs = now.getTime() - lastAttemptTime.getTime();

    if (elapsedMs < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - elapsedMs) / (60 * 1000));
      return {
        eligible: false,
        reason: `cooldown not elapsed: ${remainingMinutes} minutes remaining`,
      };
    }
  }

  // Gate 5: Attempts < cap
  const attemptCap = resolveRebaseResolutionAttempts(cfg);
  if ((entry.resolveAttempts ?? 0) >= attemptCap) {
    return {
      eligible: false,
      reason: `attempt limit reached: ${entry.resolveAttempts ?? 0} >= ${attemptCap}`,
    };
  }

  // Gate 6: Worktree does not exist
  // The worktree path follows the pattern `.worktrees/<slug>`.
  // Extract slug from the entry and construct the expected path.
  const worktreePath = `.worktrees/${entry.slug}`;
  const worktreeExists = await fs.worktreeExists(worktreePath);
  if (worktreeExists) {
    return {
      eligible: false,
      reason: `worktree already exists at ${worktreePath}; concurrent prepare in progress`,
    };
  }

  // All gates passed
  return { eligible: true };
}
