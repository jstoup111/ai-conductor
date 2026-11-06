// Covers: task:8, task:9, task:10, task:11
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { detectStackRestackResolveCommand } from '../../../src/cli.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { dispatchStackRestackResolve } from '../../../src/engine/stack-restack-resolve-cli.js';
import { conflictRecordRefFor, readConflictRecord, resolutionRefFor, writeConflictRecord } from '../../../src/engine/restack/restack-conflict-record.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { journalRefFor, readRestackJournal, writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const filesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

function sha(raw: string): CommitSha {
  const value = parseCommitSha(raw.trim());
  if (!value) throw new Error(`expected SHA, got ${raw}`);
  return value;
}

function child(value: number) {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`expected child ${value}`);
  return parsed;
}

function command(...args: string[]) {
  const parsed = detectStackRestackResolveCommand(['node', 'ai-conductor', 'stack', 'restack-resolve', ...args]);
  if (!parsed) throw new Error('restack-resolve command did not parse');
  return parsed;
}

function printedRebaseRecipe(halt: string): string[] {
  const line = halt.split('\n').find((entry) => entry.startsWith('git rebase --onto '));
  if (!line) throw new Error('expected a git rebase recipe in HALT');
  const [executable, subcommand, ...args] = line.split(' ');
  if (executable !== 'git' || subcommand !== 'rebase' || args[0] !== '--onto') {
    throw new Error(`expected a git rebase --onto recipe, got ${line}`);
  }
  return args;
}

function resolveDeps(repo: string, print: (message: string) => void = () => undefined) {
  return {
    cwd: repo, print,
    resolveMainRoot: async () => repo,
    resolveWorktree: async () => repo,
    acquireLease: async () => ({ kind: 'acquired' as const, lease: { release: async () => ({ ok: true as const }) } }),
    resolveOperator: async () => 'operator@example.test',
  };
}

interface Subject {
  readonly repo: string;
  readonly git: (args: string[]) => Promise<{ readonly stdout: string; readonly stderr: string }>;
  readonly runner: GitRunner;
  readonly base: CommitSha;
  readonly first: CommitSha;
  readonly second: CommitSha;
  readonly leaf: CommitSha;
  readonly newDefault: CommitSha;
}

async function subject(conflicting = true): Promise<Subject> {
  const repo = await mkdtemp(join(tmpdir(), 'restack-resolution-stale-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, contents: string) => {
    await mkdir(join(repo, path, '..'), { recursive: true });
    await writeFile(join(repo, path), contents);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack stale resolution']);
  await git(['config', 'core.editor', 'true']);
  await writeFile(join(repo, '.git', 'info', 'exclude'), '.pipeline/\n');
  const base = await commit('base', 'shared.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const first = await commit('child one', 'one.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', first]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const second = await commit('child two', 'shared.txt', 'child\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', second]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  const leaf = await commit('leaf', 'leaf.txt', 'leaf\n');
  await git(['checkout', '-q', 'main']);
  const newDefault = await commit('default changes', conflicting ? 'shared.txt' : 'default.txt', 'default\n');
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child one', 'Child two', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, filesystem);
  return { repo, git, runner: makeGitRunner(repo), base, first, second, leaf, newDefault };
}

async function recordTip(value: Subject) {
  await expect(runRestack({
    worktree: value.repo, slug: 'demo', cause: 'base-refresh', newDefault: value.newDefault, git: value.runner,
    resolver: async () => ({ resolved: false, reason: 'operator required' }), resolverCap: 1,
  })).resolves.toMatchObject({ kind: 'halted' });
  const record = await readConflictRecord(value.repo, 'demo', { git: value.runner });
  if (record.kind !== 'record') throw new Error('expected conflict record');
  await value.git(['checkout', '-qb', 'operator-resolution', record.record.newParent]);
  await writeFile(join(value.repo, 'shared.txt'), 'resolved\n');
  await value.git(['add', 'shared.txt']);
  // The answer must preserve the replay candidate's subject, just as the
  // command printed in the halt requires.
  await value.git(['commit', '-qm', 'child two']);
  const tip = sha((await value.git(['rev-parse', 'HEAD'])).stdout);
  await value.git(['checkout', '-q', 'feat/daemon-demo']);
  await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--tip', tip), {
    ...resolveDeps(value.repo), git: value.runner,
  })).resolves.toBe(0);
  return { record: record.record, tip };
}

async function advanceParent(value: Subject): Promise<CommitSha> {
  await value.git(['checkout', '-q', 'main']);
  await writeFile(join(value.repo, 'after-resolution.txt'), 'changed\n');
  await value.git(['add', 'after-resolution.txt']);
  await value.git(['commit', '-qm', 'feature content after resolution']);
  const advanced = sha((await value.git(['rev-parse', 'HEAD'])).stdout);
  await value.git(['checkout', '-q', 'feat/daemon-demo']);
  return advanced;
}

async function plan(value: Subject, newDefault: CommitSha, opId: RestackOpId) {
  const journal: RestackJournal = {
    opId, cause: 'base-refresh', newDefault,
    committer: { name: 'Restack stale resolution', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' }, dirtyPaths: [],
    refs: [
      { ref: 'refs/heads/feat/c1/demo' as never, oldSha: value.first },
      { ref: 'refs/conductor/demo/closed/c1' as never, oldSha: value.first },
      { ref: 'refs/heads/feat/c2/demo' as never, oldSha: value.second },
      { ref: 'refs/conductor/demo/closed/c2' as never, oldSha: value.second },
      { ref: 'refs/heads/feat/daemon-demo' as never, oldSha: value.leaf },
    ],
    ranges: [
      { child: child(1), oldParent: value.base, oldTip: value.first, kind: 'closed' },
      { child: child(2), oldParent: value.first, oldTip: value.second, kind: 'closed' },
      { child: child(3), oldParent: value.second, oldTip: value.leaf, kind: 'leaf-active' },
    ],
    children: [{ child: child(1), status: 'pending' }, { child: child(2), status: 'pending' }, { child: child(3), status: 'pending' }],
    state: 'planned', owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
  };
  const blob = await writeRestackJournalBlob(value.repo, journal);
  const previous = await readRestackJournal(value.repo, 'demo', { git: value.runner });
  await value.git(['update-ref', journalRefFor('demo'), blob, previous.kind === 'journal' ? previous.blob : '']);
  return journal;
}

async function stackRefs(value: Subject) {
  return Promise.all([
    value.git(['rev-parse', 'feat/c1/demo']), value.git(['rev-parse', 'feat/c2/demo']), value.git(['rev-parse', 'feat/daemon-demo']),
    value.git(['rev-parse', 'refs/conductor/demo/closed/c1']), value.git(['rev-parse', 'refs/conductor/demo/closed/c2']),
  ]).then((entries) => entries.map((entry) => entry.stdout));
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('stale restack resolutions (real local Git)', () => {
  it('retires a parent-tree-stale tip into a fresh conflict with durable events and recipes', async () => {
    const value = await subject();
    const prior = await recordTip(value);
    const advanced = await advanceParent(value);
    const before = await stackRefs(value);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(value.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await expect(runRestack({ worktree: value.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, events, git: value.runner }))
        .resolves.toMatchObject({ kind: 'halted' });
    } finally { persister.stop(); }
    expect(await stackRefs(value)).toEqual(before);
    await expect(value.runner(['rev-parse', '-q', '--verify', resolutionRefFor('demo', child(2))])).resolves.toMatchObject({ exitCode: 1 });
    const fresh = await readConflictRecord(value.repo, 'demo', { git: value.runner });
    if (fresh.kind !== 'record') throw new Error('expected fresh conflict record');
    const journal = await readRestackJournal(value.repo, 'demo', { git: value.runner });
    expect(journal).toMatchObject({ kind: 'journal', journal: { state: 'aborted', opId: fresh.record.opId } });
    const liveParent = sha((await value.git(['rev-parse', `${fresh.record.newParent}^{tree}`])).stdout);
    expect(fresh.record).toMatchObject({
      child: 2, oldParent: value.first, oldTip: value.second, newParentTree: liveParent,
      commit: prior.record.commit, paths: prior.record.paths,
    });
    expect(fresh.record.newParent).not.toBe(prior.record.newParent);
    const halt = await readFile(join(value.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain(`Restack-Conflict: 2 ${fresh.record.opId}`);
    expect(halt).toContain('restack-resolution-stale\nparent-tree');
    expect(halt).toContain(`git rebase --onto ${fresh.record.newParent} ${fresh.record.oldParent}`);
    expect(halt).toContain('ai-conductor stack restack-resolve --slug demo --child 2 --tip <sha>');
    expect(halt).toContain('ai-conductor stack restack-resolve --slug demo --child 2 --decision "<answer>"');
    const persisted = (await readFile(join(value.repo, '.pipeline', 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(persisted).toContainEqual(expect.objectContaining({ type: 'restack_resolution', action: 'retired', tip: prior.tip }));
    expect(persisted).toContainEqual({ type: 'restack_refused', reason: 'restack-resolution-stale', child: 2, detail: 'parent-tree', ts: expect.any(String) });
  });

  it('retires a range-stale tip into a fresh conflict without moving stack refs', async () => {
    const value = await subject();
    const prior = await recordTip(value);
    await value.git(['checkout', '-q', 'feat/c2/demo']);
    await writeFile(join(value.repo, 'after-tip.txt'), 'changed\n');
    await value.git(['add', 'after-tip.txt']);
    await value.git(['commit', '-qm', 'feature content after resolution']);
    const changedTip = sha((await value.git(['rev-parse', 'HEAD'])).stdout);
    await value.git(['update-ref', 'refs/conductor/demo/closed/c2', changedTip]);
    await value.git(['checkout', '-q', 'feat/daemon-demo']);
    await expect(value.runner(['rebase', '--onto', changedTip, value.second])).resolves.toMatchObject({ exitCode: 0 });
    const before = await stackRefs(value);
    const advanced = await advanceParent(value);
    const events = new ConductorEventEmitter();
    const refused: unknown[] = [];
    events.on('restack_refused', (event) => { refused.push(event); });

    await expect(runRestack({ worktree: value.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, events, git: value.runner }))
      .resolves.toMatchObject({ kind: 'halted' });

    expect(await stackRefs(value)).toEqual(before);
    await expect(value.runner(['rev-parse', '-q', '--verify', resolutionRefFor('demo', child(2))])).resolves.toMatchObject({ exitCode: 1 });
    await expect(readConflictRecord(value.repo, 'demo', { git: value.runner })).resolves.toMatchObject({
      kind: 'record', record: { child: 2, oldTip: changedTip, commit: prior.record.commit, paths: prior.record.paths },
    });
    await expect(readFile(join(value.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatchObject(expect.stringContaining('restack-resolution-stale\nrange'));
    expect(refused).toContainEqual(expect.objectContaining({ type: 'restack_refused', reason: 'restack-resolution-stale', child: 2, detail: 'range' }));
  });

  it('makes planned-journal recovery write the same fresh parent-tree conflict without moving refs', async () => {
    const value = await subject();
    const prior = await recordTip(value);
    const advanced = await advanceParent(value);
    const before = await stackRefs(value);
    const journal = await plan(value, advanced, 'recovery-stale-parent-tree' as RestackOpId);

    await expect(recoverRestackJournal({ worktree: value.repo, slug: 'demo', git: value.runner })).resolves.toEqual({ kind: 'halted' });
    expect(await stackRefs(value)).toEqual(before);
    expect(await readRestackJournal(value.repo, 'demo', { git: value.runner })).toMatchObject({ kind: 'journal', journal: { state: 'aborted', opId: journal.opId } });
    await expect(value.runner(['rev-parse', '-q', '--verify', resolutionRefFor('demo', child(2))])).resolves.toMatchObject({ exitCode: 1 });
    const fresh = await readConflictRecord(value.repo, 'demo', { git: value.runner });
    if (fresh.kind !== 'record') throw new Error('expected fresh recovery conflict record');
    const tree = sha((await value.git(['rev-parse', `${fresh.record.newParent}^{tree}`])).stdout);
    expect(fresh).toMatchObject({ kind: 'record', record: {
      opId: journal.opId, child: 2, oldParent: value.first, oldTip: value.second, newParentTree: tree,
      commit: prior.record.commit, paths: prior.record.paths,
    } });
    await expect(readFile(join(value.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(`Restack-Conflict: 2 ${journal.opId}`);
  });

  it('retires an orphaned child-2 resolution and resumes ordinary executor and recovery replay', async () => {
    const executor = await subject(false);
    await executor.git(['update-ref', resolutionRefFor('demo', child(2)), executor.second]);
    const executorEvents = new ConductorEventEmitter();
    const executorPersister = new EventPersister(join(executor.repo, '.pipeline', 'events.jsonl'), executorEvents);
    executorPersister.start();
    try {
      await expect(runRestack({ worktree: executor.repo, slug: 'demo', cause: 'base-refresh', newDefault: executor.newDefault, events: executorEvents, git: executor.runner }))
        .resolves.toMatchObject({ kind: 'applied' });
    } finally { executorPersister.stop(); }
    await expect(executor.runner(['rev-parse', '-q', '--verify', resolutionRefFor('demo', child(2))])).resolves.toMatchObject({ exitCode: 1 });
    await expect(readFile(join(executor.repo, '.pipeline', 'events.jsonl'), 'utf8')).resolves.toContain('"action":"retired"');
    expect((await executor.git(['rev-parse', 'feat/c2/demo'])).stdout.trim()).not.toBe(executor.second);

    const recovery = await subject(false);
    await recovery.git(['update-ref', resolutionRefFor('demo', child(2)), recovery.second]);
    await plan(recovery, recovery.newDefault, 'orphan-recovery' as RestackOpId);
    const recoveryEvents = new ConductorEventEmitter();
    const recoveryPersister = new EventPersister(join(recovery.repo, '.pipeline', 'events.jsonl'), recoveryEvents);
    recoveryPersister.start();
    try {
      await expect(recoverRestackJournal({ worktree: recovery.repo, slug: 'demo', events: recoveryEvents, git: recovery.runner }))
      .resolves.toEqual({ kind: 'recovered', fromState: 'planned' });
    } finally { recoveryPersister.stop(); }
    await expect(recovery.runner(['rev-parse', '-q', '--verify', resolutionRefFor('demo', child(2))])).resolves.toMatchObject({ exitCode: 1 });
    expect((await recovery.git(['rev-parse', 'feat/c2/demo'])).stdout.trim()).not.toBe(recovery.second);
    await expect(readFile(join(recovery.repo, '.pipeline', 'events.jsonl'), 'utf8')).resolves.toContain('"action":"retired"');
  });

  it('preserves a different child record when it retires an orphan, and records a fresh ordinary-replay conflict', async () => {
    const value = await subject(false);
    await value.git(['update-ref', resolutionRefFor('demo', child(2)), value.second]);
    const tree = sha((await value.git(['rev-parse', `${value.second}^{tree}`])).stdout);
    await expect(writeConflictRecord(value.repo, 'demo', {
      opId: 'child-three-record' as RestackOpId, child: child(3), oldParent: value.second, oldTip: value.leaf,
      newParent: value.second, newParentTree: tree, candidateSubjects: ['leaf'], commit: value.leaf, paths: ['leaf.txt'],
    }, { git: value.runner })).resolves.toEqual({ kind: 'updated' });
    const before = (await value.git(['cat-file', 'blob', conflictRecordRefFor('demo')])).stdout;
    await expect(runRestack({ worktree: value.repo, slug: 'demo', cause: 'base-refresh', newDefault: value.newDefault, git: value.runner }))
      .resolves.toMatchObject({ kind: 'applied' });
    expect((await value.git(['cat-file', 'blob', conflictRecordRefFor('demo')])).stdout).toBe(before);
    await expect(value.runner(['rev-parse', '-q', '--verify', resolutionRefFor('demo', child(2))])).resolves.toMatchObject({ exitCode: 1 });
    expect((await value.git(['rev-parse', 'feat/c2/demo'])).stdout.trim()).not.toBe(value.second);

    const conflict = await subject();
    await conflict.git(['update-ref', resolutionRefFor('demo', child(2)), conflict.second]);
    await expect(runRestack({
      worktree: conflict.repo, slug: 'demo', cause: 'base-refresh', newDefault: conflict.newDefault, git: conflict.runner,
      resolver: async () => ({ resolved: false, reason: 'declined' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });
    const fresh = await readConflictRecord(conflict.repo, 'demo', { git: conflict.runner });
    expect(fresh).toMatchObject({ kind: 'record', record: { child: 2 } });
    await expect(readFile(join(conflict.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatchObject(expect.stringContaining('ai-conductor stack restack-resolve --slug demo --child 2 --tip <sha>'));
    await expect(readFile(join(conflict.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatchObject(expect.stringContaining('ai-conductor stack restack-resolve --slug demo --child 2 --decision "<answer>"'));
  });

  it('keeps refs still when the fresh stale record cannot be written, then replays normally after retirement', async () => {
    const value = await subject();
    await recordTip(value);
    const advanced = await advanceParent(value);
    const before = await stackRefs(value);
    const native = value.runner;
    const failing: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes(conflictRecordRefFor('demo'))) {
        return { exitCode: 1, stdout: '', stderr: 'injected fresh-record failure' };
      }
      return native(args, options);
    };
    await expect(runRestack({ worktree: value.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git: failing }))
      .resolves.toMatchObject({ kind: 'halted' });
    expect(await stackRefs(value)).toEqual(before);
    await expect(readFile(join(value.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('conflict record write failed');
    await expect(native(['rev-parse', '-q', '--verify', resolutionRefFor('demo', child(2))])).resolves.toMatchObject({ exitCode: 1 });
    const resolver = vi.fn(async () => ({ resolved: false as const, reason: 'ordinary replay reached resolver' }));
    await expect(runRestack({ worktree: value.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git: native, resolver, resolverCap: 1 }))
      .resolves.toMatchObject({ kind: 'halted' });
    expect(resolver).toHaveBeenCalled();
  });

  it('treats a deleted-resolution and retained-record crash state as an ordinary replay, never a consumption', async () => {
    const value = await subject();
    await recordTip(value);
    const advanced = await advanceParent(value);
    await value.git(['update-ref', '-d', resolutionRefFor('demo', child(2))]);
    const events = new ConductorEventEmitter();
    const consumed: unknown[] = [];
    events.on('restack_resolution', (event) => { if (event.type === 'restack_resolution' && event.action === 'consumed') consumed.push(event); });
    const resolver = vi.fn(async () => ({ resolved: false as const, reason: 'ordinary replay reached resolver' }));
    await expect(runRestack({ worktree: value.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, events, git: value.runner, resolver, resolverCap: 1 }))
      .resolves.toMatchObject({ kind: 'halted' });
    expect({ consumed, resolverCalls: resolver.mock.calls.length }).toEqual({ consumed: [], resolverCalls: 1 });
  });

  it('consumes the tip produced by the stale-HALT rebase recipe without a test-side ref update', async () => {
    const tipSubject = await subject();
    await recordTip(tipSubject);
    const advanced = await advanceParent(tipSubject);
    await expect(runRestack({ worktree: tipSubject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git: tipSubject.runner })).resolves.toMatchObject({ kind: 'halted' });
    const fresh = await readConflictRecord(tipSubject.repo, 'demo', { git: tipSubject.runner });
    if (fresh.kind !== 'record') throw new Error('expected stale conflict record');
    const halt = await readFile(join(tipSubject.repo, '.pipeline', 'HALT'), 'utf8');
    const recipe = printedRebaseRecipe(halt);
    expect(recipe).toEqual(['--onto', fresh.record.newParent, fresh.record.oldParent]);
    await tipSubject.git(['checkout', '-qb', 'recipe-tip', fresh.record.oldTip]);
    const recipeCalls: string[][] = [];
    const runRecipe = async () => {
      recipeCalls.push(recipe);
      return tipSubject.runner(['rebase', ...recipe]);
    };
    const rebased = await runRecipe();
    expect(rebased.exitCode).toBe(1);
    await writeFile(join(tipSubject.repo, 'shared.txt'), 'resolved again\n');
    await tipSubject.git(['add', 'shared.txt']);
    await expect(tipSubject.runner(['rebase', '--continue'])).resolves.toMatchObject({ exitCode: 0 });
    const answerTip = sha((await tipSubject.git(['rev-parse', 'HEAD'])).stdout);
    await tipSubject.git(['checkout', '-q', 'feat/daemon-demo']);
    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--tip', answerTip), { ...resolveDeps(tipSubject.repo), git: tipSubject.runner })).resolves.toBe(0);
    const events = new ConductorEventEmitter();
    const consumed: unknown[] = [];
    events.on('restack_resolution', (event) => { consumed.push(event); });
    await expect(runRestack({ worktree: tipSubject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, events, git: tipSubject.runner }))
      .resolves.toMatchObject({ kind: 'applied' });
    const appliedTip = sha((await tipSubject.git(['rev-parse', 'feat/c2/demo'])).stdout);
    expect(consumed).toContainEqual(expect.objectContaining({ type: 'restack_resolution', action: 'consumed', tip: appliedTip }));
    expect(await tipSubject.git(['rev-parse', 'refs/conductor/demo/closed/c2'])).toMatchObject({ stdout: `${appliedTip}\n` });
    expect(await tipSubject.git(['show', `${appliedTip}:shared.txt`])).toMatchObject({ stdout: 'resolved again\n' });
    expect(recipeCalls).toEqual([['--onto', fresh.record.newParent, fresh.record.oldParent]]);
    expect(recipeCalls.flat()).not.toContain('update-ref');
  });

  it('records a stale-HALT decision, clears HALT, and delivers it to the next resolver', async () => {
    const decisionSubject = await subject();
    await recordTip(decisionSubject);
    const decisionDefault = await advanceParent(decisionSubject);
    await expect(runRestack({ worktree: decisionSubject.repo, slug: 'demo', cause: 'base-refresh', newDefault: decisionDefault, git: decisionSubject.runner })).resolves.toMatchObject({ kind: 'halted' });
    const beforeInvalid = await readFile(join(decisionSubject.repo, '.pipeline', 'HALT'), 'utf8');
    const messages: string[] = [];
    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--tip', decisionSubject.first), { ...resolveDeps(decisionSubject.repo, (message) => messages.push(message)), git: decisionSubject.runner })).resolves.toBe(1);
    const decisionRecord = await readConflictRecord(decisionSubject.repo, 'demo', { git: decisionSubject.runner });
    if (decisionRecord.kind !== 'record') throw new Error('expected stale conflict record');
    expect(messages.join('\n')).toContain(`does not descend from recorded parent ${decisionRecord.record.newParent}`);
    expect(await readFile(join(decisionSubject.repo, '.pipeline', 'HALT'), 'utf8')).toBe(beforeInvalid);
    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', 'keep upstream'), { ...resolveDeps(decisionSubject.repo), git: decisionSubject.runner })).resolves.toBe(0);
    await expect(readFile(join(decisionSubject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(decisionSubject.repo, '.pipeline', 'events.jsonl'), 'utf8')).resolves.toContain('"type":"restack_decision","opId":"' + decisionRecord.record.opId + '","child":2,"action":"recorded"');
    const resolver = vi.fn(async ({ projectRoot, environment }: { projectRoot: string; environment: NodeJS.ProcessEnv }) => {
      await writeFile(join(projectRoot, 'shared.txt'), 'decision resolved\n');
      const local = makeGitRunner(projectRoot);
      await local(['add', 'shared.txt'], { env: environment });
      await local(['rebase', '--continue'], { env: environment });
      return { resolved: true as const };
    });
    await expect(runRestack({ worktree: decisionSubject.repo, slug: 'demo', cause: 'base-refresh', newDefault: decisionDefault, git: decisionSubject.runner, resolver, resolverCap: 1 }))
      .resolves.toMatchObject({ kind: 'applied' });
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ operatorDecision: expect.objectContaining({ answer: 'keep upstream' }) }));
  });
});
