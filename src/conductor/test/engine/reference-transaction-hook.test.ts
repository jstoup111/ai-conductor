// Covers: task:2, task:3
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { resolveRealGit } from '../../src/engine/git-guard.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { initTestRepo } from '../fixtures/git-repo.js';

type GitResult = { exitCode: number; stdout: string; stderr: string };

interface Fixture {
  dir: string;
  root: string;
  worktree: string;
  home: string;
  git: (cwd: string, ...args: string[]) => Promise<GitResult>;
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture(prepared: boolean): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'reference-transaction-hook-'));
  roots.push(dir);
  const root = join(dir, 'root');
  const worktree = join(dir, 'feature');
  const home = join(dir, 'empty-home');
  await Promise.all([mkdir(root), mkdir(home)]);
  await initTestRepo(root);
  const realGit = await resolveRealGit(process.env.PATH ?? '');

  const git = async (cwd: string, ...args: string[]): Promise<GitResult> => {
    const result = await execa(realGit, args, {
      cwd,
      env: { ...process.env, HOME: home },
      reject: false,
    });
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
  };
  await writeFile(join(root, 'base.txt'), 'base\n');
  expect((await git(root, 'add', 'base.txt')).exitCode).toBe(0);
  expect((await git(root, 'commit', '-m', 'base')).exitCode).toBe(0);
  expect((await git(root, 'branch', 'base')).exitCode).toBe(0);
  expect((await git(root, 'worktree', 'add', '-b', 'feature', worktree, 'main')).exitCode).toBe(0);
  if (prepared) await prepareWorktree(worktree);
  return { dir, root, worktree, home, git };
}

async function commit(fixture: Fixture, cwd: string, name: string): Promise<void> {
  await writeFile(join(cwd, name), `${name}\n`);
  expect((await fixture.git(cwd, 'add', name)).exitCode).toBe(0);
  expect((await fixture.git(cwd, 'commit', '-m', name)).exitCode).toBe(0);
}

async function uniqueTipBranch(fixture: Fixture): Promise<string> {
  const name = 'unique-tip';
  expect((await fixture.git(fixture.worktree, 'checkout', '-b', name)).exitCode).toBe(0);
  await commit(fixture, fixture.worktree, 'unique.txt');
  expect((await fixture.git(fixture.worktree, 'checkout', 'feature')).exitCode).toBe(0);
  return name;
}

describe('reference-transaction hook', () => {
  it.each([
    ['git branch -D', async (fixture: Fixture, branch: string) => fixture.git(fixture.worktree, 'branch', '-D', branch)],
    ['git update-ref -d', async (fixture: Fixture, branch: string) => fixture.git(fixture.worktree, 'update-ref', '-d', `refs/heads/${branch}`)],
  ])('refuses %s of a unique-tip local branch', async (_label, removeBranch) => {
    const fixture = await createFixture(true);
    const branch = await uniqueTipBranch(fixture);
    const tip = (await fixture.git(fixture.worktree, 'rev-parse', `refs/heads/${branch}`)).stdout;

    expect((await removeBranch(fixture, branch)).exitCode).not.toBe(0);
    expect((await fixture.git(fixture.worktree, 'rev-parse', `refs/heads/${branch}`)).stdout).toBe(tip);
  });

  it('refuses a unique-tip branch deletion even for an engine-marked process', async () => {
    const fixture = await createFixture(true);
    const branch = await uniqueTipBranch(fixture);
    const tip = (await fixture.git(fixture.worktree, 'rev-parse', `refs/heads/${branch}`)).stdout;
    const realGit = await resolveRealGit(process.env.PATH ?? '');
    const result = await execa(realGit, ['branch', '-D', branch], {
      cwd: fixture.worktree,
      env: { ...process.env, HOME: fixture.home, CONDUCT_ENGINE_COMMIT: '1' },
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect((await fixture.git(fixture.worktree, 'rev-parse', `refs/heads/${branch}`)).stdout).toBe(tip);
  });

  it('explains how to safely delete a refused unique-tip branch', async () => {
    const fixture = await createFixture(true);
    const branch = await uniqueTipBranch(fixture);
    const tip = (await fixture.git(fixture.worktree, 'rev-parse', `refs/heads/${branch}`)).stdout;

    const result = await fixture.git(fixture.worktree, 'branch', '-D', branch);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('refused branch deletion');
    expect(result.stderr).toContain(`refs/heads/${branch}`);
    expect(result.stderr).toContain('its commits would become unreachable');
    expect(result.stderr).toContain('push or merge it first');
    expect(result.stderr).toContain('git branch -d');
    expect((await fixture.git(fixture.worktree, 'rev-parse', `refs/heads/${branch}`)).stdout).toBe(tip);
  });

  it('explains how to safely rename a refused unique-tip branch', async () => {
    const fixture = await createFixture(true);
    const branch = await uniqueTipBranch(fixture);
    const newName = 'renamed-unique-tip';
    const tip = (await fixture.git(fixture.worktree, 'rev-parse', `refs/heads/${branch}`)).stdout;

    const result = await fixture.git(fixture.worktree, 'branch', '-m', branch, newName);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('create the new branch first');
    expect(result.stderr).toContain('git branch -d');
    expect((await fixture.git(fixture.worktree, 'rev-parse', `refs/heads/${branch}`)).stdout).toBe(tip);
  });

  it('allows deleting and renaming a branch whose tip remains in another local branch', async () => {
    const fixture = await createFixture(true);
    const branch = await uniqueTipBranch(fixture);
    const tip = (await fixture.git(fixture.worktree, 'rev-parse', branch)).stdout;
    expect((await fixture.git(fixture.worktree, 'branch', 'contains-tip', branch)).exitCode).toBe(0);

    expect((await fixture.git(fixture.worktree, 'branch', '-m', branch, 'renamed-tip')).exitCode).toBe(0);
    expect((await fixture.git(fixture.worktree, 'rev-parse', 'renamed-tip')).stdout).toBe(tip);
    expect((await fixture.git(fixture.worktree, 'branch', '-D', 'renamed-tip')).exitCode).toBe(0);
  });

  it('allows deleting a branch whose tip remains in its remote-tracking ref', async () => {
    const fixture = await createFixture(true);
    const bare = join(fixture.dir, 'remote.git');
    expect((await fixture.git(fixture.root, 'init', '--bare', bare)).exitCode).toBe(0);
    expect((await fixture.git(fixture.root, 'remote', 'add', 'origin', bare)).exitCode).toBe(0);
    const branch = await uniqueTipBranch(fixture);
    expect((await fixture.git(fixture.worktree, 'push', 'origin', `${branch}:${branch}`)).exitCode).toBe(0);
    expect((await fixture.git(fixture.worktree, 'fetch', 'origin')).exitCode).toBe(0);

    expect((await fixture.git(fixture.worktree, 'branch', '-D', branch)).exitCode).toBe(0);
  });

  it('allows pack-refs and gc to prune loose duplicates but retains packed unique branches', async () => {
    const fixture = await createFixture(true);
    const branch = await uniqueTipBranch(fixture);
    const tip = (await fixture.git(fixture.worktree, 'rev-parse', branch)).stdout;

    expect((await fixture.git(fixture.worktree, 'pack-refs', '--all')).exitCode).toBe(0);
    const gc = await fixture.git(fixture.worktree, 'gc');
    expect(gc.exitCode).toBe(0);
    expect(gc.stderr).not.toContain('failed to run pack-refs');
    expect((await fixture.git(fixture.worktree, 'rev-parse', branch)).stdout).toBe(tip);
    expect((await fixture.git(fixture.worktree, 'branch', '-D', branch)).exitCode).not.toBe(0);
    expect((await fixture.git(fixture.worktree, 'rev-parse', branch)).stdout).toBe(tip);
  });

  it('chains an allowed reference transaction to the repository hook', async () => {
    const fixture = await createFixture(true);
    const log = join(fixture.dir, 'reference-transaction.log');
    const hook = join(fixture.root, '.git', 'hooks', 'reference-transaction');
    await writeFile(hook, `#!/bin/bash\ncat > ${JSON.stringify(log)}\n`);
    await chmod(hook, 0o755);

    expect((await fixture.git(fixture.worktree, 'branch', 'chained-ref')).exitCode).toBe(0);
    expect(await readFile(log, 'utf8')).toContain('refs/heads/chained-ref');
  });

  it.each([
    ['git commit', async (fixture: Fixture) => {
      await writeFile(join(fixture.worktree, 'commit.txt'), 'commit\n');
      await fixture.git(fixture.worktree, 'add', 'commit.txt');
      return fixture.git(fixture.worktree, 'commit', '-m', 'ordinary commit');
    }],
    ['git commit --amend', async (fixture: Fixture) => fixture.git(fixture.worktree, 'commit', '--amend', '--no-edit')],
    ['git rebase base', async (fixture: Fixture) => {
      expect((await fixture.git(fixture.root, 'checkout', 'base')).exitCode).toBe(0);
      await commit(fixture, fixture.root, 'base-after-feature.txt');
      return fixture.git(fixture.worktree, 'rebase', 'base');
    }],
    ['git reset --keep target', async (fixture: Fixture) => {
      await commit(fixture, fixture.worktree, 'first.txt');
      const target = (await fixture.git(fixture.worktree, 'rev-parse', 'HEAD')).stdout;
      await commit(fixture, fixture.worktree, 'second.txt');
      return fixture.git(fixture.worktree, 'reset', '--keep', target);
    }],
    ['git branch -f other target', async (fixture: Fixture) => {
      const target = (await fixture.git(fixture.worktree, 'rev-parse', 'HEAD')).stdout;
      await commit(fixture, fixture.worktree, 'advanced.txt');
      expect((await fixture.git(fixture.worktree, 'branch', 'other', 'HEAD')).exitCode).toBe(0);
      return fixture.git(fixture.worktree, 'branch', '-f', 'other', target);
    }],
  ])('leaves %s with the same status as an identical unhooked worktree', async (_label, run) => {
    const prepared = await createFixture(true);
    const unhooked = await createFixture(false);

    const [withHook, withoutHook] = await Promise.all([run(prepared), run(unhooked)]);
    expect(withHook.exitCode).toBe(withoutHook.exitCode);
  });

  it('allows tag deletion', async () => {
    const fixture = await createFixture(true);
    expect((await fixture.git(fixture.worktree, 'tag', 'discard-me')).exitCode).toBe(0);

    expect((await fixture.git(fixture.worktree, 'tag', '-d', 'discard-me')).exitCode).toBe(0);
    expect((await fixture.git(fixture.worktree, 'rev-parse', '-q', '--verify', 'refs/tags/discard-me')).exitCode).not.toBe(0);
  });

  it('allows fetch --prune to remove a deleted remote-tracking branch', async () => {
    const fixture = await createFixture(true);
    const bare = join(fixture.dir, 'remote.git');
    expect((await fixture.git(fixture.root, 'init', '--bare', bare)).exitCode).toBe(0);
    expect((await fixture.git(fixture.root, 'remote', 'add', 'origin', bare)).exitCode).toBe(0);
    expect((await fixture.git(fixture.root, 'push', 'origin', 'main')).exitCode).toBe(0);
    expect((await fixture.git(fixture.root, 'branch', 'stale-remote', 'main')).exitCode).toBe(0);
    expect((await fixture.git(fixture.root, 'push', 'origin', 'stale-remote')).exitCode).toBe(0);
    expect((await fixture.git(fixture.worktree, 'fetch', 'origin')).exitCode).toBe(0);
    expect((await fixture.git(fixture.worktree, 'rev-parse', 'refs/remotes/origin/stale-remote')).exitCode).toBe(0);
    expect((await fixture.git(fixture.root, 'push', 'origin', '--delete', 'stale-remote')).exitCode).toBe(0);

    expect((await fixture.git(fixture.worktree, 'fetch', '--prune', 'origin')).exitCode).toBe(0);
    expect((await fixture.git(fixture.worktree, 'rev-parse', '-q', '--verify', 'refs/remotes/origin/stale-remote')).exitCode).not.toBe(0);
  });
});
