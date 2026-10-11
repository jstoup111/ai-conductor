// Covers: task:10
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { createProtectedArtifactSeal, verifyProtectedArtifactSeal } from '../../../src/engine/protected-artifact-seal.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-sync-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, content: string) => {
    await mkdir(join(repo, path, '..'), { recursive: true });
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack sync']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await commit('base', 'notes.txt', 'base notes\n');
  await commit('approved plan', '.docs/plans/demo.md', 'approved\n');

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await commit('C1', 'c1.txt', 'c1\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await commit('C2', 'c2.txt', 'c2\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('L1', 'leaf.txt', 'leaf\n');
  const oldLeaf = (await git(['rev-parse', 'HEAD'])).stdout.trim();

  await git(['checkout', '-q', 'main']);
  const advancedDefault = await commit('base advance', 'base.txt', 'advanced\n');
  await git(['checkout', '-q', 'feat/daemon-demo']);
  return { repo, git, oldLeaf, advancedDefault };
}

async function restack(subject: Awaited<ReturnType<typeof fixture>>) {
  return runRestack({
    worktree: subject.repo,
    slug: 'demo',
    cause: 'base-refresh',
    newDefault: subject.advancedDefault,
    git: makeGitRunner(subject.repo),
  });
}

describe('runRestack worktree synchronization (real local Git)', () => {
  it('rotates the verified protected-artifact seal to the restacked leaf tip', async () => {
    const subject = await fixture();
    await createProtectedArtifactSeal({ projectRoot: subject.repo, baselineCommit: subject.oldLeaf });

    await expect(restack(subject)).resolves.toMatchObject({ kind: 'applied' });

    const newLeaf = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    const seal = JSON.parse(await readFile(join(subject.repo, '.pipeline', 'protected-artifact-seal.json'), 'utf8')) as {
      baselineCommit: string;
    };
    expect(seal.baselineCommit).toBe(newLeaf);
    await expect(verifyProtectedArtifactSeal({ projectRoot: subject.repo, baselineCommit: newLeaf }))
      .resolves.toMatchObject({ ok: true });
  });

  it('keeps unrelated uncommitted work in the synchronized worktree without creating a stash', async () => {
    const subject = await fixture();
    await writeFile(join(subject.repo, 'notes.txt'), 'operator notes\n');

    await expect(restack(subject)).resolves.toMatchObject({ kind: 'applied' });

    await expect(readFile(join(subject.repo, 'notes.txt'), 'utf8')).resolves.toBe('operator notes\n');
    expect((await subject.git(['status', '--porcelain'])).stdout).toBe(' M notes.txt\n');
    expect((await subject.git(['stash', 'list'])).stdout).toBe('');
  });
});
