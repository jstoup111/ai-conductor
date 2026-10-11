// Covers: task:12
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { classifyReplayMerge, makeGitRunner } from '../../../src/engine/rebase.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { replayChildRange, type CommitterStamp } from '../../../src/engine/restack/restack-replay.js';
import { parseCommitSha, type ChildRange, type CommitSha } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);

const stamp: CommitterStamp = {
  name: 'Restack Journal',
  email: 'journal@example.test',
  date: '2030-02-03T04:05:06Z',
};

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value);
  if (!parsed) throw new Error(`expected full SHA: ${value}`);
  return parsed;
}

interface MergeFixture {
  readonly repo: string;
  readonly git: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
  readonly range: ChildRange;
  readonly merge: CommitSha;
  readonly newParent: CommitSha;
}

async function fixture(kind: 'automatic' | 'hand-resolved' | 'side-not-carried', mainAfterMerge?: 'edit' | 'revert'): Promise<MergeFixture> {
  const repo = await mkdtemp(join(tmpdir(), 'restack-merges-'));
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string) => {
    await git(['add', '.']);
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  };
  try {
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'restack@example.test']);
    await git(['config', 'user.name', 'Restack merge fixture']);
    await writeFile(join(repo, 'shared.txt'), 'base\n');
    const base = await commit('base');

    await git(['checkout', '-qb', 'child']);
    await writeFile(join(repo, 'child.txt'), 'child work\n');
    await commit('child work');

    if (kind === 'side-not-carried') {
      await git(['checkout', '-qb', 'side', base]);
      await writeFile(join(repo, 'side.txt'), 'side work\n');
      await commit('side work');
      await git(['checkout', '-q', 'child']);
      await git(['merge', '--no-ff', '-m', 'merge side', 'side']);
      const merge = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
      await git(['checkout', '-q', 'main']);
      await writeFile(join(repo, 'upstream.txt'), 'upstream work\n');
      const newParent = await commit('upstream advance');
      const child = parseChildId(1);
      if (!child) throw new Error('invalid child id');
      return { repo, git, range: { child, oldParent: base, oldTip: merge, kind: 'active' }, merge, newParent };
    }

    await git(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'shared.txt'), 'D1\n');
    await commit('D1');
    await git(['checkout', '-q', 'child']);
    if (kind === 'hand-resolved') {
      await git(['merge', '--no-ff', '--no-commit', 'main']);
      await writeFile(join(repo, 'shared.txt'), 'hand resolution\n');
      await git(['add', 'shared.txt']);
      await git(['commit', '-qm', 'merge main with hand resolution']);
    } else {
      await git(['merge', '--no-ff', '-m', 'merge main automatically', 'main']);
    }
    const merge = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
    await git(['checkout', '-q', 'main']);
    if (mainAfterMerge === 'edit') {
      await writeFile(join(repo, 'shared.txt'), 'D2\n');
      await commit('D2');
    } else if (mainAfterMerge === 'revert') {
      await writeFile(join(repo, 'shared.txt'), 'base\n');
      await commit('revert D1');
    }
    const newParent = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
    const child = parseChildId(1);
    if (!child) throw new Error('invalid child id');
    return { repo, git, range: { child, oldParent: base, oldTip: merge, kind: 'active' }, merge, newParent };
  } catch (error) {
    await rm(repo, { recursive: true, force: true });
    throw error;
  }
}

describe('replayChildRange merge handling (real local Git)', () => {
  it('drops an automatic main merge when its Q parent is carried, including later edits and reverts', async () => {
    for (const expected of ['D1\n', 'D2\n', 'base\n'] as const) {
      const mainAfterMerge = expected === 'D1\n' ? undefined : expected === 'D2\n' ? 'edit' : 'revert';
      const subject = await fixture('automatic', mainAfterMerge);
      try {
        const classification = await classifyReplayMerge(makeGitRunner(subject.repo), subject.merge, subject.newParent, 'stacked');
        expect(classification.kind).toBe('ancestry-only');
        const replay = await replayChildRange(subject.range, subject.newParent, stamp, makeGitRunner(subject.repo));
        expect(replay.rewrites.has(subject.merge)).toBe(false);
        expect((await subject.git(['show', `${replay.tip}:shared.txt`])).stdout).toBe(expected);
      } finally {
        await rm(subject.repo, { recursive: true, force: true });
      }
    }
  });

  it('replays only a carried main merge hand resolution and retains its audit trailer', async () => {
    const subject = await fixture('hand-resolved');
    try {
      const classification = await classifyReplayMerge(makeGitRunner(subject.repo), subject.merge, subject.newParent, 'stacked');
      expect(classification.kind).toBe('q-carried');
      const replay = await replayChildRange(subject.range, subject.newParent, stamp, makeGitRunner(subject.repo));
      const rewritten = replay.rewrites.get(subject.merge);
      expect(rewritten).toBeDefined();
      expect((await subject.git(['show', `${replay.tip}:shared.txt`])).stdout).toBe('hand resolution\n');
      expect((await subject.git(['show', '-s', '--format=%B', rewritten!])).stdout).toContain(`Flattened-merge: ${subject.merge}`);
      expect(replay.audit.flattenedMerges).toEqual([]);
    } finally {
      await rm(subject.repo, { recursive: true, force: true });
    }
  });

  it('flattens a merge whose Q parent is not carried and preserves its first-parent delta', async () => {
    const subject = await fixture('side-not-carried');
    try {
      const classification = await classifyReplayMerge(makeGitRunner(subject.repo), subject.merge, subject.newParent, 'stacked');
      expect(classification.kind).toBe('flattened');
      const replay = await replayChildRange(subject.range, subject.newParent, stamp, makeGitRunner(subject.repo));
      const rewritten = replay.rewrites.get(subject.merge);
      expect(rewritten).toBeDefined();
      expect((await subject.git(['show', `${replay.tip}:side.txt`])).stdout).toBe('side work\n');
      expect((await subject.git(['show', '-s', '--format=%B', rewritten!])).stdout).toContain(`Flattened-merge: ${subject.merge}`);
      expect(replay.audit.flattenedMerges).toEqual([subject.merge]);
    } finally {
      await rm(subject.repo, { recursive: true, force: true });
    }
  });

  it('retains the N=1 two-class decision for an automatic merge that stacked replay drops', async () => {
    const subject = await fixture('automatic');
    try {
      await expect(classifyReplayMerge(makeGitRunner(subject.repo), subject.merge, subject.newParent, 'n1'))
        .resolves.toMatchObject({ kind: 'flattened' });
    } finally {
      await rm(subject.repo, { recursive: true, force: true });
    }
  });
});
