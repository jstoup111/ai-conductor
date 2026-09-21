/**
 * Daemon-halt escalation — opens a draft needs-remediation PR and posts a
 * comment with the failure reason when the conductor irrecoverably HALTs a
 * feature in auto/daemon mode (any cause except rebase conflicts, where
 * pushing mid-rebase is unsafe).
 *
 * Design constraints (mirroring the pr-labels seam):
 *   - Every public function is dependency-injected (runner defaults to the
 *     prod factory so call-sites with no fake need no wiring).
 *   - All operations are best-effort / non-throwing: errors are caught
 *     internally, logged via the optional `log` callback, and never
 *     re-thrown to callers.
 *   - FR-6: No GitHub artifacts are created when there are zero commits on the
 *     branch (nothing to review).
 *   - FR-7: A push failure is silently swallowed — no PR is created.
 */

import {
  type GhRunner,
  type GitRunner,
  makeProductionGh,
  makeProductionGit,
  findOrCreatePr,
  upsertComment,
  ensureHaltPresentation,
  NEEDS_REMEDIATION_MARKER,
  HALT_PR_BANNER_SENTINEL,
  HALT_PR_BANNER_LINES,
} from './pr-labels.js';
import { basename } from 'node:path';
import { executeRemoteGit, resolveFeatureRemoteMutation } from './remote-git-operations.js';
import {
  createGuardedGithubOperationRunner,
  type GithubMutationExecutionContext,
} from './tracker-client.js';
import type { GithubOperationEventEmitter } from './github-operations.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const COMMENT_MAX_LEN = 4000;

// ── Public API ────────────────────────────────────────────────────────────────

export interface EscalateBuildFailureOpts {
  /** Absolute path to the project root (used as cwd for git/gh calls). */
  projectRoot: string;
  /** Human-readable reason for the halt (names the actual cause/step). May be long; will be trimmed. */
  failureReason: string;
  /** Optional log callback. All errors are logged here, never thrown. */
  log?: (msg: string) => void;
  /** Injectable git runner (defaults to the production factory). */
  runGit?: GitRunner;
  /** Injectable gh runner (defaults to the production factory). */
  runGh?: GhRunner;
  /** Guarded remote-write seam; absent context refuses publication. */
  remoteGit?: typeof executeRemoteGit;
  remoteMutation?: GithubMutationExecutionContext;
  events?: GithubOperationEventEmitter;
}

export interface EscalateBuildFailureResult {
  /** URL of the draft PR that was found or created. Absent on any early exit. */
  prUrl?: string;
}

/**
 * Called by the conductor after any irrecoverable daemon HALT in auto mode
 * (prd-audit gaps, retries exhausted, catch-all exceptions, ping-pong/stuck-gate
 * caps) that parks a feature with commits. Not called for rebase-conflict HALTs
 * (pushing mid-rebase is unsafe).
 *
 * Steps (each best-effort/swallowed):
 *  1. Derive the current branch and the default base from origin/HEAD.
 *  2. Count commits on mergeBase..HEAD — zero commits ⇒ early exit (FR-6).
 *  3. Push the branch. Failure ⇒ early exit (FR-7).
 *  4. Find or create a draft PR titled `needs-remediation: <branch> — manual remediation required`.
 *  5. Ensure halt presentation: draft status, needs-remediation label, and body marker.
 *  6. Post a comment with the (trimmed) failure reason and a manual-remediation note.
 *
 * Returns `{ prUrl }` on success, `{}` on any early exit.
 * Never throws.
 */
export async function escalateBuildFailure(
  opts: EscalateBuildFailureOpts,
): Promise<EscalateBuildFailureResult> {
  const { projectRoot, failureReason, log } = opts;
  const runGit = opts.runGit ?? makeProductionGit();
  const runGh = opts.runGh ?? makeProductionGh();
  const cwd = projectRoot;

  // ── Step 1a: derive the current branch ────────────────────────────────────
  let branch: string;
  try {
    const { stdout } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    branch = stdout.trim();
    if (!branch || branch === 'HEAD') {
      log?.('[escalate] could not determine current branch (detached HEAD or empty)');
      return {};
    }
  } catch (err) {
    log?.(`[escalate] failed to derive current branch: ${err}`);
    return {};
  }

  // ── Step 1b: derive the default base from origin/HEAD (never hardcode) ────
  let base = 'main'; // conservative fallback only
  try {
    const { stdout } = await runGit(
      ['symbolic-ref', 'refs/remotes/origin/HEAD'],
      { cwd },
    );
    const ref = stdout.trim(); // e.g. refs/remotes/origin/main
    const match = ref.match(/^refs\/remotes\/origin\/(.+)$/);
    if (match) {
      base = match[1];
    }
  } catch {
    // Fallback silently — the base will be 'main'; logged only when dev opt-in
    log?.('[escalate] symbolic-ref unavailable, falling back to "main" as base');
  }

  // ── Step 2: count commits on mergeBase..HEAD ───────────────────────────────
  let commitCount: number;
  try {
    const { stdout: mergeBaseOut } = await runGit(['merge-base', base, 'HEAD'], { cwd });
    const mergeBase = mergeBaseOut.trim();
    if (!mergeBase) {
      log?.('[escalate] merge-base returned empty — conservative no-op');
      return {};
    }
    const { stdout: countOut } = await runGit(
      ['rev-list', '--count', `${mergeBase}..HEAD`],
      { cwd },
    );
    const parsed = parseInt(countOut.trim(), 10);
    if (isNaN(parsed)) {
      log?.('[escalate] could not parse commit count — conservative no-op');
      return {};
    }
    commitCount = parsed;
  } catch (err) {
    log?.(`[escalate] error computing commit count: ${err} — conservative no-op`);
    return {}; // FR-6 safety: never create gh artifacts with no evidence
  }

  if (commitCount === 0) {
    log?.('[escalate] zero commits on branch — no GitHub artifacts created (FR-6)');
    return {};
  }

  // ── Step 3: push the branch ───────────────────────────────────────────────
  let mutation: GithubMutationExecutionContext | undefined;
  try {
    mutation = opts.remoteMutation ?? await resolveFeatureRemoteMutation({
      cwd,
      slug: basename(cwd),
      branch,
      git: (args) => runGit(args, { cwd }),
      gh: runGh,
    });
    const pushed = await (opts.remoteGit ?? executeRemoteGit)(
      ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`],
      {
        cwd,
        config: (args) => runGit(args, { cwd }),
        runRemoteGit: runGit,
        mutation,
        events: opts.events,
      },
    );
    if (pushed.kind !== 'executed') throw new Error(remoteFailure(pushed));
  } catch (err) {
    log?.(`[escalate] push failed — skipping PR creation: ${err}`);
    return {}; // FR-7: push failure silently aborts (no partial PR)
  }

  // Keep the raw callable only for the established read/observation paths in
  // pr-labels. Every create/presentation/comment mutation goes through this
  // fresh guarded operation adapter, which reauthorizes the provenance for
  // each individual write.
  const operations = Object.assign(
    (args: string[], options: { cwd: string }) => runGh(args, options),
    createGuardedGithubOperationRunner(runGh, { cwd, mutation }),
  );

  // ── Step 4: find or create a draft PR ────────────────────────────────────
  const { prUrl, outcome } = await findOrCreatePr(
    operations,
    cwd,
    {
      repository: mutation?.provenance.repository,
      branch,
      base,
      draft: true,
      title: `needs-remediation: ${branch} — manual remediation required`,
      body: [HALT_PR_BANNER_SENTINEL, '', ...HALT_PR_BANNER_LINES.slice(1)].join('\n'),
    },
    log,
  );

  if (outcome?.kind === 'refused') {
    log?.(`[escalate] guarded PR creation refused: ${outcome.reason}`);
    return {};
  }

  if (!prUrl) {
    log?.('[escalate] could not find or create PR — skipping label and comment');
    return {};
  }

  // ── Step 5: ensure halt presentation (draft + label + body marker) ────────
  const presentation = await ensureHaltPresentation(operations, cwd, prUrl, log);
  if (presentation === 'refused') {
    log?.('[escalate] guarded halt presentation refused — skipping comment');
    return {};
  }

  // ── Step 6: comment with failure reason (priority artifact, non-throwing) ─
  // Attempt this independently of whether the label step succeeded.
  // Upsert (not append) so repeated HALTs edit a single marked comment in place
  // rather than piling up duplicates (issue #159).
  const truncatedReason =
    failureReason.length > COMMENT_MAX_LEN
      ? failureReason.slice(0, COMMENT_MAX_LEN) + '\n…(truncated)'
      : failureReason;

  const commentBody = [
    '## Daemon halt',
    '',
    truncatedReason,
    '',
    'Manual remediation is required.',
  ].join('\n');

  const comment = await upsertComment(operations, cwd, prUrl, NEEDS_REMEDIATION_MARKER, commentBody, log);
  if (comment?.kind === 'refused') {
    log?.(`[escalate] guarded remediation comment refused: ${comment.reason}`);
    return {};
  }

  return { prUrl };
}

function remoteFailure(result: Awaited<ReturnType<typeof executeRemoteGit>>): string {
  if (result.kind === 'failed') return result.error;
  if (result.kind === 'refused') return result.reason;
  return 'remote Git operation did not execute';
}
