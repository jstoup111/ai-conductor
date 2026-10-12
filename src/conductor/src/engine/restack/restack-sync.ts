import { access } from 'node:fs/promises';
import { join } from 'node:path';

import type { GitRunner } from '../rebase.js';
import {
  createProtectedArtifactSeal,
  PROTECTED_ARTIFACT_DIRECTORIES,
  PROTECTED_ARTIFACT_SEAL_PATH,
  rotateProtectedArtifactSeal,
} from '../protected-artifact-seal.js';
import type { CommitSha } from './restack-types.js';

export interface RestackSyncDependencies {
  readonly git: GitRunner;
}

/** A changed path was edited while the ref move and worktree sync were apart. */
export class RestackSyncOperatorEditError extends Error {
  constructor(readonly path: string) {
    super(`operator edit during restack sync: ${path}`);
    this.name = 'RestackSyncOperatorEditError';
  }
}

function changedProtectedPaths(output: string): string[] {
  return [...new Set(output.split('\n').map((path) => path.trim()).filter(Boolean))]
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

async function hasProtectedArtifactSeal(worktree: string): Promise<boolean> {
  try {
    await access(join(worktree, PROTECTED_ARTIFACT_SEAL_PATH));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function paths(output: string): string[] {
  return output.split('\n').map((path) => path.trim()).filter(Boolean);
}

/**
 * A recovery can find the index and worktree part-way through `read-tree`.
 * Only the before and after versions of a moved path are safe to complete;
 * anything else is an operator edit and must remain untouched.
 */
async function assertSyncPathsAreRecoverable(
  oldTip: CommitSha,
  newTip: CommitSha,
  git: GitRunner,
): Promise<string[]> {
  const changed = await git(['diff', '--name-only', oldTip, newTip]);
  if (changed.exitCode !== 0) throw new Error(`cannot inspect restack sync delta: ${changed.stderr}`);
  const alreadyNew: string[] = [];
  for (const path of paths(changed.stdout)) {
    const [oldContent, newContent] = await Promise.all([
      git(['diff', '--quiet', oldTip, '--', path]),
      git(['diff', '--quiet', newTip, '--', path]),
    ]);
    if (oldContent.exitCode === 0) continue;
    if (newContent.exitCode === 0) {
      alreadyNew.push(path);
      continue;
    }
    if (oldContent.exitCode !== 1 || newContent.exitCode !== 1) {
      throw new Error(`cannot inspect restack sync path ${path}`);
    }
    throw new RestackSyncOperatorEditError(path);
  }
  return alreadyNew;
}

/**
 * Synchronize the checked-out worktree after its branch has moved. `read-tree`
 * preserves local edits that do not overlap the old-to-new tree delta; it never
 * uses Git's stash machinery. An existing protected-artifact seal follows the
 * rewritten checked-out tip using the same proactive lineage as a clean rebase.
 */
export async function syncRestackedWorktree(
  worktree: string,
  oldTip: CommitSha,
  newTip: CommitSha,
  { git }: RestackSyncDependencies,
): Promise<void> {
  const alreadyNew = await assertSyncPathsAreRecoverable(oldTip, newTip, git);
  if (alreadyNew.length > 0) {
    // An interrupted `read-tree -u` can leave a path's new blob in the
    // worktree while the index still holds the old one. Record that file in the
    // index as-is so the merge below keeps it instead of refusing it as dirty.
    const staged = await git(['update-index', '--remove', '--', ...alreadyNew]);
    if (staged.exitCode !== 0) throw new Error(`cannot record half-synchronized restack paths: ${staged.stderr}`);
  }
  const synced = await git(['read-tree', '-m', '-u', oldTip, newTip]);
  if (synced.exitCode !== 0) throw new Error(`cannot synchronize restacked worktree: ${synced.stderr}`);

  if (!(await hasProtectedArtifactSeal(worktree))) return;
  const seal = await createProtectedArtifactSeal({ projectRoot: worktree, baselineCommit: oldTip });
  const changed = await git([
    'diff',
    '--name-only',
    oldTip,
    newTip,
    '--',
    ...PROTECTED_ARTIFACT_DIRECTORIES,
  ]);
  await rotateProtectedArtifactSeal({
    projectRoot: worktree,
    seal,
    toCommit: newTip,
    trigger: 'proactive-rebase',
    paths: changed.exitCode === 0 ? changedProtectedPaths(changed.stdout) : [],
  });
}
