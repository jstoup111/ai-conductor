// Covers: task:15
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { supersedeHaltRecord } from '../../../src/engine/halt-record.js';
import { appendHaltRecordRef } from '../../../src/engine/halt-record-ref.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { journalRefFor, writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { cleanClearedAbortedRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('cleanClearedAbortedRestackJournal halt-record source (real local Git)', () => {
  it('uses the record ref over a committed record for Task 14 upgrades and opposing record states', async () => {
    const upgraded = await fixture('halted');
    await expect(supersedeHaltRecord(upgraded.repo, 'demo', 'operator resume')).resolves.toMatchObject({ kind: 'written' });
    await installAbortedJournal(upgraded.repo, upgraded.head);

    const resolvedRef = await fixture('halted');
    await expect(appendHaltRecordRef(resolvedRef.repo, 'demo', 'Status: resolved\n', undefined)).resolves.toMatchObject({ kind: 'updated' });
    await installAbortedJournal(resolvedRef.repo, resolvedRef.head);

    const haltedRef = await fixture('resolved');
    await expect(appendHaltRecordRef(haltedRef.repo, 'demo', 'Status: halted\n', undefined)).resolves.toMatchObject({ kind: 'updated' });
    await installAbortedJournal(haltedRef.repo, haltedRef.head);

    await expect(Promise.all([
      cleanClearedAbortedRestackJournal(upgraded.repo, 'demo', { git: makeGitRunner(upgraded.repo) }),
      cleanClearedAbortedRestackJournal(resolvedRef.repo, 'demo', { git: makeGitRunner(resolvedRef.repo) }),
      cleanClearedAbortedRestackJournal(haltedRef.repo, 'demo', { git: makeGitRunner(haltedRef.repo) }),
    ])).resolves.toEqual(['cleaned', 'cleaned', 'none']);
  });
});

async function fixture(headStatus: 'halted' | 'resolved') {
  const repo = await mkdtemp(join(tmpdir(), 'restack-recovery-halt-record-ref-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'recovery@example.test']);
  await git(['config', 'user.name', 'Restack recovery']);
  await mkdir(join(repo, '.docs', 'halted'), { recursive: true });
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await writeFile(join(repo, '.docs', 'halted', 'demo.md'), `Status: ${headStatus}\n\n## HALT\n\nlegacy halt\n`);
  await git(['add', '.']);
  await git(['commit', '-qm', 'legacy halt record']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  return { repo, head: sha((await git(['rev-parse', 'HEAD'])).stdout.trim()) };
}

async function installAbortedJournal(repo: string, head: CommitSha): Promise<void> {
  const journal: RestackJournal = {
    opId: 'halt-record-ref-recovery' as RestackOpId,
    cause: 'base-refresh',
    committer: { name: 'Restack recovery', email: 'recovery@example.test', date: '2030-01-01T00:00:00Z' },
    dirtyPaths: [],
    refs: [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: head }],
    ranges: [],
    children: [],
    state: 'aborted',
    owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
  };
  const blob = await writeRestackJournalBlob(repo, journal);
  await execFile('git', ['update-ref', journalRefFor('demo'), blob, ''], { cwd: repo });
}

function sha(value: string): CommitSha {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`expected SHA, got ${value}`);
  return value as CommitSha;
}
