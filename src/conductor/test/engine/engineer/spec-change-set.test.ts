// Covers: task:3
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readMergeBaseTexts } from '../../../src/engine/engineer/spec-change-set.js';

const execFile = promisify(execFileCb);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout;
}

describe('readMergeBaseTexts', () => {
  let repository: string;
  let worktree: string;

  beforeEach(async () => {
    repository = await mkdtemp(join(tmpdir(), 'spec-change-set-repo-'));
    worktree = join(await mkdtemp(join(tmpdir(), 'spec-change-set-worktree-')), 'feature');
    await git(['init', '--initial-branch=main'], repository);
    await git(['config', 'user.email', 'test@example.com'], repository);
    await git(['config', 'user.name', 'Test User'], repository);
    await mkdir(join(repository, '.docs', 'decisions'), { recursive: true });
    await writeFile(join(repository, '.docs', 'decisions', 'adr-existing.md'), 'main text\n');
    await git(['add', '.'], repository);
    await git(['commit', '-m', 'main baseline'], repository);
    await git(['worktree', 'add', '-b', 'feature', worktree], repository);
  });

  afterEach(async () => {
    await rm(repository, { recursive: true, force: true });
    await rm(join(worktree, '..'), { recursive: true, force: true });
  });

  it('returns merge-base text for a modified path and null for a feature-only path', async () => {
    await writeFile(join(worktree, '.docs', 'decisions', 'adr-existing.md'), 'feature text\n');
    await writeFile(join(worktree, '.docs', 'decisions', 'adr-added.md'), 'added text\n');
    await git(['add', '.'], worktree);
    await git(['commit', '-m', 'feature artifacts'], worktree);

    await expect(readMergeBaseTexts(repository, repository, [
      '.docs/decisions/adr-existing.md',
      '.docs/decisions/adr-added.md',
    ])).resolves.toEqual({
      '.docs/decisions/adr-existing.md': 'main text\n',
      '.docs/decisions/adr-added.md': null,
    });
  });

  it('returns undefined when the merge base cannot be resolved', async () => {
    await git(['checkout', '--orphan', 'unrelated'], worktree);
    await git(['rm', '-rf', '.'], worktree);
    await writeFile(join(worktree, 'unrelated.md'), 'unrelated\n');
    await git(['add', '.'], worktree);
    await git(['commit', '-m', 'unrelated history'], worktree);

    await expect(readMergeBaseTexts(worktree, repository, ['unrelated.md'])).resolves.toBeUndefined();
  });
});
