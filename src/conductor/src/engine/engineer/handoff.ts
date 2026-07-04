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
//
// Task 20 (TS-8, adr-2026-07-03-pr-timing-config-key): when an open DRAFT spec
// PR already exists for `branch` (e.g. opened early by `engineer checkpoint`,
// task-16), `openSpecPr` reuses it — push + `markReadyForReview` — instead of
// opening a second PR via `gh pr create`. Detection/push/mark-ready are all
// OPTIONAL injected deps (`detectDraftPr`, `push`, `markReadyForReview`); when
// absent, this module behaves exactly as before (purely additive).

import type { TargetRepo } from './target.js';
import type { AuthoredLedgerOpts } from './authored-ledger.js';
import { recordAuthoredKey } from './authored-ledger.js';
import { extractPrUrl } from '../state.js';
import { injectIssueRef } from './issue-ref.js';

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
  /**
   * The per-idea worktree path — cwd for `gh pr create` (and the issue-ref link).
   * The worktree is checked out on `spec/<slug>`, so gh pushes THAT branch and opens
   * the PR from it (FR-4). Absent → falls back to `target.canonicalPath` (legacy).
   */
  worktreePath?: string;
  /** Options forwarded to recordAuthoredKey (e.g. engineerDir for temp-dir isolation). */
  ledgerOpts?: AuthoredLedgerOpts;
  /**
   * Originating intake reference (`owner/repo#N`). When present and valid, the
   * opened spec PR gets a NON-CLOSING `Refs owner/repo#N` line (links the issue
   * without closing it). Absent/malformed → no injection. Non-fatal.
   */
  sourceRef?: string;
  /** Optional log sink for the (non-fatal) issue-ref injection. */
  log?: (msg: string) => void;
  /**
   * Task 20 (TS-8): optional detector for an ALREADY-OPEN draft spec PR for
   * `branch`. Production wiring: `gh pr list --head <branch> --state open
   * --draft --json url`, scraped for the first url. Returns `undefined` when
   * no open draft PR exists — `openSpecPr` then falls through to the
   * existing `gh pr create --head <branch> --fill` path, byte-for-byte
   * unchanged.
   *
   * ABSENT (not supplied) behaves exactly like returning `undefined` — every
   * existing call site that does not wire detection keeps today's exact
   * behavior. This field is purely additive (task-25/26 forward-compat note
   * above).
   */
  detectDraftPr?: (branch: string, cwd: string) => Promise<string | undefined>;
  /**
   * Task 20: injectable push for the reuse path. When `detectDraftPr` finds
   * an open draft PR, the branch is pushed via this runner BEFORE
   * `markReadyForReview` is invoked, so the draft's history is current when
   * it's marked ready. Only consulted when `detectDraftPr` returns a URL.
   */
  push?: (branch: string, cwd: string) => Promise<void>;
  /**
   * Task 20: injectable "mark ready for review" call for the reuse path
   * (mirrors the daemon's T14 `setReady` finish-step hook). Invoked with the
   * discovered draft PR URL. A failure here is caught and logged — non-fatal:
   * the discovered URL is STILL returned/written back (mirrors T14/T15's
   * finish-step mark-ready-failure fallback semantics for daemon parity).
   * Only consulted when `detectDraftPr` returns a URL.
   */
  markReadyForReview?: (prUrl: string, cwd: string) => Promise<void>;
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
  // gh's actual message when the repo has zero remotes (e.g. `gh pr create`
  // against a local-only repo). The phrase is "no git remotes" — note the
  // intervening "git", which the broader /no remote/i above does NOT match.
  /no git remotes? found/i,
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
  // cwd = the per-idea worktree (checked out on `spec/<slug>`) so gh pushes and opens
  // the PR from that branch. Falls back to the canonical path for legacy callers.
  const cwd = deps.worktreePath ?? target.canonicalPath;

  // 0. Task 20 (TS-8): reuse an already-open draft spec PR instead of opening
  //    a second one. Detection is fully optional/injected — when
  //    `detectDraftPr` is absent (the default for every existing call site),
  //    this block is skipped entirely and behavior is unchanged.
  if (deps.detectDraftPr) {
    const existingUrl = await deps.detectDraftPr(branch, cwd);
    if (existingUrl) {
      // Push the branch so the draft's history is current before it goes
      // ready-for-review. Advisory in the sense that a push failure does not
      // abort the reuse — mirrors the daemon's advisoryPublish semantics.
      if (deps.push) {
        await deps.push(branch, cwd);
      }
      // Mark the draft ready for review. A failure here is caught and
      // logged — non-fatal — the discovered URL is STILL written back below
      // (mirrors T14/T15's finish-step mark-ready-failure fallback).
      if (deps.markReadyForReview) {
        try {
          await deps.markReadyForReview(existingUrl, cwd);
        } catch (err) {
          deps.log?.(
            `openSpecPr: markReadyForReview failed for ${existingUrl}: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Record the (project, feature) authored key — same as the create path.
      await recordAuthoredKey(target.name, branch, ledgerOpts ?? {});

      // Link the reused PR to the originating issue, same as the create path.
      if (deps.sourceRef) {
        await injectIssueRef({
          gh: async (args, opts) => {
            const r = await runner(args, { cwd: opts.cwd });
            return { stdout: r.stdout };
          },
          prUrl: existingUrl,
          keyword: 'Refs',
          sourceRef: deps.sourceRef,
          cwd,
          log: deps.log,
        });
      }

      // Zero `gh pr create` invocations on this path — write back the SAME
      // PR URL that was discovered.
      return { kind: 'pr-opened', url: existingUrl };
    }
  }

  // 1. Invoke `gh pr create` with the spec branch in the worktree's cwd.
  //    The `--head` flag names the branch to open a PR for; `--fill` uses the
  //    branch name + last commit message as the title/body so no interaction is
  //    required.
  let result: RunnerResult;
  try {
    result = await runner(['pr', 'create', '--head', branch, '--fill'], {
      cwd,
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

  // 3b. Link the spec PR to the originating issue with a NON-CLOSING `Refs` line
  //     (the issue must NOT close when the spec merges — only when the daemon's
  //     implementation PR merges). Idempotent + non-fatal: a gh failure here
  //     never discards the delivered PR.
  if (deps.sourceRef) {
    await injectIssueRef({
      gh: async (args, opts) => {
        const r = await runner(args, { cwd: opts.cwd });
        return { stdout: r.stdout };
      },
      prUrl: url,
      keyword: 'Refs',
      sourceRef: deps.sourceRef,
      cwd,
      log: deps.log,
    });
  }

  // 4. Return the URL wrapped in the discriminated result.
  return { kind: 'pr-opened', url };
}
