// Covers: task:10
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { execa } from 'execa';

import { makeGitRunner } from '../../src/engine/rebase.js';
import { resolveRealGit } from '../../src/engine/git-guard.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { initTestRepo } from '../fixtures/git-repo.js';

type Result = { exitCode: number; stdout: string; stderr: string };
type Fixture = { root: string; feature: string; bare: string; clone: string; bin: string; home: string; git: (cwd: string, ...args: string[]) => Promise<Result> };
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'ref-hooks-engine-')); roots.push(dir);
  const root = join(dir, 'root'); const feature = join(dir, 'feature'); const bare = join(dir, 'remote.git'); const clone = join(dir, 'clone'); const bin = join(dir, 'bin'); const home = join(dir, 'home');
  await Promise.all([mkdir(root), mkdir(bin), mkdir(home)]); await initTestRepo(root);
  const realGit = await resolveRealGit(process.env.PATH ?? '');
  await symlink(realGit, join(bin, 'git'));
  const git = async (cwd: string, ...args: string[]): Promise<Result> => {
    const result = await execa(realGit, args, { cwd, env: { ...process.env, HOME: home }, reject: false });
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
  };
  await writeFile(join(root, 'base.txt'), 'base\n'); await git(root, 'add', 'base.txt'); await git(root, 'commit', '-m', 'base');
  await git(root, 'init', '--bare', bare); await git(root, 'remote', 'add', 'origin', bare); await git(root, 'push', 'origin', 'main');
  await git(root, 'worktree', 'add', '-b', 'feature', feature, 'main'); await prepareWorktree(feature); await git(feature, 'remote', 'add', 'origin', bare); await git(feature, 'fetch', 'origin');
  await git(root, 'clone', '-b', 'main', bare, clone); await git(clone, 'config', 'user.name', 'Test User'); await git(clone, 'config', 'user.email', 'test@example.invalid');
  return { root, feature, bare, clone, bin, home, git };
}

async function withIsolatedEngineGit<T>(f: Fixture, cwd: string, operation: (git: ReturnType<typeof makeGitRunner>) => Promise<T>): Promise<T> {
  const previousPath = process.env.PATH;
  const previousHome = process.env.HOME;
  process.env.PATH = `${f.bin}${delimiter}${previousPath ?? ''}`;
  process.env.HOME = f.home;
  try {
    return await operation(makeGitRunner(cwd));
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
}

async function commit(f: Fixture, cwd: string, file: string): Promise<void> {
  await writeFile(join(cwd, file), `${file}\n`); await f.git(cwd, 'add', file); expect((await f.git(cwd, 'commit', '-m', file)).exitCode).toBe(0);
}

describe('engine ref operations with installed ref hooks', () => {
  it('permits engine quarantine and recovery ref moves in a prepared worktree', async () => {
    const f = await fixture(); const before = (await f.git(f.feature, 'rev-parse', 'HEAD')).stdout;
    await commit(f, f.root, 'recovery.txt'); const recovery = (await f.git(f.root, 'rev-parse', 'HEAD')).stdout;
    await withIsolatedEngineGit(f, f.feature, async (git) => {
      const globalConfig = await git(['config', '--global', '--list']);
      expect(globalConfig.exitCode).not.toBe(0); expect(globalConfig.stdout).toBe('');
      expect((await git(['branch', '-f', 'wip/setup-quarantine-slug', before])).exitCode).toBe(0);
      expect((await git(['update-ref', 'HEAD', recovery, before])).exitCode).toBe(0);
    });
    expect((await f.git(f.feature, 'rev-parse', 'wip/setup-quarantine-slug')).stdout).toBe(before);
    expect((await f.git(f.feature, 'rev-parse', 'HEAD')).stdout).toBe(recovery);
  });

  it('permits a current bare lease and leaves a stale lease to git', async () => {
    const f = await fixture();
    await commit(f, f.feature, 'pre-rewrite.txt');
    expect((await f.git(f.feature, 'push', 'origin', 'HEAD:main')).exitCode).toBe(0);
    expect((await f.git(f.feature, 'fetch', 'origin')).exitCode).toBe(0);
    const remoteTip = (await f.git(f.feature, 'rev-parse', 'origin/main')).stdout;
    expect((await f.git(f.feature, 'reset', '--hard', 'HEAD~1')).exitCode).toBe(0);
    await commit(f, f.feature, 'rewrite.txt');
    expect((await f.git(f.feature, 'merge-base', '--is-ancestor', remoteTip, 'HEAD')).exitCode).not.toBe(0);
    await withIsolatedEngineGit(f, f.feature, async (git) => {
      expect((await git(['push', '-u', 'origin', 'HEAD:refs/heads/main', '--force-with-lease'])).exitCode).toBe(0);
    });
    expect((await f.git(f.bare, 'rev-parse', 'main')).stdout).toBe((await f.git(f.feature, 'rev-parse', 'HEAD')).stdout);
    expect((await f.git(f.feature, 'fetch', 'origin')).exitCode).toBe(0);
    expect((await f.git(f.clone, 'fetch', 'origin')).exitCode).toBe(0);
    expect((await f.git(f.clone, 'reset', '--hard', 'origin/main')).exitCode).toBe(0);
    await commit(f, f.clone, 'remote-advance.txt'); expect((await f.git(f.clone, 'push', 'origin', 'main')).exitCode).toBe(0);
    await commit(f, f.feature, 'local-rewrite.txt');
    const stale = await withIsolatedEngineGit(f, f.feature, (git) => git(['push', '-u', 'origin', 'HEAD:refs/heads/main', '--force-with-lease']));
    expect(stale.exitCode).not.toBe(0); expect(stale.stderr).toContain('stale info'); expect(stale.stderr).not.toContain('has not fetched');
  });

  it('scopes branch-deletion protection to the prepared feature worktree', async () => {
    const f = await fixture(); expect((await f.git(f.feature, 'checkout', '-b', 'unique-tip')).exitCode).toBe(0); await commit(f, f.feature, 'unique.txt'); const tip = (await f.git(f.feature, 'rev-parse', 'HEAD')).stdout;
    expect((await f.git(f.feature, 'checkout', 'feature')).exitCode).toBe(0);
    expect((await withIsolatedEngineGit(f, f.root, (git) => git(['branch', '-D', 'unique-tip']))).exitCode).toBe(0);
    expect((await f.git(f.root, 'rev-parse', '-q', '--verify', 'refs/heads/unique-tip')).exitCode).not.toBe(0);
    expect((await f.git(f.feature, 'branch', 'unique-tip', tip)).exitCode).toBe(0);
    expect((await withIsolatedEngineGit(f, f.feature, (git) => git(['branch', '-D', 'unique-tip']))).exitCode).not.toBe(0);
    expect((await f.git(f.feature, 'rev-parse', 'refs/heads/unique-tip')).stdout).toBe(tip);
  });
});
