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
import {
  logOutcome,
  isResolutionInFlight,
  withResolveWorktree,
  runAcceptanceGuards,
  runSuiteGate,
  pushRefreshedBranch,
} from './autoresolve.js';
import { makeGitRunner } from './rebase.js';
import { execa } from 'execa';

/**
 * Classify a ci-fix resolver error into a coarse category so logs and
 * escalation paths can distinguish "the CLI flag is wrong" from "we're
 * not authenticated" from "the binary isn't spawnable" from anything else.
 *
 * Inspects the error's message plus execa-style fields (`.stderr`,
 * `.shortMessage`) since spawn failures often carry the useful text there
 * rather than in `.message`.
 */
export function classifyFixError(err: unknown): 'flag-invalid' | 'auth' | 'spawn-env' | 'unknown' {
  const parts: string[] = [];
  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.message === 'string') parts.push(anyErr.message);
    if (typeof anyErr.shortMessage === 'string') parts.push(anyErr.shortMessage);
    if (typeof anyErr.stderr === 'string') parts.push(anyErr.stderr);
  } else if (typeof err === 'string') {
    parts.push(err);
  }
  const text = parts.join(' ').toLowerCase();

  if (/enoent|spawn .*(enoent|failed)|spawnfile/.test(text)) {
    return 'spawn-env';
  }
  if (/unknown option|unrecognized option|unknown flag|unrecognized flag|invalid option/.test(text)) {
    return 'flag-invalid';
  }
  if (/\b401\b|not authenticated|unauthorized|authentication failed|auth failed/.test(text)) {
    return 'auth';
  }
  return 'unknown';
}

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
 * Injected fix-runner seam (pattern: {@link RebaseResolver} in rebase.ts).
 *
 * Story: TR-4 happy (fix run driven with RETRY hint)
 *
 * Task 18: `runCiFix` invokes this seam inside the isolated worktree created by
 * Task 17, passing the worktree path, the RETRY hint (Task 16), and the watch
 * entry. The runner's result becomes the dispatch outcome.
 */
export interface CiFixRunner {
  run(opts: {
    worktreePath: string;
    hint: string;
    entry: WatchEntry;
    dispatcher?: CiFixDispatcher;
  }): Promise<CiFixOutcome>;
}

/**
 * StepRunner-backed dispatcher seam for {@link productionCiFixRunner}.
 * Mirrors `DefaultStepRunner.resolveCiFailure`'s role (T2,
 * src/engine/step-runners.ts) but is expressed in `CiFixRunner`'s own
 * ctx/outcome shape so `productionCiFixRunner` doesn't need to know about
 * `DefaultStepRunner` construction — callers (e.g. daemon-cli.ts) adapt a
 * real `DefaultStepRunner` into this shape at the call site.
 */
export interface CiFixDispatcher {
  resolveCiFailure(ctx: {
    worktreePath: string;
    hint: string;
    entry: WatchEntry;
  }): Promise<CiFixOutcome>;
}

/**
 * Production {@link CiFixRunner}: delegates to an injected StepRunner-backed
 * dispatcher (see {@link CiFixDispatcher}) instead of shelling out to a
 * fictional "fix session" CLI flag that never existed (CF-1).
 * Guarded by the AI_CONDUCTOR_NO_REAL_EXEC kill-switch (used in tests/dry-run
 * to avoid dispatching real fix sessions) — when set, it short-circuits to a
 * no-op outcome without invoking the dispatcher.
 */
export const productionCiFixRunner: CiFixRunner = {
  async run({ worktreePath, hint, entry, dispatcher }): Promise<CiFixOutcome> {
    if (process.env.AI_CONDUCTOR_NO_REAL_EXEC) {
      return { kind: 'noop' };
    }

    if (!dispatcher) {
      throw new Error(
        'productionCiFixRunner.run requires an injected dispatcher (StepRunner-backed ' +
          'resolveCiFailure seam) — see daemon-cli.ts ciFix dispatch wiring.',
      );
    }

    return dispatcher.resolveCiFailure({ worktreePath, hint, entry });
  },
};

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
 * Task 19: once the fix-runner reports a `changed` outcome, the resolver
 * chains the same work-preservation guards and suite gate used by the
 * sweep's rebase-resolution pipeline ({@link runAcceptanceGuards},
 * {@link runSuiteGate}) before publishing with a lease-protected push
 * ({@link pushRefreshedBranch}). Any stage failure (lost commits, a red
 * suite) skips the push and logs an `escalated` outcome — the fix-runner's
 * outcome (`changed`) is still returned so the caller's attempt bookkeeping
 * treats this as a consumed attempt, not a retry.
 *
 * @param deps Dependencies for the fix execution
 * @param deps.fixRunner The injected {@link CiFixRunner} seam
 * @param deps.suiteCommand Optional suite command forwarded to {@link runSuiteGate}.
 *                           Undefined/empty → suite gate is a noop pass.
 * @param logger Optional logging function for abort/error messages
 * @returns CiFixOutcome describing the result
 */
export async function runCiFix(
  entry: WatchEntry,
  branch: string,
  hint: string,
  deps: {
    fixRunner: CiFixRunner;
    suiteCommand?: string;
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
      const git = makeGitRunner(worktreePath);

      // Ensure a local branch named `branch` is checked out, regardless of
      // whether the worktree was created from a local ref or a detached
      // `origin/<branch>` ref — pushRefreshedBranch pushes `branch` by name.
      await git(['checkout', '-B', branch]);

      // Capture the pre-fix commit subjects for the work-preservation guard
      // (Task 19). baseRef is the parent of the branch tip before the
      // fix-runner ran; if there is no parent (root commit), fall back to
      // HEAD itself — an empty subjectsBefore list makes the guard trivially
      // pass, per featureCommitsPreserved's own empty-array short-circuit.
      const parentResult = await git(['rev-parse', 'HEAD~1']);
      const baseRef = parentResult.exitCode === 0 ? parentResult.stdout.trim() : 'HEAD';
      const subjectsBefore: string[] = [];
      if (parentResult.exitCode === 0) {
        const subjResult = await git(['log', '--format=%s', `${baseRef}..HEAD`]);
        if (subjResult.exitCode === 0) {
          subjectsBefore.push(
            ...subjResult.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0),
          );
        }
      }

      // Run the fix-runner seam inside the worktree, propagating its result
      // as the dispatch outcome (Task 18).
      const fixOutcome = await deps.fixRunner.run({ worktreePath, hint, entry });

      if (fixOutcome.kind !== 'changed') {
        return fixOutcome;
      }

      // Task 19: guards + suite gate before push.
      const guardsResult = await runAcceptanceGuards(git, baseRef, subjectsBefore);
      if (!guardsResult.ok) {
        const reason = `${guardsResult.guard}: ${guardsResult.reason}`;
        log(`${prUrl}: ci-fix acceptance guard failed: ${reason}`);
        logOutcome(log, prUrl, 'ci-fix-acceptance-guards', 'escalated');
        return fixOutcome;
      }

      const suiteResult = await runSuiteGate(deps.suiteCommand, worktreePath, log);
      if (!suiteResult.ok) {
        log(`${prUrl}: ci-fix suite gate failed`);
        logOutcome(log, prUrl, 'ci-fix-suite-gate', 'escalated');
        return fixOutcome;
      }

      const pushResult = await pushRefreshedBranch(git, branch, log);
      if (!pushResult.pushed) {
        log(`${prUrl}: ci-fix lease push failed: ${pushResult.reason}`);
        logOutcome(log, prUrl, 'ci-fix-lease-push', 'escalated');
        return fixOutcome;
      }

      logOutcome(log, prUrl, 'ci-fix-lease-push', 'refreshed');
      return fixOutcome;
    });

    return outcome;
  } catch (err) {
    // Any unhandled error in worktree setup gets logged but re-thrown
    const tag = classifyFixError(err);
    const message = err instanceof Error ? err.message : String(err);
    log(`${prUrl}: unexpected error in ci-fix resolver [${tag}]: ${message}`);
    throw err;
  }
}

/**
 * Result of {@link preflightCiFixInvocation}.
 */
export interface CiFixPreflightResult {
  ok: boolean;
  reason?: string;
}

/**
 * Default probe for {@link preflightCiFixInvocation}: a cheap, no-model-round-trip
 * check that the `claude` binary is spawnable and responds to `--version`. This
 * intentionally never starts a real fix session — it's meant to catch the "the
 * daemon host has no claude binary / no auth / a stale flag" class of failure
 * once at startup, not on every per-PR dispatch.
 */
export async function defaultCiFixProbe(): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  try {
    const result = await execa('claude', ['--version'], { reject: false });
    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: '', stderr: message };
  }
}

/**
 * CF-5/CF-6 (intake #666): startup preflight for the ci-fix resolver's
 * fix-invocation surface (the `claude` CLI ci-fix relies on). Runs a cheap
 * capability/dry probe (see {@link defaultCiFixProbe}) exactly once —
 * no model round-trip — so the daemon can disable ci-fix for the run and log
 * a diagnosable reason instead of crashing or silently retrying a broken
 * invocation on every PR.
 *
 * Never throws: a rejecting probe is caught and reported as
 * `{ ok: false, reason }` just like a non-zero exit code, so callers (see
 * daemon-cli.ts startup wiring) can safely `await` this without a try/catch.
 *
 * @param opts.probe Injectable probe seam (tests stub this; production wiring
 *                     passes {@link defaultCiFixProbe}).
 */
export async function preflightCiFixInvocation(opts: {
  probe: () => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}): Promise<CiFixPreflightResult> {
  let result: { exitCode: number; stdout: string; stderr: string };
  try {
    result = await opts.probe();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const tag = classifyFixError(err);
    return { ok: false, reason: `ci-fix preflight probe threw [${tag}]: ${message}` };
  }

  if (result.exitCode === 0) {
    return { ok: true };
  }

  const err = new Error(result.stderr || `probe exited with code ${result.exitCode}`);
  const tag = classifyFixError(err);
  const reason =
    `ci-fix preflight probe failed [${tag}] (exit ${result.exitCode}): ` +
    `${result.stderr || result.stdout || '(no output)'}`;
  return { ok: false, reason };
}
