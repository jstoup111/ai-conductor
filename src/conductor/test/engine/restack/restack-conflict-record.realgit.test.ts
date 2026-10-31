// Covers: task:1
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import {
  conflictParentRefFor,
  conflictRecordRefFor,
  consumeRecordedResolution,
  decisionMatchesRange,
  decisionRefFor,
  readRestackDecision,
  recordAnswer,
  readConflictRecord,
  resolutionRefFor,
  type RestackDecision,
  writeConflictRecord,
  type RestackConflictRecord,
} from '../../../src/engine/restack/restack-conflict-record.js';
import { createRestackJournal, journalRefFor, pinStagingRef, readRestackJournal, writeRestackJournalBlob, type RestackJournalDraft } from '../../../src/engine/restack/restack-journal.js';
import { cleanClearedAbortedRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { replayChildRange } from '../../../src/engine/restack/restack-replay.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
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

function child(value: number) {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`expected child id, got ${value}`);
  return parsed;
}

async function createRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-conflict-record-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack conflict record']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const head = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  return { repo, git, head };
}

function record(head: CommitSha, value: { readonly child?: number; readonly opId?: string } = {}): RestackConflictRecord {
  return {
    opId: (value.opId ?? 'conflict-op') as RestackOpId,
    child: child(value.child ?? 2),
    oldParent: head,
    oldTip: head,
    newParent: head,
    newParentTree: head,
    candidateSubjects: ['first candidate', 'second candidate'],
    commit: head,
    paths: ['src/owned.ts', 'src/also-owned.ts'],
  };
}

describe('restack conflict record (real local Git)', () => {
  // Covers: task:3
  it('records a base-refresh child-2 conflict before moving any stack ref', async () => {
    const subject = await createRepo();
    const commit = async (message: string, path: string, contents: string): Promise<CommitSha> => {
      await writeFile(join(subject.repo, path), contents);
      await subject.git(['add', path]);
      await subject.git(['commit', '-qm', message]);
      return sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    };
    await mkdir(join(subject.repo, 'src'), { recursive: true });
    await commit('add flag', 'src/flag.ts', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const childOne = await commit('child one', 'src/one.ts', 'one\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', childOne]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const childTwo = await commit('child two changes flag', 'src/flag.ts', 'child two\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', childTwo]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await commit('leaf', 'src/leaf.ts', 'leaf\n');
    await subject.git(['checkout', '-q', 'main']);
    const newDefault = await commit('default changes flag', 'src/flag.ts', 'default\n');
    await writeSliceTopologyFixture(subject.repo, {
      version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
      sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
      storyOwnership: { S1: 1, S2: 2, S3: 3 },
    }, envelopeFilesystem);
    const before = (await subject.git([
      'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/closed/',
    ])).stdout;

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault,
      git: makeGitRunner(subject.repo), resolver: async () => ({ resolved: false, reason: 'declined' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });

    const journal = await readRestackJournal(subject.repo, 'demo');
    if (journal.kind !== 'journal') throw new Error('expected aborted journal');
    const replayParent = sha((await subject.git(['rev-parse', 'refs/conductor/demo/restack/staging/c1'])).stdout.trim());
    const replayParentTree = sha((await subject.git(['rev-parse', `${replayParent}^{tree}`])).stdout.trim());
    await expect(readConflictRecord(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'record', slug: 'demo', record: {
        opId: journal.journal.opId, child: child(2), oldParent: childOne, oldTip: childTwo,
        newParent: replayParent, newParentTree: replayParentTree,
        candidateSubjects: ['child two changes flag'], commit: childTwo, paths: ['src/flag.ts'],
      },
    });
    await expect(makeGitRunner(subject.repo)(['rev-parse', '--verify', conflictParentRefFor('demo')])).resolves.toMatchObject({
      exitCode: 0, stdout: replayParent,
    });
    expect((await subject.git([
      'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/closed/',
    ])).stdout).toBe(before);
  });

  // Covers: task:3
  it('halts a merge-bearing base refresh as flatten_refused without writing conflict refs', async () => {
    const subject = await createRepo();
    const commit = async (message: string, path: string, contents: string): Promise<CommitSha> => {
      await writeFile(join(subject.repo, path), contents);
      await subject.git(['add', path]);
      await subject.git(['commit', '-qm', message]);
      return sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    };
    await mkdir(join(subject.repo, 'src'), { recursive: true });
    await commit('add flag', 'src/flag.ts', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const childOne = await commit('child one', 'src/one.ts', 'one\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', childOne]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    await commit('child two changes flag', 'src/flag.ts', 'child two\n');
    await subject.git(['checkout', '-q', 'main']);
    await commit('main commit', 'src/flag.ts', 'main\n');
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    await subject.git(['merge', '--no-ff', '--no-commit', 'main']).catch(() => undefined);
    await writeFile(join(subject.repo, 'src/flag.ts'), 'merge resolution\n');
    await subject.git(['add', 'src/flag.ts']);
    await subject.git(['commit', '-qm', 'child two merge']);
    const childTwoMerge = sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', childTwoMerge]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await commit('leaf', 'src/leaf.ts', 'leaf\n');
    await subject.git(['checkout', '-q', 'main']);
    const newDefault = await commit('default advance', 'src/flag.ts', 'default\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await writeSliceTopologyFixture(subject.repo, {
      version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
      sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
      storyOwnership: { S1: 1, S2: 2, S3: 3 },
    }, envelopeFilesystem);
    const refusals: unknown[] = [];
    const { ConductorEventEmitter } = await import('../../../src/ui/events.js');
    const events = new ConductorEventEmitter();
    events.on('restack_refused', (event) => refusals.push(event));

    const result = await runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault,
      events, git: makeGitRunner(subject.repo), resolver: async () => ({ resolved: false, reason: 'must not be called' }),
    });
    expect(result).toMatchObject({ kind: 'halted' });

    expect(refusals).toContainEqual(expect.objectContaining({
      reason: 'flatten_refused', child: 2, detail: expect.stringContaining(childTwoMerge),
    }));
    await expect(readConflictRecord(subject.repo, 'demo')).resolves.toEqual({ kind: 'missing' });
    await expect(makeGitRunner(subject.repo)(['rev-parse', '-q', '--verify', conflictParentRefFor('demo')])).resolves.toMatchObject({ exitCode: 1 });
  });

  // Covers: task:2
  it('writes and reads a fail-closed operator decision for its exact child range', async () => {
    const subject = await createRepo();
    const decision: RestackDecision = {
      child: child(2), oldParent: subject.head, oldTip: subject.head, commit: subject.head,
      paths: ['src/flag.ts'], answer: 'keep the upstream seam', operator: 'operator@example.test',
    };

    await expect(recordAnswer(subject.repo, 'demo', { kind: 'decision', decision })).resolves.toEqual({ kind: 'updated' });
    await expect(readRestackDecision(subject.repo, 'demo', child(2))).resolves.toMatchObject({
      kind: 'decision', slug: 'demo', decision,
    });

    for (const invalid of [
      { ...decision, operator: undefined },
      { ...decision, commit: 'not-a-sha' },
      { ...decision, answer: '' },
    ]) {
      const blob = sha((await makeGitRunner(subject.repo)(['hash-object', '-w', '--stdin'], { input: JSON.stringify(invalid) })).stdout.trim());
      await subject.git(['update-ref', decisionRefFor('demo', child(2)), blob]);
      await expect(readRestackDecision(subject.repo, 'demo', child(2))).resolves.toEqual({ kind: 'unreadable', blob });
    }

    const range = { child: child(2), oldParent: subject.head, oldTip: subject.head, kind: 'closed' as const };
    expect(decisionMatchesRange(decision, range)).toBe(true);
    expect(decisionMatchesRange({ ...decision, child: child(3) }, range)).toBe(false);
    expect(decisionMatchesRange({ ...decision, oldParent: sha('1'.repeat(40)) }, range)).toBe(false);
    expect(decisionMatchesRange({ ...decision, oldTip: sha('2'.repeat(40)) }, range)).toBe(false);
  });

  // Covers: task:2
  it('atomically replaces the other answer kind and rejects a changed compare-and-swap value', async () => {
    const subject = await createRepo();
    const decision: RestackDecision = {
      child: child(2), oldParent: subject.head, oldTip: subject.head, commit: subject.head,
      paths: ['src/flag.ts'], answer: 'keep the upstream seam', operator: 'operator@example.test',
    };
    const resolution = resolutionRefFor('demo', child(2));
    const decisionRef = decisionRefFor('demo', child(2));
    await subject.git(['update-ref', resolution, subject.head]);

    await expect(recordAnswer(subject.repo, 'demo', { kind: 'decision', decision })).resolves.toEqual({ kind: 'updated' });
    await expect(makeGitRunner(subject.repo)(['rev-parse', '-q', '--verify', resolution])).resolves.toMatchObject({ exitCode: 1 });
    const recorded = await readRestackDecision(subject.repo, 'demo', child(2));
    expect(recorded.kind).toBe('decision');

    await expect(recordAnswer(subject.repo, 'demo', { kind: 'tip', child: child(2), tip: subject.head })).resolves.toEqual({ kind: 'updated' });
    await expect(makeGitRunner(subject.repo)(['rev-parse', '-q', '--verify', decisionRef])).resolves.toMatchObject({ exitCode: 1 });
    await expect(makeGitRunner(subject.repo)(['rev-parse', '--verify', resolution])).resolves.toMatchObject({
      exitCode: 0, stdout: subject.head,
    });

    const current = sha((await subject.git(['rev-parse', resolution])).stdout.trim());
    await subject.git(['commit', '--allow-empty', '-qm', 'concurrent answer']);
    const concurrent = sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    const native = makeGitRunner(subject.repo);
    let raced = false;
    const racingGit = async (args: string[], options?: { input?: string }) => {
      if (!raced && args[0] === 'update-ref' && args[1] === '--stdin') {
        raced = true;
        await native(['update-ref', resolution, concurrent, current]);
      }
      return native(args, options);
    };
    await expect(recordAnswer(subject.repo, 'demo', { kind: 'decision', decision }, { git: racingGit }))
      .resolves.toEqual({ kind: 'stale' });
    await expect(native(['rev-parse', '-q', '--verify', decisionRef])).resolves.toMatchObject({ exitCode: 1 });
    await expect(native(['rev-parse', resolution])).resolves.toMatchObject({ exitCode: 0, stdout: concurrent });
  });

  it('writes the complete parsed record and pins its replay parent', async () => {
    const subject = await createRepo();
    const expected = record(subject.head);

    await expect(writeConflictRecord(subject.repo, 'demo', expected)).resolves.toEqual({ kind: 'updated' });

    await expect(readConflictRecord(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'record', slug: 'demo', record: expected,
    });
    const parent = await makeGitRunner(subject.repo)(['rev-parse', '--verify', conflictParentRefFor('demo')]);
    expect(parent.exitCode).toBe(0);
    expect(parent.stdout.trim()).toBe(expected.newParent);
  });

  it('replaces both refs atomically and fails closed when either expected old value changes', async () => {
    const subject = await createRepo();
    await expect(writeConflictRecord(subject.repo, 'demo', record(subject.head))).resolves.toEqual({ kind: 'updated' });
    const firstRecord = sha((await subject.git(['rev-parse', conflictRecordRefFor('demo')])).stdout.trim());
    const firstParent = sha((await subject.git(['rev-parse', conflictParentRefFor('demo')])).stdout.trim());

    await expect(writeConflictRecord(subject.repo, 'demo', record(subject.head, { child: 3, opId: 'later-conflict' }))).resolves.toEqual({ kind: 'updated' });
    await expect(readConflictRecord(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'record', record: { child: child(3), opId: 'later-conflict' },
    });

    const currentRecord = sha((await subject.git(['rev-parse', conflictRecordRefFor('demo')])).stdout.trim());
    const currentParent = sha((await subject.git(['rev-parse', conflictParentRefFor('demo')])).stdout.trim());
    const native = makeGitRunner(subject.repo);
    const concurrent = sha((await native(['hash-object', '-w', '--stdin'], { input: '{"concurrent":true}' })).stdout.trim());
    let changed = false;
    const racingGit = async (args: string[], options?: { input?: string }) => {
      if (!changed && args[0] === 'update-ref' && args[1] === '--stdin') {
        changed = true;
        await native(['update-ref', conflictRecordRefFor('demo'), concurrent, currentRecord]);
        return { exitCode: 1, stdout: '', stderr: 'simulated concurrent change' };
      }
      return native(args, options);
    };

    await expect(writeConflictRecord(subject.repo, 'demo', record(subject.head, { child: 2, opId: 'stale' }), { git: racingGit })).resolves.toEqual({ kind: 'stale' });
    expect((await native(['rev-parse', conflictRecordRefFor('demo')])).stdout.trim()).toBe(concurrent);
    expect((await native(['rev-parse', conflictParentRefFor('demo')])).stdout.trim()).toBe(currentParent);
    expect(firstRecord).not.toBe(currentRecord);
    expect(firstParent).toBe(currentParent);
  });

  it('fails closed for malformed records and reports an absent record as missing', async () => {
    const subject = await createRepo();
    await expect(readConflictRecord(subject.repo, 'demo')).resolves.toEqual({ kind: 'missing' });

    for (const invalid of [
      { ...record(subject.head), newParent: 'not-a-sha' },
      { ...record(subject.head), child: 2.5 },
    ]) {
      const blob = sha((await makeGitRunner(subject.repo)(['hash-object', '-w', '--stdin'], { input: JSON.stringify(invalid) })).stdout.trim());
      await subject.git(['update-ref', conflictRecordRefFor('demo'), blob]);
      await expect(readConflictRecord(subject.repo, 'demo')).resolves.toEqual({ kind: 'unreadable', blob });
    }
  });

  it('leaves conflict refs intact while cleaning an aborted journal and staging refs', async () => {
    const subject = await createRepo();
    await writeConflictRecord(subject.repo, 'demo', record(subject.head));
    const recordBefore = (await subject.git(['rev-parse', conflictRecordRefFor('demo')])).stdout.trim();
    const parentBefore = (await subject.git(['rev-parse', conflictParentRefFor('demo')])).stdout.trim();
    const draft: RestackJournalDraft = {
      opId: 'journal-op' as RestackOpId,
      cause: 'feature-repair',
      committer: { name: 'Restack', email: 'restack@example.test', date: '2030-01-01T00:00:00Z' },
      dirtyPaths: [],
      refs: [],
      ranges: [],
      children: [],
    };
    expect((await createRestackJournal(subject.repo, 'demo', draft)).kind).toBe('created');
    const planned = await readRestackJournal(subject.repo, 'demo');
    if (planned.kind !== 'journal') throw new Error('expected journal');
    const aborted = { ...planned.journal, state: 'aborted' as const };
    const abortedBlob = await writeRestackJournalBlob(subject.repo, aborted);
    await subject.git(['update-ref', journalRefFor('demo'), abortedBlob, planned.blob]);
    await pinStagingRef(subject.repo, 'demo', child(1), subject.head);

    await expect(cleanClearedAbortedRestackJournal(subject.repo, 'demo')).resolves.toBe('cleaned');
    await expect(makeGitRunner(subject.repo)(['rev-parse', '-q', '--verify', journalRefFor('demo')])).resolves.toMatchObject({ exitCode: 1 });
    await expect(makeGitRunner(subject.repo)(['rev-parse', '-q', '--verify', 'refs/conductor/demo/restack/staging/c1'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(subject.git(['rev-parse', conflictRecordRefFor('demo')])).resolves.toMatchObject({ stdout: `${recordBefore}\n` });
    await expect(subject.git(['rev-parse', conflictParentRefFor('demo')])).resolves.toMatchObject({ stdout: `${parentBefore}\n` });
  });

  // Covers: task:7
  it('consumes a matching resolution onto an equivalent live parent tree', async () => {
    const subject = await createRepo();
    const commit = async (message: string, path?: string, contents?: string): Promise<CommitSha> => {
      if (path !== undefined) {
        await writeFile(join(subject.repo, path), contents ?? 'value\n');
        await subject.git(['add', path]);
      }
      await subject.git(['commit', '-qm', message]);
      return sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    };
    const oldParent = subject.head;
    const original = await commit('carry this subject', 'owned.txt', 'original\n');
    const oldTip = original;
    await subject.git(['checkout', '-q', '-b', 'resolution', oldParent]);
    const recordedParent = await commit('new parent', 'base.txt', 'new parent\n');
    const resolutionTip = await commit('carry this subject', 'owned.txt', 'resolved\n');
    await subject.git(['checkout', '-q', recordedParent]);
    await subject.git(['commit', '--allow-empty', '-qm', 'metadata parent']);
    const liveParent = sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    const parentTree = sha((await subject.git(['rev-parse', `${recordedParent}^{tree}`])).stdout.trim());
    const conflict: RestackConflictRecord = {
      ...record(oldTip),
      oldParent,
      oldTip,
      newParent: recordedParent,
      newParentTree: parentTree,
      candidateSubjects: ['carry this subject'],
      commit: original,
      paths: ['owned.txt'],
    };
    await expect(writeConflictRecord(subject.repo, 'demo', conflict)).resolves.toEqual({ kind: 'updated' });
    await subject.git(['update-ref', resolutionRefFor('demo', child(2)), resolutionTip]);

    const result = await consumeRecordedResolution({
      slug: 'demo',
      range: { child: child(2), oldParent, oldTip, kind: 'closed' },
      parent: liveParent,
      committer: { name: 'Restack', email: 'restack@example.test', date: '2030-01-01T00:00:00Z' },
      git: makeGitRunner(subject.repo),
      replay: (range, parent, committer, git) => replayChildRange(range, parent, committer, git, { comparisonCommits: [] }),
    });

    expect(result).toMatchObject({ kind: 'consumed', resolution: { child: child(2), tip: resolutionTip } });
    if (result.kind !== 'consumed') throw new Error('expected consumed resolution');
    await subject.git(['diff', '--exit-code', `${resolutionTip}^{tree}`, `${result.tip}^{tree}`]);
    expect(result.rewrites.get(original)).toBeDefined();
  });

  it('reports absent, malformed-range, missing-record, and changed-parent resolution state without replaying', async () => {
    const subject = await createRepo();
    const commit = async (message: string, path: string, contents: string): Promise<CommitSha> => {
      await writeFile(join(subject.repo, path), contents);
      await subject.git(['add', path]);
      await subject.git(['commit', '-qm', message]);
      return sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    };
    const oldParent = subject.head;
    const oldTip = await commit('candidate', 'owned.txt', 'original\n');
    await subject.git(['checkout', '-q', '-b', 'resolution', oldParent]);
    const newParent = await commit('new parent', 'base.txt', 'new\n');
    const resolutionTip = await commit('candidate', 'owned.txt', 'resolved\n');
    const parentTree = sha((await subject.git(['rev-parse', `${newParent}^{tree}`])).stdout.trim());
    const liveParent = newParent;
    const replay = async () => ({ tip: resolutionTip, rewrites: new Map<CommitSha, CommitSha>() });
    const input = (range = { child: child(2), oldParent, oldTip, kind: 'closed' as const }) => ({
      slug: 'demo', range, parent: liveParent,
      committer: { name: 'Restack', email: 'restack@example.test', date: '2030-01-01T00:00:00Z' },
      git: makeGitRunner(subject.repo), replay,
    });

    await expect(consumeRecordedResolution(input())).resolves.toEqual({ kind: 'none' });
    await subject.git(['update-ref', resolutionRefFor('demo', child(2)), resolutionTip]);
    await expect(consumeRecordedResolution(input())).resolves.toEqual({ kind: 'stale', field: 'record' });

    const conflict: RestackConflictRecord = {
      ...record(oldTip), oldParent, oldTip, newParent, newParentTree: parentTree,
      candidateSubjects: ['candidate'], commit: oldTip, paths: ['owned.txt'],
    };
    await writeConflictRecord(subject.repo, 'demo', conflict);
    await expect(consumeRecordedResolution(input({ ...input().range, oldTip: oldParent }))).resolves.toEqual({ kind: 'stale', field: 'range' });

    await subject.git(['checkout', '-q', newParent]);
    const changedParent = await commit('changes parent tree', 'base.txt', 'changed\n');
    await expect(consumeRecordedResolution({ ...input(), parent: changedParent })).resolves.toEqual({ kind: 'stale', field: 'parent-tree' });
  });

  it('maps only uniquely-subjected original candidates to rebuilt resolution commits', async () => {
    const subject = await createRepo();
    const commit = async (message: string, path: string, contents: string): Promise<CommitSha> => {
      await writeFile(join(subject.repo, path), contents);
      await subject.git(['add', path]);
      await subject.git(['commit', '-qm', message]);
      return sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    };
    const oldParent = subject.head;
    const uniqueOriginal = await commit('unique', 'unique.txt', 'original\n');
    const duplicateOne = await commit('duplicate', 'one.txt', 'one\n');
    const duplicateTwo = await commit('duplicate', 'two.txt', 'two\n');
    await subject.git(['checkout', '-q', '-b', 'resolution', oldParent]);
    const newParent = await commit('new parent', 'base.txt', 'new\n');
    const uniqueResolution = await commit('unique', 'unique.txt', 'resolved\n');
    await commit('duplicate', 'one.txt', 'resolved one\n');
    const resolutionTip = await commit('duplicate', 'two.txt', 'resolved two\n');
    const parentTree = sha((await subject.git(['rev-parse', `${newParent}^{tree}`])).stdout.trim());
    const conflict: RestackConflictRecord = {
      ...record(resolutionTip), oldParent, oldTip: duplicateTwo, newParent, newParentTree: parentTree,
      candidateSubjects: ['unique', 'duplicate', 'duplicate'], commit: uniqueOriginal,
      paths: ['unique.txt', 'one.txt', 'two.txt'],
    };
    await writeConflictRecord(subject.repo, 'demo', conflict);
    await subject.git(['update-ref', resolutionRefFor('demo', child(2)), resolutionTip]);
    const rebuiltUnique = sha((await subject.git(['rev-parse', uniqueResolution])).stdout.trim());

    const result = await consumeRecordedResolution({
      slug: 'demo', range: { child: child(2), oldParent, oldTip: duplicateTwo, kind: 'closed' }, parent: newParent,
      committer: { name: 'Restack', email: 'restack@example.test', date: '2030-01-01T00:00:00Z' },
      git: makeGitRunner(subject.repo),
      replay: async () => ({ tip: resolutionTip, rewrites: new Map([[uniqueResolution, rebuiltUnique]]) }),
    });
    expect(result).toMatchObject({ kind: 'consumed' });
    if (result.kind !== 'consumed') throw new Error('expected consumed resolution');
    expect(result.rewrites.get(uniqueOriginal)).toBe(rebuiltUnique);
    expect(result.rewrites.has(duplicateOne)).toBe(false);
    expect(result.rewrites.has(duplicateTwo)).toBe(false);
  });
});
