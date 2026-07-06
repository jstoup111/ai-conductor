// checkpoint.test.ts — unit tests for `checkpointSpec` (Task 16, Story TS-6).
//
// Mirrors the fixture convention in land-spec.test.ts / the RED acceptance spec
// (test/acceptance/pr-timing-engineer-lifecycle.acceptance.test.ts): a real git tmp
// repo stands in for the target, with a real per-idea worktree created via
// `createEngineerWorktree`, and a real `git init --bare` stands in for "origin".

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { checkpointSpec } from '../../../src/engine/engineer/checkpoint.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import type { GhRunner } from '../../../src/engine/owner-gate/identity.js';

const execFile = promisify(execFileCb);

let repoPath: string;
let origin: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

beforeEach(async () => {
  origin = await mkdtemp(join(tmpdir(), 'checkpoint-origin-'));
  await execFile('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: origin });

  repoPath = await mkdtemp(join(tmpdir(), 'checkpoint-repo-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'test@test.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-q', '-m', 'init']);
  await git(['remote', 'add', 'origin', origin]);
  await git(['push', '-q', '-u', 'origin', 'main']);
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
  await rm(origin, { recursive: true, force: true });
});

async function seedWorktree(idea: string): Promise<string> {
  const wt = await createEngineerWorktree(repoPath, idea);
  await mkdir(join(wt.worktreePath, '.docs', 'stories'), { recursive: true });
  await writeFile(join(wt.worktreePath, '.docs', 'stories', 'x.md'), '# stories\n');
  return wt.worktreePath;
}

describe('checkpointSpec', () => {
  it('commits ONLY .docs paths and plain-pushes spec/<slug> to origin', async () => {
    const worktree = await seedWorktree('dep bump');

    const result = await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'early-draft',
      identity: { resolved: true, id: 'operator@example.com' },
    });

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);

    const { stdout: log } = await execFile(
      'git',
      ['log', '-1', '--name-only', '--pretty=format:%s'],
      { cwd: worktree },
    );
    const files = log.trim().split('\n').slice(1);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.startsWith('.docs/'))).toBe(true);

    const remoteSha = await execFile('git', ['rev-parse', 'refs/heads/spec/dep-bump'], {
      cwd: origin,
    }).then((r) => r.stdout.trim());
    const localSha = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree }).then(
      (r) => r.stdout.trim(),
    );
    expect(remoteSha).toBe(localSha);
  });

  it('second checkpoint with no new content: no new commit (commit-iff-staged)', async () => {
    const worktree = await seedWorktree('dep bump');

    const first = await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'early-draft',
      identity: { resolved: true, id: 'operator@example.com' },
    });
    expect(first.committed).toBe(true);

    const afterFirst = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree }).then(
      (r) => r.stdout.trim(),
    );

    const second = await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'early-draft',
      identity: { resolved: true, id: 'operator@example.com' },
    });
    expect(second.committed).toBe(false);

    const afterSecond = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree }).then(
      (r) => r.stdout.trim(),
    );
    expect(afterSecond).toBe(afterFirst);
  });

  it('first push ahead of base creates a draft PR exactly once; second call reuses it', async () => {
    const worktree = await seedWorktree('dep bump');

    const calls: string[][] = [];
    const gh: GhRunner = async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'create') {
        return { stdout: 'https://github.com/acme/alpha/pull/7\n' };
      }
      return { stdout: '' };
    };

    await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'early-draft',
      identity: { resolved: true, id: 'operator@example.com' },
      gh,
    });
    await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'early-draft',
      identity: { resolved: true, id: 'operator@example.com' },
      gh,
    });

    const createCalls = calls.filter((a) => a[0] === 'pr' && a[1] === 'create');
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toContain('--draft');
  });

  it('non-.docs dirty files are excluded from the checkpoint commit', async () => {
    const worktree = await seedWorktree('dep bump');
    await writeFile(join(worktree, 'unrelated.txt'), 'do not commit me\n');

    await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'early-draft',
      identity: { resolved: true, id: 'operator@example.com' },
    });

    const { stdout: log } = await execFile(
      'git',
      ['log', '-1', '--name-only', '--pretty=format:%s'],
      { cwd: worktree },
    );
    const files = log.trim().split('\n').slice(1);
    expect(files).not.toContain('unrelated.txt');

    const { stdout: status } = await execFile('git', ['status', '--porcelain'], { cwd: worktree });
    expect(status).toContain('unrelated.txt');
  });

  it('unresolved identity: zero commits/pushes (fail-fast no-op)', async () => {
    const worktree = await seedWorktree('dep bump');
    const before = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree }).then(
      (r) => r.stdout.trim(),
    );

    const result = await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'early-draft',
      identity: { resolved: false },
    });

    expect(result.committed).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.skippedReason).toBe('identity-unresolved');

    const after = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree }).then(
      (r) => r.stdout.trim(),
    );
    expect(after).toBe(before);

    const remoteExists = await execFile('git', ['rev-parse', 'refs/heads/spec/dep-bump'], {
      cwd: origin,
    }).then(
      () => true,
      () => false,
    );
    expect(remoteExists).toBe(false);
  });

  it('finish mode: no gh/PR activity — checkpoint publish is early-draft-only', async () => {
    const worktree = await seedWorktree('dep bump');

    const calls: string[][] = [];
    const gh: GhRunner = async (args: string[]) => {
      calls.push(args);
      return { stdout: '' };
    };

    const result = await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'finish',
      identity: { resolved: true, id: 'operator@example.com' },
      gh,
    });

    expect(calls).toHaveLength(0);
    expect(result.drafted).toBe(false);
    expect(result.prUrl).toBeUndefined();
    expect(result.committed).toBe(false);
    expect(result.pushed).toBe(false);
  });

  it('push failure (no remote): logs loudly, resolves without throwing', async () => {
    const wt = await createEngineerWorktree(repoPath, 'dep bump 2');
    const worktree = wt.worktreePath;
    await execFile('git', ['remote', 'remove', 'origin'], { cwd: repoPath }).catch(() => undefined);
    await mkdir(join(worktree, '.docs', 'stories'), { recursive: true });
    await writeFile(join(worktree, '.docs', 'stories', 'x.md'), '# stories\n');

    const logs: string[] = [];
    await expect(
      checkpointSpec({
        worktreePath: worktree,
        slug: 'dep-bump-2',
        prTiming: 'early-draft',
        identity: { resolved: true, id: 'operator@example.com' },
        log: (m: string) => logs.push(m),
      }),
    ).resolves.not.toThrow();

    expect(logs.length).toBeGreaterThan(0);
  });
});
