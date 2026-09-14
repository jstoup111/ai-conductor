// handoff.ts — spec PR opener (Task 24 + 25, FR-7).
//
// `openSpecPr(target, branch, deps)`:
//   1. Refuses remote publication without guarded publication dependencies.
//   2. Authorizes and pushes the branch, then creates the PR through those
//      guarded dependencies.
//   3. Records the (project, feature) authored key only after the PR exists.
//   4. Returns `{ kind: 'pr-opened'; url }` to the caller.
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
import { injectIssueRef } from './issue-ref.js';
import { buildSpecPrCreateArgs, ensureReleaseMetadata } from './release-metadata-inject.js';
import { mirrorIssueCriticalityLabels } from '../pr-criticality-labels.js';
import type { GitRunner } from '../pr-labels.js';
import {
  executeGithubOperation,
  type GithubOperationRunner,
  type GithubOperationRefusalReason,
} from '../github-operations.js';
import { executeRemoteGit, type RemoteGitOperationDependencies } from '../remote-git-operations.js';

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
  /** Injectable git runner used to publish the spec branch before opening its PR. */
  gitRunner?: GitRunner;
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
 * The guarded initial-publication composition. Absent composition is a typed
 * refusal; it can never fall back to raw GitHub or Git transports.
   */
  publication?: {
    readonly remote: RemoteGitOperationDependencies;
    readonly operations: GithubOperationRunner;
    readonly repository: string;
  };
}

// ─── Result types (discriminated union) ───────────────────────────────────────

/**
 * Successful PR-opened result.
 * The URL comes from the guarded create result, or a read through the injected
 * runner when that result cannot identify the created pull request.
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

/** A policy denial is terminal for this handoff, but preserves local authoring work. */
export interface PrRefusedResult {
  kind: 'pr-refused';
  reason: GithubOperationRefusalReason;
}

/** Discriminated union returned by `openSpecPr`. Callers must narrow on `kind`. */
export type OpenSpecPrResult = PrOpenedResult | PrSkippedResult | PrRefusedResult;

// ─── Internal helpers ──────────────────────────────────────────────────────────

function createPayload(branch: string, args: readonly string[]): { title: string; body: string } {
  const titleIndex = args.indexOf('--title');
  const bodyIndex = args.indexOf('--body');
  return {
    title: titleIndex >= 0 && typeof args[titleIndex + 1] === 'string' ? args[titleIndex + 1]! : branch,
    body: bodyIndex >= 0 && typeof args[bodyIndex + 1] === 'string' ? args[bodyIndex + 1]! : '',
  };
}

async function readCreatedPrUrl(
  runner: CommandRunner,
  branch: string,
  cwd: string,
): Promise<string | undefined> {
  const response = await runner(['pr', 'view', branch, '--json', 'url'], { cwd });
  try {
    const url = (JSON.parse(response.stdout || '{}') as { url?: unknown }).url;
    return typeof url === 'string' && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Open a spec PR in the TARGET repo for the given spec branch.
 *
 * @param target - The resolved target repo (name + canonicalPath).
 * @param branch - The spec branch name (e.g. "spec/add-auth"). Used as the
 *                 `feature` key in the authored ledger.
 * @param deps   - Injected dependencies (runner, ledgerOpts).
 * @returns      `{ kind: 'pr-opened'; url }` on success,
 *               `{ kind: 'pr-skipped'; reason }` when the repo has no remote,
 *               or `{ kind: 'pr-refused'; reason }` when authorization is absent
 *               or denied.
 */
export async function openSpecPr(
  target: TargetRepo,
  branch: string,
  deps: HandoffDeps,
): Promise<OpenSpecPrResult> {
  const { runner, gitRunner, ledgerOpts } = deps;
  // cwd = the per-idea worktree (checked out on `spec/<slug>`) so gh pushes and opens
  // the PR from that branch. Falls back to the canonical path for legacy callers.
  const cwd = deps.worktreePath ?? target.canonicalPath;

  if (target.remote === undefined) {
    await recordAuthoredKey(target.name, branch, ledgerOpts ?? {});
    return { kind: 'pr-skipped', reason: 'no remote configured' };
  }

  if (!deps.publication) {
    return { kind: 'pr-refused', reason: 'missing-provenance' };
  }

  if (!gitRunner) {
    throw new Error(
      `openSpecPr: gitRunner is required to push branch "${branch}" for remote target "${target.name}"`,
    );
  }

  const createArgs = await buildSpecPrCreateArgs({ cwd, branch, git: gitRunner });

  const push = await executeRemoteGit(
    ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`],
    deps.publication.remote,
  );
  if (push.kind === 'refused') return { kind: 'pr-refused', reason: push.reason };
  if (push.kind === 'failed') throw new Error(`openSpecPr: guarded push failed: ${push.error}`);
  if (push.kind !== 'executed') throw new Error('openSpecPr: guarded publication did not resolve a remote push target');

  const payload = createPayload(branch, createArgs);
  const created = await executeGithubOperation({
    operation: 'pull-request.create',
    repository: deps.publication.repository,
    resource: { kind: 'repository' },
    context: { actor: 'engineer-handoff' },
    payload: { title: payload.title, body: payload.body, head: branch, base: 'main' },
  }, deps.publication.operations);
  if (created.kind === 'refused') return { kind: 'pr-refused', reason: created.reason };
  if (created.kind === 'failed') throw new Error(`openSpecPr: guarded PR creation failed: ${created.error}`);
  if (created.kind === 'partial') throw new Error('openSpecPr: PR creation returned an invalid partial result');
  const url = created.target.kind === 'pull-request'
    ? `https://github.com/${created.target.repository}/pull/${created.target.number}`
    : await readCreatedPrUrl(runner, branch, cwd);
  if (!url) throw new Error(`openSpecPr: guarded PR creation did not identify a URL for branch "${branch}".`);

  // 3. Record the (project, feature) authored key durably.
  //    The `feature` is the spec branch name — consistent with how the engineer's
  //    authored ledger identifies authoring events (one branch = one feature spec).
  await recordAuthoredKey(target.name, branch, ledgerOpts ?? {});

  // 3a2. Guarantee the PR declares a release disposition. `--fill` builds the
  //      body from the branch name and last commit message, so it never carries
  //      a `## Release metadata` section and the required check fails closed on
  //      every landed spec PR. Runs unconditionally — the obligation is on every
  //      PR, not only those linking an issue. Idempotent and non-fatal.
  await ensureReleaseMetadata({
    gh: async (args, opts) => {
      const r = await runner(args, { cwd: opts.cwd });
      return { stdout: r.stdout };
    },
    prUrl: url,
    operations: deps.publication.operations,
    cwd,
    log: deps.log,
  });

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
      operations: deps.publication.operations,
      keyword: 'Refs',
      sourceRef: deps.sourceRef,
      cwd,
      log: deps.log,
    });

    // 3c. Mirror the issue's criticality (`priority: <band>`) labels onto the
    //     spec PR, so the PR list carries the same urgency signal the daemon
    //     dispatches on. Fail-open: never throws, never discards the PR.
    await mirrorIssueCriticalityLabels({
      gh: async (args, opts) => runner(args, { cwd: opts.cwd }),
      operations: deps.publication.operations,
      cwd,
      prUrl: url,
      sourceRef: deps.sourceRef,
      log: deps.log,
    });
  }

  // 4. Return the URL wrapped in the discriminated result.
  return { kind: 'pr-opened', url };
}
