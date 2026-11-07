import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { readRestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

const envelopeFilesystem = {
  readFile: (path: string) => readFile(path, 'utf8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path: string, contents: string) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

type Git = (args: string[]) => Promise<{ stdout: string }>;

async function repository(prefix: string) {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  repositories.push(repo);
  const git: Git = (args) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, file: string, content: string) => {
    await mkdir(join(repo, file, '..'), { recursive: true });
    await writeFile(join(repo, file), content);
    await git(['add', file]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack Executor Sweep']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  return { repo, git, commit };
}

async function seal(repo: string) {
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
}

/** The stories' three-child stack, with the leaf checked out and a default advance B -> B'. */
async function threeChildStack() {
  const { repo, git, commit } = await repository('restack-executor-sweep-');
  const base = await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const a1 = await commit('A1', 'a1.txt', 'a1\n');
  const a2 = await commit('A2', 'a2.txt', 'a2\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', a2]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c1 = await commit('C1', 'c1.txt', 'c1\n');
  const c2 = await commit('C2', 'c2.txt', 'c2\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  const l1 = await commit('L1', 'l1.txt', 'l1\n');
  await git(['checkout', '-q', 'main']);
  const advanced = await commit('B-prime', 'default.txt', 'advanced\n');
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await seal(repo);
  return { repo, git, commit, base, a1, a2, c1, c2, l1, advanced };
}

/** The stories' one-closed-one-active stack: the unentered leaf sits at B. */
async function oneClosedOneActiveStack() {
  const { repo, git, commit } = await repository('restack-executor-sweep-active-');
  const base = await commit('base', 'base.txt', 'base\n');
  await git(['branch', 'feat/daemon-demo']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await commit('A1', 'a1.txt', 'a1\n');
  const a2 = await commit('A2', 'a2.txt', 'a2\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', a2]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c1 = await commit('C1', 'c1.txt', 'c1\n');
  await git(['checkout', '-q', 'main']);
  const advanced = await commit('B-prime', 'default.txt', 'advanced\n');
  await git(['checkout', '-q', 'feat/c2/demo']);
  await seal(repo);
  return { repo, git, commit, base, a2, c1, advanced };
}

async function refSnapshot(git: Git): Promise<string> {
  return (await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/'])).stdout;
}

async function tip(git: Git, name: string): Promise<string> {
  return (await git(['rev-parse', name])).stdout.trim();
}

async function revList(git: Git, range: string): Promise<string[]> {
  return (await git(['rev-list', '--reverse', range])).stdout.split('\n').filter(Boolean);
}

async function patchId(repo: string, commit: string): Promise<string> {
  const { stdout } = await execFile('sh', ['-c', `git show ${commit} | git patch-id --stable`], { cwd: repo });
  return stdout.split(' ')[0]!;
}

async function identity(git: Git, commit: string): Promise<string> {
  return (await git(['show', '-s', '--format=%an%x00%ae%x00%aI%x00%B', commit])).stdout;
}

/** Asserts `range` lists exactly one rewrite of each original, in order. */
async function expectExactRewrites(subject: { repo: string; git: Git }, range: string, originals: readonly string[]) {
  const listed = await revList(subject.git, range);
  expect(listed).toHaveLength(originals.length);
  for (const [index, original] of originals.entries()) {
    expect(listed[index]).not.toBe(original);
    expect(await identity(subject.git, listed[index]!)).toBe(await identity(subject.git, original));
    expect(await patchId(subject.repo, listed[index]!)).toBe(await patchId(subject.repo, original));
  }
}

async function persistedRecords(repo: string): Promise<Record<string, unknown>[]> {
  return (await readFile(join(repo, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n')
    .map((line) => {
      const { ts: _ts, ...record } = JSON.parse(line) as Record<string, unknown>;
      return record;
    });
}

async function withPersister<T>(repo: string, run: (events: ConductorEventEmitter) => Promise<T>): Promise<T> {
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(repo, '.pipeline', 'events.jsonl'), events);
  persister.start();
  try {
    return await run(events);
  } finally {
    persister.stop();
  }
}

/** Real Git, recording the staged tip each child-status transaction pins. */
function stagingRecorder(repo: string, staged: Map<number, string>): GitRunner {
  const real = makeGitRunner(repo);
  return async (args, options) => {
    if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input !== undefined) {
      for (const match of options.input.matchAll(/^update refs\/conductor\/demo\/restack\/staging\/c(\d+) ([0-9a-f]{40}) /gm)) {
        staged.set(Number(match[1]), match[2]!);
      }
    }
    return real(args, options);
  };
}

describe('runRestack orchestration (sweep G1, real local Git)', () => {
  // Covers: S1.1, S4.1, S5.1, task:8
  it('rewrites exactly each child range onto its new parent, applies every journaled tip and leaves no restack state', async () => {
    const subject = await threeChildStack();
    const before = {
      c1: await tip(subject.git, 'feat/c1/demo'),
      c2: await tip(subject.git, 'feat/c2/demo'),
      leaf: await tip(subject.git, 'feat/daemon-demo'),
      closedC1: await tip(subject.git, 'refs/conductor/demo/closed/c1'),
      closedC2: await tip(subject.git, 'refs/conductor/demo/closed/c2'),
    };
    const staged = new Map<number, string>();

    const result = await withPersister(subject.repo, (events) => runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: subject.advanced,
      events,
      git: stagingRecorder(subject.repo, staged),
    }));

    expect(result.kind).toBe('applied');
    await expectExactRewrites(subject, `${subject.advanced}..feat/c1/demo`, [subject.a1, subject.a2]);
    await expectExactRewrites(subject, 'refs/conductor/demo/closed/c1..feat/c2/demo', [subject.c1, subject.c2]);
    await expectExactRewrites(subject, 'refs/conductor/demo/closed/c2..feat/daemon-demo', [subject.l1]);

    const after = {
      c1: await tip(subject.git, 'feat/c1/demo'),
      c2: await tip(subject.git, 'feat/c2/demo'),
      leaf: await tip(subject.git, 'feat/daemon-demo'),
      closedC1: await tip(subject.git, 'refs/conductor/demo/closed/c1'),
      closedC2: await tip(subject.git, 'refs/conductor/demo/closed/c2'),
    };
    for (const key of Object.keys(before) as (keyof typeof before)[]) expect(after[key]).not.toBe(before[key]);
    expect([...staged.entries()].sort()).toEqual([[1, after.c1], [2, after.c2], [3, after.leaf]]);
    expect(after.closedC1).toBe(after.c1);
    expect(after.closedC2).toBe(after.c2);
    await expect(subject.git(['merge-base', '--is-ancestor', subject.advanced, after.c1])).resolves.toBeDefined();
    await expect(subject.git(['merge-base', '--is-ancestor', after.c1, after.c2])).resolves.toBeDefined();
    await expect(subject.git(['merge-base', '--is-ancestor', after.c2, after.leaf])).resolves.toBeDefined();
    expect((await subject.git(['for-each-ref', 'refs/conductor/demo/restack/'])).stdout).toBe('');
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
    expect((await subject.git(['status', '--porcelain', '--untracked-files=all'])).stdout).toBe('');
    expect((await subject.git(['symbolic-ref', 'HEAD'])).stdout.trim()).toBe('refs/heads/feat/daemon-demo');
    expect((await subject.git(['write-tree'])).stdout.trim()).toBe(await tip(subject.git, `${after.leaf}^{tree}`));
    expect((await readFile(join(subject.repo, 'base.txt'), 'utf8'))).toBe('base\n');
    expect((await readFile(join(subject.repo, 'default.txt'), 'utf8'))).toBe('advanced\n');
  });

  // Covers: task:8
  it('persists restack_planned with opId, cause and children before one fully populated restack_applied per moved child', async () => {
    const subject = await threeChildStack();
    const oldTips = { 1: subject.a2, 2: subject.c2, 3: subject.l1 } as Record<number, string>;

    await expect(withPersister(subject.repo, (events) => runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.advanced, events, git: makeGitRunner(subject.repo),
    }))).resolves.toMatchObject({ kind: 'applied' });

    const records = (await persistedRecords(subject.repo)).filter((record) => String(record.type).startsWith('restack_'));
    expect(records.map((record) => record.type)).toEqual(['restack_planned', 'restack_applied', 'restack_applied', 'restack_applied']);
    const [planned, ...applied] = records;
    expect(Object.keys(planned!).sort()).toEqual(['cause', 'children', 'opId', 'type']);
    expect(planned).toMatchObject({ cause: 'base-refresh', children: [1, 2, 3], opId: expect.stringMatching(/.+/) });
    const newTips = { 1: await tip(subject.git, 'feat/c1/demo'), 2: await tip(subject.git, 'feat/c2/demo'), 3: await tip(subject.git, 'feat/daemon-demo') } as Record<number, string>;
    expect(applied.map((record) => record.child)).toEqual([1, 2, 3]);
    for (const record of applied) {
      expect(Object.keys(record).sort()).toEqual(['cause', 'child', 'newTip', 'oldTip', 'opId', 'parentOverlapPaths', 'type', 'wouldInvalidate']);
      expect(record).toMatchObject({
        opId: planned!.opId,
        cause: 'base-refresh',
        oldTip: oldTips[record.child as number],
        newTip: newTips[record.child as number],
      });
      expect(Array.isArray(record.wouldInvalidate)).toBe(true);
      expect(Array.isArray(record.parentOverlapPaths)).toBe(true);
    }
  });

  // Covers: S1.9, S1.11, task:8
  it('moves no unentered leaf for the one-closed-one-active stack and halts range-not-ancestor naming child 2 when it was rebased elsewhere', async () => {
    const subject = await oneClosedOneActiveStack();
    const leafBefore = await tip(subject.git, 'feat/daemon-demo');
    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.advanced, git: makeGitRunner(subject.repo) }))
      .resolves.toMatchObject({ kind: 'applied' });
    expect(await tip(subject.git, 'feat/daemon-demo')).toBe(leafBefore);
    expect((await subject.git(['for-each-ref', '--format=%(refname)', 'refs/heads/'])).stdout.split('\n').filter(Boolean).sort())
      .toEqual(['refs/heads/feat/c1/demo', 'refs/heads/feat/c2/demo', 'refs/heads/feat/daemon-demo', 'refs/heads/main']);

    const rebased = await oneClosedOneActiveStack();
    await rebased.git(['rebase', '-q', '--onto', rebased.base, 'refs/conductor/demo/closed/c1', 'feat/c2/demo']);
    const refsBefore = await refSnapshot(rebased.git);

    const halted = await withPersister(rebased.repo, (events) => runRestack({
      worktree: rebased.repo, slug: 'demo', cause: 'base-refresh', newDefault: rebased.advanced, events, git: makeGitRunner(rebased.repo),
    }));

    expect(halted).toMatchObject({ kind: 'halted' });
    expect((await persistedRecords(rebased.repo)).filter((record) => record.type === 'restack_refused'))
      .toEqual([{ type: 'restack_refused', reason: 'range-not-ancestor', child: 2 }]);
    await expect(readFile(join(rebased.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    expect(await refSnapshot(rebased.git)).toBe(refsBefore);
    expect(await readRestackJournal(rebased.repo, 'demo')).toEqual({ kind: 'missing' });
  });

  // Covers: S1.14, task:8
  it('drops a halt-record-only commit past closed/c1 from every child while feat/c1/demo equals its new closure and keeps it in its reflog', async () => {
    const subject = await threeChildStack();
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    const haltCommit = await subject.commit('halt record', '.docs/halted/demo.md', 'Status: halted\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.advanced, git: makeGitRunner(subject.repo) }))
      .resolves.toMatchObject({ kind: 'applied' });

    expect(await tip(subject.git, 'feat/c1/demo')).toBe(await tip(subject.git, 'refs/conductor/demo/closed/c1'));
    const stackCommits = await revList(subject.git, `${subject.advanced}..feat/daemon-demo`);
    expect(stackCommits).toHaveLength(5);
    expect(stackCommits).not.toContain(haltCommit);
    for (const commit of stackCommits) {
      expect((await subject.git(['show', '-s', '--format=%s', commit])).stdout.trim()).not.toBe('halt record');
      expect((await subject.git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit])).stdout).not.toContain('.docs/halted/');
    }
    await expect(subject.git(['cat-file', '-e', 'feat/daemon-demo:.docs/halted/demo.md'])).rejects.toBeDefined();
    expect((await subject.git(['reflog', 'show', '--format=%H', 'feat/c1/demo'])).stdout.split('\n')).toContain(haltCommit);
  });

  // Covers: S4.7, task:7
  it('rolls every journaled ref back, ends the journal aborted and halts verification-failed when a moved tree differs from its staging ref', async () => {
    const subject = await threeChildStack();
    const refsBefore = await refSnapshot(subject.git);
    const real = makeGitRunner(subject.repo);
    let corrupted = false;
    const git: GitRunner = async (args, options) => {
      const result = await real(args, options);
      // Immediately after the one move transaction commits, swap child 2's
      // staged commit for a different tree so post-move verification fails.
      if (!corrupted && result.exitCode === 0 && args[0] === 'update-ref' && args[1] === '--stdin'
        && options?.input?.includes('update refs/heads/feat/c1/demo ')) {
        corrupted = true;
        await real(['update-ref', 'refs/conductor/demo/restack/staging/c2', subject.c1]);
      }
      return result;
    };

    const result = await withPersister(subject.repo, (events) => runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.advanced, events, git,
    }));

    expect(corrupted).toBe(true);
    expect(result).toMatchObject({ kind: 'halted' });
    // Every branch and closure ref is back at its journaled old SHA; only the
    // halted operation's own journal, staging and leaf-moved bookkeeping remain.
    const refsAfter = (await refSnapshot(subject.git)).trim().split('\n')
      .filter((line) => !line.startsWith('refs/conductor/demo/restack/') && !line.startsWith('refs/conductor/demo/leaf-moved '));
    expect(refsAfter).toEqual(refsBefore.trim().split('\n'));
    const journal = await readRestackJournal(subject.repo, 'demo');
    expect(journal.kind === 'journal' ? journal.journal.state : journal.kind).toBe('aborted');
    expect((await persistedRecords(subject.repo)).filter((record) => record.type === 'restack_refused'))
      .toEqual([{ type: 'restack_refused', reason: 'verification-failed', detail: 'tree mismatch for child 2' }]);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('tree mismatch for child 2');
  });
});
