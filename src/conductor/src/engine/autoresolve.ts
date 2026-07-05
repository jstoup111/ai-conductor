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
import { execa } from 'execa';
import { rm, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

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

/**
 * Track in-flight resolution worktree operations by slug to prevent concurrent
 * attempts on the same PR (serial guard).
 */
const inFlightSlugs = new Set<string>();

/**
 * Provision a transient worktree for conflict resolution, run the provided
 * function inside it, and always tear it down (even on failure).
 *
 * Implements the "Resolution runs in a dedicated transient worktree" story.
 *
 * Workflow:
 *   1. Check if a resolution is already in flight for this slug (serial guard)
 *   2. Remove any stale worktree directory leftover from a crashed prior run
 *   3. Create a fresh worktree at `.worktrees/resolve-<slug>` checked out at
 *      the PR branch tip
 *   4. Write WORKTREE_NAMESPACE into the worktree's `.env` for per-worktree
 *      resource naming (database, redis namespace, etc.)
 *   5. Call the provided async function with the worktree path
 *   6. Always remove the worktree, regardless of success or failure
 *
 * @param slug The PR slug (used to construct the worktree path)
 * @param branch The PR branch to check out at worktree tip
 * @param repoCwd The primary checkout directory
 * @param fn Async function that runs inside the worktree, receives the
 *           worktree path as its only argument, returns any value
 * @returns The return value of fn
 * @throws If the function throws, or if worktree operations fail (add/remove)
 * @throws If a resolution is already in flight for this slug (serial guard)
 */
export async function withResolveWorktree<T>(
  slug: string,
  branch: string,
  repoCwd: string,
  fn: (worktreePath: string) => Promise<T>,
): Promise<T> {
  // Serial guard: prevent concurrent operations on the same slug
  if (inFlightSlugs.has(slug)) {
    throw new Error(`resolution already in flight for slug ${slug}; concurrent worktree add rejected`);
  }

  inFlightSlugs.add(slug);
  const worktreePath = join(repoCwd, '.worktrees', `resolve-${slug}`);

  try {
    // Remove stale worktree directory if it exists (crashed prior run)
    await rm(worktreePath, { recursive: true, force: true });

    // Create the .worktrees directory if needed
    await mkdir(join(repoCwd, '.worktrees'), { recursive: true });

    // Create a fresh worktree at the branch tip
    await execa('git', ['worktree', 'add', worktreePath, branch], { cwd: repoCwd });

    // Write the namespace into the worktree's .env for per-worktree identity
    const namespace = sanitizeNamespace(basename(worktreePath));
    await writeNamespaceEnv(worktreePath, namespace);

    // Run the function inside the worktree
    return await fn(worktreePath);
  } finally {
    // Always clean up the worktree, even if fn throws
    inFlightSlugs.delete(slug);
    try {
      await execa('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoCwd });
    } catch (err) {
      // Log but don't throw on cleanup failure; the primary goal is to remove
      // the in-flight marker so future attempts aren't blocked
      console.error(`failed to remove resolution worktree at ${worktreePath}:`, err);
    }
  }
}

/**
 * Sanitize a worktree directory name to a token safe as a database or resource name.
 * This is derived from the worktree path, so `resolve-widget` → `resolve_widget`.
 */
function sanitizeNamespace(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, '_');
}

/**
 * Write WORKTREE_NAMESPACE into the worktree's .env file.
 * Idempotent: replaces an existing entry rather than appending a duplicate.
 */
async function writeNamespaceEnv(worktreePath: string, namespace: string): Promise<void> {
  const NAMESPACE_VAR = 'WORKTREE_NAMESPACE';
  const envPath = join(worktreePath, '.env');

  // Read existing .env if present
  let existing = '';
  try {
    const { stdout } = await execa('cat', [envPath]);
    existing = stdout;
  } catch {
    // No .env yet; we'll create it
  }

  // Remove any existing WORKTREE_NAMESPACE line and reconstruct
  const lines = existing.split('\n').filter((l) => !l.startsWith(`${NAMESPACE_VAR}=`));
  while (lines.length && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  lines.push(`${NAMESPACE_VAR}=${namespace}`, '');

  await writeFile(envPath, lines.join('\n'), 'utf-8');
}
