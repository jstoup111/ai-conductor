// Covers: task:16
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
}

async function createFixture(mixed = false): Promise<HaltRecordFixture> {
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
    if (mixed) {
      await mkdir(join(repo, 'src'), { recursive: true });
      await writeFile(join(repo, 'src', 'c.ts'), 'upper child source\n');
    }
    await commit('upper child halt record');
    const childTwoTip = sha((await git(['rev-parse', 'HEAD'])).stdout);

    await git(['checkout', '-q', 'child-1']);
    await mkdir(join(repo, '.docs', 'halted'), { recursive: true });
    await writeFile(join(repo, '.docs', 'halted', 'demo.md'), 'lower child record\n');
    if (mixed) {
      await mkdir(join(repo, 'src'), { recursive: true });
      await writeFile(join(repo, 'src', 'c.ts'), 'lower child source\n');
    }
    await commit('lower child halt record');
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
    };
  } catch (error) {
    await rm(repo, { recursive: true, force: true });
    throw error;
  }
}

async function replayFirstChild(fixture: HaltRecordFixture) {
  return replayChildRange(fixture.childOne, fixture.newParent, stamp, makeGitRunner(fixture.repo));
}

describe('replayChildRange halt-record conflicts (real local Git)', () => {
  it('keeps the upper child halt record when the conflict is confined to that record', async () => {
    const fixture = await createFixture();
    try {
      const replayedOne = await replayFirstChild(fixture);
      const replayedTwo = await replayChildRange(fixture.childTwo, replayedOne.tip, stamp, makeGitRunner(fixture.repo));
      const inspect = join(fixture.repo, 'inspect');
      const git = (args: string[]) => execFile('git', args, { cwd: fixture.repo });
      await git(['worktree', 'add', '--detach', inspect, replayedTwo.tip]);
      try {
        await expect(readFile(join(inspect, '.docs', 'halted', 'demo.md'), 'utf8')).resolves.toBe('upper child record\n');
      } finally {
        await git(['worktree', 'remove', '--force', inspect]);
      }
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('leaves a mixed halt-record and source conflict for the resolver hand-off', async () => {
    const fixture = await createFixture(true);
    try {
      const replayedOne = await replayFirstChild(fixture);
      await expect(replayChildRange(fixture.childTwo, replayedOne.tip, stamp, makeGitRunner(fixture.repo)))
        .rejects.toThrow(/^merge-tree failed for [0-9a-f]{40}:/);
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });
});
