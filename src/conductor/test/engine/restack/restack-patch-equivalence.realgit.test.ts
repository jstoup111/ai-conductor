// Covers: task:11
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { replayChildRange, type CommitterStamp } from '../../../src/engine/restack/restack-replay.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const stamp: CommitterStamp = {
  name: 'Restack Journal',
  email: 'journal@example.test',
  date: '2030-02-03T04:05:06Z',
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

interface Repository {
  readonly path: string;
  readonly git: (args: string[]) => Promise<{ readonly stdout: string; readonly stderr: string }>;
  readonly commit: (message: string, path: string, content: string) => Promise<string>;
}

async function createRepository(): Promise<Repository> {
  const path = await mkdtemp(join(tmpdir(), 'restack-patch-equivalence-'));
  repositories.push(path);
  const git = async (args: string[]) => execFile('git', args, { cwd: path });
  const commit = async (message: string, file: string, content: string) => {
    await writeFile(join(path, file), content);
    await git(['add', file]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack Patch Equivalence']);
  await commit('base', 'base.txt', 'base\n');
  return { path, git, commit };
}

async function commits(repo: Repository, range: string): Promise<string[]> {
  return (await repo.git(['rev-list', '--reverse', range])).stdout.split('\n').filter(Boolean);
}

function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw.trim());
  if (!parsed) throw new Error(`expected Git object name, got ${raw}`);
  return parsed;
}

describe('runRestack patch equivalence (real local Git)', () => {
  it('drops a child patch cherry-picked into the advancing default branch', async () => {
    const repo = await createRepository();
    await repo.commit('shared base', 'shared.txt', 'base\n');
    await repo.git(['checkout', '-qb', 'feat/c1/demo']);
    await repo.commit('A1', 'a1.txt', 'a1\n');
    const a2 = await repo.commit('A2', 'shared.txt', 'feature\n');
    await repo.git(['update-ref', 'refs/conductor/demo/closed/c1', a2]);
    await repo.git(['checkout', '-qb', 'feat/daemon-demo']);
    await repo.commit('L1', 'leaf.txt', 'leaf\n');
    await repo.git(['checkout', '-q', 'main']);
    await repo.git(['cherry-pick', a2]);
    const advanced = await repo.commit('main follow-up', 'shared.txt', 'main\n');
    await repo.git(['checkout', '-q', 'feat/daemon-demo']);

    const result = await runRestack({
      worktree: repo.path,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: advanced,
      git: makeGitRunner(repo.path),
    });

    expect(result.kind).toBe('applied');
    expect(await commits(repo, `${advanced}..feat/c1/demo`)).toHaveLength(1);
    expect((await repo.git(['show', 'feat/c1/demo:a1.txt'])).stdout).toBe('a1\n');
    expect((await repo.git(['show', 'feat/c1/demo:shared.txt'])).stdout).toBe('main\n');
  });

  it('drops a repair patch already cherry-picked into an upper child', async () => {
    const repo = await createRepository();
    await repo.git(['checkout', '-qb', 'feat/c1/demo']);
    const closure = await repo.commit('C1', 'c1.txt', 'c1\n');
    await repo.git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
    await repo.git(['checkout', '-qb', 'feat/c2/demo']);
    await repo.commit('C2', 'c2.txt', 'c2\n');
    await repo.git(['checkout', '-q', 'feat/c1/demo']);
    const x = await repo.commit('X', 'x.txt', 'x\n');
    await repo.git(['checkout', '-q', 'feat/c2/demo']);
    await repo.git(['cherry-pick', x]);
    const x2 = (await repo.git(['rev-parse', 'HEAD'])).stdout.trim();
    const child = parseChildId(2);
    if (!child) throw new Error('child 2 should be valid');
    const replay = await replayChildRange({
      child,
      oldParent: sha(closure),
      oldTip: sha(x2),
      kind: 'closed',
    }, sha(x), stamp, makeGitRunner(repo.path), { comparisonCommits: [sha(x)] });

    expect(replay.rewrites.has(sha(x2))).toBe(false);
    expect(await commits(repo, `${x}..${replay.tip}`)).toHaveLength(1);
  });

  it('replays a child re-application even when its patch-id also exists below the child', async () => {
    const repo = await createRepository();
    await repo.git(['checkout', '-qb', 'feat/c1/demo']);
    const a1 = await repo.commit('A1', 'a1.txt', 'a1\n');
    await repo.git(['update-ref', 'refs/conductor/demo/closed/c1', a1]);
    await repo.git(['checkout', '-qb', 'feat/c2/demo']);
    await repo.git(['revert', '--no-edit', a1]);
    await repo.git(['cherry-pick', a1]);
    const reapplied = (await repo.git(['rev-parse', 'HEAD'])).stdout.trim();
    await repo.git(['update-ref', 'refs/conductor/demo/closed/c2', reapplied]);
    await repo.git(['checkout', '-qb', 'feat/daemon-demo']);
    await repo.commit('L1', 'leaf.txt', 'leaf\n');
    await repo.git(['checkout', '-q', 'main']);
    const advanced = await repo.commit('advance', 'advance.txt', 'advance\n');
    await repo.git(['checkout', '-q', 'feat/daemon-demo']);

    const result = await runRestack({
      worktree: repo.path,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: advanced,
      git: makeGitRunner(repo.path),
    });

    expect(result.kind).toBe('applied');
    expect(await commits(repo, 'refs/conductor/demo/closed/c1..feat/c2/demo')).toHaveLength(2);
    expect((await repo.git(['show', 'feat/c2/demo:a1.txt'])).stdout).toBe('a1\n');
  });
});
