// Covers: task:10, task:14
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { resolutionRefFor, writeConflictRecord } from '../../../src/engine/restack/restack-conflict-record.js';
import { journalRefFor, readRestackJournal, writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { resolveUnenteredLeafOwner } from '../../../src/engine/restack/restack-unentered-leaf.js';
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

describe('recovery consumed-resolution leaf ownership (real local Git)', () => {
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
