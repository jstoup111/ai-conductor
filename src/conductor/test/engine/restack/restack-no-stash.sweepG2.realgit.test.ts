import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { checkRestackPreMove, type RestackMoveRef } from '../../../src/engine/restack/restack-move.js';
import { syncRestackedWorktree } from '../../../src/engine/restack/restack-sync.js';
import { parseRefName } from '../../../src/engine/restack/restack-types.js';
import { createSweepRepository, removeAll, sealStack } from './restack-sweepG2-fixture.js';

const cleanup: string[] = [];

afterEach(async () => {
  await removeAll(cleanup);
});

function recordingBoundary(repo: string): { readonly git: GitRunner; readonly calls: string[][] } {
  const calls: string[][] = [];
  const native = makeGitRunner(repo);
  return {
    calls,
    git: async (args, options) => {
      calls.push([...args]);
      return native(args, options);
    },
  };
}

function stashRequests(calls: readonly string[][]): string[][] {
  return calls.filter((args) => args.includes('stash') || args.includes('--autostash') || args.some((arg) => /autostash/i.test(arg)));
}

describe('restack never stashes (recorded Git boundary)', () => {
  // Covers: S5.2, task:10
  it('records no stash subcommand or autostash argument from runRestack, checkRestackPreMove or syncRestackedWorktree', async () => {
    const subject = await createSweepRepository('restack-no-stash-sweep-', cleanup);
    await subject.commit('base', 'notes.txt', 'base notes\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const c1 = await subject.commit('C1', 'c1.txt', 'c1\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const c2 = await subject.commit('C2', 'c2.txt', 'c2\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    const oldLeaf = await subject.commit('L1', 'leaf.txt', 'leaf\n');
    await subject.git(['checkout', '-q', 'main']);
    const advanced = await subject.commit('advance', 'base.txt', 'advanced\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await sealStack(subject.repo);
    // Local, uncommitted work is exactly what an autostash would capture.
    await writeFile(join(subject.repo, 'notes.txt'), 'operator notes\n');

    const restackBoundary = recordingBoundary(subject.repo);
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git: restackBoundary.git,
    })).resolves.toMatchObject({ kind: 'applied' });
    const newLeaf = await subject.rev('feat/daemon-demo');
    // The run reached both the pre-move check and the sync through this boundary.
    expect(restackBoundary.calls).toContainEqual(['worktree', 'list', '--porcelain']);
    expect(restackBoundary.calls).toContainEqual(['read-tree', '-m', '-u', '-n', oldLeaf, newLeaf]);
    expect(restackBoundary.calls).toContainEqual(['read-tree', '-m', '-u', oldLeaf, newLeaf]);
    expect(stashRequests(restackBoundary.calls)).toEqual([]);

    // Each primitive called directly, with dirty local work present.
    const leafRef = parseRefName('refs/heads/feat/daemon-demo')!;
    const moves: RestackMoveRef[] = [{ ref: leafRef, oldSha: newLeaf, newSha: oldLeaf }];
    const preMoveBoundary = recordingBoundary(subject.repo);
    await expect(checkRestackPreMove(subject.repo, moves, leafRef, { git: preMoveBoundary.git }))
      .resolves.toEqual({ kind: 'clear' });
    expect(preMoveBoundary.calls.length).toBeGreaterThan(0);
    expect(stashRequests(preMoveBoundary.calls)).toEqual([]);

    const syncBoundary = recordingBoundary(subject.repo);
    await expect(syncRestackedWorktree(subject.repo, newLeaf, oldLeaf, { git: syncBoundary.git })).resolves.toBeUndefined();
    expect(syncBoundary.calls).toContainEqual(['read-tree', '-m', '-u', newLeaf, oldLeaf]);
    expect(stashRequests(syncBoundary.calls)).toEqual([]);

    expect((await subject.git(['stash', 'list'])).stdout).toBe('');
  });
});
