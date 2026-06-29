/**
 * Build-failure escalation — opens a draft needs-remediation PR and posts a
 * comment with the failure reason when the conductor irrecoverably halts a
 * build step in auto/daemon mode.
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
  ensureLabel,
  addLabel,
  findOrCreatePr,
  comment,
} from './pr-labels.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const LABEL_NAME = 'needs-remediation';
const LABEL_COLOR = 'B60205';
const COMMENT_MAX_LEN = 4000;

// ── Public API ────────────────────────────────────────────────────────────────

export interface EscalateBuildFailureOpts {
  /** Absolute path to the project root (used as cwd for git/gh calls). */
  projectRoot: string;
  /** Human-readable reason the build failed. May be long; will be trimmed. */
  failureReason: string;
  /** Optional log callback. All errors are logged here, never thrown. */
  log?: (msg: string) => void;
  /** Injectable git runner (defaults to the production factory). */
  runGit?: GitRunner;
  /** Injectable gh runner (defaults to the production factory). */
  runGh?: GhRunner;
}

export interface EscalateBuildFailureResult {
  /** URL of the draft PR that was found or created. Absent on any early exit. */
  prUrl?: string;
}

/**
 * Called by the conductor after an irrecoverable build failure in auto mode.
 *
 * Steps (each best-effort/swallowed):
 *  1. Derive the current branch and the default base from origin/HEAD.
 *  2. Count commits on mergeBase..HEAD — zero commits ⇒ early exit (FR-6).
 *  3. Push the branch. Failure ⇒ early exit (FR-7).
 *  4. Find or create a draft PR titled `needs-remediation: build failed — <branch>`.
 *  5. Ensure the `needs-remediation` label exists and add it to the PR.
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
  try {
    await runGit(['push', '-u', 'origin', branch], { cwd });
  } catch (err) {
    log?.(`[escalate] push failed — skipping PR creation: ${err}`);
    return {}; // FR-7: push failure silently aborts (no partial PR)
  }

  // ── Step 4: find or create a draft PR ────────────────────────────────────
  const { prUrl } = await findOrCreatePr(
    runGh,
    cwd,
    {
      branch,
      base,
      draft: true,
      title: `needs-remediation: build failed — ${branch}`,
      body: [
        'This PR was opened automatically after an irrecoverable build failure.',
        '',
        'Manual remediation is required to unblock this feature.',
        'See the comment below for the failure reason.',
      ].join('\n'),
    },
    log,
  );

  if (!prUrl) {
    log?.('[escalate] could not find or create PR — skipping label and comment');
    return {};
  }

  // ── Step 5: ensure label exists + add it (both best-effort, non-throwing) ─
  await ensureLabel(runGh, cwd, LABEL_NAME, LABEL_COLOR, log);
  await addLabel(runGh, cwd, prUrl, LABEL_NAME, log);

  // ── Step 6: comment with failure reason (priority artifact, non-throwing) ─
  // Attempt this independently of whether the label step succeeded.
  const truncatedReason =
    failureReason.length > COMMENT_MAX_LEN
      ? failureReason.slice(0, COMMENT_MAX_LEN) + '\n…(truncated)'
      : failureReason;

  const commentBody = [
    '## Build failure',
    '',
    truncatedReason,
    '',
    'Manual remediation is required to resolve this failure.',
  ].join('\n');

  await comment(runGh, cwd, prUrl, commentBody, log);

  return { prUrl };
}
