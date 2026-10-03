// Covers: task:6, task:7, task:8
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { resolveRealGit } from '../../src/engine/git-guard.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { initTestRepo } from '../fixtures/git-repo.js';

interface Fixture { dir: string; root: string; worktree: string; clone: string; bare: string; git: (cwd: string, ...args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>; }
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'pre-push-hook-'));
  roots.push(dir);
  const root = join(dir, 'root'); const worktree = join(dir, 'feature'); const clone = join(dir, 'advance'); const home = join(dir, 'home'); const bare = join(dir, 'remote.git');
  await Promise.all([mkdir(root), mkdir(home)]); await initTestRepo(root);
  const realGit = await resolveRealGit(process.env.PATH ?? '');
  const git = async (cwd: string, ...args: string[]) => {
    const result = await execa(realGit, args, { cwd, env: { ...process.env, HOME: home }, reject: false });
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
  };
  await writeFile(join(root, 'base.txt'), 'base\n'); await git(root, 'add', 'base.txt'); await git(root, 'commit', '-m', 'base');
  await git(root, 'init', '--bare', bare); await git(root, 'remote', 'add', 'origin', bare); await git(root, 'push', 'origin', 'main');
  await git(root, 'worktree', 'add', '-b', 'feature', worktree, 'main'); await prepareWorktree(worktree);
  await git(worktree, 'remote', 'add', 'origin', bare); await git(worktree, 'fetch', 'origin');
  expect((await git(root, 'clone', '-b', 'main', bare, clone)).exitCode).toBe(0);
  await git(clone, 'config', 'user.name', 'Test User'); await git(clone, 'config', 'user.email', 'test@example.invalid');
  return { dir, root, worktree, clone, bare, git };
}

async function commit(f: Fixture, cwd: string, file: string): Promise<void> {
  await writeFile(join(cwd, file), `${file}\n`); await f.git(cwd, 'add', file); expect((await f.git(cwd, 'commit', '-m', file)).exitCode).toBe(0);
}

async function staleRewrite(f: Fixture): Promise<void> {
  await commit(f, f.clone, 'remote-advance.txt'); expect((await f.git(f.clone, 'push', 'origin', 'main')).exitCode).toBe(0);
  await commit(f, f.worktree, 'local-rewrite.txt');
}

describe('pre-push hook', () => {
  it.each([
    ['--force', ['push', '--force', 'origin', 'HEAD:main']],
    ['plus refspec', ['push', 'origin', '+HEAD:main']],
    ['explicit stale lease', ['push', '--force-with-lease=main:0000000000000000000000000000000000000000', 'origin', 'HEAD:main']],
  ])('refuses a stale non-fast-forward %s and explains recovery', async (_label, args) => {
    const f = await fixture(); await staleRewrite(f);
    const result = await f.git(f.worktree, ...args);
    expect(result.exitCode).not.toBe(0); expect(result.stderr).toContain('refused push to refs/heads/main');
    expect(result.stderr).toContain('would overwrite remote history this worktree has not fetched');
    expect(result.stderr).toContain('git fetch'); expect(result.stderr).toContain('git push --force-with-lease');
    expect(result.stdout).toBe('');
    expect((await f.git(f.bare, 'rev-parse', 'main')).stdout).toBe((await f.git(f.clone, 'rev-parse', 'main')).stdout);
  });

  it('allows a force update when the tracking ref proves the remote value and permits new and delete refs', async () => {
    const f = await fixture(); await commit(f, f.worktree, 'rewrite.txt');
    expect((await f.git(f.worktree, 'push', '--force-with-lease', 'origin', 'HEAD:main')).exitCode).toBe(0);
    await commit(f, f.worktree, 'second-rewrite.txt');
    expect((await f.git(f.worktree, 'push', '--force', 'origin', 'HEAD:main')).exitCode).toBe(0);
    await commit(f, f.worktree, 'fast-forward.txt'); expect((await f.git(f.worktree, 'push', 'origin', 'HEAD:main')).exitCode).toBe(0);
    expect((await f.git(f.worktree, 'push', 'origin', 'HEAD:new-branch')).exitCode).toBe(0);
    expect((await f.git(f.worktree, 'push', 'origin', '--delete', 'new-branch')).exitCode).toBe(0);
    expect((await f.git(f.bare, 'rev-parse', '-q', '--verify', 'new-branch')).exitCode).not.toBe(0);
  });
});
