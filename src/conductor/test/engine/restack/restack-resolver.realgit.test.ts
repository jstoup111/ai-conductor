// Covers: task:14
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { resolveRestackConflict } from '../../../src/engine/restack/restack-resolver.js';
import type { CommitterStamp } from '../../../src/engine/restack/restack-replay.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { parseCommitSha, type ChildRange, type CommitSha } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

const stamp: CommitterStamp = {
  name: 'Journal Committer',
  email: 'journal@example.test',
  date: '2030-02-03T04:05:06Z',
};

interface Fixture {
  readonly repo: string;
  readonly range: ChildRange;
  readonly newParent: CommitSha;
  readonly carried: CommitSha;
  readonly empty: CommitSha;
  readonly conflicting: CommitSha;
}

function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw.trim());
  if (!parsed) throw new Error(`expected SHA, got ${raw}`);
  return parsed;
}

async function fixture(operatorConfig = false): Promise<Fixture> {
  const repo = await mkdtemp(join(tmpdir(), 'restack-resolver-'));
  repositories.push(repo);
  const git = (args: string[], env?: NodeJS.ProcessEnv) => execFile('git', args, { cwd: repo, env });
  const commit = async (message: string, paths: string[], date: string) => {
    await git(['add', ...paths]);
    await git(['commit', '-qm', message], {
      ...process.env,
      GIT_AUTHOR_NAME: 'Fixture Author',
      GIT_AUTHOR_EMAIL: 'fixture-author@example.test',
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: 'Fixture Committer',
      GIT_COMMITTER_EMAIL: 'fixture@example.test',
      GIT_COMMITTER_DATE: date,
    });
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'Fixture Committer']);
  await git(['config', 'user.email', 'fixture@example.test']);
  await writeFile(join(repo, 'shared.txt'), 'base\n');
  await writeFile(join(repo, 'carried.txt'), 'base\n');
  await commit('base', ['shared.txt', 'carried.txt'], '2020-01-01T00:00:00Z');
  const oldParent = sha((await git(['rev-parse', 'HEAD'])).stdout);

  await git(['checkout', '-qb', 'child']);
  await git(['commit', '--allow-empty', '-qm', 'started empty E'], {
    ...process.env,
    GIT_AUTHOR_NAME: 'Fixture Author', GIT_AUTHOR_EMAIL: 'fixture-author@example.test', GIT_AUTHOR_DATE: '2021-01-01T00:00:00Z',
    GIT_COMMITTER_NAME: 'Fixture Committer', GIT_COMMITTER_EMAIL: 'fixture@example.test', GIT_COMMITTER_DATE: '2021-01-01T00:00:00Z',
  });
  const empty = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await writeFile(join(repo, 'shared.txt'), 'child\n');
  await commit('conflicting C2', ['shared.txt'], '2021-01-02T00:00:00Z');
  const conflicting = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await writeFile(join(repo, 'carried.txt'), 'carried\n');
  await commit('already carried', ['carried.txt'], '2021-01-03T00:00:00Z');
  const oldTip = sha((await git(['rev-parse', 'HEAD'])).stdout);

  await git(['checkout', '-q', 'main']);
  await writeFile(join(repo, 'shared.txt'), 'main\n');
  await commit('main conflict', ['shared.txt'], '2022-01-01T00:00:00Z');
  await writeFile(join(repo, 'carried.txt'), 'carried\n');
  await commit('main carries change', ['carried.txt'], '2022-01-02T00:00:00Z');
  const newParent = sha((await git(['rev-parse', 'HEAD'])).stdout);
  const carried = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await git(['checkout', '-q', 'child']);
  if (operatorConfig) {
    await git(['config', 'rebase.updateRefs', 'true']);
    await git(['config', 'rebase.autoSquash', 'true']);
    await git(['config', 'merge.renames', 'false']);
  }
  const child = parseChildId(2);
  if (!child) throw new Error('child must parse');
  return { repo, range: { child, oldParent, oldTip, kind: 'active' }, newParent, carried, empty, conflicting };
}

async function worktreePaths(repo: string): Promise<string[]> {
  return (await execFile('git', ['worktree', 'list', '--porcelain'], { cwd: repo })).stdout
    .split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length));
}

async function refSnapshot(repo: string): Promise<string> {
  return (await execFile('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/'], { cwd: repo })).stdout;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('resolveRestackConflict (real local Git)', () => {
  it('resolves only the replay candidates in a detached temporary worktree, stamps every rewritten commit, and moves no real ref', async () => {
    const subject = await fixture();
    const beforeRefs = await refSnapshot(subject.repo);
    const rootCalls: string[][] = [];
    const rootGit = makeGitRunner(subject.repo);
    let dispatchEnvironment: NodeJS.ProcessEnv | undefined;
    let resolverWorktree = '';
    const result = await resolveRestackConflict({
      worktree: subject.repo,
      range: subject.range,
      newParent: subject.newParent,
      stamp,
      comparisonCommits: [subject.carried],
      resolver: async (context) => {
        dispatchEnvironment = context.environment;
        resolverWorktree = context.projectRoot;
        await writeFile(join(context.projectRoot, 'shared.txt'), 'resolved\n');
        const git = makeGitRunner(context.projectRoot);
        await git(['add', 'shared.txt'], { env: context.environment });
        await git(['rebase', '--continue'], { env: context.environment });
        return { resolved: true };
      },
      cap: 1,
      git: async (args, options) => {
        rootCalls.push(args);
        return rootGit(args, options);
      },
    });

    expect(result.outcome.kind).toBe('changed');
    expect(result.candidates).toEqual([subject.empty, subject.conflicting]);
    expect([...result.rewrites.keys()]).toEqual([subject.empty, subject.conflicting]);
    expect(resolverWorktree).toMatch(/\.pipeline\/restack\/resolve\/child-[^/]+$/);
    expect(await refSnapshot(subject.repo)).toBe(beforeRefs);
    expect(await worktreePaths(subject.repo)).toEqual([subject.repo]);
    const added = rootCalls.find((args) => args[0] === 'worktree' && args[1] === 'add');
    expect(added).toEqual(['worktree', 'add', '--detach', resolverWorktree, subject.range.oldTip]);
    expect(rootCalls).toContainEqual(['worktree', 'remove', '--force', resolverWorktree]);
    expect(rootCalls).toContainEqual(['worktree', 'prune']);
    expect(dispatchEnvironment).toMatchObject({
      GIT_COMMITTER_NAME: stamp.name,
      GIT_COMMITTER_EMAIL: stamp.email,
      GIT_COMMITTER_DATE: stamp.date,
    });
    for (const rewritten of result.rewrites.values()) {
      const { stdout } = await execFile('git', ['show', '-s', '--format=%cn%x00%ce%x00%cI', rewritten], { cwd: subject.repo });
      expect(stdout.trim()).toBe(`${stamp.name}\0${stamp.email}\0${stamp.date}`);
    }
  });

  it('cleans the detached worktree after a rejected resolver hand-off', async () => {
    const subject = await fixture();
    const result = await resolveRestackConflict({
      worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp,
      comparisonCommits: [subject.carried], cap: 1,
      resolver: async () => ({ resolved: false, reason: 'declined' }),
    });
    expect(result.outcome).toMatchObject({ kind: 'conflict_halt', reason: 'declined' });
    expect(await worktreePaths(subject.repo)).toEqual([subject.repo]);
  });

  it('cleans the detached worktree when resolver dispatch crashes', async () => {
    const subject = await fixture();
    await expect(resolveRestackConflict({
      worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp,
      comparisonCommits: [subject.carried], cap: 1,
      resolver: async () => { throw new Error('resolver crashed'); },
    })).rejects.toThrow('resolver crashed');
    expect(await worktreePaths(subject.repo)).toEqual([subject.repo]);
  });

  it('is invariant to operator rebase and rename configuration', async () => {
    const baseline = await fixture();
    const configured = await fixture(true);
    const resolve = async (context: { projectRoot: string; environment: NodeJS.ProcessEnv }) => {
      await writeFile(join(context.projectRoot, 'shared.txt'), 'resolved\n');
      const git = makeGitRunner(context.projectRoot);
      await git(['add', 'shared.txt'], { env: context.environment });
      await git(['rebase', '--continue'], { env: context.environment });
      return { resolved: true } as const;
    };
    const [first, second] = await Promise.all([
      resolveRestackConflict({ worktree: baseline.repo, range: baseline.range, newParent: baseline.newParent, stamp, comparisonCommits: [baseline.carried], resolver: resolve, cap: 1 }),
      resolveRestackConflict({ worktree: configured.repo, range: configured.range, newParent: configured.newParent, stamp, comparisonCommits: [configured.carried], resolver: resolve, cap: 1 }),
    ]);
    expect(second.candidates).toEqual(first.candidates);
    expect(second.tip).toBe(first.tip);
  });
});
