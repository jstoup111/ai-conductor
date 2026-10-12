import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { replayChildRange, type CommitterStamp } from '../../../src/engine/restack/restack-replay.js';
import { resolveRestackConflict, type RestackResolver } from '../../../src/engine/restack/restack-resolver.js';
import type { ChildRange, CommitSha } from '../../../src/engine/restack/restack-types.js';
import { createSweepRepository, removeAll, sha, type SweepRepository } from './restack-sweepG2-fixture.js';

const execFile = promisify(execFileCallback);
const cleanup: string[] = [];
const stamp: CommitterStamp = { name: 'Journal Committer', email: 'journal@example.test', date: '2030-02-03T04:05:06Z' };

afterEach(async () => {
  vi.unstubAllEnvs();
  await removeAll(cleanup);
});

interface ResolverFixture extends SweepRepository {
  readonly range: ChildRange;
  readonly newParent: CommitSha;
  readonly carried: CommitSha;
  readonly empty: CommitSha;
  readonly conflicting: CommitSha;
  /** A parent with only the carried change, onto which the range replays cleanly. */
  readonly cleanParent: CommitSha;
  readonly cleanCarried: CommitSha;
}

/**
 * Child 2 holds a started-empty commit E, a commit C2 that conflicts with the
 * advance, and a commit whose patch the advance already carries.
 */
async function resolverFixture(): Promise<ResolverFixture> {
  const subject = await createSweepRepository('restack-resolver-sweep-', cleanup);
  await subject.write('shared.txt', 'base\n');
  await subject.git(['add', 'shared.txt']);
  const oldParent = await subject.commit('base', 'carried.txt', 'base\n');
  await subject.git(['checkout', '-qb', 'feat/c2/demo']);
  await subject.git(['commit', '--allow-empty', '-qm', 'started empty E']);
  const empty = await subject.rev('HEAD');
  const conflicting = await subject.commit('conflicting C2', 'shared.txt', 'child\n');
  const oldTip = await subject.commit('already carried', 'carried.txt', 'carried\n');
  await subject.git(['checkout', '-qb', 'clean-parent', oldParent]);
  const cleanCarried = await subject.commit('clean parent carries change', 'carried.txt', 'carried\n');
  await subject.git(['checkout', '-q', 'main']);
  await subject.commit('main conflict', 'shared.txt', 'main\n');
  const carried = await subject.commit('main carries change', 'carried.txt', 'carried\n');
  await subject.git(['checkout', '-q', 'feat/c2/demo']);
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', oldParent]);
  return {
    ...subject,
    range: { child: parseChildId(2)!, oldParent, oldTip, kind: 'active' },
    newParent: carried,
    carried,
    empty,
    conflicting,
    cleanParent: cleanCarried,
    cleanCarried,
  };
}

async function refSnapshot(subject: SweepRepository): Promise<string> {
  return (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/'])).stdout;
}

async function worktreePaths(subject: SweepRepository): Promise<string[]> {
  return (await subject.git(['worktree', 'list', '--porcelain'])).stdout
    .split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length));
}

function resolvingResolver(onDispatch?: (context: Parameters<RestackResolver>[0]) => Promise<void>): RestackResolver {
  return async (context) => {
    await onDispatch?.(context);
    await writeFile(join(context.projectRoot, 'shared.txt'), 'resolved\n');
    const git = makeGitRunner(context.projectRoot);
    await git(['add', 'shared.txt'], { env: context.environment });
    await git(['rebase', '--continue'], { env: context.environment });
    return { resolved: true };
  };
}

async function tracedArgv(path: string): Promise<string[][]> {
  const raw = await readFile(path, 'utf8');
  return raw.split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as { event?: string; argv?: string[] })
    .filter((event) => event.event === 'start' && Array.isArray(event.argv))
    .map((event) => event.argv!);
}

describe('resolveRestackConflict sweep (real local Git)', () => {
  // Covers: S6.1, S6.2, task:14
  it('runs rebase -i --onto newParent oldParent in a detached resolve worktree without autostash, moving no ref during the hand-off, and stamps every commit including rebase --continue', async () => {
    const subject = await resolverFixture();
    const traceDirectory = await mkdtemp(join(tmpdir(), 'restack-resolver-trace-'));
    cleanup.push(traceDirectory);
    const trace = join(traceDirectory, 'trace2.jsonl');
    vi.stubEnv('GIT_TRACE2_EVENT', trace);
    const before = await refSnapshot(subject);
    const observed: { refs?: string; head?: string; root?: string; onto?: string; headName?: string } = {};

    const result = await resolveRestackConflict({
      worktree: subject.repo,
      range: subject.range,
      newParent: subject.newParent,
      stamp,
      comparisonCommits: [subject.carried],
      cap: 1,
      resolver: resolvingResolver(async (context) => {
        observed.root = context.projectRoot;
        observed.refs = await refSnapshot(subject);
        const symbolic = await execFile('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: context.projectRoot }).then(() => 'attached', () => 'detached');
        observed.head = symbolic;
        const gitDir = (await execFile('git', ['rev-parse', '--absolute-git-dir'], { cwd: context.projectRoot })).stdout.trim();
        observed.onto = (await readFile(join(gitDir, 'rebase-merge', 'onto'), 'utf8')).trim();
        observed.headName = (await readFile(join(gitDir, 'rebase-merge', 'head-name'), 'utf8')).trim();
      }),
    });
    vi.unstubAllEnvs();

    expect(result.outcome.kind).toBe('changed');
    expect(observed.root).toMatch(/\/\.pipeline\/restack\/resolve\/child-[^/]+$/);
    expect(observed.root!.startsWith(join(subject.repo, '.pipeline', 'restack', 'resolve'))).toBe(true);
    expect(observed.head).toBe('detached');
    expect(observed.headName).toBe('detached HEAD');
    expect(observed.onto).toBe(subject.newParent);
    // No real ref moved during the hand-off, nor after it.
    expect(observed.refs).toBe(before);
    expect(await refSnapshot(subject)).toBe(before);

    const argv = await tracedArgv(trace);
    const rebaseStarts = argv.filter((args) => args[1] === 'rebase' && args.includes('-i'));
    expect(rebaseStarts).toEqual([['git', 'rebase', '-i', '--onto', subject.newParent, subject.range.oldParent]]);
    expect(argv.some((args) => args.includes('--autostash') || args.includes('stash'))).toBe(false);
    expect(argv.some((args) => args[1] === 'rebase' && args.includes('--continue'))).toBe(true);

    // Every commit the resolved rebase wrote carries the journal's committer stamp.
    const written = (await subject.git(['rev-list', `${subject.newParent}..${result.tip!}`])).stdout.split('\n').filter(Boolean);
    expect(written).toHaveLength(2);
    expect(new Set(written)).toEqual(new Set(result.rewrites.values()));
    for (const commit of written) {
      expect((await subject.git(['show', '-s', '--format=%cn%x00%ce%x00%cI', commit])).stdout.trim())
        .toBe(`${stamp.name}\0${stamp.email}\0${stamp.date}`);
    }
    expect((await subject.git(['show', '-s', '--format=%s', result.tip!])).stdout.trim()).toBe('conflicting C2');
  });

  // Covers: S6.1, task:14
  it('resolves a conflict in a repository whose root .gitignore is tracked without dirtying the detached checkout', async () => {
    const subject = await resolverFixture();
    expect((await subject.git(['ls-files', '.gitignore'])).stdout).toBe('.gitignore\n');
    let status = 'not dispatched';

    const result = await resolveRestackConflict({
      worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp,
      comparisonCommits: [subject.carried], cap: 1,
      resolver: resolvingResolver(async (context) => {
        status = (await execFile('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: context.projectRoot })).stdout;
      }),
    });

    // Only the conflicted path is dirty; the engine's own control files never enter the checkout.
    expect(status).toBe('UU shared.txt\n');
    expect(result.outcome.kind).toBe('changed');
    expect((await subject.git(['show', `${result.tip!}:.gitignore`])).stdout).toBe('.pipeline/\n');
    expect((await subject.git(['diff', '--name-only', subject.newParent, result.tip!])).stdout).toBe('shared.txt\n');
  });

  // Covers: S6.2, task:14
  it('removes the temporary resolve worktree after accepted, rejected and crashed hand-offs', async () => {
    const outcomes: Array<[string, RestackResolver]> = [
      ['accepted', resolvingResolver()],
      ['rejected', async () => ({ resolved: false, reason: 'declined' })],
      ['crashed', async () => { throw new Error('resolver crashed'); }],
    ];
    for (const [name, resolver] of outcomes) {
      const subject = await resolverFixture();
      let dispatchedIn = '';
      const observing: RestackResolver = async (context) => {
        dispatchedIn = context.projectRoot;
        expect(await worktreePaths(subject)).toContain(context.projectRoot);
        return resolver(context);
      };
      const run = resolveRestackConflict({
        worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp,
        comparisonCommits: [subject.carried], cap: 1, resolver: observing,
      });
      if (name === 'crashed') await expect(run).rejects.toThrow('resolver crashed');
      else await expect(run).resolves.toMatchObject({ outcome: { kind: name === 'accepted' ? 'changed' : 'conflict_halt' } });
      expect(dispatchedIn).not.toBe('');
      expect(await worktreePaths(subject)).toEqual([subject.repo]);
    }
  });

  // Covers: S6.3, task:14
  it('writes a todo with started-empty E and without the cherry-picked commit, equal to the commits replayChildRange applies', async () => {
    const subject = await resolverFixture();
    let todo = '';
    const result = await resolveRestackConflict({
      worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp,
      comparisonCommits: [subject.carried], cap: 1,
      resolver: resolvingResolver(async (context) => {
        // The todo the paused rebase is executing: its completed and remaining picks.
        const gitDir = (await execFile('git', ['rev-parse', '--absolute-git-dir'], { cwd: context.projectRoot })).stdout.trim();
        const done = await readFile(join(gitDir, 'rebase-merge', 'done'), 'utf8');
        const remaining = await readFile(join(gitDir, 'rebase-merge', 'git-rebase-todo'), 'utf8');
        todo = `${done}${remaining}`.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#')).join('\n');
      }),
    });

    const replay = await replayChildRange(subject.range, subject.cleanParent, stamp, makeGitRunner(subject.repo), {
      comparisonCommits: [subject.cleanCarried],
    });
    const applied = [...replay.rewrites.keys()];
    const picks = todo.split('\n').filter(Boolean).map((line) => {
      const [command, commit] = line.split(' ');
      expect(command).toBe('pick');
      return sha(commit!);
    });

    expect(applied).toEqual([subject.empty, subject.conflicting]);
    expect(picks).toEqual(applied);
    expect(result.candidates).toEqual(applied);
    expect(picks).not.toContain(subject.range.oldTip);
  });
});
