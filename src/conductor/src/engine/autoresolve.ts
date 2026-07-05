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
import {
  type GhRunner as PrLabelsGhRunner,
  makeProductionGh,
  removeLabel,
  addLabel,
  upsertComment,
  NEEDS_REMEDIATION_MARKER,
} from './pr-labels.js';
import {
  resolveRebaseConflicts,
  type RebaseOutcome,
  type RebaseResolver,
  type GitRunner,
  featureCommitsPreserved,
  isBranchCurrent,
  rebaseStateActive,
  conflictedFiles,
  resolveBase,
  runTier1,
  makeGitRunner,
} from './rebase.js';
import { execa } from 'execa';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareWorktree as defaultPrepareWorktree } from './worktree-prepare.js';
import { rewriteWatch } from './mergeable-sweep.js';

const execFile = promisify(execFileCb);

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
 * Structured outcome logging (FR-16).
 *
 * Story: "one outcome line per concluded attempt — PR identifier, stage
 * reached, refreshed | escalated | skipped(<reason>)"
 *
 * Emits exactly one log line in a consistent, greppable format so operators
 * can scan the daemon log for what happened to every PR the autoresolve
 * pipeline touched. Used by `isEligibleForResolve` (skipped), `escalate`'s
 * caller (escalated), and `publishResolution` (refreshed/escalated).
 *
 * @param log          Logging function to write the line to.
 * @param prIdentifier The PR being reported on (e.g. its URL or slug).
 * @param stage        The pipeline stage reached when the attempt concluded
 *                     (e.g. "eligibility", "lease-push", "suite-gate").
 * @param result       One of `refreshed`, `escalated`, or a `skipped(<reason>)`
 *                     string built by the caller.
 */
export function logOutcome(
  log: (msg: string) => void,
  prIdentifier: string,
  stage: string,
  result: 'refreshed' | 'escalated' | string,
): void {
  log(`outcome: pr=${prIdentifier} stage=${stage} result=${result}`);
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
 * @param logger Optional logging function (default: console.log). When the PR
 *               is deemed ineligible, one `skipped(<reason>)` outcome line
 *               (FR-16) is emitted via {@link logOutcome}.
 */
export async function isEligibleForResolve(
  entry: WatchEntry,
  prState: PrMergeState,
  cfg: HarnessConfig | undefined,
  now: Date,
  fs: AutoresolveFs,
  logger?: (msg: string) => void,
): Promise<EligibilityResult> {
  const result = await evaluateEligibilityGates(entry, prState, cfg, now, fs);

  if (!result.eligible) {
    const log = logger ?? console.log;
    logOutcome(log, entry.prUrl, 'eligibility', `skipped(${result.reason})`);
  }

  return result;
}

/**
 * Evaluate the eligibility gates without any logging side effect. Extracted
 * from {@link isEligibleForResolve} so the outcome line is emitted exactly
 * once, at the single call site, regardless of which gate rejected the PR.
 */
async function evaluateEligibilityGates(
  entry: WatchEntry,
  prState: PrMergeState,
  cfg: HarnessConfig | undefined,
  now: Date,
  fs: AutoresolveFs,
): Promise<EligibilityResult> {
  // Gate 0 (Task 18): process-wide in-flight serial guard. While ANY
  // resolution is running (any slug), no other PR may be dispatched — the
  // next tick must defer, not just the same-slug case `inFlightSlugs`
  // already covers inside withResolveWorktree.
  if (isResolutionInFlight()) {
    return {
      eligible: false,
      reason: `resolution already in flight for another PR; serial guard`,
    };
  }

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
 * Task 18: process-wide in-flight serial guard across ticks.
 *
 * Story: "worktree story negative path — no second resolution while one
 * runs" (.docs/stories/auto-resolve-open-pr-conflicts.md).
 *
 * `inFlightSlugs` above only rejects a second concurrent attempt for the
 * SAME slug. This flag is broader: while ANY resolution is running (e.g. a
 * long suite gate), the next sweep tick must start no second resolution for
 * ANY PR. Set at the top of {@link withResolveWorktree} (before any git
 * work) and always cleared in its `finally`, so a long-running suite, a
 * thrown error, or an escalation all leave the flag clear afterward.
 */
let resolutionInFlight = false;

/**
 * True while a resolution (of any PR) is in flight. Consulted by the
 * eligibility gate (Gate 0) so the next tick defers every other PR until the
 * current resolution finishes.
 */
export function isResolutionInFlight(): boolean {
  return resolutionInFlight;
}

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
 *   4. Prepare the worktree (write WORKTREE_NAMESPACE to .env, run bin/setup)
 *      using the injected prepareWorktree function (or default)
 *   5. Call the provided async function with the worktree path
 *   6. Always remove the worktree, regardless of success or failure
 *
 * @param slug The PR slug (used to construct the worktree path)
 * @param branch The PR branch to check out at worktree tip
 * @param repoCwd The primary checkout directory
 * @param fn Async function that runs inside the worktree, receives the
 *           worktree path as its only argument, returns any value
 * @param prepareWorktree Optional injected function to prepare the worktree
 *                        (write namespace, run setup). Defaults to the standard
 *                        daemon preparation. Useful for testing and custom flows.
 * @returns The return value of fn
 * @throws If the function throws, or if worktree operations fail (add/remove)
 * @throws If a resolution is already in flight for this slug (serial guard)
 */
export async function withResolveWorktree<T>(
  slug: string,
  branch: string,
  repoCwd: string,
  fn: (worktreePath: string) => Promise<T>,
  prepareWorktree?: (worktreePath: string) => Promise<void>,
): Promise<T> {
  // Serial guard: prevent concurrent operations on the same slug
  if (inFlightSlugs.has(slug)) {
    throw new Error(`resolution already in flight for slug ${slug}; concurrent worktree add rejected`);
  }

  inFlightSlugs.add(slug);
  // Task 18: set the process-wide flag for the duration of this resolution,
  // BEFORE any git work runs, so the eligibility gate defers every other PR
  // (any slug) until this attempt's finally clears it below.
  resolutionInFlight = true;
  const worktreePath = join(repoCwd, '.worktrees', `resolve-${slug}`);

  let originalBranch: string | null = null;

  try {
    // Remove stale worktree directory if it exists (crashed prior run)
    await rm(worktreePath, { recursive: true, force: true });

    // Create the .worktrees directory if needed
    await mkdir(join(repoCwd, '.worktrees'), { recursive: true });

    // If the branch is already checked out in the main repo, we need to checkout
    // a different branch first so we can create the worktree.
    // Check if HEAD points to the branch we want to create a worktree for.
    const headResult = await execa('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: repoCwd,
      reject: false,
    });
    if (headResult.exitCode === 0 && headResult.stdout.trim() === branch) {
      // Branch is currently checked out. Switch to main (or another branch) temporarily.
      originalBranch = branch;
      const mainCheckout = await execa('git', ['checkout', '-q', 'main'], {
        cwd: repoCwd,
        reject: false,
      });
      // If checking out main fails, try origin/main or just master
      if (mainCheckout.exitCode !== 0) {
        await execa('git', ['checkout', '-q', 'origin/main'], {
          cwd: repoCwd,
          reject: false,
        });
      }
    }

    // Create a fresh worktree at the branch tip
    await execa('git', ['worktree', 'add', worktreePath, branch], { cwd: repoCwd });

    // Prepare the worktree using the injected prepareWorktree function (or default)
    const prepare = prepareWorktree ?? defaultPrepareWorktree;
    await prepare(worktreePath);

    // Run the function inside the worktree
    return await fn(worktreePath);
  } finally {
    // Always clean up the worktree, even if fn throws
    inFlightSlugs.delete(slug);
    // Task 18: clear the process-wide flag on both success and failure
    // (thrown error / escalation), so the next tick can dispatch again.
    resolutionInFlight = false;

    // Restore the original branch if we switched away from it
    if (originalBranch !== null) {
      try {
        await execa('git', ['checkout', '-q', originalBranch], { cwd: repoCwd, reject: false });
      } catch (err) {
        // Log but don't fail if we can't restore the branch
        console.error(`failed to restore branch ${originalBranch}:`, err);
      }
    }

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
 * Tier 2 gated dispatch of `resolveRebaseConflicts` for remaining conflicts.
 *
 * Story: "Remaining conflicts go to the gated /rebase session, bounded"
 * (adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep)
 *
 * Tier 2 runs after Tier 1 (deterministic CHANGELOG + .docs/ resolvers).
 * When remaining conflicts exist, Tier 2 dispatches them to `resolveRebaseConflicts`
 * with a bounded cap read from `rebase_resolution_attempts` in the harness config.
 *
 * Bounded behavior:
 *   - cap <= 0        → no dispatch; return escalation (cap=0 disables)
 *   - cap > 0         → call resolveRebaseConflicts with the cap
 *   - resolver fails  → short-circuit on attempt 1 (FR-6)
 *   - cap exhausted   → abort rebase (`git rebase --abort`) and escalate
 *
 * @param git          Git runner (injected for testability)
 * @param projectRoot  Worktree path where the rebase is paused
 * @param baseRef      The base reference (e.g., "main" or "origin/main") that the rebase is onto
 * @param remaining    Remaining conflicted files from Tier 1 (if any)
 * @param cap          Maximum attempts for resolution; 0 disables tier 2
 * @param resolver     Injected resolver function (dispatches to /rebase or test stub)
 * @returns            Reclassified RebaseOutcome: unchanged conflict_halt or reclassified as
 *                     'noop', 'changed', or 'changelog_resolved' if resolver succeeds
 */
export async function runTier2(
  git: GitRunner,
  projectRoot: string,
  baseRef: string,
  remaining: string[],
  cap: number,
  resolver: RebaseResolver,
): Promise<RebaseOutcome> {
  // FR-7: cap=0 disables resolution entirely — return the conflict unchanged
  if (cap <= 0) {
    return {
      kind: 'conflict_halt',
      conflicts: remaining,
      reason: 'tier 2 resolution disabled (cap=0)',
    };
  }

  // Create a conflict_halt outcome from the remaining conflicts
  const conflictOutcome: RebaseOutcome = {
    kind: 'conflict_halt',
    conflicts: remaining,
    reason: 'remaining conflicts after tier 1',
  };

  // Delegate to resolveRebaseConflicts with the bounded cap
  // This will retry up to `cap` times until success or the resolver explicitly gives up
  return resolveRebaseConflicts(git, projectRoot, conflictOutcome, resolver, cap);
}

/**
 * Work-preservation acceptance guards for sweep-resolution (open-PR auto-resolve).
 *
 * Story: "Work-preservation guards reject lossy resolutions"
 *
 * Applies after a successful Tier 1 + Tier 2 resolution attempt to verify
 * the rebase completed correctly and no work was lost.
 *
 * Guards (in order):
 *   1. rebaseStateActive  — rebase-merge dir must not be present; rebase must be fully finished
 *   2. isBranchCurrent    — branch must be current with the base it rebased onto
 *   3. featureCommitsPreserved — all pre-rebase feature commits (by subject) must survive
 *
 * Subjects MUST be captured BEFORE any rebase work to avoid false negatives.
 *
 * @param git             Git runner (injected for testability)
 * @param baseRef         The base reference the rebase was onto (e.g., "main" or commit hash)
 * @param subjectsBefore  Commit subjects of the feature, captured BEFORE rebase started
 * @returns               { ok: true } if all guards pass, or { ok: false, guard, reason } on failure
 */
export type AcceptanceGuardResult =
  | { ok: true }
  | { ok: false; guard: string; reason: string };

export async function runAcceptanceGuards(
  git: GitRunner,
  baseRef: string,
  subjectsBefore: string[],
): Promise<AcceptanceGuardResult> {
  // Determine the project root from the git runner by asking git where it is.
  // This allows the function to work with git runners bound to any directory.
  const topLevel = await git(['rev-parse', '--show-toplevel']);
  const projectRoot = topLevel.exitCode === 0 ? topLevel.stdout.trim() : '.';

  // Guard 1: rebase-merge dir must be gone (rebase fully finished, not mid-state)
  const active = await rebaseStateActive(git, projectRoot);
  if (active) {
    return {
      ok: false,
      guard: 'rebaseStateActive',
      reason: 'rebase did not fully complete (rebase-merge or rebase-apply still present)',
    };
  }

  // Guard 2: branch must be current with the base it rebased onto
  const current = await isBranchCurrent(git, baseRef);
  if (!current) {
    return {
      ok: false,
      guard: 'isBranchCurrent',
      reason: `branch not current with ${baseRef} after resolution`,
    };
  }

  // Guard 3: all feature commits (by subject) must be preserved
  const preserved = await featureCommitsPreserved(git, baseRef, subjectsBefore);
  if (!preserved) {
    const displaySubjects = subjectsBefore.slice(0, 3).join(', ');
    const more = subjectsBefore.length > 3 ? `... (+${subjectsBefore.length - 3} more)` : '';
    return {
      ok: false,
      guard: 'featureCommitsPreserved',
      reason: `feature commit(s) lost during resolution: expected ${displaySubjects}${more}`,
    };
  }

  return { ok: true };
}

/**
 * Result of the suite gate. On exit 0, the suite passes; on any other exit code, it fails.
 */
export type SuiteGateResult =
  | { ok: true; exitCode: 0; duration: number }
  | { ok: false; exitCode: number; duration: number; reason?: string };

/**
 * Options for running the suite gate.
 */
export interface SuiteGateOptions {
  /**
   * Timeout in milliseconds. If the command takes longer than this,
   * it will be killed and the result will be a timeout failure.
   * If undefined, no timeout is enforced.
   */
  timeoutMs?: number;
}

/**
 * Runs a user-configured test suite command in the resolution worktree.
 *
 * Story: "Full suite must pass before anything publishes" (fail-closed)
 *
 * Execution:
 *   - If `suiteCommand` is undefined/empty, returns success (noop)
 *   - Otherwise, runs the command via sh -c in the worktree directory
 *   - Captures stdout and stderr
 *   - Measures execution duration
 *   - Exit code 0 → success, other codes → failure
 *   - Logs exit code, duration, and command output
 *   - Timeout: if exceeded, kills the process and returns timeout failure
 *   - ENOENT or any spawn error: treated as a suite failure with clear reason
 *
 * @param suiteCommand The shell command to run (e.g., `npm test`, `./verify.sh`)
 *                     If undefined/empty, returns success (no suite configured)
 * @param worktreePath The worktree directory where the command executes
 * @param logger       Optional logging function (default: console.log)
 * @param options      Optional execution options (timeout, etc.)
 * @returns            SuiteGateResult: { ok: true, ... } or { ok: false, exitCode, duration, reason }
 *                     All failures include a clear reason for escalation
 */
export async function runSuiteGate(
  suiteCommand: string | undefined,
  worktreePath: string,
  logger?: (msg: string) => void,
  options?: SuiteGateOptions,
): Promise<SuiteGateResult> {
  const log = logger ?? console.log;

  // If no suite command configured, treat as noop success
  if (!suiteCommand || suiteCommand.trim() === '') {
    log('suite gate: no command configured (noop)');
    return { ok: true, exitCode: 0, duration: 0 };
  }

  // Measure duration
  const startMs = Date.now();

  // Set up timeout if specified
  let timeoutHandle: NodeJS.Timeout | undefined;
  const controller = new AbortController();

  try {
    // If a timeout is specified, set up a timer to abort
    if (options?.timeoutMs !== undefined && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        controller.abort();
      }, options.timeoutMs);
    }

    // Run the command in the worktree directory using sh -c
    // This allows complex shell commands with pipes, redirects, etc.
    const result = await execFile('sh', ['-c', suiteCommand], {
      cwd: worktreePath,
      encoding: 'utf-8',
      signal: controller.signal,
    });

    const durationMs = Date.now() - startMs;

    // Exit code 0 = success
    log(`suite gate passed: exit code 0, duration ${durationMs}ms`);
    if (result.stdout) {
      log(`suite output: ${result.stdout.trim()}`);
    }

    return { ok: true, exitCode: 0, duration: durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - startMs;

    // Handle abort (timeout) specially
    if (err.name === 'AbortError' || controller.signal.aborted) {
      log(`suite gate timed out after ${durationMs}ms`);
      return {
        ok: false,
        exitCode: 1,
        duration: durationMs,
        reason: `suite command timed out after ${durationMs}ms`,
      };
    }

    // Handle other errors (ENOENT, permission denied, etc.)
    const exitCode = err.code ?? err.status ?? 1;
    const stdout = err.stdout ? String(err.stdout).trim() : '';
    const stderr = err.stderr ? String(err.stderr).trim() : '';

    // Build failure reason with context
    let reason = `suite command failed`;
    if (err.code === 'ENOENT') {
      reason = `suite command not found or not executable`;
    } else if (exitCode !== 1) {
      reason = `suite command exited with code ${exitCode}`;
    } else if (stderr) {
      reason = `suite command failed: ${stderr}`;
    }

    log(`suite gate failed: exit code ${exitCode}, duration ${durationMs}ms`);
    if (stdout) {
      log(`suite stdout: ${stdout}`);
    }
    if (stderr) {
      log(`suite stderr: ${stderr}`);
    }

    return {
      ok: false,
      exitCode,
      duration: durationMs,
      reason,
    };
  } finally {
    // Clean up the timeout if it's still pending
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Result of a push attempt using --force-with-lease.
 * Success updates the watch entry (attempts reset to 0, lastResolveAt updated).
 * Failure includes a reason (e.g., lease rejection due to concurrent push).
 */
export type PushRefreshedResult =
  | { pushed: true }
  | { pushed: false; reason: string };

/**
 * Push the refreshed branch with lease protection.
 *
 * Story: "The refresh publishes with a lease and never overwrites unseen work"
 *
 * Execution:
 *   - Pushes the branch using `git push origin <branch> --force-with-lease`
 *   - On success (exit 0):
 *     * Resets attempt counter to 0 (success = no more retries needed)
 *     * Updates lastResolveAt timestamp
 *     * Removes the resolution worktree (if paths provided)
 *     * Logs outcome as "refreshed"
 *     * Returns { pushed: true }
 *   - On failure (non-zero exit):
 *     * Returns { pushed: false, reason: ... }
 *     * Reason includes lease rejection context if available
 *
 * @param git         Git runner (injected for testability)
 * @param branch      The branch name to push (e.g., "feat/widget")
 * @param projectRoot Optional: the primary project root for watch file updates
 *                    If provided, updates the watch entry with rewriteWatch
 * @param entry       Optional: the watch entry for this PR. If provided with projectRoot,
 *                    its attempts are reset and lastResolveAt is updated.
 * @param logger      Optional logging function (default: console.log)
 * @returns           { pushed: true } on success, { pushed: false, reason } on failure
 */
export async function pushRefreshedBranch(
  git: GitRunner,
  branch: string,
  projectRoot?: string,
  entry?: WatchEntry,
  logger?: (msg: string) => void,
): Promise<PushRefreshedResult> {
  const log = logger ?? console.log;

  // Push the branch with --force-with-lease (lease prevents concurrent overwrites)
  const pushResult = await git(['push', 'origin', branch, '--force-with-lease']);

  // Check if the push succeeded
  if (pushResult.exitCode === 0) {
    // Success: update the watch entry and log
    if (projectRoot && entry) {
      // Reset attempts to 0 (successful resolution)
      const updatedEntry: WatchEntry = {
        ...entry,
        resolveAttempts: 0,
        lastResolveAt: new Date().toISOString(),
      };

      // Ensure the .daemon directory exists before writing
      await mkdir(join(projectRoot, '.daemon'), { recursive: true });

      // Update the watch registry
      await rewriteWatch(projectRoot, [updatedEntry]);

      log(`pushRefreshedBranch: attempts reset to 0, lastResolveAt updated`);
    }

    log(`pushRefreshedBranch: refreshed (${branch} pushed with lease)`);
    return { pushed: true };
  }

  // Failure: lease rejected (concurrent push detected) or other error
  const stderr = pushResult.stderr || '';
  const stdout = pushResult.stdout || '';
  let reason = 'push failed';

  // Detect lease rejection (typical error message from git)
  if (stderr.includes('stale') || stderr.includes('lease') || stderr.includes('rejected')) {
    reason = `lease push rejected (stale remote ref or concurrent change): ${stderr.slice(0, 100)}`;
  } else if (stderr) {
    reason = `push error: ${stderr.slice(0, 100)}`;
  } else if (stdout) {
    reason = `push output: ${stdout.slice(0, 100)}`;
  }

  log(`pushRefreshedBranch failed: ${reason}`);
  return { pushed: false, reason };
}

/**
 * An earlier-stage failure (Tier 2 dispatch gave up, an acceptance guard
 * failed, or the suite gate went red) that must short-circuit
 * {@link publishResolution} BEFORE any git operation runs.
 */
export interface EarlierStageFailure {
  /** The pipeline stage that failed (e.g. "suite-gate", "acceptance-guards"). */
  stage: string;
  /** Human-readable reason, forwarded verbatim to escalation. */
  reason: string;
}

/**
 * Options for {@link publishResolution}.
 */
export interface PublishResolutionOptions {
  /** Injected git runner used for the lease push. */
  git: GitRunner;
  /** The PR branch to push. */
  branch: string;
  /** The PR being published/escalated. */
  prUrl: string;
  /** gh options forwarded to {@link escalate} and the mergeable-label restore. */
  gh: EscalateOpts;
  /**
   * When set, publishResolution short-circuits immediately: no git call is
   * made at all (zero push calls), and the flow escalates with this reason
   * instead of attempting the lease push.
   */
  earlierFailure?: EarlierStageFailure;
  /** Optional: the primary project root, forwarded to pushRefreshedBranch for watch-entry updates. */
  projectRoot?: string;
  /** Optional: the watch entry, forwarded to pushRefreshedBranch for watch-entry updates. */
  entry?: WatchEntry;
}

/**
 * Result of {@link publishResolution}.
 */
export type PublishResolutionResult =
  | { published: true }
  | { published: false; stage: string; reason: string };

/**
 * Orchestrate the final publish of a resolved PR branch: an earlier-stage
 * failure short-circuits before any git call; otherwise the branch is pushed
 * with a lease and, on success, the `mergeable` label is restored
 * (best-effort — a label-restore failure never rolls back the push and is
 * only logged, per the C3 best-effort-labels convention; the next tick's
 * normal label pass reconciles it).
 *
 * Story: "The refresh publishes with a lease and never overwrites unseen
 * work" (negative paths).
 *
 * @param opts See {@link PublishResolutionOptions}.
 */
export async function publishResolution(
  opts: PublishResolutionOptions,
): Promise<PublishResolutionResult> {
  const log = opts.gh.log ?? console.log;

  // Earlier-stage failure: short-circuit before touching git at all.
  if (opts.earlierFailure) {
    const { stage, reason } = opts.earlierFailure;
    await escalate(opts.prUrl, stage, reason, opts.gh);
    logOutcome(log, opts.prUrl, stage, 'escalated');
    return { published: false, stage, reason };
  }

  // Lease-protected push. pushRefreshedBranch issues exactly one
  // `--force-with-lease` push call and never retries or falls back to
  // bare `--force`.
  const pushResult = await pushRefreshedBranch(
    opts.git,
    opts.branch,
    opts.projectRoot,
    opts.entry,
    log,
  );

  if (!pushResult.pushed) {
    // Lease rejected (or other push failure): discard the local result,
    // escalate with the concrete reason, do not retry.
    await escalate(opts.prUrl, 'lease-push', pushResult.reason, opts.gh);
    logOutcome(log, opts.prUrl, 'lease-push', 'escalated');
    return { published: false, stage: 'lease-push', reason: pushResult.reason };
  }

  // Push succeeded: restore the `mergeable` label. This is best-effort —
  // addLabel never throws, so a gh failure here is only logged (via the
  // injected `log`) and never rolls back the push or triggers escalation.
  // The next tick's normal label pass reconciles the label if this fails.
  const runGh = opts.gh.runGh ?? makeProductionGh();
  await addLabel(runGh, opts.gh.cwd, opts.prUrl, 'mergeable', log);

  logOutcome(log, opts.prUrl, 'lease-push', 'refreshed');
  return { published: true };
}

/**
 * Options for {@link escalate}.
 */
export interface EscalateOpts {
  /** Injectable gh runner (defaults to the production factory). */
  runGh?: PrLabelsGhRunner;
  /** cwd for gh calls (typically the primary project root). */
  cwd: string;
  /** Optional log callback. All errors are logged here, never thrown. */
  log?: (msg: string) => void;
}

/**
 * Escalate a PR to a human: mark it for manual remediation with a concrete
 * reason.
 *
 * Story: "Escalation marks the PR for a human with a concrete reason"
 *
 * Steps (each best-effort, non-throwing, consistent with the pr-labels seam):
 *   1. Remove the `mergeable` label via the REST endpoint.
 *   2. Add the `needs-remediation` label via the REST endpoint.
 *   3. Upsert (post or edit-in-place) a marker-tagged comment describing the
 *      stage and reason — so repeated escalations on the same PR update a
 *      single comment rather than piling up duplicates.
 *
 * A label failure never blocks the comment attempt (step 3 always runs).
 * A comment failure never throws — upsertComment's own fallback behavior
 * (create-once-on-lookup-failure, no fallback on PATCH failure) governs
 * retry suppression; escalate does not add its own retries on top.
 *
 * @param prUrl  The PR to escalate.
 * @param stage  The pipeline stage at which escalation was triggered (e.g.
 *               "tier2-resolve", "suite-gate").
 * @param reason Human-readable reason for the escalation.
 * @param opts   { runGh, cwd, log } — runGh defaults to the production gh factory.
 */
export async function escalate(
  prUrl: string,
  stage: string,
  reason: string,
  opts: EscalateOpts,
): Promise<void> {
  const runGh = opts.runGh ?? makeProductionGh();
  const { cwd, log } = opts;

  // Step 1 + 2: labels (best-effort; removeLabel/addLabel never throw).
  await removeLabel(runGh, cwd, prUrl, 'mergeable', log);
  await addLabel(runGh, cwd, prUrl, 'needs-remediation', log);

  // Step 3: marker-tagged comment (best-effort; upsertComment never throws).
  const commentBody = [
    '## Escalation: manual remediation required',
    '',
    `**Stage:** ${stage}`,
    `**Reason:** ${reason}`,
  ].join('\n');

  await upsertComment(runGh, cwd, prUrl, NEEDS_REMEDIATION_MARKER, commentBody, log);
}

/**
 * Comprehensive orchestrator for auto-resolving open PR conflicts.
 *
 * Story: "The daemon orchestrates the full resolution pipeline" (Task 20 / FR-3-FR-16)
 *
 * Composes all primitives (worktree isolation, Tier1/Tier2 resolution, acceptance
 * guards, suite gate, lease-protected push) into a single end-to-end pipeline.
 * Deterministic + assistant-resolved conflicts both flow through the same path.
 *
 * Flow:
 *   1. Create isolated worktree at the feature branch tip (withResolveWorktree)
 *   2. Determine the base to rebase onto (resolveBase, auto-discovers origin/main)
 *   3. Capture pre-rebase feature commit subjects (for work-preservation guards)
 *   4. Start the rebase; if no conflicts → return refreshed (already current)
 *   5. Run Tier1 (deterministic CHANGELOG + .docs/ resolution)
 *   6. If conflicts remain, run Tier2 (bounded assistant dispatch via resolver)
 *   7. Run acceptance guards (rebase state, branch current, commits preserved)
 *   8. Run suite gate (full suite must pass before pushing)
 *   9. Publish with lease (--force-with-lease) or escalate on any stage failure
 *
 * Deps (injected for testability):
 *   - runGh     Callable that executes `gh` commands (labels, comments)
 *   - runSuite  Callable that runs the user's test suite command
 *   - resolver  Tier2 resolver dispatched for remaining conflicts (RebaseResolver)
 *   - log       Callback for logging outcome lines (one log per stage result)
 *
 * @returns {kind: 'refreshed'} if published successfully,
 *          {kind: 'escalated'} if any stage fails or suite fails.
 */
export async function resolveConflictingPr(
  entry: { prUrl: string; slug: string; repoCwd: string },
  branch: string,
  config: { enabled: boolean; suiteCommand: string; cooldownMinutes: number; attemptCap: number },
  deps: {
    runGh: PrLabelsGhRunner;
    runSuite: (projectRoot: string) => Promise<{ exitCode: number; durationMs: number }>;
    resolver: RebaseResolver;
    log: (msg: string) => void;
  },
): Promise<{ kind: 'refreshed' | 'escalated' }> {
  const { prUrl, slug, repoCwd } = entry;
  const { log } = deps;

  return withResolveWorktree(slug, branch, repoCwd, async (worktreePath) => {
    // Initialize a git runner for the worktree
    const git = makeGitRunner(worktreePath);

    // Determine the base to rebase onto
    const baseResolved = await resolveBase(git, 'main');
    const baseRef = baseResolved.ref;

    // Capture pre-rebase feature subjects (for work-preservation guard)
    const subjR = await git(['log', '--format=%s', `${baseRef}..HEAD`]);
    const subjectsBefore =
      subjR.exitCode === 0
        ? subjR.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
        : [];

    // Start the rebase; this will fail with conflicts if base and feature diverged
    const rebaseAttempt = await git(['rebase', '--autostash', baseRef]);
    if (rebaseAttempt.exitCode === 0) {
      // No conflicts — branch is already current or cleanly rebased
      log(`${prUrl}: rebase completed without conflicts, no resolution needed`);
      logOutcome(log, prUrl, 'rebase-clean', 'refreshed');
      return { kind: 'refreshed' };
    }

    // Check for actual conflicted files
    const conflicts = await conflictedFiles(git);
    if (conflicts.length === 0) {
      // Rebase failed but no unmerged files — treat as escalation-worthy error
      log(`${prUrl}: rebase failed without conflicts; escalating`);
      await escalate(prUrl, 'rebase-error', rebaseAttempt.stderr.trim(), {
        runGh: deps.runGh,
        cwd: repoCwd,
        log,
      });
      logOutcome(log, prUrl, 'rebase-error', 'escalated');
      return { kind: 'escalated' };
    }

    // Rebase paused with conflicts — enter resolution pipeline

    // Stage 1: Deterministic resolution (CHANGELOG + .docs/)
    const tier1Result = await runTier1(git, worktreePath);
    log(`${prUrl}: tier1 resolved ${tier1Result.resolved.length} file(s); ${tier1Result.remaining.length} remain`);

    // Stage 2: Assistant dispatch for remaining conflicts
    let tier2Outcome: RebaseOutcome | null = null;
    if (tier1Result.remaining.length > 0) {
      tier2Outcome = await runTier2(
        git,
        worktreePath,
        baseRef,
        tier1Result.remaining,
        config.attemptCap,
        deps.resolver,
      );
      log(`${prUrl}: tier2 outcome: ${tier2Outcome.kind}`);

      // If tier2 failed (unresolved conflicts), escalate immediately
      if (tier2Outcome.kind === 'conflict_halt') {
        const reason = tier2Outcome.reason || 'could not resolve remaining conflicts';
        await escalate(prUrl, 'tier2-resolve', reason, {
          runGh: deps.runGh,
          cwd: repoCwd,
          log,
        });
        logOutcome(log, prUrl, 'tier2-resolve', 'escalated');
        return { kind: 'escalated' };
      }
    }

    // Work-preservation guards: verify the rebase succeeded correctly
    const guardsResult = await runAcceptanceGuards(git, baseRef, subjectsBefore);
    if (!guardsResult.ok) {
      const reason = `${guardsResult.guard}: ${guardsResult.reason}`;
      log(`${prUrl}: acceptance guard failed: ${reason}`);
      await escalate(prUrl, 'acceptance-guards', reason, {
        runGh: deps.runGh,
        cwd: repoCwd,
        log,
      });
      logOutcome(log, prUrl, 'acceptance-guards', 'escalated');
      return { kind: 'escalated' };
    }

    // Suite gate: full test suite must pass
    // Use the injected runSuite function which may be a real suite runner or test stub
    const suiteRunResult = await deps.runSuite(worktreePath);
    const suiteOk = suiteRunResult.exitCode === 0;
    if (!suiteOk) {
      const reason = `suite exited with code ${suiteRunResult.exitCode}`;
      log(`${prUrl}: suite gate failed: ${reason}`);
      await escalate(prUrl, 'suite-gate', reason, {
        runGh: deps.runGh,
        cwd: repoCwd,
        log,
      });
      logOutcome(log, prUrl, 'suite-gate', 'escalated');
      return { kind: 'escalated' };
    }

    // All stages pass — publish the resolution with lease protection
    const publishResult = await publishResolution({
      git,
      branch,
      prUrl,
      gh: {
        runGh: deps.runGh,
        cwd: repoCwd,
        log,
      },
      projectRoot: repoCwd,
      // No earlierFailure → attempt the lease push
    });

    if (!publishResult.published) {
      // Lease push failed — already escalated by publishResolution
      return { kind: 'escalated' };
    }

    // Success
    logOutcome(log, prUrl, 'lease-push', 'refreshed');
    return { kind: 'refreshed' };
  });
}
