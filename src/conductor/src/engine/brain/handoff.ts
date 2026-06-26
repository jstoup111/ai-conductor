// handoff.ts — spec PR opener (Task 24, FR-7).
//
// `openSpecPr(target, branch, deps)`:
//   1. Invokes the INJECTED runner with `gh pr create` args, cwd = target.canonicalPath.
//   2. Scrapes the PR URL from the runner's stdout using `extractPrUrl` from state.ts.
//   3. Records the (project, feature) authored key via `recordAuthoredKey`.
//   4. Returns the URL to the caller.
//
// All external I/O (gh invocation, ledger writes) is injected via `HandoffDeps` so
// tests run without real network or subprocess calls.
//
// Future tasks (task-25 no-remote fallback, task-26 assert-no-merge) will extend
// HandoffDeps and openSpecPr without rewriting this module — keep exports stable.

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
  /** Options forwarded to recordAuthoredKey (e.g. brainDir for temp-dir isolation). */
  ledgerOpts?: AuthoredLedgerOpts;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Open a spec PR in the TARGET repo for the given spec branch.
 *
 * @param target - The resolved target repo (name + canonicalPath).
 * @param branch - The spec branch name (e.g. "spec/add-auth"). Used as the
 *                 `feature` key in the authored ledger.
 * @param deps   - Injected dependencies (runner, ledgerOpts).
 * @returns      The PR URL scraped from the runner's stdout.
 * @throws       When the runner stdout contains no URL (never silently discards).
 */
export async function openSpecPr(
  target: TargetRepo,
  branch: string,
  deps: HandoffDeps,
): Promise<string> {
  const { runner, ledgerOpts } = deps;

  // 1. Invoke `gh pr create` with the spec branch in the target repo's cwd.
  //    The `--head` flag names the branch to open a PR for; `--fill` uses the
  //    branch name + last commit message as the title/body so no interaction is
  //    required. Additional flags (--base, --title, --body) may be added by
  //    task-25/26 extensions via HandoffDeps without changing this signature.
  const result = await runner(['pr', 'create', '--head', branch, '--fill'], {
    cwd: target.canonicalPath,
  });

  // 2. Scrape the PR URL from stdout via the shared extractPrUrl helper.
  const url = extractPrUrl(result.stdout);
  if (!url) {
    throw new Error(
      `openSpecPr: no PR URL found in runner stdout for branch "${branch}" in "${target.canonicalPath}". ` +
        `stdout was: ${JSON.stringify(result.stdout)}`,
    );
  }

  // 3. Record the (project, feature) authored key durably.
  //    The `feature` is the spec branch name — consistent with how the brain's
  //    authored ledger identifies authoring events (one branch = one feature spec).
  await recordAuthoredKey(target.name, branch, ledgerOpts ?? {});

  // 4. Return the URL to the caller.
  return url;
}
