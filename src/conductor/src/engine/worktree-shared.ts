// worktree-shared.ts — the single git-worktree create/reconcile/teardown mechanism
// shared by the daemon (daemon-deps.ts) and the engineer (engineer/worktree-authoring.ts).
//
// Both actors isolate their work in a per-feature git worktree of the SAME primary
// checkout. Before this module the daemon owned the only implementation
// (daemon-deps.ts:createWorktree); the engineer mutated the shared checkout instead.
// Extracting the mechanism gives the harness ONE worktree story (PRD non-functional
// "Parity") and lets the engineer inherit the daemon's leftover-branch reconciliation.
//
// The four create cases:
//   1. a worktree is already registered for this path            → reuse it (resume)
//   2. the branch exists but its worktree was removed            → attach a worktree
//   3. only the remote-tracking branch exists                    → fetch a tracking worktree
//   4. neither exists                                            → fresh branch+worktree
//
// The base ref for case 4 is resolved LAZILY (only when a fresh branch is cut) so the
// reuse/attach paths issue no extra git call — the daemon-deps test asserts this exact
// call ordering.

import { execa } from 'execa';
import { join, sep } from 'node:path';

/** Which reconciliation case fired — surfaced so callers can report it (FR-11). */
export type WorktreeReconcile = 'reused' | 'attached' | 'fetched' | 'created';

export interface EnsureWorktreeOpts {
  /** The primary checkout the worktree is added to. */
  root: string;
  /** Absolute path of the per-feature worktree directory. */
  path: string;
  /** Branch to check out in the worktree (fetched in case 3, created fresh in case 4, attached in case 2). */
  branch: string;
  /**
   * Lazily resolves the base ref a FRESH branch forks from (case 4 only). Not invoked
   * on the reuse/attach paths — keeping those paths free of an extra git call.
   */
  resolveBase: () => Promise<string>;
  log?: (msg: string) => void;
}

export interface EnsureWorktreeResult {
  path: string;
  branch: string;
  reconcile: WorktreeReconcile;
}

/**
 * Create-or-reconcile a per-feature worktree. Idempotent: re-running after a kept
 * (halted/failed) worktree resumes instead of aborting on "already exists".
 */
export async function ensureWorktree(opts: EnsureWorktreeOpts): Promise<EnsureWorktreeResult> {
  const { root, path, branch, resolveBase, log } = opts;

  if (await isRegisteredWorktree(root, path)) {
    log?.(`reusing worktree ${path} (resume)`);
    return { path, branch, reconcile: 'reused' };
  }

  if (await branchExists(root, branch)) {
    log?.(`attaching worktree to existing branch ${branch}`);
    await execa('git', ['worktree', 'add', path, branch], { cwd: root });
    return { path, branch, reconcile: 'attached' };
  }

  if (await remoteBranchExists(root, branch)) {
    await execa('git', ['worktree', 'add', '--track', '-b', branch, path, `origin/${branch}`], { cwd: root });
    return { path, branch, reconcile: 'fetched' };
  }

  const base = await resolveBase();
  await execa('git', ['worktree', 'add', '-b', branch, path, base], { cwd: root });
  return { path, branch, reconcile: 'created' };
}

/** Remove a worktree with `--force` (handles a dirty worktree). Throws on failure. */
export async function removeWorktree(root: string, path: string): Promise<void> {
  await execa('git', ['worktree', 'remove', '--force', path], { cwd: root });
}

/**
 * The `git status --porcelain` output for a worktree (empty string == clean).
 * Used to surface a dirty leftover worktree rather than silently reusing stale
 * artifacts on a retry (FR-11 negative).
 */
export async function worktreeStatus(path: string): Promise<string> {
  const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: path });
  return stdout.trim();
}

/** True if `path` is already a registered git worktree of `root`. */
export async function isRegisteredWorktree(root: string, path: string): Promise<boolean> {
  try {
    const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: root });
    // Lines look like `worktree <abs-path>`. Match the exact path or its
    // full `.worktrees/...` suffix (git may report a realpath-resolved form).
    // Keeping the whole suffix is necessary for nested feature slugs: reducing
    // `.worktrees/a/b` to its basename can turn a failed lookup into the final
    // character and accidentally match an unrelated project root.
    const marker = `${join('.worktrees', '')}${sep}`;
    const markerIndex = path.indexOf(marker);
    const suffix = markerIndex >= 0 ? path.slice(markerIndex) : path;
    return stdout
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .some((l) => {
        const wt = l.slice('worktree '.length);
        return wt === path || wt.endsWith(suffix);
      });
  } catch {
    return false;
  }
}

/** True if a local branch named `branch` exists in `root`. */
export async function branchExists(root: string, branch: string): Promise<boolean> {
  try {
    await execa('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

/** True if the remote-tracking branch named `branch` exists in `root`. */
async function remoteBranchExists(root: string, branch: string): Promise<boolean> {
  try {
    await execa('git', ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { cwd: root });
    return true;
  } catch {
    return false;
  }
}
