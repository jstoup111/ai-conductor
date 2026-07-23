// engineer/worktree-authoring.ts — per-idea worktree lifecycle for the engineer.
//
// The engineer authors and lands each idea's DECIDE set inside a DEDICATED worktree of
// the target repo (never the primary checkout), reusing the daemon's shared worktree
// mechanism (worktree-shared.ts) so the harness has ONE worktree story (PRD parity).
//
//   path convention: <canonicalPath>/.worktrees/engineer-<slug>   (disjoint from the
//                    daemon's <canonicalPath>/.worktrees/<slug>)
//   branch:          spec/<slug>                                   (the land/handoff branch)
//
// Lifecycle: the skill CREATES the worktree before DECIDE, authors + lands inside it, and
// on a SUCCESSFUL handoff REMOVES it; a failure leaves it for inspection (FR-5/FR-6).
//
// Strict abort (FR-7): if a worktree cannot be created — including a detached/unborn HEAD
// where the base branch cannot be derived — creation throws and makes ZERO mutation to the
// primary working tree. There is no fallback to authoring in the shared checkout.

import { join } from 'node:path';
import {
  ensureWorktree,
  removeWorktree,
  worktreeStatus,
  type EnsureWorktreeResult,
  type WorktreeReconcile,
} from '../worktree-shared.js';
import { deriveDefaultBranch, slugify } from './authoring.js';
import { stageIntakeOutcomes } from './outcome-staging.js';

export interface EngineerWorktree {
  slug: string;
  /** The idea's branch — `spec/<slug>`, checked out in the worktree. */
  branch: string;
  /** Absolute path of the per-idea worktree (cwd for authoring + land/handoff). */
  worktreePath: string;
  /** How a leftover collision was resolved (FR-11) — reported to the operator. */
  reconcile: WorktreeReconcile;
}

/** The per-idea engineer worktree path — `engineer-`-scoped, disjoint from the daemon's. */
export function engineerWorktreePath(canonicalPath: string, slug: string): string {
  return join(canonicalPath, '.worktrees', `engineer-${slug}`);
}

/**
 * Create — or deterministically reconcile a leftover (FR-11) — the per-idea worktree on
 * branch `spec/<slug>`, based on the repo's derived default branch.
 *
 * @throws when the worktree cannot be created (strict abort, FR-7). The base branch is
 *   derived via `deriveDefaultBranch`, which throws on a detached/unborn HEAD — so a
 *   zero-commit repo aborts here WITHOUT seeding a commit or touching the primary tree.
 * @throws when a reused/attached leftover worktree is dirty — refusing to silently land
 *   stale artifacts (FR-11 negative). The operator is told to remove and retry.
 */
export async function createEngineerWorktree(
  canonicalPath: string,
  idea: string,
  log?: (m: string) => void,
  claim?: { sourceRef?: string | null; body?: string | null },
): Promise<EngineerWorktree> {
  const slug = slugify(idea);
  const branch = `spec/${slug}`;
  const worktreePath = engineerWorktreePath(canonicalPath, slug);

  let res: EnsureWorktreeResult;
  try {
    res = await ensureWorktree({
      root: canonicalPath,
      path: worktreePath,
      branch,
      // Lazy — resolved only when a FRESH branch is cut. Throws on unborn/detached HEAD,
      // which is exactly the strict-abort condition (FR-7 zero-commit case).
      resolveBase: () => deriveDefaultBranch(canonicalPath),
      log,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `engineer worktree: could not create an isolated worktree for "${idea}" in "${canonicalPath}": ${reason}. ` +
        'Aborting the idea — the engineer never falls back to authoring in the primary checkout (FR-7).',
    );
  }

  // FR-11 negative: a reused/attached leftover worktree that is DIRTY must not silently
  // land stale artifacts. Surface it so the operator recreates it.
  if (res.reconcile !== 'created') {
    const status = await worktreeStatus(worktreePath).catch(() => '');
    if (status !== '') {
      throw new Error(
        `engineer worktree: leftover worktree at "${worktreePath}" (${res.reconcile}) is dirty:\n${status}\n` +
          'Refusing to reuse it to avoid a silent stale-artifact land — remove it and retry (FR-11).',
      );
    }
  }

  // Task 1 (Story 1 happy path): stage the intake's Desired-outcome bullets into
  // the worktree's gitignored .pipeline/ BEFORE any DECIDE artifact is authored.
  // No-op for chat/CLI-originated ideas (no sourceRef/body) — Story 1 negative path.
  if (claim?.sourceRef && claim?.body) {
    await stageIntakeOutcomes(worktreePath, claim.sourceRef, claim.body);
  }

  return { slug, branch, worktreePath, reconcile: res.reconcile };
}

/**
 * Remove the per-idea worktree after a SUCCESSFUL handoff (FR-5). The `spec/<slug>`
 * branch and its commit persist — `git worktree remove` never deletes the branch. A
 * removal failure PROPAGATES (must be reported, not swallowed — FR-5 negative).
 */
export async function removeEngineerWorktree(
  canonicalPath: string,
  worktreePath: string,
): Promise<void> {
  await removeWorktree(canonicalPath, worktreePath);
}
