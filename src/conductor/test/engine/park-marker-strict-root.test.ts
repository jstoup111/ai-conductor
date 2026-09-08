// Covers: task:1
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveMainRepoRootStrict } from '../../src/engine/park-marker.js';

const execFile = promisify(execFileCb);

describe('resolveMainRepoRootStrict', () => {
  let fixtureRoot: string;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'park-marker-strict-root-'));
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('resolves the main checkout root from its root, a nested directory, and a linked worktree', async () => {
    const mainRoot = join(fixtureRoot, 'repository');
    const git = (args: string[], cwd = mainRoot) => execFile('git', args, { cwd });
    await mkdir(mainRoot);
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test User']);
    await git(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(mainRoot, 'README.md'), '# fixture\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'initial']);

    const nestedDir = join(mainRoot, 'nested', 'directory');
    await mkdir(nestedDir, { recursive: true });
    const worktreeDir = join(mainRoot, '.worktrees', 'linked-feature');
    await mkdir(join(mainRoot, '.worktrees'), { recursive: true });
    await git(['worktree', 'add', '-b', 'spec/linked-feature', worktreeDir, 'main']);

    await expect(Promise.all([
      resolveMainRepoRootStrict(mainRoot),
      resolveMainRepoRootStrict(nestedDir),
      resolveMainRepoRootStrict(worktreeDir),
    ])).resolves.toEqual([mainRoot, mainRoot, mainRoot]);
  });

  it('returns null outside a repository without traversing beyond the fixture', async () => {
    const outsideDir = join(fixtureRoot, 'outside');
    await mkdir(outsideDir);
    const priorCeiling = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = fixtureRoot;

    try {
      await expect(resolveMainRepoRootStrict(outsideDir)).resolves.toBeNull();
    } finally {
      if (priorCeiling === undefined) {
        delete process.env.GIT_CEILING_DIRECTORIES;
      } else {
        process.env.GIT_CEILING_DIRECTORIES = priorCeiling;
      }
    }
  });
});
