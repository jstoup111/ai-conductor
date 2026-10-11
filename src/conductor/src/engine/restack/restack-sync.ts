import { access } from 'node:fs/promises';
import { join } from 'node:path';

import type { GitRunner } from '../rebase.js';
import {
  createProtectedArtifactSeal,
  PROTECTED_ARTIFACT_DIRECTORIES,
  PROTECTED_ARTIFACT_SEAL_PATH,
  rotateProtectedArtifactSeal,
} from '../protected-artifact-seal.js';

export interface RestackSyncDependencies {
  readonly git: GitRunner;
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

/**
 * Synchronize the checked-out worktree after its branch has moved. `read-tree`
 * preserves local edits that do not overlap the old-to-new tree delta; it never
 * uses Git's stash machinery. An existing protected-artifact seal follows the
 * rewritten checked-out tip using the same proactive lineage as a clean rebase.
 */
export async function syncRestackedWorktree(
  worktree: string,
  oldTip: string,
  newTip: string,
  { git }: RestackSyncDependencies,
): Promise<void> {
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
