// Covers: task:15
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { journalRefFor, readRestackJournal, stagingRefFor } from '../../../src/engine/restack/restack-journal.js';
import type { RestackResolver } from '../../../src/engine/restack/restack-resolver.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw.trim());
  if (!parsed) throw new Error(`expected full Git SHA: ${raw}`);
  return parsed;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { recursive: true, force: true })));
});

async function fixture(kind: 'content' | 'rename' = 'content') {
  const repo = await mkdtemp(join(tmpdir(), 'restack-conflict-'));
  repositories.push(repo);
  const git = (args: string[], env?: NodeJS.ProcessEnv) => execFile('git', args, { cwd: repo, env });
  const commit = async (subject: string, paths: string[]) => {
    await git(['add', ...paths]);
    await git(['commit', '-qm', subject]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack conflict']);
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, '.git', 'info', 'exclude'), '.pipeline/\n');
  await writeFile(join(repo, 'src', 'c.ts'), 'one\ntwo\n');
  await writeFile(join(repo, 'src', 'x.ts'), 'old\n');
  await commit('base', ['src/c.ts', 'src/x.ts']);

  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(repo, 'c1.txt'), 'child one\n');
  const c1 = await commit('C1', ['c1.txt']);
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);

  await git(['checkout', '-qb', 'feat/c2/demo']);
  let c2: CommitSha;
  if (kind === 'content') {
    await writeFile(join(repo, 'src', 'c.ts'), 'one\nchild\n');
    c2 = await commit('C2', ['src/c.ts']);
  } else {
    await git(['mv', 'src/x.ts', 'src/z.ts']);
    c2 = await commit('C2 rename', ['-A']);
  }
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);

  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await writeFile(join(repo, 'leaf.txt'), 'leaf\n');
  await commit('L1', ['leaf.txt']);
  await git(['checkout', '-q', 'main']);
  if (kind === 'content') {
    await writeFile(join(repo, 'src', 'c.ts'), 'one\nmain\n');
    await commit('main advance', ['src/c.ts']);
  } else {
    await writeFile(join(repo, 'src', 'z.ts'), 'main\n');
    await commit('main advance', ['src/z.ts']);
  }
  const newDefault = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
  return { repo, git, c1, c2, newDefault };
}

function resolverThatContinues(content: string, extraPath?: string): RestackResolver {
  return async ({ projectRoot, environment }) => {
    await writeFile(join(projectRoot, 'src', 'c.ts'), content);
    if (extraPath) await writeFile(join(projectRoot, extraPath), 'unowned\n');
    const git = (args: string[]) => execFile('git', args, { cwd: projectRoot, env: { ...process.env, ...environment } });
    await git(['add', 'src/c.ts', ...(extraPath === undefined ? [] : [extraPath])]);
    await git(['rebase', '--continue']);
    return { resolved: true };
  };
}

async function refs(subject: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  return (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/closed/'])).stdout;
}

describe('runRestack conflict resolver (real local Git)', () => {
  it('accepts a resolved conflicting child, pins and marks it resolved, then continues without replaying child 1 twice', async () => {
    const subject = await fixture();
    const observedJournalChildren: unknown[] = [];
    const replayedCommits: string[] = [];
    let resolvedStagingPinned = false;
    const nativeGit = makeGitRunner(subject.repo);
    const git: GitRunner = async (args, options) => {
      if (args[0] === 'merge-tree') replayedCommits.push(args.at(-1)!);
      if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes('update refs/conductor/demo/restack/staging/c2 ')) {
        resolvedStagingPinned = true;
      }
      if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes(journalRefFor('demo'))) {
        const journalLine = options.input.split('\n').find((line) => line.startsWith(`update ${journalRefFor('demo')} `));
        const blob = journalLine?.split(' ')[2];
        if (blob) observedJournalChildren.push(JSON.parse((await nativeGit(['cat-file', 'blob', blob])).stdout).children);
      }
      return nativeGit(args, options);
    };

    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => { refusals.push(event); });
    const result = await runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: subject.newDefault,
      git,
      resolver: resolverThatContinues('one\nchild\n'),
      resolverCap: 1,
      events,
    });

    expect({ result, refusals }).toEqual({ result: expect.objectContaining({ kind: 'applied' }), refusals: [] });
    expect(replayedCommits.filter((commit) => commit === subject.c1)).toHaveLength(1);
    expect(resolvedStagingPinned).toBe(true);
    expect(observedJournalChildren).toContainEqual(expect.arrayContaining([expect.objectContaining({ child: 2, status: 'resolved' })]));
    expect((await subject.git(['show', 'feat/c2/demo:src/c.ts'])).stdout).toBe('one\nchild\n');
    await expect(subject.git(['merge-base', '--is-ancestor', 'feat/c2/demo', 'feat/daemon-demo'])).resolves.toMatchObject({ stdout: '' });
  });

  it('pins the original conflicting child before aborting after resolver rejection and emits a durable conflict occurrence', async () => {
    const subject = await fixture();
    const before = await refs(subject);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo), events, resolver: async () => ({ resolved: false, reason: 'budget exhausted' }), resolverCap: 1,
    })).resolves.toEqual({ kind: 'halted' });
    persister.stop();

    expect(await refs(subject)).toBe(before);
    const persisted = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; child?: number; commit?: string; paths?: string[] });
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'restack_conflict', child: 2, commit: subject.c2, paths: ['src/c.ts'] }));
    expect(persisted.some((event) => event.type === 'restack_refused')).toBe(false);
    const child = parseChildId(2);
    if (!child) throw new Error('child 2 must parse');
    expect((await subject.git(['rev-parse', stagingRefFor('demo', child)])).stdout.trim()).toBe(subject.c2);
    await expect(readRestackJournal(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('src/c.ts');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/^restack conflict child 2\n/);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it('halts after the resolver exhausts its bounded attempt cap', async () => {
    const subject = await fixture();
    let attempts = 0;

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo),
      resolver: async () => {
        attempts += 1;
        return { resolved: true };
      },
      resolverCap: 1,
    })).resolves.toEqual({ kind: 'halted' });

    expect(attempts).toBe(1);
    await expect(readRestackJournal(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
  });

  it.each(['skip', 'wrong-base'] as const)('rejects a resolver result with %s acceptance failure', async (mode) => {
    const subject = await fixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const resolver: RestackResolver = async ({ projectRoot, environment }) => {
      const git = (args: string[]) => execFile('git', args, { cwd: projectRoot, env: { ...process.env, ...environment } });
      if (mode === 'skip') await git(['rebase', '--skip']);
      else {
        await git(['rebase', '--abort']);
        await git(['reset', '--hard', subject.c2]);
      }
      return { resolved: true };
    };

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo), events, resolver, resolverCap: 1,
    })).resolves.toEqual({ kind: 'halted' });
    persister.stop();
    await expect(readRestackJournal(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(`commit ${subject.c2}; paths: src/c.ts`);
    const persisted = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; child?: number; commit?: string; paths?: string[] });
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'restack_conflict', child: 2, commit: subject.c2, paths: ['src/c.ts'] }));
    expect(persisted.some((event) => event.type === 'restack_refused')).toBe(false);
  });

  it('refuses an accepted-base resolver result that changes an unowned path', async () => {
    const subject = await fixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo), events, resolver: resolverThatContinues('one\nchild\n', 'src/unowned.ts'), resolverCap: 1,
    })).resolves.toEqual({ kind: 'halted' });
    persister.stop();

    const persisted = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; child?: number; reason?: string; detail?: string });
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'restack_refused', reason: 'replay-mismatch', child: 2, detail: expect.stringContaining('src/unowned.ts') }));
  });

  // Covers: task:13
  it('hands a rename collision to the resolver instead of accepting it as a clean replay', async () => {
    const subject = await fixture('rename');
    const contexts: { readonly conflicts: readonly string[] }[] = [];
    const events = new ConductorEventEmitter();
    const conflicts: unknown[] = [];
    events.on('restack_conflict', (event) => { conflicts.push(event); });

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo), events,
      resolver: async (context) => {
        contexts.push(context);
        return { resolved: false, reason: 'cannot resolve rename collision' };
      },
      resolverCap: 1,
    })).resolves.toEqual({ kind: 'halted' });

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.conflicts).toContain('src/z.ts');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ child: 2, commit: subject.c2 });
    expect((conflicts[0] as { paths: string[] }).paths).toContain('src/z.ts');
  });
});
