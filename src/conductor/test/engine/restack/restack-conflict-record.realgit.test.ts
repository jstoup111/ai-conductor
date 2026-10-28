// Covers: task:1
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import {
  conflictParentRefFor,
  conflictRecordRefFor,
  readConflictRecord,
  writeConflictRecord,
  type RestackConflictRecord,
} from '../../../src/engine/restack/restack-conflict-record.js';
import { createRestackJournal, journalRefFor, pinStagingRef, readRestackJournal, writeRestackJournalBlob, type RestackJournalDraft } from '../../../src/engine/restack/restack-journal.js';
import { cleanClearedAbortedRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

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
});
