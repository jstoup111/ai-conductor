// Covers: task:9
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { resolveRealGit } from '../../src/engine/git-guard.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { initTestRepo } from '../fixtures/git-repo.js';

type Result = { exitCode: number; stdout: string; stderr: string };
type Fixture = { dir: string; root: string; worktree: string; bare: string; git: (cwd: string, ...args: string[]) => Promise<Result> };
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'ref-hook-chaining-')); roots.push(dir);
  const root = join(dir, 'root'); const worktree = join(dir, 'feature'); const bare = join(dir, 'remote.git'); const home = join(dir, 'home');
  await Promise.all([mkdir(root), mkdir(home)]); await initTestRepo(root);
  const realGit = await resolveRealGit(process.env.PATH ?? '');
  const git = async (cwd: string, ...args: string[]) => {
    const r = await execa(realGit, args, { cwd, env: { ...process.env, HOME: home }, reject: false });
    return { exitCode: r.exitCode ?? 1, stdout: r.stdout, stderr: r.stderr };
  };
  await writeFile(join(root, 'base'), 'base\n'); await git(root, 'add', 'base'); await git(root, 'commit', '-m', 'base');
  await git(root, 'init', '--bare', bare); await git(root, 'remote', 'add', 'origin', bare); await git(root, 'push', 'origin', 'main');
  await git(root, 'worktree', 'add', '-b', 'feature', worktree, 'main'); await prepareWorktree(worktree); await git(worktree, 'remote', 'add', 'origin', bare); await git(worktree, 'fetch', 'origin');
  return { dir, root, worktree, bare, git };
}

async function repositoryHook(f: Fixture, name: string, log: string, status = 0): Promise<void> {
  const hook = join(f.root, '.git', 'hooks', name);
  await writeFile(hook, `#!/bin/bash\nprintf '%s\\n' \"$*\" >> ${JSON.stringify(log)}\ncat >> ${JSON.stringify(log)}\nexit ${status}\n`);
  await chmod(hook, 0o755);
}

describe('ref hook chaining', () => {
  it('forwards allowed push arguments and stdin exactly once', async () => {
    const f = await fixture(); const log = join(f.dir, 'push.log'); await repositoryHook(f, 'pre-push', log);
    expect((await f.git(f.worktree, 'push', 'origin', 'HEAD:allowed')).exitCode).toBe(0);
    const contents = await readFile(log, 'utf8'); expect(contents).toContain('origin'); expect(contents).toContain('refs/heads/allowed');
  });

  it('forwards an allowed prepared branch transaction', async () => {
    const f = await fixture(); const log = join(f.dir, 'transaction.log'); await repositoryHook(f, 'reference-transaction', log);
    expect((await f.git(f.worktree, 'branch', 'allowed-ref')).exitCode).toBe(0);
    const contents = await readFile(log, 'utf8'); expect(contents).toContain('prepared'); expect(contents).toContain('refs/heads/allowed-ref');
  });

  it('propagates a repository pre-push veto', async () => {
    const f = await fixture(); const log = join(f.dir, 'veto.log'); await repositoryHook(f, 'pre-push', log, 1);
    const before = (await f.git(f.bare, 'rev-parse', 'main')).stdout;
    await writeFile(join(f.worktree, 'allowed'), 'x\n'); await f.git(f.worktree, 'add', 'allowed'); await f.git(f.worktree, 'commit', '-m', 'allowed');
    const result = await f.git(f.worktree, 'push', 'origin', 'HEAD:main');
    expect(result.exitCode).not.toBe(0); expect((await f.git(f.bare, 'rev-parse', 'main')).stdout).toBe(before); expect(await readFile(log, 'utf8')).toContain('refs/heads/main');
  });

  it('does not chain after its own refusal', async () => {
    const f = await fixture(); const log = join(f.dir, 'refused.log'); await repositoryHook(f, 'pre-push', log);
    const clone = join(f.dir, 'advance'); expect((await f.git(f.root, 'clone', '-b', 'main', f.bare, clone)).exitCode).toBe(0);
    await f.git(clone, 'config', 'user.name', 'Test User'); await f.git(clone, 'config', 'user.email', 'test@example.invalid'); await writeFile(join(clone, 'advance'), 'x\n'); await f.git(clone, 'add', 'advance'); await f.git(clone, 'commit', '-m', 'advance'); await f.git(clone, 'push', 'origin', 'main');
    await writeFile(join(f.worktree, 'rewrite'), 'x\n'); await f.git(f.worktree, 'add', 'rewrite'); await f.git(f.worktree, 'commit', '-m', 'rewrite');
    expect((await f.git(f.worktree, 'push', '--force', 'origin', 'HEAD:main')).exitCode).not.toBe(0);
    await expect(readFile(log, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('skips a non-executable repository pre-push hook', async () => {
    const f = await fixture(); const log = join(f.dir, 'not-executable.log'); const hook = join(f.root, '.git', 'hooks', 'pre-push');
    await writeFile(hook, `#!/bin/bash\necho ran > ${JSON.stringify(log)}\n`);
    expect((await f.git(f.worktree, 'push', 'origin', 'HEAD:skipped')).exitCode).toBe(0);
    await expect(readFile(log, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
