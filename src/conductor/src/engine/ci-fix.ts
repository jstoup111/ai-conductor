/**
 * CI fix eligibility, hint builder, and resolver for failed check remediation.
 *
 * Provides:
 * - `buildCiFixHint`: Prepares required failure context from a selected PR snapshot
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
  pushRefreshedBranch,
  type ResolveWorktreeLiveness,
} from './autoresolve.js';
import { makeGitRunner } from './rebase.js';
import { execa } from 'execa';
import { dispatchTestSuiteCommand } from './test-suite-cli.js';

export const CI_FIX_HINT_MAX_BYTES = 24_576;
export const CI_FIX_METADATA_MAX_BYTES = 12_288;
export const CI_FIX_MAX_FAILED_ENTRIES = 64;
export const CI_FIX_LOG_TIMEOUT_MS = 10_000;
export const CI_FIX_LOG_MAX_BUFFER = 65_536;

function truncateUtf8(value: string, maxBytes: number, marker = '[truncated]'): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const limit = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
  let result = '';
  for (const char of value) {
    if (Buffer.byteLength(result + char, 'utf8') > limit) break;
    result += char;
  }
  return result + marker;
}

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
 * Required CI failure context prepared from the same snapshot that selected a
 * PR for repair. Optional log enrichment is deliberately owned by Task 3.
 */
export type CiFixHintResult =
  | { kind: 'ready'; hint: string }
  | {
    kind: 'context-error';
    reason: 'read-failure' | 'malformed-context' | 'empty-failure-context';
  };

const FAILED_CHECK_RUN_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'STALE',
]);
const FAILED_EXTERNAL_STATUS_STATES = new Set(['FAILURE', 'ERROR']);

function checkDisplayName(check: NonNullable<PrMergeState['statusCheckRollup']>[number], index: number): string {
  return check.name?.trim() || check.context?.trim() || `(unnamed check #${index + 1})`;
}

function isFailedCheck(check: NonNullable<PrMergeState['statusCheckRollup']>[number]): boolean {
  if (check.kind === 'status-context') {
    return FAILED_EXTERNAL_STATUS_STATES.has((check.state ?? '').toUpperCase());
  }
  return FAILED_CHECK_RUN_CONCLUSIONS.has((check.conclusion ?? '').toUpperCase());
}

/**
 * Prepare a hint from a selected PR state. The legacy overload exists only so
 * Task 11 can replace the old daemon callback without changing this task's
 * file scope; it performs no independent GitHub listing.
 */
export function buildCiFixHint(prState: PrMergeState): CiFixHintResult;
export function buildCiFixHint(legacyGh: GhRunner, cwd: string, prUrl: string): string;
export function buildCiFixHint(
  prStateOrLegacyGh: PrMergeState | GhRunner,
  _cwd?: string,
  _prUrl?: string,
): CiFixHintResult | string {
  if (typeof prStateOrLegacyGh === 'function') {
    return 'CI repair context unavailable: selected PR state is required.';
  }

  const prState = prStateOrLegacyGh;
  if (prState.readFailure) {
    return { kind: 'context-error', reason: 'read-failure' };
  }
  if (prState.contextFailure) {
    return { kind: 'context-error', reason: 'malformed-context' };
  }

  const failedChecks = (prState.statusCheckRollup ?? [])
    .map((check, index) => ({ check, index }))
    .filter(({ check }) => isFailedCheck(check));
  if (failedChecks.length === 0) {
    return { kind: 'context-error', reason: 'empty-failure-context' };
  }

  const lines = ['CI checks failed:'];
  let omitted = 0;
  for (const { check, index } of failedChecks.slice(0, CI_FIX_MAX_FAILED_ENTRIES)) {
    const name = checkDisplayName(check, index);
    const boundedName = truncateUtf8(name, 256);
    lines.push(`\n• ${boundedName}`);
    const link = check.kind === 'status-context' ? check.targetUrl : check.detailsUrl;
    if (link && Buffer.byteLength(link, 'utf8') <= 2048) lines.push(`  ${link}`);
    else if (link) lines.push('  [link omitted: too long]');
    if (Buffer.byteLength(lines.join('\n'), 'utf8') > CI_FIX_METADATA_MAX_BYTES) {
      lines.pop();
      omitted += 1;
      break;
    }
  }
  omitted += Math.max(0, failedChecks.length - CI_FIX_MAX_FAILED_ENTRIES);
  if (omitted) lines.push(`\n[${omitted} failed check entries omitted]`);
  return { kind: 'ready', hint: lines.join('\n') };
}

export interface CiFixHintEnrichment {
  hint: string;
  degradations: Array<'log-unavailable' | 'context-truncated'>;
}

/** Optional workflow-log enrichment. Required check context is prepared first,
 * so any log failure is degradable rather than a reason to start blindly. */
export async function enrichCiFixHint(
  hint: string,
  state: PrMergeState,
  runGh: GhRunner,
  cwd: string,
): Promise<CiFixHintEnrichment> {
  const runKeys = new Set<string>();
  for (const check of state.statusCheckRollup ?? []) {
    const url = check.kind === 'status-context' ? check.targetUrl : check.detailsUrl;
    const match = url?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/|$)/);
    if (match) runKeys.add(`${match[1]}#${match[2]}`);
  }
  const excerpts: string[] = [];
  const degradations: CiFixHintEnrichment['degradations'] = [];
  for (const key of [...runKeys].slice(0, 3)) {
    const [repo, run] = key.split('#');
    try {
      const { stdout } = await runGh(['run', 'view', run, '--repo', repo, '--log-failed'], {
        cwd, timeout: CI_FIX_LOG_TIMEOUT_MS, maxBuffer: CI_FIX_LOG_MAX_BUFFER,
      });
      const excerpt = Buffer.from(stdout, 'utf8').subarray(0, 12_288).toString('utf8');
      if (excerpt) excerpts.push(`\nWorkflow run ${run} log excerpt:\n${excerpt}`);
    } catch {
      degradations.push('log-unavailable');
    }
  }
  let combined = `${hint}${excerpts.join('')}`;
  if (Buffer.byteLength(combined, 'utf8') > CI_FIX_HINT_MAX_BYTES) {
    combined = `${truncateUtf8(combined, CI_FIX_HINT_MAX_BYTES - 28, '')}\n[context truncated]`;
    degradations.push('context-truncated');
  }
  return { hint: combined, degradations: [...new Set(degradations)] };
}

/**
 * Check statuses/conclusions that are NOT terminal — the run is queued, waiting,
 * or still executing, so its outcome is not yet known. Everything else that
 * carries a conclusion (`SUCCESS`, `FAILURE`, `CANCELLED`, `TIMED_OUT`,
 * `SKIPPED`, `NEUTRAL`, …) has finished and will not change.
 */
const NON_TERMINAL_CHECK_STATES = new Set([
  'QUEUED',
  'IN_PROGRESS',
  'PENDING',
  'WAITING',
  'REQUESTED',
  'EXPECTED',
]);

/**
 * Names of the rollup entries that have not reached a terminal state.
 *
 * A check is non-terminal when its `status`, `conclusion`, or reported `state`
 * is queued/running. It is also non-terminal when it carries neither a
 * conclusion nor a reported state — the same "still running" signal
 * `pr-labels.ts#isCheckFailingOrPending` uses.
 *
 * An absent/empty rollup yields an empty list: no rollup detail is no evidence
 * of a running check, so the caller's gate must not block on it.
 */
export function nonTerminalCheckNames(
  rollup?: Array<{
    status?: string | null;
    conclusion?: string | null;
    state?: string | null;
    name?: string;
    context?: string;
  }> | null,
): string[] {
  if (!rollup || rollup.length === 0) return [];
  return rollup
    .filter((check) => {
      const status = (check.status ?? '').toUpperCase();
      const conclusion = (check.conclusion ?? '').toUpperCase();
      const state = (check.state ?? '').toUpperCase();
      if (NON_TERMINAL_CHECK_STATES.has(status)) return true;
      if (NON_TERMINAL_CHECK_STATES.has(conclusion)) return true;
      if (NON_TERMINAL_CHECK_STATES.has(state)) return true;
      // No conclusion or reported state recorded yet → the run has not finished.
      return conclusion.length === 0 && state.length === 0;
    })
    .map((check) => check.name?.trim() || check.context?.trim() || '(unnamed check)');
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
 *   4. Every check in the rollup has reached a terminal state (no queued/running check)
 *   5. No resolution in flight (shared serial guard)
 *   6. Cooldown elapsed since last CI fix attempt
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

  // Gate 4: every check has reached a terminal state.
  // A rollup classifies as `failed` as soon as ONE check fails, even while its
  // siblings are still queued or running. Remediating then acts on incomplete
  // results: the RETRY hint can only name the checks that already finished, and
  // a run that is about to fail seconds later is invisible to the fix session —
  // burning an attempt on a partial picture. Defer instead; the next sweep tick
  // re-reads the PR and dispatches once every check is terminal. No counter is
  // burned, because the sweep bumps `ciFixAttempts` only after this gate passes.
  const nonTerminal = nonTerminalCheckNames(prState.statusCheckRollup);
  if (nonTerminal.length > 0) {
    const shown = nonTerminal.slice(0, 3).join(', ');
    const overflow = nonTerminal.length > 3 ? ` +${nonTerminal.length - 3} more` : '';
    return {
      eligible: false,
      reason: `CI checks not finished: ${shown}${overflow} (checks-not-terminal)`,
    };
  }

  // Gate 5: Shared serial guard (Task 14)
  // Task 14: any resolution in flight → defer without counter burn (serial)
  if (isResolutionInFlight()) {
    return {
      eligible: false,
      reason: `resolution already in flight for another PR; serial guard`,
    };
  }

  // Gate 6: Cooldown elapsed (Task 14)
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
export type CiFixOutcome =
  | { kind: 'not-started' }
  | { kind: 'noop' }
  | { kind: 'failed'; stage: 'provider' | 'guard' | 'verification' | 'publication' | 'worktree' }
  | { kind: 'published' }
  | { kind: 'branch-gone' };

/** Internal result emitted by the provider-session boundary. */
export type CiFixSessionOutcome =
  | { kind: 'not-started' }
  | { kind: 'failed' }
  | { kind: 'session-completed' }
  /** @deprecated compatibility for existing injected seams; treated as completed. */
  | { kind: 'changed' }
  /** @deprecated compatibility for existing injected seams; treated as no-start. */
  | { kind: 'noop' };

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
  }): Promise<CiFixSessionOutcome>;
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
  }): Promise<CiFixSessionOutcome>;
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
  async run({ worktreePath, hint, entry, dispatcher }): Promise<CiFixSessionOutcome> {
    if (process.env.AI_CONDUCTOR_NO_REAL_EXEC) {
      return { kind: 'not-started' };
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
 * @param deps.verify Optional test seam for the engine-owned configured verifier.
 *                    Production reads test_suite from the repair worktree and fails closed.
 * @param deps.liveness Optional dispatcher-owned liveness seam forwarded to
 *                      {@link withResolveWorktree}: `worktreeLifecycle`
 *                      single-flights the transient worktree add/remove through
 *                      the one lifecycle queue, and `isFeatureInFlight` refuses
 *                      removal while the slug holds an active work claim.
 * @param logger Optional logging function for abort/error messages
 * @returns CiFixOutcome describing the result
 */
export async function runCiFix(
  entry: WatchEntry,
  branch: string,
  hint: string,
  deps: {
    fixRunner: CiFixRunner;
    verify?: (worktreePath: string) => Promise<number>;
    liveness?: ResolveWorktreeLiveness;
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

      const beforeHead = await git(['rev-parse', 'HEAD']);
      if (beforeHead.exitCode !== 0) return { kind: 'failed', stage: 'worktree' };

      // Run the provider session inside the worktree. A completed session is
      // only a candidate repair; the committed HEAD check below is authoritative.
      const fixOutcome = await deps.fixRunner.run({ worktreePath, hint, entry });

      if (fixOutcome.kind === 'not-started' || fixOutcome.kind === 'noop') return { kind: 'not-started' };
      if (fixOutcome.kind === 'failed') return { kind: 'failed', stage: 'provider' };

      const afterHead = await git(['rev-parse', 'HEAD']);
      if (afterHead.exitCode !== 0) return { kind: 'failed', stage: 'worktree' };
      if (afterHead.stdout.trim() === beforeHead.stdout.trim()) {
        return { kind: 'noop' };
      }

      // Task 19: guards + suite gate before push.
      const guardsResult = await runAcceptanceGuards(git, baseRef, subjectsBefore);
      if (!guardsResult.ok) {
        const reason = `${guardsResult.guard}: ${guardsResult.reason}`;
        log(`${prUrl}: ci-fix acceptance guard failed: ${reason}`);
        logOutcome(log, prUrl, 'ci-fix-acceptance-guards', 'escalated');
        return { kind: 'failed', stage: 'guard' };
      }

      const verify = deps.verify ?? ((projectRoot: string) =>
        dispatchTestSuiteCommand({ kind: 'run' }, { projectRoot, print: log }));
      let suiteExitCode: number;
      try {
        suiteExitCode = await verify(worktreePath);
      } catch {
        return { kind: 'failed', stage: 'verification' };
      }
      if (suiteExitCode !== 0) {
        log(`${prUrl}: ci-fix suite gate failed`);
        logOutcome(log, prUrl, 'ci-fix-suite-gate', 'escalated');
        return { kind: 'failed', stage: 'verification' };
      }

      const pushResult = await pushRefreshedBranch(git, branch, log);
      if (!pushResult.pushed) {
        log(`${prUrl}: ci-fix lease push failed: ${pushResult.reason}`);
        logOutcome(log, prUrl, 'ci-fix-lease-push', 'escalated');
        return { kind: 'failed', stage: 'publication' };
      }

      logOutcome(log, prUrl, 'ci-fix-lease-push', 'refreshed');
      return { kind: 'published' };
    }, undefined, deps.liveness ?? {});

    return outcome as CiFixOutcome;
  } catch (err) {
    // Worktree failures are conservative and never become a refund.
    const tag = classifyFixError(err);
    const message = err instanceof Error ? err.message : String(err);
    log(`${prUrl}: unexpected error in ci-fix resolver [${tag}]: ${message}`);
    return { kind: 'failed', stage: 'worktree' };
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
