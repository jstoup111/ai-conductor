// Covers: task:38
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import {
  journalRefFor,
  stagingRefFor,
  writeRestackJournalBlob,
  type RestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import {
  deleteFeatureConductorRefs,
  featureConductorRefNames,
} from '../../../src/engine/restack/restack-refs-cleanup.js';
import type { RestackOpId } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-refs-cleanup-'));
  repositories.push(repo);
  const nativeGit = (args: string[]) => execFile('git', args, { cwd: repo });
  await nativeGit(['init', '-q', '-b', 'main']);
  await nativeGit(['config', 'user.email', 'cleanup@example.test']);
  await nativeGit(['config', 'user.name', 'Ref cleanup']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await nativeGit(['add', 'base.txt']);
  await nativeGit(['commit', '-qm', 'base']);
  return { repo, git: makeGitRunner(repo) };
}

describe('deleteFeatureConductorRefs (real local Git)', () => {
  it('deletes the finite pushed, cascade, leaf, journal and journal-named staging refs in one explicit transaction', async () => {
    const subject = await fixture();
    const child = parseChildId(1);
    if (!child) throw new Error('child 1 should be valid');
    const tip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();

    for (const ref of featureConductorRefNames('demo')) {
      if (ref === journalRefFor('demo')) continue;
      await subject.git(['update-ref', ref, tip]);
    }
    const journal: RestackJournal = {
      opId: 'cleanup-journal' as RestackOpId,
      cause: 'base-refresh',
      committer: { name: 'Ref cleanup', email: 'cleanup@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [],
      ranges: [{ child, oldParent: tip as never, oldTip: tip as never, kind: 'active' }],
      children: [{ child, status: 'pending' }],
      state: 'planned',
      owner: { host: 'cleanup-host', pid: 1, processStartTime: '0' },
    };
    const journalBlob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), journalBlob]);
    await subject.git(['update-ref', stagingRefFor('demo', child), tip]);

    const calls: Array<{ args: string[]; input?: string }> = [];
    const recordingGit: GitRunner = async (args, options) => {
      calls.push({ args: [...args], input: options?.input });
      return subject.git(args, options);
    };
    await expect(deleteFeatureConductorRefs('demo', recordingGit)).resolves.toBe(true);

    for (const ref of [...featureConductorRefNames('demo'), stagingRefFor('demo', child)]) {
      await expect(subject.git(['rev-parse', '-q', '--verify', ref])).resolves.toMatchObject({ exitCode: 1 });
    }
    const transaction = calls.find(({ args }) => args[0] === 'update-ref' && args[1] === '--stdin');
    expect(transaction?.input).toContain(`delete ${stagingRefFor('demo', child)} ${tip}`);
    expect(calls.map(({ args }) => args[0])).not.toContain('for-each-ref');
    expect(transaction?.input).not.toMatch(/[?*]/);
    expect(transaction?.input?.split('\n').filter((line) => line.startsWith('delete '))).toHaveLength(
      featureConductorRefNames('demo').length + 1,
    );
  });

  it('leaves a reused slug with no pushed record and zero cascade count', async () => {
    const subject = await fixture();
    const tip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    await subject.git(['update-ref', 'refs/conductor/demo/pushed/feat/daemon-demo', tip]);
    const cascadeBlob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ version: 1, counts: { 1: 2 } }) })).stdout.trim();
    await subject.git(['update-ref', 'refs/conductor/demo/cascades', cascadeBlob]);

    await expect(deleteFeatureConductorRefs('demo', subject.git)).resolves.toBe(true);
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/pushed/feat/daemon-demo']))
      .resolves.toMatchObject({ exitCode: 1 });
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/cascades']))
      .resolves.toMatchObject({ exitCode: 1 });
  });
});
