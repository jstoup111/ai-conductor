// Covers: task:2, task:14, task:rem-as-built-R2
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { missingCandidateSubjects } from '../../../src/engine/restack/restack-conflict-record.js';
import { replayCandidateSubjects, resolveRestackConflict } from '../../../src/engine/restack/restack-resolver.js';
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

async function mergeFixture(kind: 'q-carried' | 'ancestry-only' | 'flattened'): Promise<{
  repo: string;
  range: ChildRange;
  newParent: CommitSha;
  ordinaryBeforeMerge: CommitSha;
  merge: CommitSha;
  ordinaryAfterMerge: CommitSha;
  sideSubject: string;
}> {
  const repo = await mkdtemp(join(tmpdir(), 'restack-resolver-merge-'));
  repositories.push(repo);
  const git = (args: string[], env?: NodeJS.ProcessEnv) => execFile('git', args, { cwd: repo, env });
  const commit = async (subject: string) => {
    await git(['add', '.']);
    await git(['commit', '-qm', subject]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'Merge fixture']);
  await git(['config', 'user.email', 'merge-fixture@example.test']);
  await writeFile(join(repo, 'shared.txt'), 'base\n');
  await writeFile(join(repo, 'side.txt'), 'base\n');
  const base = await commit('base');
  await git(['checkout', '-qb', 'child']);
  await writeFile(join(repo, 'child.txt'), 'C\n');
  const ordinaryBeforeMerge = await commit('C');
  await git(['checkout', '-qb', 'side', base]);
  await writeFile(join(repo, 'side.txt'), 'side work\n');
  const sideSubject = 'S';
  await commit(sideSubject);
  await git(['checkout', '-q', 'main']);
  if (kind !== 'flattened') {
    await git(['merge', '--no-ff', '-m', 'carry side', 'side']);
    await writeFile(join(repo, 'side.txt'), 'later main edit\n');
    await commit('later main edit');
  }
  await writeFile(join(repo, 'shared.txt'), 'parent conflict\n');
  const newParent = await commit('parent conflict');
  await git(['checkout', '-q', 'child']);
  if (kind === 'q-carried') {
    await git(['merge', '--no-ff', '--no-commit', 'side']);
    await writeFile(join(repo, 'hand.txt'), 'hand edit\n');
    await git(['add', 'hand.txt']);
    await git(['commit', '-qm', 'M']);
  } else {
    await git(['merge', '--no-ff', '-m', 'M', 'side']);
  }
  const merge = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await writeFile(join(repo, 'shared.txt'), 'later child edit\n');
  const ordinaryAfterMerge = await commit('T');
  const child = parseChildId(2);
  if (!child) throw new Error('child must parse');
  return { repo, range: { child, oldParent: base, oldTip: ordinaryAfterMerge, kind: 'active' }, newParent, ordinaryBeforeMerge, merge, ordinaryAfterMerge, sideSubject };
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('resolveRestackConflict (real local Git)', () => {
  it('replays a q-carried merge from the flattened todo, maps its rewrite to the original merge, and omits side lineage', async () => {
    const subject = await mergeFixture('q-carried');
    const result = await resolveRestackConflict({
      worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp, cap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'shared.txt'), 'settled child edit\n');
        const git = makeGitRunner(context.projectRoot);
        await git(['add', 'shared.txt'], { env: context.environment });
        await git(['rebase', '--continue'], { env: context.environment });
        return { resolved: true };
      },
    });

    expect(result.outcome.kind).toBe('changed');
    expect(result.tip).toBeDefined();
    expect((await execFile('git', ['show', `${result.tip}:hand.txt`], { cwd: subject.repo })).stdout).toBe('hand edit\n');
    expect((await execFile('git', ['show', `${result.tip}:side.txt`], { cwd: subject.repo })).stdout).toBe('later main edit\n');
    expect((await execFile('git', ['log', '--format=%s', `${subject.newParent}..${result.tip}`], { cwd: subject.repo })).stdout).toContain('M');
    expect((await execFile('git', ['log', '--format=%s', `${subject.newParent}..${result.tip}`], { cwd: subject.repo })).stdout).not.toContain(subject.sideSubject);
    const candidateSubjects = await replayCandidateSubjects(makeGitRunner(subject.repo), result.candidates);
    expect(candidateSubjects).not.toContain(subject.sideSubject);
    await expect(missingCandidateSubjects(makeGitRunner(subject.repo), subject.newParent, result.tip!, candidateSubjects)).resolves.toEqual([]);
    expect(result.rewrites.get(subject.merge)).toBeDefined();
    expect(result.audit).toMatchObject({ flattenedMerges: [] });
  });

  it('maps a not-carried flattened merge rewrite to its original merge and reports it in the audit', async () => {
    const subject = await mergeFixture('flattened');
    const result = await resolveRestackConflict({
      worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp, cap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'shared.txt'), 'settled child edit\n');
        const git = makeGitRunner(context.projectRoot);
        await git(['add', 'shared.txt'], { env: context.environment });
        await git(['rebase', '--continue'], { env: context.environment });
        return { resolved: true };
      },
    });
    const candidateSubjects = await replayCandidateSubjects(makeGitRunner(subject.repo), result.candidates);
    expect(result.outcome.kind).toBe('changed');
    expect(result.rewrites.get(subject.merge)).toBeDefined();
    expect(result.audit).toMatchObject({ flattenedMerges: [subject.merge] });
    expect(candidateSubjects).not.toContain(subject.sideSubject);
  });

  it('maps missing-hook fallback rewrites from synthetic C, M, T commits to their original commits', async () => {
    const subject = await mergeFixture('flattened');
    const noHooks = join(subject.repo, 'no-post-rewrite-hooks');
    await mkdir(noHooks);
    const result = await resolveRestackConflict({
      worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp, cap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'shared.txt'), 'settled child edit\n');
        const git = makeGitRunner(context.projectRoot);
        await git(['add', 'shared.txt'], { env: context.environment });
        await git(['rebase', '--continue'], { env: context.environment });
        return { resolved: true };
      },
      temporaryGit: (worktree) => async (args, options) => makeGitRunner(worktree)(args, {
        ...options,
        env: { ...options?.env, GIT_CONFIG_VALUE_0: noHooks },
      }),
    });

    expect(result.outcome.kind).toBe('changed');
    expect([...result.rewrites.keys()].sort()).toEqual([
      subject.ordinaryBeforeMerge,
      subject.merge,
      subject.ordinaryAfterMerge,
    ].sort());
  });

  it('preserves the no-merge resolver path and reports no merge audit', async () => {
    const subject = await fixture();
    const result = await resolveRestackConflict({
      worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp,
      comparisonCommits: [subject.carried], cap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'shared.txt'), 'resolved\n');
        const git = makeGitRunner(context.projectRoot);
        await git(['add', 'shared.txt'], { env: context.environment });
        await git(['rebase', '--continue'], { env: context.environment });
        return { resolved: true };
      },
    });
    expect(result.candidates).toEqual([subject.empty, subject.conflicting]);
    expect(result.audit).toBeUndefined();
  });

  it('accepts an ancestry-only merge without requiring its merge subject in the settled history', async () => {
    const subject = await mergeFixture('ancestry-only');
    const result = await resolveRestackConflict({
      worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp, cap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'shared.txt'), 'hand edit\n');
        const git = makeGitRunner(context.projectRoot);
        await git(['add', 'shared.txt'], { env: context.environment });
        await git(['rebase', '--continue'], { env: context.environment });
        return { resolved: true };
      },
    });
    const subjects = (await execFile('git', ['log', '--format=%s', `${subject.newParent}..${result.tip}`], { cwd: subject.repo })).stdout;
    expect(result.outcome.kind).toBe('changed');
    expect(subjects).not.toContain('M');
    expect(result.audit).toMatchObject({ ancestryOnlyMerges: [subject.merge] });
  });

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

  it('uses the settled checkout HEAD and rebuilds rewrites when a replayed resolver session left no rewrite list', async () => {
    const subject = await fixture();
    const result = await resolveRestackConflict({
      worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp,
      comparisonCommits: [subject.carried], cap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'shared.txt'), 'resolved\n');
        const git = makeGitRunner(context.projectRoot);
        // A provider session that never received context.environment: the
        // rebase finishes, but the engine's post-rewrite hook does not run.
        await git(['add', 'shared.txt']);
        await git(['rebase', '--continue'], { env: { GIT_EDITOR: 'true' } });
        return { resolved: true };
      },
    });
    // The provider omitted the hook environment, but the settled detached
    // checkout still carries every candidate. Its HEAD is authoritative and
    // unique subjects reconstruct the rewrite map.
    expect(result.tip).toBeDefined();
    expect(result.tip).not.toBe(subject.newParent);
    expect(result.outcome).toMatchObject({ kind: 'changed' });
    expect([...result.rewrites.keys()]).toEqual([subject.empty, subject.conflicting]);
    expect(await worktreePaths(subject.repo)).toEqual([subject.repo]);
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
