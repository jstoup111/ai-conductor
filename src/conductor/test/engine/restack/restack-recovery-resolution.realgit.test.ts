// Covers: task:5, task:11
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { detectStackRestackResolveCommand } from '../../../src/cli.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { dispatchStackRestackResolve } from '../../../src/engine/stack-restack-resolve-cli.js';
import { readConflictRecord, resolutionRefFor, writeConflictRecord } from '../../../src/engine/restack/restack-conflict-record.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { journalRefFor, readRestackJournal, writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { resolveUnenteredLeafOwner } from '../../../src/engine/restack/restack-unentered-leaf.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const topologyFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value);
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

function resolveCommand(...args: string[]) {
  const command = detectStackRestackResolveCommand(['node', 'ai-conductor', 'stack', 'restack-resolve', ...args]);
  if (!command) throw new Error('restack-resolve command did not parse');
  return command;
}

function resolveDeps(repo: string) {
  return {
    resolveMainRoot: async () => repo,
    resolveWorktree: async () => repo,
    acquireLease: async () => ({ kind: 'acquired' as const, lease: { release: async () => ({ ok: true as const }) } }),
    resolveOperator: async () => 'operator@example.test',
    print: () => undefined,
  };
}

async function baseRefreshConflictFixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-base-refresh-resolution-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, contents: string) => {
    await writeFile(join(repo, path), contents);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack resolution']);
  await writeFile(join(repo, '.git', 'info', 'exclude'), '.pipeline/\n');
  await commit('base', 'shared.txt', 'base\n');
  const first = parseChildId(1);
  const second = parseChildId(2);
  if (!first || !second) throw new Error('child ids should parse');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const firstTip = await commit('child one', 'one.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', firstTip]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const secondTip = await commit('child two', 'shared.txt', 'child two\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', secondTip]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  const leafTip = await commit('leaf', 'leaf.txt', 'leaf\n');
  await git(['checkout', '-q', 'main']);
  const newDefault = await commit('default changes shared', 'shared.txt', 'default\n');
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child one', 'Child two', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, topologyFilesystem);
  const runner = makeGitRunner(repo);
  await expect(runRestack({
    worktree: repo, slug: 'demo', cause: 'base-refresh', newDefault, git: runner,
    resolver: async () => ({ resolved: false, reason: 'declined' }), resolverCap: 1,
  })).resolves.toMatchObject({ kind: 'halted' });
  const halt = await readFile(join(repo, '.pipeline', 'HALT'), 'utf8');
  expect(halt).toContain('Restack-Conflict: 2');
  const record = await readConflictRecord(repo, 'demo', { git: runner });
  if (record.kind !== 'record') throw new Error('expected base-refresh conflict record');
  await git(['checkout', '-qb', 'operator-resolution', record.record.newParent]);
  const resolutionTip = await commit('child two', 'shared.txt', 'resolved\n');
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await expect(dispatchStackRestackResolve(
    resolveCommand('--slug', 'demo', '--child', '2', '--tip', resolutionTip), resolveDeps(repo),
  )).resolves.toBe(0);
  // A move must run from a feature checkout. Give the leaf's working tree the
  // same sealed topology without moving any stack ref.
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child one', 'Child two', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, topologyFilesystem);
  return { repo, git, runner, firstTip, secondTip, leafTip, newDefault, resolutionTip, second };
}

describe('recovery consumed-resolution leaf ownership (real local Git)', () => {
  async function replaceRecordedTipWithDecision(subject: Awaited<ReturnType<typeof baseRefreshConflictFixture>>) {
    const conflict = await readConflictRecord(subject.repo, 'demo', { git: subject.runner });
    if (conflict.kind !== 'record') throw new Error('expected recorded base-refresh conflict');
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), `Restack-Conflict: 2 ${conflict.record.opId}\n`);
    await writeFile(join(subject.repo, '.pipeline', 'HALT.class'), 'needs-human\n');
    await expect(dispatchStackRestackResolve(
      resolveCommand('--slug', 'demo', '--child', '2', '--decision', 'keep upstream'), resolveDeps(subject.repo),
    )).resolves.toBe(0);
    return conflict.record;
  }

  function resolvingDecisionResolver() {
    return async ({ projectRoot, environment }: { projectRoot: string; environment: NodeJS.ProcessEnv }) => {
      await writeFile(join(projectRoot, 'shared.txt'), 'resolved\n');
      const local = makeGitRunner(projectRoot);
      await local(['add', 'shared.txt'], { env: environment });
      await local(['rebase', '--continue'], { env: environment });
      return { resolved: true as const };
    };
  }

  // Covers: task:11
  it('delivers a recorded decision after the base branch advances and emits applied for child 2', async () => {
    const subject = await baseRefreshConflictFixture();
    await replaceRecordedTipWithDecision(subject);
    await subject.git(['checkout', '-q', 'main']);
    await writeFile(join(subject.repo, 'after-halt.txt'), 'advance\n');
    await subject.git(['add', 'after-halt.txt']);
    await subject.git(['commit', '-qm', 'advance default after decision']);
    const advanced = sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    const events = new ConductorEventEmitter();
    const applied: unknown[] = [];
    events.on('restack_decision', (event) => { if (event.type === 'restack_decision') applied.push(event); });
    const resolver = vi.fn(resolvingDecisionResolver());

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced,
      events, git: subject.runner, resolver, resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'applied' });

    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      operatorDecision: expect.objectContaining({ answer: 'keep upstream' }),
    }));
    expect(applied).toContainEqual(expect.objectContaining({ type: 'restack_decision', action: 'applied', child: subject.second }));
  });

  // Covers: task:11
  it('delivers a decision replacing a recorded tip without consuming that tip', async () => {
    const subject = await baseRefreshConflictFixture();
    await replaceRecordedTipWithDecision(subject);
    const events = new ConductorEventEmitter();
    const consumed: unknown[] = [];
    events.on('restack_resolution', (event) => { if (event.type === 'restack_resolution' && event.action === 'consumed') consumed.push(event); });
    const resolver = vi.fn(resolvingDecisionResolver());

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      events, git: subject.runner, resolver, resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'applied' });

    expect(consumed).toEqual([]);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      operatorDecision: expect.objectContaining({ answer: 'keep upstream' }),
    }));
  });

  // Covers: task:12
  it('delivers a decision while resuming a planned journal, persists applied, and retires it with the move', async () => {
    const subject = await baseRefreshConflictFixture();
    const conflict = await replaceRecordedTipWithDecision(subject);
    const base = sha((await subject.git(['rev-parse', `${subject.firstTip}^`])).stdout.trim());
    const leaf = parseChildId(3);
    if (!leaf) throw new Error('expected leaf child');
    const journal: RestackJournal = {
      opId: conflict.opId,
      cause: 'base-refresh',
      newDefault: subject.newDefault,
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [
        { ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.firstTip },
        { ref: 'refs/conductor/demo/closed/c1' as never, oldSha: subject.firstTip },
        { ref: 'refs/heads/feat/c2/demo' as never, oldSha: subject.secondTip },
        { ref: 'refs/conductor/demo/closed/c2' as never, oldSha: subject.secondTip },
        { ref: 'refs/heads/feat/daemon-demo' as never, oldSha: subject.leafTip },
      ],
      ranges: [
        { child: parseChildId(1)!, oldParent: base, oldTip: subject.firstTip, kind: 'closed' },
        { child: subject.second, oldParent: subject.firstTip, oldTip: subject.secondTip, kind: 'closed' },
        { child: leaf, oldParent: subject.secondTip, oldTip: subject.leafTip, kind: 'leaf-active' },
      ],
      children: [
        { child: parseChildId(1)!, status: 'pending' },
        { child: subject.second, status: 'pending' },
        { child: leaf, status: 'pending' },
      ],
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    const priorJournal = await readRestackJournal(subject.repo, 'demo', { git: subject.runner });
    await subject.git(['update-ref', journalRefFor('demo'), blob, priorJournal.kind === 'journal' ? priorJournal.blob : '']);
    const events = new ConductorEventEmitter();
    new EventPersister(join(subject.repo, '.pipeline/events.jsonl'), events).start();
    const resolver = vi.fn(resolvingDecisionResolver());

    await expect(recoverRestackJournal({
      worktree: subject.repo, slug: 'demo', git: subject.runner, events, resolver, resolverCap: 1,
    })).resolves.toEqual({ kind: 'recovered', fromState: 'planned' });

    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      operatorDecision: expect.objectContaining({ answer: 'keep upstream' }),
    }));
    const persisted = (await readFile(join(subject.repo, '.pipeline/events.jsonl'), 'utf8'))
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'restack_decision', action: 'applied', child: subject.second }));
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/restack/decision/c2'])).rejects.toMatchObject({ code: 1 });
    const resolved = (await subject.git(['rev-parse', 'feat/c2/demo'])).stdout.trim();
    await expect(subject.git(['rev-parse', 'refs/conductor/demo/closed/c2'])).resolves.toMatchObject({ stdout: `${resolved}\n` });
  });

  it('consumes a dispatcher-recorded base-refresh resolution and moves the closed child without test-written refs', async () => {
    const subject = await baseRefreshConflictFixture();
    const events = new ConductorEventEmitter();
    const consumed: string[] = [];
    events.on('restack_resolution', (event) => {
      if (event.type === 'restack_resolution' && event.action === 'consumed') consumed.push(event.tip);
    });

    const result = await runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      events, git: subject.runner,
    });
    expect(result).toMatchObject({ kind: 'applied' });

    const childTip = (await subject.git(['rev-parse', 'feat/c2/demo'])).stdout.trim();
    expect(consumed).toEqual([childTip]);
    await expect(subject.git(['rev-parse', 'refs/conductor/demo/closed/c2']))
      .resolves.toMatchObject({ stdout: `${childTip}\n` });
  });

  it('refuses a dispatcher-recorded base-refresh resolution whose recorded parent tree is stale without moving refs', async () => {
    const subject = await baseRefreshConflictFixture();
    await subject.git(['checkout', '-q', 'main']);
    const advanced = await (async () => {
      await writeFile(join(subject.repo, 'after-resolution.txt'), 'advance\n');
      await subject.git(['add', 'after-resolution.txt']);
      await subject.git(['commit', '-qm', 'advance default after resolution']);
      return sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    })();
    const before = await Promise.all([
      subject.git(['rev-parse', 'feat/c1/demo']), subject.git(['rev-parse', 'feat/c2/demo']),
      subject.git(['rev-parse', 'feat/daemon-demo']), subject.git(['rev-parse', 'refs/conductor/demo/closed/c1']),
      subject.git(['rev-parse', 'refs/conductor/demo/closed/c2']),
    ]);

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git: subject.runner,
    })).resolves.toMatchObject({ kind: 'halted' });

    const after = await Promise.all([
      subject.git(['rev-parse', 'feat/c1/demo']), subject.git(['rev-parse', 'feat/c2/demo']),
      subject.git(['rev-parse', 'feat/daemon-demo']), subject.git(['rev-parse', 'refs/conductor/demo/closed/c1']),
      subject.git(['rev-parse', 'refs/conductor/demo/closed/c2']),
    ]);
    expect(after.map((result) => result.stdout)).toEqual(before.map((result) => result.stdout));
    await expect(subject.git(['rev-parse', resolutionRefFor('demo', subject.second)])).resolves.toMatchObject({ stdout: `${subject.resolutionTip}\n` });
    await expect(subject.git(['rev-parse', 'refs/conductor/demo/restack/conflict/record'])).resolves.toMatchObject({ stdout: expect.any(String) });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('restack-resolution-stale) child 2\nparent-tree');
  });

  it('rebuilds an omitted duplicate-subject leaf through the same owner resolution as the executor', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'restack-recovery-duplicate-leaf-'));
    repositories.push(repo);
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    const commit = async (message: string, path: string, contents: string) => {
      await writeFile(join(repo, path), contents);
      await git(['add', path]);
      await git(['commit', '-qm', message]);
      return sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
    };
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'restack@example.test']);
    await git(['config', 'user.name', 'Restack recovery']);
    await writeFile(join(repo, '.git', 'info', 'exclude'), '.pipeline/\n');

    const base = await commit('base', 'base.txt', 'base\n');
    const first = parseChildId(1);
    const second = parseChildId(2);
    const leaf = parseChildId(3);
    if (!first || !second || !leaf) throw new Error('child ids should parse');
    await git(['checkout', '-qb', 'feat/c1/demo']);
    const firstBeforeRepair = await commit('first original', 'first.txt', 'original\n');
    const rewrittenFirst = await commit('first repair', 'repair.txt', 'repair\n');
    await git(['checkout', '-qb', 'feat/c2/demo', firstBeforeRepair]);
    const duplicateOne = await commit('duplicate', 'one.txt', 'one\n');
    const duplicateTwo = await commit('duplicate', 'two.txt', 'two\n');
    await git(['branch', 'feat/daemon-demo', duplicateOne]);
    await git(['checkout', '-qb', 'recorded-resolution', rewrittenFirst]);
    await commit('duplicate', 'one.txt', 'one\n');
    const resolutionTip = await commit('duplicate', 'two.txt', 'two\n');
    const parentTree = sha((await git(['rev-parse', `${rewrittenFirst}^{tree}`])).stdout.trim());
    await expect(writeConflictRecord(repo, 'demo', {
      opId: 'recovery-duplicate-leaf' as RestackOpId,
      child: second,
      oldParent: firstBeforeRepair,
      oldTip: duplicateTwo,
      newParent: rewrittenFirst,
      newParentTree: parentTree,
      candidateSubjects: ['duplicate', 'duplicate'],
      commit: duplicateOne,
      paths: ['one.txt', 'two.txt'],
    }, { git: makeGitRunner(repo) })).resolves.toEqual({ kind: 'updated' });
    await git(['update-ref', resolutionRefFor('demo', second), resolutionTip]);
    await git(['checkout', '-q', 'feat/c2/demo']);

    const journal: RestackJournal = {
      opId: 'recovery-duplicate-leaf' as RestackOpId,
      cause: 'feature-repair',
      newDefault: base,
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [
        { ref: 'refs/heads/feat/c1/demo' as never, oldSha: rewrittenFirst },
        { ref: 'refs/heads/feat/c2/demo' as never, oldSha: duplicateTwo },
        { ref: 'refs/heads/feat/daemon-demo' as never, oldSha: duplicateOne },
      ],
      ranges: [
        { child: first, oldParent: base, oldTip: rewrittenFirst, kind: 'active' },
        { child: second, oldParent: firstBeforeRepair, oldTip: duplicateTwo, kind: 'active' },
        { child: leaf, oldParent: duplicateOne, oldTip: duplicateOne, kind: 'leaf-unentered' },
      ],
      originatingChildren: [first],
      children: [{ child: first, status: 'pending' }, { child: second, status: 'pending' }, { child: leaf, status: 'pending' }],
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(repo, journal);
    await git(['update-ref', journalRefFor('demo'), blob, '']);

    await expect(recoverRestackJournal({ worktree: repo, slug: 'demo', git: makeGitRunner(repo) }))
      .resolves.toEqual({ kind: 'recovered', fromState: 'planned' });

    const rebuiltSecond = sha((await git(['rev-parse', 'feat/c2/demo'])).stdout.trim());
    const executorOwner = (await resolveUnenteredLeafOwner(makeGitRunner(repo), duplicateOne, new Map(), [{
      child: second,
      oldParent: firstBeforeRepair,
      oldTip: duplicateTwo,
      newParent: rewrittenFirst,
      tip: rebuiltSecond,
    }])).matches;
    expect(executorOwner).toHaveLength(1);
    expect((await git(['rev-parse', 'feat/daemon-demo'])).stdout.trim()).toBe(executorOwner[0]!.rewritten);
    expect((await git(['merge-base', '--is-ancestor', executorOwner[0]!.rewritten, 'feat/c2/demo'])).stdout).toBe('');
    expect(await readRestackJournal(repo, 'demo')).toEqual({ kind: 'missing' });
  });
});
