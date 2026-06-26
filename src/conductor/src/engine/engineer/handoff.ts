// handoff.ts — spec PR opener (Task 24 + 25, FR-7).
//
// `openSpecPr(target, branch, deps)`:
//   1. Invokes the INJECTED runner with `gh pr create` args, cwd = target.canonicalPath.
//   2. Detects the no-remote condition (runner rejects with a no-remote error message)
//      and returns a non-fatal `{ kind: 'pr-skipped'; reason }` result rather than
//      propagating the exception. The authored key IS recorded on skip (authoring
//      happened; flywheel-trend.ts counts it in the learning trajectory).
//   3. On success, scrapes the PR URL from the runner's stdout using `extractPrUrl`.
//   4. Records the (project, feature) authored key via `recordAuthoredKey`.
//   5. Returns `{ kind: 'pr-opened'; url }` to the caller.
//
// CONTRACT — discriminated result type (introduced by task-25):
//
//   { kind: 'pr-opened'; url: string }   — PR successfully opened; url is the GitHub URL.
//   { kind: 'pr-skipped'; reason: string } — No remote / no GitHub configured;
//                                             spec is committed on its branch (work preserved);
//                                             authored key IS recorded for flywheel tracking.
//
// ALL external I/O (gh invocation, ledger writes) is injected via `HandoffDeps` so
// tests run without real network or subprocess calls.
//
// Future tasks (task-26 assert-no-merge) will extend HandoffDeps and add assertions
// without rewriting this module — keep exports stable.

import type { TargetRepo } from './target.js';
import type { AuthoredLedgerOpts } from './authored-ledger.js';
import { recordAuthoredKey } from './authored-ledger.js';
import { extractPrUrl } from '../state.js';

// ─── Public types ──────────────────────────────────────────────────────────────

/**
 * Result of a single runner invocation.
 */
export interface RunnerResult {
  stdout: string;
  stderr: string;
}

/**
 * Options passed to the injectable runner alongside the command args.
 */
export interface RunnerOpts {
  /** Working directory for the command. */
  cwd?: string;
}

/**
 * Injectable command runner — wraps `gh` (or any CLI) so tests can supply a fake.
 * Production implementations may call `execFile('gh', args, { cwd })`.
 */
export type CommandRunner = (args: string[], opts?: RunnerOpts) => Promise<RunnerResult>;

/**
 * Dependency bag for `openSpecPr`.
 * Designed for forward-compatibility: task-25/26 may add optional fields without
 * breaking existing call sites that only supply `runner` and `ledgerOpts`.
 */
export interface HandoffDeps {
  /** Injectable gh/CLI runner. Tests supply a fake; production wraps execFile. */
  runner: CommandRunner;
  /** Options forwarded to recordAuthoredKey (e.g. engineerDir for temp-dir isolation). */
  ledgerOpts?: AuthoredLedgerOpts;
}

// ─── Result types (discriminated union) ───────────────────────────────────────

/**
 * Successful PR-opened result.
 * The `url` is scraped from the runner's stdout via `extractPrUrl`.
 */
export interface PrOpenedResult {
  kind: 'pr-opened';
  /** The GitHub PR URL (e.g. "https://github.com/acme/proj/pull/42"). */
  url: string;
}

/**
 * Non-fatal PR-skipped result: the target repo had no remote / no GitHub configured.
 *
 * The spec is committed on its branch (work is preserved).
 * The authored key IS recorded — authoring happened even without a PR, and the
 * flywheel-trend.ts intersection (store signals ∩ authored-keys ledger) must count it.
 */
export interface PrSkippedResult {
  kind: 'pr-skipped';
  /** Human-readable explanation, e.g. "no remote: <original error message>". */
  reason: string;
}

/** Discriminated union returned by `openSpecPr`. Callers must narrow on `kind`. */
export type OpenSpecPrResult = PrOpenedResult | PrSkippedResult;

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * No-remote error patterns from `gh` and `git`.
 * These indicate the target repo has no remote configured — not a transient
 * network failure — so we can safely return a non-fatal skip result.
 *
 * Matched case-insensitively against the thrown error message.
 */
const NO_REMOTE_PATTERNS: RegExp[] = [
  /no remote/i,
  /does not have any remotes/i,
  /no configured remote/i,
];

/**
 * Return true if the caught error message indicates "no remote configured" — a
 * permanent local-repo condition that should produce a non-fatal skip rather than
 * a hard failure.
 */
function isNoRemoteError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return NO_REMOTE_PATTERNS.some((pattern) => pattern.test(message));
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Open a spec PR in the TARGET repo for the given spec branch.
 *
 * @param target - The resolved target repo (name + canonicalPath).
 * @param branch - The spec branch name (e.g. "spec/add-auth"). Used as the
 *                 `feature` key in the authored ledger.
 * @param deps   - Injected dependencies (runner, ledgerOpts).
 * @returns      `{ kind: 'pr-opened'; url }` on success, or
 *               `{ kind: 'pr-skipped'; reason }` when the repo has no remote.
 * @throws       For any runner error that is NOT a no-remote condition (e.g.
 *               network timeout, auth failure). Also throws when the runner
 *               stdout contains no URL (never silently discards on success path).
 */
export async function openSpecPr(
  target: TargetRepo,
  branch: string,
  deps: HandoffDeps,
): Promise<OpenSpecPrResult> {
  const { runner, ledgerOpts } = deps;

  // 1. Invoke `gh pr create` with the spec branch in the target repo's cwd.
  //    The `--head` flag names the branch to open a PR for; `--fill` uses the
  //    branch name + last commit message as the title/body so no interaction is
  //    required.
  let result: RunnerResult;
  try {
    result = await runner(['pr', 'create', '--head', branch, '--fill'], {
      cwd: target.canonicalPath,
    });
  } catch (err) {
    // 1a. Detect the no-remote condition: the runner rejected with an error whose
    //     message matches one of the NO_REMOTE_PATTERNS above.
    if (isNoRemoteError(err)) {
      // Work is preserved on the spec branch. Record the authored key so the
      // flywheel trend still counts this authoring event, then return non-fatal.
      await recordAuthoredKey(target.name, branch, ledgerOpts ?? {});
      return {
        kind: 'pr-skipped',
        reason: `no remote: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    // 1b. Any other runner error (network timeout, auth, etc.) is a hard failure —
    //     re-throw so the engineer loop can surface it.
    throw err;
  }

  // 2. Scrape the PR URL from stdout via the shared extractPrUrl helper.
  const url = extractPrUrl(result.stdout);
  if (!url) {
    throw new Error(
      `openSpecPr: no PR URL found in runner stdout for branch "${branch}" in "${target.canonicalPath}". ` +
        `stdout was: ${JSON.stringify(result.stdout)}`,
    );
  }

  // 3. Record the (project, feature) authored key durably.
  //    The `feature` is the spec branch name — consistent with how the engineer's
  //    authored ledger identifies authoring events (one branch = one feature spec).
  await recordAuthoredKey(target.name, branch, ledgerOpts ?? {});

  // 4. Return the URL wrapped in the discriminated result.
  return { kind: 'pr-opened', url };
}
