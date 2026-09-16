import { describe, expect, it, vi } from 'vitest';

import { listRegisteredWorktrees } from '../../src/engine/park-reconciliation.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';

describe('engine/park-reconciliation — registered worktree listing', () => {
  const projectRoot = '/project';

  it('returns only depth-one .worktrees records with their porcelain branch names', async () => {
    const runGit = vi.fn<GitRunner>(async () => ({
      stdout: `worktree /project/.worktrees/feat-a\nHEAD aaaaaaaa\nbranch refs/heads/feat/a\n\nworktree /project/.worktrees/fix-b\nHEAD bbbbbbbb\nbranch refs/heads/fix/b\n\nworktree /project/.worktrees/chore-c\nHEAD cccccccc\nbranch refs/heads/chore/c\n\nworktree /project/.worktrees/feat/daemon-x\nHEAD dddddddd\nbranch refs/heads/feat/daemon-x\n\nworktree /project\nHEAD eeeeeeee\nbranch refs/heads/main\n\nworktree /project/.claude/worktrees/x\nHEAD ffffffff\nbranch refs/heads/feat/x\n\nworktree /project/.worktrees/detached\nHEAD 11111111\ndetached\n`,
    }));

    await expect(listRegisteredWorktrees(runGit, projectRoot)).resolves.toEqual([
      { slug: 'feat-a', branch: 'feat/a' },
      { slug: 'fix-b', branch: 'fix/b' },
      { slug: 'chore-c', branch: 'chore/c' },
    ]);
    expect(runGit).toHaveBeenCalledWith(['worktree', 'list', '--porcelain'], { cwd: projectRoot });
  });

  it('returns null when the porcelain listing cannot be read', async () => {
    const runGit = vi.fn<GitRunner>(async () => {
      throw Object.assign(new Error('git unavailable'), { code: 128 });
    });

    await expect(listRegisteredWorktrees(runGit, projectRoot)).resolves.toBeNull();
  });
});
