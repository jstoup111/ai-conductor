/**
 * Shared gh PR-ops seam — the single module through which all `gh`/`git`
 * label + PR primitives flow.
 *
 * Design constraints:
 *   - Every public function is dependency-injected (runner defaults to the
 *     prod factory so call-sites with no fake need no wiring).
 *   - All operations are best-effort / non-throwing: errors are caught
 *     internally, logged via the optional `log` callback, and never
 *     re-thrown to callers.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { extractPrUrl } from './state.js';
import type { ParsedIssueRef } from './engineer/issue-ref.js';
import {
  executeGithubOperation,
  type GithubOperationName,
  type GithubOperationResult,
  type GithubOperationRunner,
} from './github-operations.js';

const execFileP = promisify(execFileCb);

// ── Runner types ──────────────────────────────────────────────────────────────

import { makeProductionGh, assertRealExecAllowed, type GhRunner } from './tracker-client.js';
export { makeProductionGh, assertRealExecAllowed, type GhRunner };

/**
 * Injectable runner for `git` CLI commands.
 */
export type GitRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string }>;

/**
 * The PR seam accepts its historical raw runner for read-only compatibility,
 * but mutations are admitted only through the typed guarded-operation runner.
 * Keeping the union at this boundary lets the remaining read callers migrate
 * independently without reintroducing a raw mutation escape hatch.
 */
export type PrRunner = GhRunner | GithubOperationRunner | (GhRunner & GithubOperationRunner);

export type PrMutationResult = GithubOperationResult;

function isGuardedRunner(runner: PrRunner): runner is GithubOperationRunner {
  if (runner === null || (typeof runner !== 'object' && typeof runner !== 'function')) return false;
  return 'run' in runner && typeof (runner as { run?: unknown }).run === 'function';
}

function prTarget(url: string): { repository: string; kind: 'pull-request'; number: number } | null {
  const ref = parseIssueRef(url);
  if (!ref || !Number.isSafeInteger(Number(ref.number)) || Number(ref.number) < 1) return null;
  return { repository: ref.repo, kind: 'pull-request', number: Number(ref.number) };
}

function refused(
  operation: GithubOperationName,
  reason: 'invalid-target' | 'explicit-authorization-required',
): PrMutationResult {
  return { kind: 'refused', operation, reason };
}

/** Submit a typed PR operation; a raw runner can never perform the mutation. */
async function runMutation(
  runner: PrRunner,
  operation: GithubOperationName,
  repository: string | undefined,
  resource: Record<string, unknown>,
  payload?: Record<string, unknown>,
): Promise<PrMutationResult> {
  if (!repository) return refused(operation, 'invalid-target');
  if (!isGuardedRunner(runner)) return refused(operation, 'explicit-authorization-required');
  const result = await executeGithubOperation({
    operation,
    repository,
    resource,
    // The canonical runner resolves the actual machine actor afresh. This
    // field satisfies the closed request decoder; it is never authority.
    context: { actor: 'pr-labels' },
    ...(payload ? { payload } : {}),
  }, runner);
  if (result.kind === 'refused' && !('operation' in result)) {
    return refused(operation, result.reason === 'invalid-target' ? 'invalid-target' : 'explicit-authorization-required');
  }
  return result;
}

// ── Production factories ──────────────────────────────────────────────────────

/** Construct the real git runner used in production. */
export function makeProductionGit(): GitRunner {
  return async (args: string[], opts: { cwd: string }) => {
    assertRealExecAllowed('git');
    const result = await execFileP('git', args, {
      cwd: opts.cwd,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout: String(result.stdout) };
  };
}

// ── Label management ──────────────────────────────────────────────────────────

/**
 * Parse a github.com PR or issue URL into the `owner/repo` slug and number used
 * by the REST labels endpoint. Returns null for anything that isn't a
 * recognizable github.com pull/issue URL.
 */
export function parseIssueRef(url: string): ParsedIssueRef | null {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)/);
  if (!m) return null;
  return { repo: m[1], number: m[2] };
}

/**
 * Build the `gh api` argv that ADDS a label via the REST endpoint
 * (`POST /repos/{owner}/{repo}/issues/{number}/labels`).
 *
 * We deliberately avoid `gh pr edit --add-label` / `gh issue edit --add-label`:
 * those commands first run a GraphQL query that pulls Projects (classic)
 * metadata, which GitHub has sunset — so the whole command now errors out
 * before the label is ever applied. The REST labels endpoint never touches
 * Projects. `repo` is the `owner/repo` slug; `number` is the PR/issue number.
 */
export function restAddLabelArgs(repo: string, number: string, name: string): string[] {
  return [
    'api',
    '--method',
    'POST',
    `repos/${repo}/issues/${number}/labels`,
    '-f',
    `labels[]=${name}`,
  ];
}

/**
 * Build the `gh api` argv that REMOVES a label via the REST endpoint
 * (`DELETE /repos/{owner}/{repo}/issues/{number}/labels/{name}`). The label
 * name is URL-encoded so names with special characters (e.g. `engineer:handled`)
 * resolve correctly. See {@link restAddLabelArgs} for why we avoid `gh pr/issue
 * edit`.
 */
export function restRemoveLabelArgs(repo: string, number: string, name: string): string[] {
  return [
    'api',
    '--method',
    'DELETE',
    `repos/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`,
  ];
}

/**
 * Ensure a label exists in the repo (idempotent via --force).
 * Swallows all errors.
 */
export async function ensureLabel(
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  name: string,
  color: string,
  log?: (msg: string) => void,
  target?: { readonly repository: string },
): Promise<PrMutationResult> {
  // A label definition is repository-wide shared state. It is deliberately
  // never force-created or force-updated: callers without an exact shared
  // approval receive a refusal, and existing definitions need no write.
  const result = target
    ? await runMutation(runGh, 'label-definition.create', target.repository, { kind: 'label-definition', name }, { name, color })
    : refused('label-definition.create', 'explicit-authorization-required');
  if (result.kind === 'failed') log?.(`[pr-labels] ensureLabel(${name}) error: ${result.error}`);
  return result;
}

/**
 * Add a label to a PR by URL via the REST endpoint (see {@link restAddLabelArgs}
 * for why we don't use `gh pr edit`). Swallows all errors.
 */
export async function addLabel(
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  name: string,
  log?: (msg: string) => void,
): Promise<PrMutationResult> {
  const target = prTarget(prUrl);
  if (!target) {
    log?.(`[pr-labels] addLabel: unparseable PR URL "${prUrl}"`);
    return refused('pull-request.label.add', 'invalid-target');
  }
  const result = await runMutation(runGh, 'pull-request.label.add', target.repository, target, { label: name });
  if (result.kind === 'failed') log?.(`[pr-labels] addLabel(${prUrl}, ${name}) error: ${result.error}`);
  return result;
}

/**
 * Remove a label from a PR by URL via the REST endpoint (see
 * {@link restRemoveLabelArgs}). Swallows all errors.
 */
export async function removeLabel(
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  name: string,
  log?: (msg: string) => void,
): Promise<PrMutationResult> {
  const target = prTarget(prUrl);
  if (!target) {
    log?.(`[pr-labels] removeLabel: unparseable PR URL "${prUrl}"`);
    return refused('pull-request.label.remove', 'invalid-target');
  }
  const result = await runMutation(runGh, 'pull-request.label.remove', target.repository, target, { label: name });
  if (result.kind === 'failed') log?.(`[pr-labels] removeLabel(${prUrl}, ${name}) error: ${result.error}`);
  return result;
}

// ── PR merge state ────────────────────────────────────────────────────────────

export interface PrMergeState {
  state: string;
  mergeable: string;
  hasFailingOrPendingChecks: boolean;
  labels: string[];
  checksOutcome: 'failed' | 'pending' | 'green' | 'none';
  statusCheckRollup?: Array<{
    status?: string | null;
    conclusion?: string | null;
    state?: string | null;
    name?: string;
    context?: string;
  }>;
  /**
   * True when the PR is still a draft (not ready for review). Optional so
   * existing constructors/fixtures stay valid; absent is read as "not draft".
   * Consumers that act ON a PR (autoresolve / CI-fix dispatch) must skip
   * drafts; consumers that merely LABEL a PR must not.
   */
  isDraft?: boolean;
}

/** Safe sentinel returned when the gh runner fails with a transient/unknown error. */
const ERROR_SENTINEL: PrMergeState = {
  state: 'UNKNOWN',
  mergeable: 'UNKNOWN',
  hasFailingOrPendingChecks: true,
  labels: [],
  checksOutcome: 'none',
};

/**
 * Sentinel returned when the gh runner fails because the PR is genuinely gone
 * (404 / deleted / "could not resolve"). Distinct from UNKNOWN so that the
 * sweep can prune these entries (FR-13) without pruning on transient errors.
 */
const NOTFOUND_SENTINEL: PrMergeState = {
  state: 'NOTFOUND',
  mergeable: 'UNKNOWN',
  hasFailingOrPendingChecks: true,
  labels: [],
  checksOutcome: 'none',
};

/**
 * gh's stable GraphQL not-found phrase, e.g. "Could not resolve to a
 * PullRequest with the number N." This is narrower than a loose set of
 * English substrings (like bare "not found" or "404") that can appear in
 * unrelated transient/network errors and cause false-positive pruning.
 */
const GH_GRAPHQL_NOT_FOUND = 'could not resolve to a pullrequest';

/**
 * Classify a caught `gh` exec error as a genuine "PR not found" (vs. a
 * transient/unknown failure). Inspects the structured fields Node's
 * `execFile`/`ExecFileException` attaches to the rejection — `code` (process
 * exit code) and `stderr` — in addition to `err.message`.
 *
 * Returns true ONLY when BOTH hold:
 *   (a) the process exited non-zero (a zero/undefined exit never indicates
 *       "not found" — `gh` failures always carry a non-zero code), AND
 *   (b) the combined stderr+message contains the gh GraphQL not-found
 *       signal ({@link GH_GRAPHQL_NOT_FOUND}).
 *
 * Any other shape — a non-zero exit with empty/ambiguous stderr, a
 * transient network error ("could not resolve host"), an auth failure,
 * etc. — returns false, which callers treat as UNKNOWN (kept, not pruned).
 * This is the fail-safe direction: ambiguity never causes a mis-prune.
 */
function isNotFoundError(err: unknown): boolean {
  const e = err as { message?: unknown; stderr?: unknown; code?: unknown } | null;

  const code = e && typeof e === 'object' ? e.code : undefined;
  if (code === 0 || code === undefined) return false;

  const message = err instanceof Error ? err.message : String(err);
  const stderr = e && typeof e === 'object' && typeof e.stderr === 'string' ? e.stderr : '';
  const combined = `${stderr} ${message}`.toLowerCase();

  return combined.includes(GH_GRAPHQL_NOT_FOUND);
}

/**
 * The set of status/conclusion values that indicate a check is failing or
 * still pending (blocking merge). This includes terminal failure conclusions
 * as well as in-progress/pending states.
 */
const FAILING_OR_PENDING = new Set([
  'FAILURE',
  'ERROR',
  'PENDING',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'CANCELLED',
]);

function isCheckFailingOrPending(c: {
  status?: string | null;
  conclusion?: string | null;
}): boolean {
  const status = (c.status ?? '').toUpperCase();
  const conclusion = (c.conclusion ?? '').toUpperCase();
  // Explicit failure / error / pending status
  if (FAILING_OR_PENDING.has(status)) return true;
  // Explicit failure / error / pending conclusion
  if (FAILING_OR_PENDING.has(conclusion)) return true;
  // Null/empty conclusion = check is still running (not yet completed)
  if (!c.conclusion) return true;
  return false;
}

/**
 * Classify the overall outcome of a check rollup into one of four states:
 * - 'failed': rollup contains at least one failed check (FAILURE, ERROR, TIMED_OUT, etc.)
 * - 'pending': rollup contains only passing or pending/running checks, but at least one is not complete
 * - 'green': all checks in the rollup have completed successfully (SUCCESS conclusion)
 * - 'none': rollup is empty, null, or undefined
 *
 * Failed wins over pending (if both are present, 'failed' is returned).
 * Malformed entries (missing status/conclusion) are treated as pending (fail-safe).
 */
export function classifyChecksOutcome(
  checks: Array<{ status?: string | null; conclusion?: string | null }> | null | undefined,
): 'failed' | 'pending' | 'green' | 'none' {
  // Empty or absent rollup → 'none'
  if (!checks || checks.length === 0) {
    return 'none';
  }

  let hasFailed = false;
  let hasPending = false;

  for (const check of checks) {
    const conclusion = (check.conclusion ?? '').toUpperCase();

    // Check if this entry has a failed conclusion
    if (FAILING_OR_PENDING.has(conclusion)) {
      hasFailed = true;
      break; // Failed wins, no need to check further
    }

    // Check if conclusion is missing (still running) or status indicates pending
    if (!check.conclusion) {
      hasPending = true;
    } else if (conclusion === 'SUCCESS') {
      // Passing check, no action needed
    } else {
      // Malformed or unknown conclusion → treat as pending (fail-safe)
      hasPending = true;
    }
  }

  // Failed wins over pending
  if (hasFailed) {
    return 'failed';
  }

  if (hasPending) {
    return 'pending';
  }

  // All checks are SUCCESS
  return 'green';
}

interface GhPrViewJson {
  state?: string;
  mergeable?: string;
  statusCheckRollup?: Array<{ status?: string | null; conclusion?: string | null }> | null;
  labels?: Array<{ name?: string }> | null;
  isDraft?: boolean | null;
}

/**
 * Fetch the merge state of a PR (state, mergeable, check rollup, labels).
 * On any runner error returns a safe sentinel so callers can treat it as
 * non-mergeable without special error handling. Never throws.
 */
export async function prMergeState(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
): Promise<PrMergeState> {
  try {
    const { stdout } = await runGh(
      ['pr', 'view', prUrl, '--json', 'state,mergeable,statusCheckRollup,labels,isDraft'],
      { cwd },
    );
    const data: GhPrViewJson = JSON.parse(stdout);
    const state = data.state ?? 'UNKNOWN';
    const mergeable = data.mergeable ?? 'UNKNOWN';
    const checks = data.statusCheckRollup ?? [];
    const hasFailingOrPendingChecks =
      checks.length > 0 && checks.some(isCheckFailingOrPending);
    const labels = (data.labels ?? []).map((l) => l.name ?? '').filter(Boolean);
    const checksOutcome = classifyChecksOutcome(checks);
    return {
      state,
      mergeable,
      hasFailingOrPendingChecks,
      labels,
      checksOutcome,
      statusCheckRollup: checks,
      isDraft: data.isDraft ?? false,
    };
  } catch (err) {
    log?.(`[pr-labels] prMergeState(${prUrl}) error: ${err}`);
    // Classify the error: a genuinely gone PR returns NOTFOUND so the sweep can
    // prune it (FR-13). A transient/unknown error returns UNKNOWN so the sweep
    // keeps the entry and retries next cycle (FR-15).
    if (isNotFoundError(err)) {
      return { ...NOTFOUND_SENTINEL, checksOutcome: 'none' };
    }
    return { ...ERROR_SENTINEL, checksOutcome: 'none' };
  }
}

/**
 * True iff the PR is open, unambiguously mergeable, and has no failing or
 * pending checks. A runner error (sentinel) always returns false.
 */
export function isMergeable(s: PrMergeState): boolean {
  return (
    s.state === 'OPEN' && s.mergeable === 'MERGEABLE' && !s.hasFailingOrPendingChecks
  );
}

// ── Find-or-create PR ─────────────────────────────────────────────────────────

export interface FindOrCreatePrOpts {
  /** Canonical destination required before a creation write can be authorized. */
  repository?: string;
  branch: string;
  base: string;
  draft?: boolean;
  title: string;
  body: string;
}

export interface FindOrCreatePrResult {
  prUrl?: string;
  outcome?: PrMutationResult;
}

/**
 * Return the URL of an existing OPEN PR for the branch, or create a new one.
 *
 * - If a PR for the branch already exists and is OPEN, its URL is returned
 *   without creating a new PR.
 * - If a PR exists but is CLOSED or MERGED, it is NOT resurrected; a new PR
 *   is created instead.
 * - On any runner error, returns {} (swallows).
 */
export async function findOrCreatePr(
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  opts: FindOrCreatePrOpts,
  log?: (msg: string) => void,
): Promise<FindOrCreatePrResult> {
  try {
    // ── Step 1: check for an existing PR ──────────────────────────────────
    try {
      if (typeof runGh !== 'function') {
        // A typed guarded runner intentionally exposes no raw stdout escape
        // hatch. Creation remains safe and idempotent: the guarded create is
        // attempted once, never retried as a duplicate fallback.
        throw new Error('guarded PR lookup has no raw response adapter');
      }
      const { stdout } = await runGh(
        ['pr', 'view', opts.branch, '--json', 'url,state'],
        { cwd },
      );
      const data: { url?: string; state?: string } = JSON.parse(stdout);
      if (data.state === 'OPEN' && data.url) {
        return { prUrl: data.url };
      }
      // CLOSED / MERGED: fall through to create a fresh PR
      log?.(
        `[pr-labels] findOrCreatePr: existing PR for ${opts.branch} is ${data.state ?? 'unknown'} — creating new`,
      );
    } catch {
      // No PR found for branch — proceed to create
    }

    // ── Step 2: create a new PR ───────────────────────────────────────────
    const result = await runMutation(
      runGh,
      'pull-request.create',
      opts.repository,
      { kind: 'repository' },
      { title: opts.title, body: opts.body, head: opts.branch, base: opts.base },
    );
    return { outcome: result };
  } catch (err) {
    log?.(`[pr-labels] findOrCreatePr(${opts.branch}) error: ${err}`);
    return {};
  }
}

/**
 * Look up the PR (of any state — open, closed, merged) associated with a
 * branch, and return its URL if one exists. LOOKUP-ONLY: unlike
 * {@link findOrCreatePr}, this never creates a PR (no draft, no `pr create`).
 * Intended for resolving gated spec PRs that already exist on origin but have
 * no per-slug worktree state locally. Swallows all errors and returns
 * `undefined` when no PR is found or the runner fails.
 */
export async function resolveSpecPrUrl(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  branch: string,
  log?: (msg: string) => void,
): Promise<string | undefined> {
  try {
    const { stdout } = await runGh(
      ['pr', 'list', '--state', 'all', '--head', branch, '--json', 'url,state', '--limit', '1'],
      { cwd },
    );
    const data: Array<{ url?: string; state?: string }> = JSON.parse(stdout);
    const url = data[0]?.url;
    return url || undefined;
  } catch (err) {
    log?.(`[pr-labels] resolveSpecPrUrl(${branch}) error: ${err}`);
    return undefined;
  }
}

// ── PR comment + ready ────────────────────────────────────────────────────────

/**
 * Post a comment on a PR.
 * Swallows all errors.
 */
export async function comment(
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  body: string,
  log?: (msg: string) => void,
): Promise<PrMutationResult> {
  const target = prTarget(prUrl);
  if (!target) return refused('pull-request.comment.create', 'invalid-target');
  const result = await runMutation(runGh, 'pull-request.comment.create', target.repository, target, { body });
  if (result.kind === 'failed') log?.(`[pr-labels] comment(${prUrl}) error: ${result.error}`);
  return result;
}

/**
 * Stable hidden marker identifying the single harness-authored remediation-status
 * comment on a PR. Embedded in the comment body so subsequent HALTs can find and
 * edit that comment in place instead of appending a new one (issue #159).
 */
export const NEEDS_REMEDIATION_MARKER = '<!-- conductor:needs-remediation -->';

/**
 * Stable hidden marker identifying the remediation need in the PR body itself.
 * Distinct from {@link NEEDS_REMEDIATION_MARKER} which is embedded in comments.
 * Used for marking the PR body when a HALT marks a PR as needing remediation.
 */
export const NEEDS_REMEDIATION_BODY_MARKER = '<!-- conductor:needs-remediation -->';

/**
 * Stable hidden marker identifying the single harness-authored owner-gate
 * status comment on a PR for a spec that is currently owner-gated. Embedded
 * in the comment body so subsequent scans can find and edit that comment in
 * place instead of appending a new one, mirroring
 * {@link NEEDS_REMEDIATION_MARKER}.
 */
export const OWNER_GATED_MARKER = '<!-- conductor:owner-gated -->';

/**
 * First line of the engine-authored halt PR body (build-failure-escalation.ts).
 * Stable sentinel: its presence in a PR body is a stateless halt signal
 * (issue #632).
 */
export const HALT_PR_BANNER_SENTINEL =
  'This PR was opened automatically after an irrecoverable daemon HALT.';
export const HALT_PR_BANNER_LINES = [
  HALT_PR_BANNER_SENTINEL,
  'Manual remediation is required to unblock this feature.',
  'See the comment below for the failure reason.',
] as const;

interface ParsedCommentRef {
  owner: string;
  repo: string;
  commentId: string;
}

/**
 * Extract `{owner, repo, commentId}` from a GitHub issue-comment URL of the shape
 * `https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id>` (PR comments are
 * issue comments). Returns null if the URL does not match — callers treat that as
 * "can't edit, create instead".
 */
function parseCommentUrl(url: string): ParsedCommentRef | null {
  const m = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/(?:pull|issues)\/\d+#issuecomment-(\d+)/,
  );
  if (!m) return null;
  return { owner: m[1], repo: m[2], commentId: m[3] };
}

interface GhCommentJson {
  comments?: Array<{ body?: string; url?: string }> | null;
}

/**
 * Upsert a single marker-tagged comment on a PR (issue #159).
 *
 * Behaviour:
 *  - The stored comment body is `<marker>\n<body>` so it can be located later.
 *  - If a comment containing `marker` already exists and its URL is parseable, the
 *    existing comment is **edited in place** (HTTP PATCH via `gh api`). A PATCH
 *    failure is swallowed and leaves the existing comment as-is — it is NOT followed
 *    by a fallback create (that would defeat the de-duplication this function exists
 *    to provide).
 *  - Otherwise (no marked comment, an unparseable URL, or a failed lookup) a new
 *    marked comment is created via {@link comment}, so the next call can find it.
 *
 * Best-effort / non-throwing, consistent with the rest of this seam.
 */
export async function upsertComment(
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  marker: string,
  body: string,
  log?: (msg: string) => void,
): Promise<void> {
  const taggedBody = `${marker}\n${body}`;

  if (typeof runGh !== 'function') {
    log?.(`[pr-labels] upsertComment(${prUrl}) requires a read-capable guarded runner`);
    return;
  }

  let matchedUrl: string | undefined;
  try {
    const { stdout } = await runGh(['pr', 'view', prUrl, '--json', 'comments'], { cwd });
    const data: GhCommentJson = JSON.parse(stdout);
    const matched = (data.comments ?? []).find(
      (c) => typeof c?.body === 'string' && c.body.includes(marker),
    );
    matchedUrl = matched?.url;
  } catch (err) {
    log?.(`[pr-labels] upsertComment(${prUrl}) lookup failed: ${err} — creating new comment`);
    await comment(runGh, cwd, prUrl, taggedBody, log);
    return;
  }

  if (matchedUrl) {
    const ref = parseCommentUrl(matchedUrl);
    if (ref) {
      // Edit the existing comment in place. A failure here is terminal (no fallback
      // create) so a repeated HALT never piles up a second comment.
      const target = prTarget(prUrl);
      if (!target) {
        log?.(`[pr-labels] upsertComment(${prUrl}) invalid PR target`);
        return;
      }
      const result = await runMutation(
        runGh,
        'pull-request.comment.update',
        target.repository,
        target,
        { commentId: ref.commentId, body: taggedBody },
      );
      if (result.kind !== 'executed') {
        log?.(
          `[pr-labels] upsertComment(${prUrl}) update failed — leaving existing comment as-is`,
        );
      }
      return;
    }
    log?.(
      `[pr-labels] upsertComment(${prUrl}) marked comment url unparseable (${matchedUrl}) — creating new comment`,
    );
  }

  // No editable marked comment — create one carrying the marker.
  await comment(runGh, cwd, prUrl, taggedBody, log);
}

/**
 * Post a comment on an issue (as opposed to a PR — see {@link comment}).
 * `issueUrl` must be a `github.com/.../issues/N` URL. Swallows all errors.
 */
export async function issueComment(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  issueUrl: string,
  body: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await runGh(['issue', 'comment', issueUrl, '--body', body], { cwd });
  } catch (err) {
    log?.(`[pr-labels] issueComment(${issueUrl}) error: ${err}`);
  }
}

/**
 * Issue-comment counterpart to {@link upsertComment}: upserts a single
 * marker-tagged comment on an issue rather than a PR. Mirrors the same
 * lookup/PATCH/create-fallback contract (find by marker, PATCH in place on a
 * failure-terminal basis, else create). Best-effort / non-throwing.
 */
export async function upsertIssueComment(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  issueUrl: string,
  marker: string,
  body: string,
  log?: (msg: string) => void,
): Promise<void> {
  const taggedBody = `${marker}\n${body}`;

  let matchedUrl: string | undefined;
  try {
    const { stdout } = await runGh(['issue', 'view', issueUrl, '--json', 'comments'], { cwd });
    const data: GhCommentJson = JSON.parse(stdout);
    const matched = (data.comments ?? []).find(
      (c) => typeof c?.body === 'string' && c.body.includes(marker),
    );
    matchedUrl = matched?.url;
  } catch (err) {
    log?.(`[pr-labels] upsertIssueComment(${issueUrl}) lookup failed: ${err} — creating new comment`);
    await issueComment(runGh, cwd, issueUrl, taggedBody, log);
    return;
  }

  if (matchedUrl) {
    const ref = parseCommentUrl(matchedUrl);
    if (ref) {
      try {
        await runGh(
          [
            'api',
            '--method',
            'PATCH',
            `repos/${ref.owner}/${ref.repo}/issues/comments/${ref.commentId}`,
            '-f',
            `body=${taggedBody}`,
          ],
          { cwd },
        );
      } catch (err) {
        log?.(
          `[pr-labels] upsertIssueComment(${issueUrl}) PATCH failed: ${err} — leaving existing comment as-is`,
        );
      }
      return;
    }
    log?.(
      `[pr-labels] upsertIssueComment(${issueUrl}) marked comment url unparseable (${matchedUrl}) — creating new comment`,
    );
  }

  await issueComment(runGh, cwd, issueUrl, taggedBody, log);
}

/**
 * Mark a draft PR as ready for review.
 * Swallows all errors.
 */
export async function setReady(
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
): Promise<PrMutationResult> {
  const target = prTarget(prUrl);
  if (!target) return refused('pull-request.ready', 'invalid-target');
  const result = await runMutation(runGh, 'pull-request.ready', target.repository, target);
  if (result.kind === 'failed') log?.(`[pr-labels] setReady(${prUrl}) error: ${result.error}`);
  return result;
}

/**
 * Convert a PR to draft status via `gh pr ready --undo`.
 * Swallows all errors.
 */
export async function convertToDraft(
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
): Promise<PrMutationResult> {
  const target = prTarget(prUrl);
  if (!target) return refused('pull-request.draft', 'invalid-target');
  const result = await runMutation(runGh, 'pull-request.draft', target.repository, target);
  if (result.kind === 'failed') log?.(`[pr-labels] convertToDraft(${prUrl}) error: ${result.error}`);
  return result;
}

// ── Halt presentation read ────────────────────────────────────────────────────

export interface HaltPresentation {
  isDraft: boolean;
  labels: string[];
  body: string;
}

interface GhHaltPresentationJson {
  isDraft?: boolean;
  labels?: Array<{ name?: string }> | null;
  body?: string;
}

/**
 * Read the isDraft, labels, and body of a PR for halt-PR presentation purposes.
 * On any runner error returns null and logs; never throws.
 */
export async function readHaltPresentation(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
): Promise<HaltPresentation | null> {
  try {
    const { stdout } = await runGh(
      ['pr', 'view', prUrl, '--json', 'isDraft,labels,body'],
      { cwd },
    );
    const data: GhHaltPresentationJson = JSON.parse(stdout);
    const isDraft = data.isDraft ?? false;
    const labels = (data.labels ?? []).map((l) => l.name ?? '').filter(Boolean);
    const body = data.body ?? '';
    return { isDraft, labels, body };
  } catch (err) {
    log?.(`[pr-labels] readHaltPresentation(${prUrl}) error: ${err}`);
    return null;
  }
}

/**
 * Ensure the PR body contains the remediation marker, appending it if not present.
 * Idempotent: if the marker is already in the body, makes no edit call.
 *
 * If `currentBody` is provided, uses it directly; otherwise reads the body via
 * {@link readHaltPresentation}. Swallows all errors and never throws.
 */
export async function ensureBodyMarker(
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  currentBody?: string,
  log?: (msg: string) => void,
): Promise<PrMutationResult | undefined> {
  try {
    // ── Step 1: determine the current body ────────────────────────────────
    let body = currentBody;
    if (body === undefined) {
      if (typeof runGh !== 'function') {
        log?.('[pr-labels] ensureBodyMarker: guarded runner has no body-read adapter');
        return undefined;
      }
      const presentation = await readHaltPresentation(runGh, cwd, prUrl, log);
      if (!presentation) {
        log?.(`[pr-labels] ensureBodyMarker: could not read PR presentation`);
        return undefined;
      }
      body = presentation.body;
    }

    // ── Step 2: check if marker is present; if so, idempotent-exit ────────
    if (body.includes(NEEDS_REMEDIATION_BODY_MARKER)) {
      // Marker already present — no edit needed
      return undefined;
    }

    // ── Step 3: append marker through the guarded edit operation ─────────
    const newBody = `${body}\n${NEEDS_REMEDIATION_BODY_MARKER}`;
    const target = prTarget(prUrl);
    if (!target) return refused('pull-request.edit', 'invalid-target');
    return await runMutation(runGh, 'pull-request.edit', target.repository, target, { body: newBody });
  } catch (err) {
    log?.(`[pr-labels] ensureBodyMarker(${prUrl}) error: ${err}`);
    return undefined;
  }
}

// ── Halt presentation ensure (verify-after-write) ───────────────────────────

/**
 * Default sleep implementation for backoff. Exported for test injection.
 */
export async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure all three halt-presentation markers are present on a PR (draft status,
 * needs-remediation label, and body marker). Performs an idempotent verify-after-write:
 * writes all three markers, then re-reads to verify all are present.
 *
 * Implements retry logic (Task 7): if the label is missing after the first add attempt,
 * the function retries with bounded attempts (3 total) and backoff (100ms, 200ms).
 *
 * Happy path returns 'confirmed'; any mismatch returns 'unconfirmed'.
 *
 * Never throws; swallows all errors internally and logs them via the optional
 * `log` callback.
 *
 * @param runGh - Injectable gh runner (defaults to production)
 * @param cwd - Working directory for gh operations
 * @param prUrl - URL of the PR to ensure (e.g. https://github.com/owner/repo/pull/123)
 * @param log - Optional logging callback
 * @param sleep - Optional sleep injection for backoff (defaults to setTimeout-based sleep)
 * @returns 'confirmed' if all three markers verified, 'unconfirmed' otherwise
 */
export async function ensureHaltPresentation(
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<'confirmed' | 'unconfirmed'> {
  try {
    if (typeof runGh !== 'function') {
      log?.('[pr-labels] ensureHaltPresentation: guarded runner has no read adapter');
      return 'unconfirmed';
    }
    // ── Step 1: ensure body marker ────────────────────────────────────────
    await ensureBodyMarker(runGh, cwd, prUrl, undefined, log);

    // ── Step 2: read current state to decide if we need to convert to draft ─
    const beforeConvert = await readHaltPresentation(runGh, cwd, prUrl, log);
    if (!beforeConvert) {
      log?.(`[pr-labels] ensureHaltPresentation: could not read PR before convert`);
      return 'unconfirmed';
    }

    // ── Step 3: convert to draft only if not already draft ─────────────────
    if (!beforeConvert.isDraft) {
      await convertToDraft(runGh, cwd, prUrl, log);
    }

    // ── Step 4: add the needs-remediation label with retry logic ──────────
    const maxAttempts = 3;
    let labelConfirmed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Add the label
      await addLabel(runGh, cwd, prUrl, 'needs-remediation', log);

      // Re-read to check if label is present
      const afterAdd = await readHaltPresentation(runGh, cwd, prUrl, log);
      if (afterAdd?.labels.includes('needs-remediation')) {
        labelConfirmed = true;
        break;
      }

      // Label not present yet; log and retry with backoff (unless on last attempt)
      if (attempt < maxAttempts) {
        const backoffMs = attempt * 100; // 100ms, 200ms, etc.
        log?.(
          `[pr-labels] ensureHaltPresentation(${prUrl}): label missing after attempt ${attempt}, retrying in ${backoffMs}ms`,
        );
        await sleep(backoffMs);
      }
    }

    // ── Step 5: re-read to verify all three markers are present ───────────
    const afterWrite = await readHaltPresentation(runGh, cwd, prUrl, log);
    if (!afterWrite) {
      log?.(`[pr-labels] ensureHaltPresentation: could not re-read PR after writes`);
      return 'unconfirmed';
    }

    // ── Step 6: verify all three markers ──────────────────────────────────
    const hasDraft = afterWrite.isDraft;
    const hasLabel = afterWrite.labels.includes('needs-remediation');
    const hasBodyMarker = afterWrite.body.includes(NEEDS_REMEDIATION_BODY_MARKER);

    if (hasDraft && hasLabel && hasBodyMarker) {
      return 'confirmed';
    }

    if (!hasDraft) {
      log?.(`[pr-labels] ensureHaltPresentation(${prUrl}): missing draft status`);
    }
    if (!hasLabel) {
      log?.(`[pr-labels] ensureHaltPresentation(${prUrl}): missing needs-remediation label`);
    }
    if (!hasBodyMarker) {
      log?.(`[pr-labels] ensureHaltPresentation(${prUrl}): missing body marker`);
    }

    return 'unconfirmed';
  } catch (err) {
    log?.(`[pr-labels] ensureHaltPresentation(${prUrl}) error: ${err}`);
    return 'unconfirmed';
  }
}

// ── Halt presentation cleanup (verify-after-write) ─────────────────────────────

/**
 * Remove the remediation marker from a PR body, idempotent via marker check.
 * Does not call gh if the marker is not present.
 * Swallows all errors and never throws.
 *
 * @param runGh - Injectable gh runner (defaults to production)
 * @param cwd - Working directory for gh operations
 * @param prUrl - URL of the PR to edit
 * @param currentBody - The current body content to check and edit
 * @param log - Optional logging callback
 */
export async function removeBodyMarker(
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  currentBody: string,
  log?: (msg: string) => void,
): Promise<PrMutationResult | undefined> {
  try {
    // Check if marker is present; if not, idempotent-exit
    if (!currentBody.includes(NEEDS_REMEDIATION_BODY_MARKER)) {
      return undefined;
    }

    // Strip the marker and submit the same guarded edit primitive.
    const newBody = currentBody.replace(NEEDS_REMEDIATION_BODY_MARKER, '').trim();
    const target = prTarget(prUrl);
    if (!target) return refused('pull-request.edit', 'invalid-target');
    return await runMutation(runGh, 'pull-request.edit', target.repository, target, { body: newBody });
  } catch (err) {
    log?.(`[pr-labels] removeBodyMarker(${prUrl}) error: ${err}`);
    return undefined;
  }
}

/**
 * Clean up halt presentation markers after a feature finishes: remove label,
 * convert to ready, strip body marker, then re-read to verify all gone.
 *
 * Implements retry logic for label removal (up to 3 attempts with backoff).
 * Returns 'confirmed' if all cleanup verified; 'partial' if any residual markers
 * or failed operations.
 *
 * Never throws; swallows all errors internally and logs them via the optional
 * `log` callback.
 *
 * @param runGh - Injectable gh runner (defaults to production)
 * @param cwd - Working directory for gh operations
 * @param prUrl - URL of the PR to clean up
 * @param log - Optional logging callback
 * @param sleep - Optional sleep injection for backoff (defaults to setTimeout-based sleep)
 * @param opts - `preserveDraft: true` suppresses the draft→ready flip (and drops
 *   draft-ness from the verification), for callers that repair presentation while
 *   the PR must legitimately stay a draft — see `makeRetainedPrPresentable`.
 * @returns 'confirmed' if all three markers verified removed, 'partial' otherwise
 */
export async function cleanupHaltPresentation(
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  opts: { preserveDraft?: boolean } = {},
): Promise<'confirmed' | 'partial'> {
  const preserveDraft = opts.preserveDraft === true;
  try {
    if (typeof runGh !== 'function') {
      log?.('[pr-labels] cleanupHaltPresentation: guarded runner has no read adapter');
      return 'partial';
    }
    // ── Step 1: read current state ────────────────────────────────────────
    const beforeCleanup = await readHaltPresentation(runGh, cwd, prUrl, log);
    if (!beforeCleanup) {
      log?.(`[pr-labels] cleanupHaltPresentation: could not read PR before cleanup`);
      return 'partial';
    }

    // ── Step 2: remove the label with retry logic ────────────────────────
    const hasLabel = beforeCleanup.labels.includes('needs-remediation');
    if (hasLabel) {
      const maxAttempts = 3;
      let labelRemovalConfirmed = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Remove the label (best-effort, non-throwing)
        await removeLabel(runGh, cwd, prUrl, 'needs-remediation', log);

        // Re-read to check if label is gone
        const afterRemove = await readHaltPresentation(runGh, cwd, prUrl, log);
        if (afterRemove && !afterRemove.labels.includes('needs-remediation')) {
          labelRemovalConfirmed = true;
          break;
        }

        // Label still present; log and retry with backoff (unless on last attempt)
        if (attempt < maxAttempts) {
          const backoffMs = attempt * 100; // 100ms, 200ms, etc.
          log?.(
            `[pr-labels] cleanupHaltPresentation(${prUrl}): label still present after attempt ${attempt}, retrying in ${backoffMs}ms`,
          );
          await sleep(backoffMs);
        }
      }
    }

    // ── Step 3: convert to ready (remove draft status) ─────────────────────
    // Call setReady whenever we removed a label (which implies the PR was in halt status)
    // or if the PR is currently in draft status.
    //
    // Suppressed entirely under `preserveDraft`: a retained SHIP draft PR must
    // stay a draft until `finish` flips it, so a mid-SHIP presentation repair
    // must never make the PR ready-for-review ahead of the ship gates.
    if (!preserveDraft && (hasLabel || beforeCleanup.isDraft)) {
      await setReady(runGh, cwd, prUrl, log);
    }

    // ── Step 4: remove the body marker ───────────────────────────────────
    await removeBodyMarker(runGh, cwd, prUrl, beforeCleanup.body, log);

    // ── Step 5: re-read to verify all markers are gone ───────────────────
    const afterCleanup = await readHaltPresentation(runGh, cwd, prUrl, log);
    if (!afterCleanup) {
      log?.(`[pr-labels] cleanupHaltPresentation: could not re-read PR after cleanup`);
      return 'partial';
    }

    // ── Step 6: verify all three markers are gone ────────────────────────
    const hasResidualLabel = afterCleanup.labels.includes('needs-remediation');
    // Under preserveDraft a still-draft PR is the intended end state, so it is
    // never a residual marker.
    const isDraft = preserveDraft ? false : afterCleanup.isDraft;
    const hasBodyMarker = afterCleanup.body.includes(NEEDS_REMEDIATION_BODY_MARKER);

    if (!hasResidualLabel && !isDraft && !hasBodyMarker) {
      return 'confirmed';
    }

    if (hasResidualLabel) {
      log?.(`[pr-labels] cleanupHaltPresentation(${prUrl}): residual needs-remediation label`);
    }
    if (isDraft) {
      log?.(`[pr-labels] cleanupHaltPresentation(${prUrl}): still in draft status`);
    }
    if (hasBodyMarker) {
      log?.(`[pr-labels] cleanupHaltPresentation(${prUrl}): residual body marker`);
    }

    return 'partial';
  } catch (err) {
    log?.(`[pr-labels] cleanupHaltPresentation(${prUrl}) error: ${err}`);
    return 'partial';
  }
}
