// Covers: task:rem-prd-audit-R18
// Covers: task:rem-prd-audit-R15
// Covers: task:8
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { EventPersister } from '../../../src/engine/event-persister.js';
import { writeCoverageBindingEnvelope } from '../../../src/engine/coverage-binding-envelope.js';
import { readVerdict } from '../../../src/engine/gate-verdicts.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
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

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-executor-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, file: string, content: string) => {
    await writeFile(join(repo, file), content);
    await git(['add', file]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack Executor']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  const base = await commit('base', 'base.txt', 'base\n');
  const oldDefault = await commit('old default', 'default.txt', 'old default\n');

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
  const advancedDefault = await commit('B-prime', 'base.txt', 'base advanced\n');
  await git(['checkout', '-q', 'feat/daemon-demo']);
  return { repo, git, base, oldDefault, a1, a2, c1, c2, l1, advancedDefault };
}

async function revList(git: (args: string[]) => Promise<{ stdout: string }>, range: string): Promise<string[]> {
  return (await git(['rev-list', '--reverse', range])).stdout.split('\n').filter(Boolean);
}

describe('runRestack (real local Git)', () => {
  it('replays the complete stack, atomically moves its refs, synchronizes HEAD, cleans durable state, and emits spine events', async () => {
    const subject = await fixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      const result = await runRestack({
        worktree: subject.repo,
        slug: 'demo',
        cause: 'base-refresh',
        newDefault: subject.advancedDefault,
        events,
        git: makeGitRunner(subject.repo),
      });

      expect(result.kind).toBe('applied');
      const [newC1, newC2, newLeaf] = await Promise.all([
        subject.git(['rev-parse', 'feat/c1/demo']).then((result) => result.stdout.trim()),
        subject.git(['rev-parse', 'feat/c2/demo']).then((result) => result.stdout.trim()),
        subject.git(['rev-parse', 'feat/daemon-demo']).then((result) => result.stdout.trim()),
      ]);
      expect(await revList(subject.git, `${subject.advancedDefault}..feat/c1/demo`)).toHaveLength(2);
      expect(await revList(subject.git, 'refs/conductor/demo/closed/c1..feat/c2/demo')).toHaveLength(2);
      expect(await revList(subject.git, 'refs/conductor/demo/closed/c2..feat/daemon-demo')).toHaveLength(1);
      expect(newC1).toBe((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim());
      expect(newC2).toBe((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c2'])).stdout.trim());
      expect((await subject.git(['merge-base', '--is-ancestor', newC1, newLeaf])).stdout).toBe('');
      expect((await subject.git(['status', '--porcelain'])).stdout).toBe('');
      expect((await subject.git(['rev-parse', 'HEAD'])).stdout.trim()).toBe(newLeaf);
      await expect(subject.git(['rev-parse', '--verify', 'refs/conductor/demo/restack/journal'])).rejects.toBeDefined();
      const eventRecords = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as { type: string; child?: number; cause?: string });
      expect(eventRecords.map((event) => event.type)).toEqual(['restack_planned', 'restack_applied', 'restack_applied', 'restack_applied']);
      expect(eventRecords[0]).toMatchObject({ cause: 'base-refresh' });
      expect(eventRecords.slice(1).map((event) => event.child)).toEqual([1, 2, 3]);
    } finally {
      persister.stop();
    }
  });

  it('moves only existing children when a closed child is followed by an active child', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'restack-executor-active-'));
    repositories.push(repo);
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    const commit = async (message: string, file: string) => {
      await writeFile(join(repo, file), `${message}\n`);
      await git(['add', file]);
      await git(['commit', '-qm', message]);
      return (await git(['rev-parse', 'HEAD'])).stdout.trim();
    };
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'restack@example.test']);
    await git(['config', 'user.name', 'Restack Executor']);
    const base = await commit('base', 'base.txt');
    await git(['checkout', '-qb', 'feat/c1/demo']);
    const closed = await commit('closed', 'closed.txt');
    await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
    await git(['checkout', '-qb', 'feat/c2/demo']);
    await commit('active', 'active.txt');
    await git(['checkout', '-q', 'main']);
    const advanced = await commit('advance', 'advance.txt');
    await git(['checkout', '-q', 'feat/c2/demo']);

    const result = await runRestack({ worktree: repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git: makeGitRunner(repo) });

    expect(result.kind).toBe('applied');
    await expect(git(['rev-parse', '--verify', 'refs/heads/feat/daemon-demo'])).rejects.toBeDefined();
    expect((await git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).not.toBe(closed);
    expect((await git(['rev-parse', 'feat/c2/demo'])).stdout.trim()).not.toBe(base);
  });

  it('preserves the unchanged old default in the whole-feature transition for an intermediate active-child repair', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'restack-executor-intermediate-repair-'));
    repositories.push(repo);
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    const commit = async (message: string, file: string) => {
      await writeFile(join(repo, file), `${message}\n`);
      await git(['add', file]);
      await git(['commit', '-qm', message]);
      return (await git(['rev-parse', 'HEAD'])).stdout.trim();
    };
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'restack@example.test']);
    await git(['config', 'user.name', 'Restack Executor']);
    await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
    await git(['add', '.gitignore']);
    await commit('base', 'base.txt');
    const oldDefault = await commit('old default', 'default.txt');
    await git(['checkout', '-qb', 'feat/c1/demo']);
    const c1Closure = await commit('closed child', 'closed.txt');
    await git(['update-ref', 'refs/conductor/demo/closed/c1', c1Closure]);
    await git(['checkout', '-qb', 'feat/c2/demo']);
    const c2Closure = await commit('closed intermediate child', 'active.txt');
    await git(['update-ref', 'refs/conductor/demo/closed/c2', c2Closure]);
    await git(['checkout', '-qb', 'feat/daemon-demo']);
    const oldLeafTip = await git(['rev-parse', 'HEAD']).then((result) => result.stdout.trim());
    await git(['checkout', '-q', 'feat/c1/demo']);
    await commit('repair', 'repair.txt');
    await git(['checkout', '-q', 'feat/c2/demo']);
    await mkdir(join(repo, '.pipeline'), { recursive: true });
    await writeFile(join(repo, '.pipeline', 'conduct-state.json'), '{}');

    await expect(runRestack({ worktree: repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(repo) }))
      .resolves.toMatchObject({ kind: 'applied' });

    const rebase = await readVerdict(repo, 'rebase');
    const completedHead = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    expect(rebase?.rebaseOperation).toMatchObject({
      cause: 'feature-repair',
      replay: {
        preRebaseHead: oldLeafTip,
        mergeBase: oldDefault,
        target: oldDefault,
        completedHead,
      },
    });
  });

  it('uses the journaled old and new default tuple in the whole-feature base-refresh transition', async () => {
    const subject = await fixture();
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    await writeFile(join(subject.repo, '.pipeline', 'conduct-state.json'), '{}');

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: subject.advancedDefault,
      git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'applied' });

    const rebase = await readVerdict(subject.repo, 'rebase');
    const completedHead = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    expect(rebase?.rebaseOperation).toMatchObject({
      cause: 'base-refresh',
      replay: {
        preRebaseHead: subject.l1,
        mergeBase: subject.oldDefault,
        target: subject.advancedDefault,
        completedHead,
      },
    });
  });

  // Covers: task:rem-prd-audit-R15
  it('moves an unentered pre-region halt-record leaf to its owning child rewrite', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'restack-executor-unentered-leaf-'));
    repositories.push(repo);
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    const commit = async (message: string, file: string, content: string) => {
      await mkdir(join(repo, '.docs', 'halted'), { recursive: true });
      await writeFile(join(repo, file), content);
      await git(['add', file]);
      await git(['commit', '-qm', message]);
      return (await git(['rev-parse', 'HEAD'])).stdout.trim();
    };
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'restack@example.test']);
    await git(['config', 'user.name', 'Restack Executor']);
    await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
    await git(['add', '.gitignore']);
    await commit('base', 'base.txt', 'base\n');
    await git(['checkout', '-qb', 'feat/daemon-demo']);
    const haltRecord = await commit('halt record', '.docs/halted/demo.md', 'Status: halted\n');
    await git(['checkout', '-qb', 'feat/c1/demo']);
    await commit('child work', 'child.txt', 'child\n');
    await writeCoverageBindingEnvelope(repo, {
      version: 1,
      slug: 'demo',
      runId: 'run-1',
      status: 'done',
      entries: [],
      sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Child 1', 'Child 2'] },
      storyOwnership: { S1: 1, S2: 2 },
    }, envelopeFilesystem);
    await git(['checkout', '-q', 'main']);
    const advanced = await commit('advance', 'base.txt', 'advanced\n');
    await git(['checkout', '-q', 'feat/c1/demo']);

    const result = await runRestack({ worktree: repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git: makeGitRunner(repo) });

    expect(result.kind).toBe('applied');
    const [newChild, newLeaf] = await Promise.all([
      git(['rev-parse', 'feat/c1/demo']).then((result) => result.stdout.trim()),
      git(['rev-parse', 'feat/daemon-demo']).then((result) => result.stdout.trim()),
    ]);
    expect(newLeaf).not.toBe(newChild);
    expect(newLeaf).not.toBe(haltRecord);
    expect((await git(['show', '-s', '--format=%s', newLeaf])).stdout.trim()).toBe('halt record');
    expect((await git(['merge-base', '--is-ancestor', advanced, newLeaf])).stdout).toBe('');
    expect((await git(['rev-parse', 'HEAD'])).stdout.trim()).toBe(newChild);
  });

  it('persists a merge audit after flattening an uncarried side of a child range', async () => {
    const subject = await fixture();
    await subject.git(['branch', 'leaf-side']);
    await subject.git(['checkout', '-q', 'leaf-side']);
    await writeFile(join(subject.repo, 'side.txt'), 'side work\n');
    await subject.git(['add', 'side.txt']);
    await subject.git(['commit', '-qm', 'side work']);
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await subject.git(['merge', '--no-ff', '-m', 'merge uncarried side', 'leaf-side']);
    const merge = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await expect(runRestack({
        worktree: subject.repo,
        slug: 'demo',
        cause: 'base-refresh',
        newDefault: subject.advancedDefault,
        events,
        git: makeGitRunner(subject.repo),
      })).resolves.toMatchObject({ kind: 'applied' });

      const records = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as { type: string; flattenedMerges?: string[] });
      expect(records).toContainEqual(expect.objectContaining({ type: 'rebase_merge_audit', flattenedMerges: [merge] }));
    } finally {
      persister.stop();
    }
  });

  it('halts without a journal or ref move when an active range is not based on its closed parent', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'restack-executor-refusal-'));
    repositories.push(repo);
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    const commit = async (message: string, file: string) => {
      await writeFile(join(repo, file), `${message}\n`);
      await git(['add', file]);
      await git(['commit', '-qm', message]);
      return (await git(['rev-parse', 'HEAD'])).stdout.trim();
    };
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'restack@example.test']);
    await git(['config', 'user.name', 'Restack Executor']);
    const base = await commit('base', 'base.txt');
    await git(['checkout', '-qb', 'feat/c1/demo']);
    const closed = await commit('closed', 'closed.txt');
    await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
    await git(['checkout', '-qb', 'feat/c2/demo', base]);
    const active = await commit('active', 'active.txt');
    await git(['checkout', '-q', 'main']);
    const advanced = await commit('advance', 'advance.txt');
    await git(['checkout', '-q', 'feat/c2/demo']);
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => refusals.push(event));

    const result = await runRestack({ worktree: repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, events, git: makeGitRunner(repo) });

    expect(result.kind).toBe('halted');
    expect(refusals).toEqual([expect.objectContaining({ reason: 'range-not-ancestor', child: 2 })]);
    expect((await git(['rev-parse', 'feat/c2/demo'])).stdout.trim()).toBe(active);
    await expect(git(['rev-parse', '--verify', 'refs/conductor/demo/restack/journal'])).rejects.toBeDefined();
    await expect(readFile(join(repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it('discards halt-record-only commits after a closed child while retaining them in its reflog', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await mkdir(join(subject.repo, '.docs', 'halted'), { recursive: true });
    await writeFile(join(subject.repo, '.docs', 'halted', 'demo.md'), 'Status: halted\n');
    await subject.git(['add', '.docs/halted/demo.md']);
    await subject.git(['commit', '-qm', 'halt record']);
    const haltCommit = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    const result = await runRestack({ worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.advancedDefault, git: makeGitRunner(subject.repo) });

    expect(result.kind).toBe('applied');
    expect((await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim())
      .toBe((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim());
    expect(await revList(subject.git, `refs/conductor/demo/closed/c1..feat/c2/demo`)).not.toContain(haltCommit);
    expect((await subject.git(['reflog', 'show', '--format=%H', 'feat/c1/demo'])).stdout).toContain(haltCommit);
  });
});
