// worktree-shared.ts — the single git-worktree create/reconcile/teardown mechanism
// shared by the daemon (daemon-deps.ts) and the engineer (engineer/worktree-authoring.ts).
//
// Both actors isolate their work in a per-feature git worktree of the SAME primary
// checkout. Before this module the daemon owned the only implementation
// (daemon-deps.ts:createWorktree); the engineer mutated the shared checkout instead.
// Extracting the mechanism gives the harness ONE worktree story (PRD non-functional
// "Parity") and lets the engineer inherit the daemon's leftover-branch reconciliation.
//
// The three create cases (unchanged from the daemon's original logic, so the daemon
// path stays byte-identical):
//   1. a worktree is already registered for this path            → reuse it (resume)
//   2. the branch exists but its worktree was removed            → attach a worktree
//   3. neither exists                                            → fresh branch+worktree
//
// The base ref for case 3 is resolved LAZILY (only when a fresh branch is cut) so the
// reuse/attach paths issue no extra git call — the daemon-deps test asserts this exact
// call ordering.

import { execa } from 'execa';
import { basename, join } from 'node:path';

/** Which of the three reconciliation cases fired — surfaced so callers can report it (FR-11). */
export type WorktreeReconcile = 'reused' | 'attached' | 'created';

export interface EnsureWorktreeOpts {
  /** The primary checkout the worktree is added to. */
  root: string;
  /** Absolute path of the per-feature worktree directory. */
  path: string;
  /** Branch to check out in the worktree (created fresh in case 3, attached in case 2). */
  branch: string;
  /**
   * Lazily resolves the base ref a FRESH branch forks from (case 3 only). Not invoked
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
    // `.worktrees/<name>` suffix (git may report a realpath-resolved form).
    const suffix = path.slice(path.indexOf(join('.worktrees', basename(path))));
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
