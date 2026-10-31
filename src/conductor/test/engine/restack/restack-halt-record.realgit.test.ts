// Covers: task:3
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { replayChildRange, type CommitterStamp } from '../../../src/engine/restack/restack-replay.js';
import { parseCommitSha, type ChildRange, type CommitSha } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);

const stamp: CommitterStamp = {
  name: 'Restack Journal',
  email: 'journal@example.test',
  date: '2030-02-03T04:05:06Z',
};

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected Git object name, got ${value}`);
  return parsed;
}

interface HaltRecordFixture {
  readonly repo: string;
  readonly childOne: ChildRange;
  readonly childTwo: ChildRange;
  readonly newParent: CommitSha;
  readonly lowerHalt: CommitSha;
  readonly upperHalt: CommitSha;
}

async function createFixture(mode: 'normal' | 'mixed' | 'pin' = 'normal'): Promise<HaltRecordFixture> {
  const mixed = mode === 'mixed';
  const pin = mode === 'pin';
  const repo = await mkdtemp(join(tmpdir(), 'restack-halt-record-'));
  const git = (args: string[], env?: NodeJS.ProcessEnv) => execFile('git', args, { cwd: repo, env });
  const commit = async (message: string) => {
    await git(['add', '.']);
    await git(['commit', '-qm', message], {
      ...process.env,
      GIT_AUTHOR_NAME: 'Fixture Author',
      GIT_AUTHOR_EMAIL: 'fixture-author@example.test',
      GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
      GIT_COMMITTER_NAME: 'Fixture Committer',
      GIT_COMMITTER_EMAIL: 'fixture@example.test',
      GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
    });
  };

  try {
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.name', 'Fixture Committer']);
    await git(['config', 'user.email', 'fixture@example.test']);
    await writeFile(join(repo, 'base.txt'), 'base\n');
    await commit('base');
    const base = sha((await git(['rev-parse', 'HEAD'])).stdout);

    await git(['checkout', '-qb', 'child-1']);
    await writeFile(join(repo, 'child-1.txt'), 'closure\n');
    await commit('child 1 closure');
    const childOneClosure = sha((await git(['rev-parse', 'HEAD'])).stdout);

    await git(['checkout', '-qb', 'child-2']);
    await mkdir(join(repo, '.docs', 'halted'), { recursive: true });
    await writeFile(join(repo, '.docs', 'halted', 'demo.md'), 'upper child record\n');
    if (mixed || pin) {
      await mkdir(join(repo, 'src'), { recursive: true });
      await writeFile(join(repo, 'src', pin ? 'b.ts' : 'c.ts'), 'upper child source\n');
    }
    await commit('upper child halt record');
    const upperHalt = sha((await git(['rev-parse', 'HEAD'])).stdout);
    if (!mixed && !pin) {
      await writeFile(join(repo, 'child-2.txt'), 'work\n');
      await commit('child 2 work');
    }
    const childTwoTip = sha((await git(['rev-parse', 'HEAD'])).stdout);

    await git(['checkout', '-q', 'child-1']);
    await mkdir(join(repo, '.docs', 'halted'), { recursive: true });
    await writeFile(join(repo, '.docs', 'halted', 'demo.md'), 'lower child record\n');
    if (mixed || pin) {
      await mkdir(join(repo, 'src'), { recursive: true });
      await writeFile(join(repo, 'src', pin ? 'a.ts' : 'c.ts'), 'lower child source\n');
    }
    await commit('lower child halt record');
    const lowerHalt = sha((await git(['rev-parse', 'HEAD'])).stdout);
    const childOneTip = sha((await git(['rev-parse', 'HEAD'])).stdout);

    await git(['checkout', '-qb', 'new-parent', base]);
    await writeFile(join(repo, 'upstream.txt'), 'upstream\n');
    await commit('upstream');
    const newParent = sha((await git(['rev-parse', 'HEAD'])).stdout);

    const childOne = parseChildId(1);
    const childTwo = parseChildId(2);
    if (!childOne || !childTwo) throw new Error('fixture child ids must be valid');
    return {
      repo,
      childOne: { child: childOne, oldParent: base, oldTip: childOneTip, kind: 'closed' },
      childTwo: { child: childTwo, oldParent: childOneClosure, oldTip: childTwoTip, kind: 'active' },
      newParent,
      lowerHalt,
      upperHalt,
    };
  } catch (error) {
    await rm(repo, { recursive: true, force: true });
    throw error;
  }
}

async function replayFirstChild(fixture: HaltRecordFixture) {
  return replayChildRange(fixture.childOne, fixture.newParent, stamp, makeGitRunner(fixture.repo), { haltRecordSlug: 'demo' });
}

describe('replayChildRange halt-record conflicts (real local Git)', () => {
  it('omits halt-record-only commits and maps their rewrites to the replay tip', async () => {
    const fixture = await createFixture();
    try {
      const replayedOne = await replayFirstChild(fixture);
      const replayedTwo = await replayChildRange(fixture.childTwo, replayedOne.tip, stamp, makeGitRunner(fixture.repo), { haltRecordSlug: 'demo' });
      const git = (args: string[]) => execFile('git', args, { cwd: fixture.repo });
      await expect(git(['log', '--format=%s', `${fixture.newParent}..${replayedTwo.tip}`])).resolves.toMatchObject({ stdout: 'child 2 work\nhalt record: demo\nchild 1 closure\n' });
      expect(replayedOne.rewrites.size).toBe(2);
      expect(replayedTwo.rewrites.size).toBe(2);
      expect(replayedOne.rewrites.get(fixture.lowerHalt)).toBe(replayedOne.tip);
      expect(replayedTwo.rewrites.get(fixture.upperHalt)).toBe(replayedOne.tip);
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('leaves a mixed halt-record and source conflict for the resolver hand-off', async () => {
    const fixture = await createFixture('mixed');
    try {
      const replayedOne = await replayFirstChild(fixture);
      await expect(replayChildRange(fixture.childTwo, replayedOne.tip, stamp, makeGitRunner(fixture.repo), { haltRecordSlug: 'demo' }))
        .rejects.toThrow(/^merge-tree failed for [0-9a-f]{40}:/);
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('pins the halt path while replaying the kept source change with its original message', async () => {
    const fixture = await createFixture('pin');
    try {
      const replayedOne = await replayFirstChild(fixture);
      const replayedTwo = await replayChildRange(fixture.childTwo, replayedOne.tip, stamp, makeGitRunner(fixture.repo), { haltRecordSlug: 'demo' });
      const git = (args: string[]) => execFile('git', args, { cwd: fixture.repo });
      await expect(git(['show', `${replayedTwo.tip}:src/b.ts`])).resolves.toMatchObject({ stdout: 'upper child source\n' });
      await expect(git(['show', `${replayedTwo.tip}:.docs/halted/demo.md`])).resolves.toMatchObject({ stdout: 'lower child record\n' });
      await expect(git(['show', '-s', '--format=%B', replayedTwo.tip])).resolves.toMatchObject({ stdout: 'upper child halt record\n\n' });
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });
});
