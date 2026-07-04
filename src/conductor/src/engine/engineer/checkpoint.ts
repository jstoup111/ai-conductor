// checkpoint.ts — `engineer checkpoint` primitive (Task 16, Story TS-6,
// adr-2026-07-03-engineer-checkpoint-commits-idempotent-land).
//
// PURPOSE:
//   Commit ONLY the `.docs/` tree the engineer has authored so far inside the
//   per-idea worktree, and publish that progress early (plain push, and — for
//   `pr_timing: early-draft` — a lazily-created/reused draft spec PR). This is
//   the mid-authoring checkpoint primitive: unlike `landSpec` (which validates
//   the FULL DECIDE artifact set is complete + approved before committing),
//   `checkpointSpec` makes no such demand — it may run repeatedly across a
//   long authoring session, each time committing whatever `.docs` content has
//   accumulated and pushing it so the operator/daemon can observe progress.
//
// CONTRACT: checkpointSpec({ worktreePath, slug, prTiming, identity, gh?, git?, log? })
//
//   IDENTITY-GATED (fail-fast, no-op): when `identity.resolved` is false, this
//   function performs ZERO git operations (no add, no commit, no push) and
//   returns immediately. A spec is never checkpoint-published un-owned.
//
//   `.docs`-SCOPED: stages only `git add .docs` (never `-A`), so any dirty
//   non-`.docs` file in the worktree is excluded from the resulting commit and
//   remains untracked/dirty (mirrors `landSpec`'s idea-scoped staging, FR-9).
//
//   COMMIT-IFF-STAGED: if nothing is staged under `.docs` (e.g. a repeat
//   checkpoint with no new artifact content), no commit is created — the
//   second-call-is-a-no-op idiom (mirrors Task 18's landSpec fix).
//
//   PUBLISH: pushes `spec/<slug>` to `origin`. For `prTiming === 'early-draft'`,
//   delegates to `publishEarlyDraft` (pr-labels.ts) so the FIRST push that lands
//   ahead of the repo's base branch lazily creates a draft PR — reused (not
//   recreated) on every subsequent checkpoint. Push/PR failures are logged and
//   swallowed — checkpointSpec never throws on a publish failure (advisory).

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { OwnerResolution } from '../owner-gate/identity.js';
import {
  publishEarlyDraft,
  pushBranch,
  type GhRunner,
  type GitRunner,
} from '../pr-labels.js';

const execFile = promisify(execFileCb);

// ── Public types ──────────────────────────────────────────────────────────────

export interface CheckpointSpecOptions {
  /** The per-idea worktree (cwd for ALL git ops). Checked out on `spec/<slug>`. */
  worktreePath: string;
  /** The idea's slug — the branch is `spec/<slug>`. */
  slug: string;
  /** The configured pr_timing mode; only `'early-draft'` triggers draft-PR publish. */
  prTiming: string;
  /** Resolved owner identity (fail-closed gate — Task 16 mirrors landSpec's D3). */
  identity: OwnerResolution;
  /** Injectable gh runner (tests supply a fake; defaults to the pr-labels production gh). */
  gh?: GhRunner;
  /** Injectable git runner for the PUBLISH step (push/ahead-count/PR). Defaults to a
   *  real (un-guarded) execFile-based runner — the local `.docs` commit always uses
   *  real git regardless of this override. */
  git?: GitRunner;
  /** Optional log sink — every non-fatal failure is logged here (never thrown). */
  log?: (msg: string) => void;
}

export interface CheckpointSpecResult {
  /** True if a NEW commit was created this call (false when nothing was staged). */
  committed: boolean;
  /** True if the branch was pushed to origin. */
  pushed: boolean;
  /** True if a draft PR was created OR already existed (early-draft mode only). */
  drafted: boolean;
  /** The draft/spec PR URL, when known. */
  prUrl?: string;
  /** Present when checkpointSpec no-op'd (e.g. unresolved identity). */
  skippedReason?: string;
}

// ── Default (real, un-guarded) git runner for the publish step ───────────────

/**
 * A real `git` runner used as the default for the PUBLISH step (push / ahead-count
 * / draft-PR creation). Deliberately does NOT reuse pr-labels.ts's `makeProductionGit`
 * (that factory refuses to exec under `AI_CONDUCTOR_NO_REAL_EXEC`, the test-env
 * kill-switch for the *pr-labels* seam) — checkpointSpec's own unit/acceptance tests
 * exercise real local git repos directly (mirrors `land-spec.ts`'s pattern of raw
 * `execFile('git', ...)` for local operations) and must be able to push for real
 * against a local (tmp bare) "origin" fixture.
 */
function defaultCheckpointGit(): GitRunner {
  return async (args: string[], opts: { cwd: string }) => {
    const result = await execFile('git', args, { cwd: opts.cwd });
    return { stdout: String(result.stdout) };
  };
}

// ── Base-branch discovery ─────────────────────────────────────────────────────

/**
 * Discover the base branch to measure "ahead of" for early-draft publish.
 * Tries, in order:
 *   1. `git symbolic-ref refs/remotes/origin/HEAD` (set by `git clone` / `remote set-head`).
 *   2. `git remote show origin` ("HEAD branch: <name>") — works against a local/tmp
 *      origin with no network round-trip.
 *   3. The first of `main` / `master` that resolves as a local branch ref (worktrees
 *      share refs/heads/* with the primary checkout, so this is visible even though
 *      HEAD itself is per-worktree).
 * Returns null if none resolve (caller then skips the ahead-of-base publish path).
 */
async function resolveBaseBranch(worktreePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFile(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD'],
      { cwd: worktreePath },
    );
    const m = stdout.trim().match(/^refs\/remotes\/origin\/(.+)$/);
    if (m) return m[1];
  } catch {
    // fall through
  }

  try {
    const { stdout } = await execFile('git', ['remote', 'show', 'origin'], {
      cwd: worktreePath,
    });
    const m = stdout.match(/HEAD branch:\s*(.+)/);
    if (m && m[1].trim() !== '(unknown)') return m[1].trim();
  } catch {
    // fall through
  }

  for (const candidate of ['main', 'master']) {
    try {
      await execFile('git', ['rev-parse', '--verify', `refs/heads/${candidate}`], {
        cwd: worktreePath,
      });
      return candidate;
    } catch {
      // try next candidate
    }
  }

  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Commit whatever `.docs/` content has accumulated in the per-idea worktree and
 * publish the branch (plain push, plus a lazy draft PR for `early-draft` timing).
 *
 * Fails CLOSED on unresolved identity (zero git operations). Every publish
 * failure (push, PR create) is logged and swallowed — checkpointSpec is
 * advisory and never throws.
 */
export async function checkpointSpec(
  opts: CheckpointSpecOptions,
): Promise<CheckpointSpecResult> {
  const { worktreePath, slug, prTiming, identity, log } = opts;

  // Identity gate (fail-closed): unresolved identity → zero commits/pushes.
  if (!identity.resolved) {
    log?.(
      `[engineer/checkpoint] identity is unresolved for "${slug}" — skipping checkpoint ` +
        '(no commit, no push). Configure spec_owner or run `gh auth login`.',
    );
    return { committed: false, pushed: false, drafted: false, skippedReason: 'identity-unresolved' };
  }

  const branch = `spec/${slug}`;

  // 1. Stage ONLY the `.docs` tree (never `-A`) — mirrors landSpec's idea-scoped
  //    staging so a dirty non-.docs file never bleeds into the checkpoint commit.
  await execFile('git', ['add', '.docs'], { cwd: worktreePath });

  // 2. Commit-iff-staged: only commit when something is actually staged, so a
  //    repeat checkpoint with no new artifact content is a true no-op (idempotent,
  //    mirrors Task 18's landSpec fix).
  let committed = false;
  const { stdout: stagedNames } = await execFile(
    'git',
    ['diff', '--cached', '--name-only'],
    { cwd: worktreePath },
  );
  if (stagedNames.trim() !== '') {
    await execFile(
      'git',
      ['commit', '-m', `checkpoint: ${slug} [engineer/checkpoint]`],
      { cwd: worktreePath },
    );
    committed = true;
  }

  // 3. Publish. Push failures are logged and swallowed (advisory) — checkpointSpec
  //    never throws on a publish failure.
  const runGit = opts.git ?? defaultCheckpointGit();

  if (prTiming === 'early-draft') {
    const base = (await resolveBaseBranch(worktreePath)) ?? 'main';
    const result = await publishEarlyDraft(
      runGit,
      opts.gh,
      worktreePath,
      branch,
      base,
      undefined,
      log,
    );
    return {
      committed,
      pushed: result.pushed,
      drafted: result.drafted,
      prUrl: result.pr_url,
    };
  }

  // Non-early-draft timing: plain push only, no PR creation.
  let pushed = true;
  try {
    await pushBranch(runGit, worktreePath, branch, undefined, log);
  } catch (err) {
    pushed = false;
    log?.(`[engineer/checkpoint] pushBranch(${branch}) error: ${err}`);
  }

  return { committed, pushed, drafted: false };
}
