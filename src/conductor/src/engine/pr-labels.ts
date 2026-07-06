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

const execFileP = promisify(execFileCb);

// ── Runner types ──────────────────────────────────────────────────────────────

/**
 * Injectable runner for `gh` CLI commands.
 * Mirrors the GhRunner type in engineer/loop.ts — defined here so pr-labels
 * has no dependency on that module.
 */
export type GhRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string }>;

/**
 * Injectable runner for `git` CLI commands.
 */
export type GitRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string }>;

// ── Production factories ──────────────────────────────────────────────────────

/**
 * Test kill-switch. When `AI_CONDUCTOR_NO_REAL_EXEC` is set (the vitest global setup
 * sets it — see `test/setup.ts`), the production `gh`/`git` runners refuse to
 * shell out. This is a belt-and-suspenders guard: every test is supposed to inject
 * a fake runner, but if one ever reaches a real runner (e.g. a daemon-mode test
 * that forgets to stub escalation), this prevents it from mutating real GitHub —
 * the exact failure mode that once labeled + commented on a live PR. The real-`git`
 * integration tests (e.g. rebase / daemon-rekick) use their own execa paths, NOT
 * this seam, so they are unaffected.
 */
function assertRealExecAllowed(bin: string): void {
  if (process.env.AI_CONDUCTOR_NO_REAL_EXEC) {
    throw new Error(
      `pr-labels: real '${bin}' exec blocked under AI_CONDUCTOR_NO_REAL_EXEC (test env). ` +
        `Inject a fake runner instead of using makeProduction${bin === 'gh' ? 'Gh' : 'Git'}().`,
    );
  }
}

/** Construct the real gh runner used in production. */
export function makeProductionGh(): GhRunner {
  return async (args: string[], opts: { cwd: string }) => {
    assertRealExecAllowed('gh');
    const result = await execFileP('gh', args, { cwd: opts.cwd });
    return { stdout: String(result.stdout) };
  };
}

/** Construct the real git runner used in production. */
export function makeProductionGit(): GitRunner {
  return async (args: string[], opts: { cwd: string }) => {
    assertRealExecAllowed('git');
    const result = await execFileP('git', args, { cwd: opts.cwd });
    return { stdout: String(result.stdout) };
  };
}

// ── Label management ──────────────────────────────────────────────────────────

/**
 * Parse a github.com PR or issue URL into the `owner/repo` slug and number used
 * by the REST labels endpoint. Returns null for anything that isn't a
 * recognizable github.com pull/issue URL.
 */
export function parseIssueRef(url: string): { repo: string; number: string } | null {
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
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  name: string,
  color: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await runGh(['label', 'create', name, '--color', color, '--force'], { cwd });
  } catch (err) {
    log?.(`[pr-labels] ensureLabel(${name}) error: ${err}`);
  }
}

/**
 * Add a label to a PR by URL via the REST endpoint (see {@link restAddLabelArgs}
 * for why we don't use `gh pr edit`). Swallows all errors.
 */
export async function addLabel(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  name: string,
  log?: (msg: string) => void,
): Promise<void> {
  const ref = parseIssueRef(prUrl);
  if (!ref) {
    log?.(`[pr-labels] addLabel: unparseable PR URL "${prUrl}"`);
    return;
  }
  try {
    await runGh(restAddLabelArgs(ref.repo, ref.number, name), { cwd });
  } catch (err) {
    log?.(`[pr-labels] addLabel(${prUrl}, ${name}) error: ${err}`);
  }
}

/**
 * Remove a label from a PR by URL via the REST endpoint (see
 * {@link restRemoveLabelArgs}). Swallows all errors.
 */
export async function removeLabel(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  name: string,
  log?: (msg: string) => void,
): Promise<void> {
  const ref = parseIssueRef(prUrl);
  if (!ref) {
    log?.(`[pr-labels] removeLabel: unparseable PR URL "${prUrl}"`);
    return;
  }
  try {
    await runGh(restRemoveLabelArgs(ref.repo, ref.number, name), { cwd });
  } catch (err) {
    log?.(`[pr-labels] removeLabel(${prUrl}, ${name}) error: ${err}`);
  }
}

// ── PR merge state ────────────────────────────────────────────────────────────

export interface PrMergeState {
  state: string;
  mergeable: string;
  hasFailingOrPendingChecks: boolean;
  labels: string[];
}

/** Safe sentinel returned when the gh runner fails with a transient/unknown error. */
const ERROR_SENTINEL: PrMergeState = {
  state: 'UNKNOWN',
  mergeable: 'UNKNOWN',
  hasFailingOrPendingChecks: true,
  labels: [],
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
};

/** Patterns whose presence in an error message indicate a PR is genuinely gone. */
const NOT_FOUND_PATTERNS = [
  'not found',
  'could not resolve to', // gh GraphQL: "Could not resolve to a PullRequest with the number N"
  'no pull requests',
  '404',
  'no such',
];

function isNotFoundError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return NOT_FOUND_PATTERNS.some((p) => msg.includes(p));
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

interface GhPrViewJson {
  state?: string;
  mergeable?: string;
  statusCheckRollup?: Array<{ status?: string | null; conclusion?: string | null }> | null;
  labels?: Array<{ name?: string }> | null;
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
      ['pr', 'view', prUrl, '--json', 'state,mergeable,statusCheckRollup,labels'],
      { cwd },
    );
    const data: GhPrViewJson = JSON.parse(stdout);
    const state = data.state ?? 'UNKNOWN';
    const mergeable = data.mergeable ?? 'UNKNOWN';
    const checks = data.statusCheckRollup ?? [];
    const hasFailingOrPendingChecks =
      checks.length > 0 && checks.some(isCheckFailingOrPending);
    const labels = (data.labels ?? []).map((l) => l.name ?? '').filter(Boolean);
    return { state, mergeable, hasFailingOrPendingChecks, labels };
  } catch (err) {
    log?.(`[pr-labels] prMergeState(${prUrl}) error: ${err}`);
    // Classify the error: a genuinely gone PR returns NOTFOUND so the sweep can
    // prune it (FR-13). A transient/unknown error returns UNKNOWN so the sweep
    // keeps the entry and retries next cycle (FR-15).
    if (isNotFoundError(err)) {
      return { ...NOTFOUND_SENTINEL };
    }
    return { ...ERROR_SENTINEL };
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
  branch: string;
  base: string;
  draft?: boolean;
  title: string;
  body: string;
}

export interface FindOrCreatePrResult {
  prUrl?: string;
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
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  opts: FindOrCreatePrOpts,
  log?: (msg: string) => void,
): Promise<FindOrCreatePrResult> {
  try {
    // ── Step 1: check for an existing PR ──────────────────────────────────
    try {
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
    const createArgs: string[] = [
      'pr',
      'create',
      '--head',
      opts.branch,
      '--base',
      opts.base,
      '--title',
      opts.title,
      '--body',
      opts.body,
    ];
    if (opts.draft) createArgs.push('--draft');

    const { stdout: createOut } = await runGh(createArgs, { cwd });
    const prUrl = extractPrUrl(createOut);
    if (prUrl) return { prUrl };

    log?.(`[pr-labels] findOrCreatePr: could not parse URL from output: ${createOut}`);
    return {};
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
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  body: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await runGh(['pr', 'comment', prUrl, '--body', body], { cwd });
  } catch (err) {
    log?.(`[pr-labels] comment(${prUrl}) error: ${err}`);
  }
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
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  marker: string,
  body: string,
  log?: (msg: string) => void,
): Promise<void> {
  const taggedBody = `${marker}\n${body}`;

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
          `[pr-labels] upsertComment(${prUrl}) PATCH failed: ${err} — leaving existing comment as-is`,
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
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await runGh(['pr', 'ready', prUrl], { cwd });
  } catch (err) {
    log?.(`[pr-labels] setReady(${prUrl}) error: ${err}`);
  }
}

/**
 * Convert a PR to draft status via `gh pr ready --undo`.
 * Swallows all errors.
 */
export async function convertToDraft(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await runGh(['pr', 'ready', '--undo', prUrl], { cwd });
  } catch (err) {
    log?.(`[pr-labels] convertToDraft(${prUrl}) error: ${err}`);
  }
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
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  currentBody?: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    // ── Step 1: determine the current body ────────────────────────────────
    let body = currentBody;
    if (body === undefined) {
      const presentation = await readHaltPresentation(runGh, cwd, prUrl, log);
      if (!presentation) {
        log?.(`[pr-labels] ensureBodyMarker: could not read PR presentation`);
        return;
      }
      body = presentation.body;
    }

    // ── Step 2: check if marker is present; if so, idempotent-exit ────────
    if (body.includes(NEEDS_REMEDIATION_BODY_MARKER)) {
      // Marker already present — no edit needed
      return;
    }

    // ── Step 3: append marker and call gh pr edit ────────────────────────
    const newBody = `${body}\n${NEEDS_REMEDIATION_BODY_MARKER}`;
    await runGh(['pr', 'edit', prUrl, '--body', newBody], { cwd });
  } catch (err) {
    log?.(`[pr-labels] ensureBodyMarker(${prUrl}) error: ${err}`);
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
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<'confirmed' | 'unconfirmed'> {
  try {
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
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  currentBody: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    // Check if marker is present; if not, idempotent-exit
    if (!currentBody.includes(NEEDS_REMEDIATION_BODY_MARKER)) {
      return;
    }

    // Strip the marker and call gh pr edit
    const newBody = currentBody.replace(NEEDS_REMEDIATION_BODY_MARKER, '').trim();
    await runGh(['pr', 'edit', prUrl, '--body', newBody], { cwd });
  } catch (err) {
    log?.(`[pr-labels] removeBodyMarker(${prUrl}) error: ${err}`);
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
 * @returns 'confirmed' if all three markers verified removed, 'partial' otherwise
 */
export async function cleanupHaltPresentation(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<'confirmed' | 'partial'> {
  try {
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
    // or if the PR is currently in draft status
    if (hasLabel || beforeCleanup.isDraft) {
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
    const isDraft = afterCleanup.isDraft;
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
