// Covers: task:4, task:rem-prd-audit-R1
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { restackResolverForStepRunner } from '../../../src/engine/daemon-feature-lifecycle.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { journalRefFor, readRestackJournal, writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { resolveRestackConflict, type ResolveRestackConflictOptions } from '../../../src/engine/restack/restack-resolver.js';
import type { CommitterStamp } from '../../../src/engine/restack/restack-replay.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import { sealStack } from './restack-sweepG2-fixture.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

interface Fixture {
  readonly repo: string;
  readonly git: (args: string[], env?: NodeJS.ProcessEnv) => Promise<{ readonly stdout: string; readonly stderr: string }>;
  readonly newDefault: CommitSha;
  readonly oldParent: CommitSha;
  readonly oldTip: CommitSha;
  readonly first: CommitSha;
  readonly second: CommitSha;
  readonly leafCommits: readonly CommitSha[];
}

const stamp: CommitterStamp = {
  name: 'Fixture Committer',
  email: 'fixture@example.test',
  date: '2030-02-03T04:05:06Z',
};

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

async function createFixture(): Promise<Fixture> {
  const repo = await mkdtemp(join(tmpdir(), 'restack-resolver-lost-commit-'));
  repositories.push(repo);
  const git = (args: string[], env?: NodeJS.ProcessEnv) => execFile('git', args, {
    cwd: repo,
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  const commit = async (subject: string, path: string, content: string) => {
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', subject]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'Fixture Committer']);
  await git(['config', 'user.email', 'fixture@example.test']);
  await commit('base', 'base.txt', 'base\n');
  await commit('shared base', 'conflict.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await commit('child one', 'one.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await commit('child two', 'two.txt', 'two\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  const oldParent = c2;
  const leafCommits: CommitSha[] = [];
  for (let index = 1; index <= 8; index += 1) {
    leafCommits.push(await commit(
      `child three ${index}`,
      index === 1 ? 'conflict.txt' : `three-${index}.txt`,
      index === 1 ? 'child\n' : `${index}\n`,
    ));
  }
  const oldTip = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await git(['checkout', '-q', 'main']);
  await commit('default conflicts', 'conflict.txt', 'default\n');
  const newDefault = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await sealStack(repo);
  return { repo, git, newDefault, oldParent, oldTip, first: c1, second: c2, leafCommits };
}

async function stackRefs(subject: Fixture): Promise<string> {
  return (await subject.git([
    'for-each-ref', '--format=%(refname) %(objectname)',
    'refs/heads/feat/', 'refs/conductor/demo/closed/',
  ])).stdout;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('restack resolver lost commit (real local Git)', () => {
  it('halts when its settled temporary tip cannot be read without a rewrite list', async () => {
    const subject = await createFixture();
    const child = parseChildId(3);
    if (!child) throw new Error('expected child three');
    const options: ResolveRestackConflictOptions & { temporaryGit: (worktree: string) => GitRunner } = {
      worktree: subject.repo,
      range: { child, oldParent: subject.oldParent, oldTip: subject.oldTip, kind: 'leaf-active' },
      newParent: subject.newDefault,
      stamp,
      cap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'conflict.txt'), 'resolved\n');
        const git = makeGitRunner(context.projectRoot);
        await git(['add', 'conflict.txt']);
        const continued = await git(['rebase', '--continue'], { env: { GIT_EDITOR: 'true' } });
        if (continued.exitCode !== 0) throw new Error(`continue failed: ${continued.stderr}`);
        return { resolved: true };
      },
      temporaryGit: (worktree) => {
        const real = makeGitRunner(worktree);
        return async (args, options) => {
          if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
            return { exitCode: 1, stdout: '', stderr: 'unreadable tip' };
          }
          return real(args, options);
        };
      },
    };

    const result = await resolveRestackConflict(options);

    expect(result.outcome.kind).toBe('conflict_halt');
    expect(result.outcome).toMatchObject({ reason: expect.stringMatching(/readable settled tip|unreadable tip/) });
  });

  it('halts when an unreadable settled tip falls back to a rewritten list that omits candidates', async () => {
    const subject = await createFixture();
    const child = parseChildId(3);
    if (!child) throw new Error('expected child three');
    const options: ResolveRestackConflictOptions = {
      worktree: subject.repo,
      range: { child, oldParent: subject.oldParent, oldTip: subject.oldTip, kind: 'leaf-active' },
      newParent: subject.newDefault,
      stamp,
      cap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'conflict.txt'), 'resolved\n');
        const git = makeGitRunner(context.projectRoot);
        await git(['add', 'conflict.txt'], { env: context.environment });
        const continued = await git(['rebase', '--continue'], { env: context.environment });
        if (continued.exitCode !== 0) throw new Error(`continue failed: ${continued.stderr}`);
        const hooksPath = context.environment.GIT_CONFIG_VALUE_0;
        if (!hooksPath) throw new Error('expected resolver hooks path');
        const rewritePath = join(dirname(hooksPath), 'rewritten-list');
        const [first] = (await readFile(rewritePath, 'utf8')).split('\n').filter(Boolean);
        if (!first) throw new Error('expected rewritten list entry');
        await writeFile(rewritePath, `${first}\n`);
        return { resolved: true };
      },
      temporaryGit: (worktree) => {
        const real = makeGitRunner(worktree);
        return async (args, options) => args[0] === 'rev-parse' && args[1] === 'HEAD'
          ? { exitCode: 1, stdout: '', stderr: 'unreadable tip' }
          : real(args, options);
      },
    };

    const result = await resolveRestackConflict(options);

    expect(result.outcome).toMatchObject({
      kind: 'conflict_halt', reason: expect.stringContaining('child three 2'),
    });
  });

  it('reports a conflict halt naming the skipped candidate before any branch can move it', async () => {
    const subject = await createFixture();
    const child = parseChildId(3);
    if (!child) throw new Error('expected child three');

    const result = await resolveRestackConflict({
      worktree: subject.repo,
      range: { child, oldParent: subject.oldParent, oldTip: subject.oldTip, kind: 'leaf-active' },
      newParent: subject.newDefault,
      stamp,
      cap: 1,
      resolver: async (context) => {
        const git = makeGitRunner(context.projectRoot);
        const skipped = await git(['rebase', '--skip'], { env: { GIT_EDITOR: 'true' } });
        if (skipped.exitCode !== 0) throw new Error(`skip failed: ${skipped.stderr}`);
        return { resolved: true };
      },
    });

    expect(result.outcome.kind).toBe('conflict_halt');
    expect(result.outcome).toMatchObject({ reason: expect.stringContaining('child three 1') });
  });

  it('aborts without moving a feature or closure ref when the resolver skips one of eight candidates', async () => {
    const subject = await createFixture();
    const before = await stackRefs(subject);
    const resolver = restackResolverForStepRunner({
      resolveRebaseConflict: async (context) => {
        const git = makeGitRunner(context.projectRoot);
        const skipped = await git(['rebase', '--skip'], { env: { GIT_EDITOR: 'true' } });
        if (skipped.exitCode !== 0) throw new Error(`skip failed: ${skipped.stderr}`);
        return { resolved: true };
      },
    });
    if (!resolver) throw new Error('expected production resolver');

    const result = await runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: subject.newDefault,
      resolver,
      resolverCap: 1,
      git: makeGitRunner(subject.repo),
    });

    expect(result).toMatchObject({ kind: 'halted' });
    expect(await stackRefs(subject)).toBe(before);
    expect(await readRestackJournal(subject.repo, 'demo')).toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Restack-Conflict: 3 ');
    expect(halt).toContain('ai-conductor stack restack-resolve --slug demo --child 3 --tip <sha>');
    expect(halt).toContain('ai-conductor stack restack-resolve --slug demo --child 3 --decision "<answer>"');
    expect(halt).toContain('child three 1');
  });

  it('recovers a planned journal when the resolver continues without its supplied environment', async () => {
    const resolver = async (context: Parameters<NonNullable<ResolveRestackConflictOptions['resolver']>>[0]) => {
      await writeFile(join(context.projectRoot, 'conflict.txt'), 'resolved\n');
      const git = makeGitRunner(context.projectRoot);
      await git(['add', 'conflict.txt']);
      const continued = await git(['rebase', '--continue'], { env: { GIT_EDITOR: 'true' } });
      if (continued.exitCode !== 0) throw new Error(`continue failed: ${continued.stderr}`);
      return { resolved: true as const };
    };
    const subject = await createFixture();
    const first = parseChildId(1);
    const second = parseChildId(2);
    const third = parseChildId(3);
    if (!first || !second || !third) throw new Error('expected child ids');
    const base = sha((await subject.git(['rev-parse', `${subject.first}^`])).stdout);
    const journal: RestackJournal = {
      opId: 'recover-resolver-without-environment' as never,
      cause: 'base-refresh', newDefault: subject.newDefault, committer: stamp, dirtyPaths: [],
      refs: [
        { ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.first },
        { ref: 'refs/conductor/demo/closed/c1' as never, oldSha: subject.first },
        { ref: 'refs/heads/feat/c2/demo' as never, oldSha: subject.second },
        { ref: 'refs/conductor/demo/closed/c2' as never, oldSha: subject.second },
        { ref: 'refs/heads/feat/daemon-demo' as never, oldSha: subject.oldTip },
      ],
      ranges: [
        { child: first, oldParent: base, oldTip: subject.first, kind: 'closed' },
        { child: second, oldParent: subject.first, oldTip: subject.second, kind: 'closed' },
        { child: third, oldParent: subject.second, oldTip: subject.oldTip, kind: 'leaf-active' },
      ],
      children: [{ child: first, status: 'pending' }, { child: second, status: 'pending' }, { child: third, status: 'pending' }],
      state: 'planned', owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob]);

    await expect(recoverRestackJournal({
      worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo), resolver, resolverCap: 1,
    })).resolves.toEqual({ kind: 'recovered', fromState: 'planned' });

    const subjects = (await subject.git(['log', '--format=%s', 'feat/daemon-demo'])).stdout.split('\n');
    for (let index = 1; index <= 8; index += 1) expect(subjects).toContain(`child three ${index}`);
  });
});
