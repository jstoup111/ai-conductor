import { afterEach, describe, expect, it } from 'vitest';

import { moveLeaf } from '../../../src/engine/child-lifecycle.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { createSweepRepository, removeAll, sealStack, type SweepRepository } from './restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const marker = 'refs/conductor/demo/leaf-moved';

afterEach(async () => {
  await removeAll(cleanup);
});

async function refExists(subject: SweepRepository, ref: string): Promise<boolean> {
  return subject.git(['show-ref', '--verify', '--quiet', ref]).then(() => true, () => false);
}

describe('leaf-moved marker sweep (real local Git)', () => {
  // Covers: S11.7, task:20
  it('writes leaf-moved when the three-child restack moves the active leaf, and not when the leaf is not the active child', async () => {
    const stack = await createSweepRepository('restack-leaf-moved-sweep-', cleanup);
    await stack.commit('base', 'base.txt', 'base\n');
    await stack.git(['checkout', '-qb', 'feat/c1/demo']);
    await stack.git(['update-ref', 'refs/conductor/demo/closed/c1', await stack.commit('C1', 'one.txt', 'one\n')]);
    await stack.git(['checkout', '-qb', 'feat/c2/demo']);
    await stack.git(['update-ref', 'refs/conductor/demo/closed/c2', await stack.commit('C2', 'two.txt', 'two\n')]);
    await stack.git(['checkout', '-qb', 'feat/daemon-demo']);
    const oldLeaf = await stack.commit('L1', 'leaf.txt', 'leaf\n');
    await stack.git(['checkout', '-q', 'main']);
    const advanced = await stack.commit('advance', 'advance.txt', 'advance\n');
    await stack.git(['checkout', '-q', 'feat/daemon-demo']);
    await sealStack(stack.repo);
    expect(await refExists(stack, marker)).toBe(false);

    await expect(runRestack({ worktree: stack.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git: makeGitRunner(stack.repo) }))
      .resolves.toMatchObject({ kind: 'applied' });

    const newLeaf = await stack.rev('feat/daemon-demo');
    expect(newLeaf).not.toBe(oldLeaf);
    expect(await stack.rev(marker)).toBe(newLeaf);

    // Intermediate child 2 is active: the restack moves children but never the active leaf.
    const intermediate = await createSweepRepository('restack-leaf-moved-intermediate-sweep-', cleanup);
    await intermediate.commit('base', 'base.txt', 'base\n');
    await intermediate.git(['checkout', '-qb', 'feat/c1/demo']);
    await intermediate.git(['update-ref', 'refs/conductor/demo/closed/c1', await intermediate.commit('C1', 'one.txt', 'one\n')]);
    await intermediate.git(['checkout', '-qb', 'feat/c2/demo']);
    await intermediate.commit('C2', 'two.txt', 'two\n');
    await intermediate.git(['checkout', '-q', 'main']);
    const intermediateAdvance = await intermediate.commit('advance', 'advance.txt', 'advance\n');
    await intermediate.git(['checkout', '-q', 'feat/c2/demo']);
    await sealStack(intermediate.repo);

    await expect(runRestack({ worktree: intermediate.repo, slug: 'demo', cause: 'base-refresh', newDefault: intermediateAdvance, git: makeGitRunner(intermediate.repo) }))
      .resolves.toMatchObject({ kind: 'applied' });
    expect(await refExists(intermediate, marker)).toBe(false);
  });

  // Covers: S1.10, task:20
  it("moves an unentered leaf at pre-region halt record H to H' in the same restack without leaf-moved, so moveLeaf later completes", async () => {
    const subject = await createSweepRepository('restack-leaf-unentered-sweep-', cleanup);
    const base = await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['update-ref', 'refs/remotes/origin/main', base]);
    await subject.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    const haltRecord = await subject.commit('halt record', '.docs/halted/demo.md', 'Status: halted\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', await subject.commit('C1', 'one.txt', 'one\n')]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    await subject.commit('C2', 'two.txt', 'two\n');
    await subject.git(['checkout', '-q', 'main']);
    const advanced = await subject.commit('advance', 'advance.txt', 'advance\n');
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    await sealStack(subject.repo);
    const moved: string[] = [];
    const native = makeGitRunner(subject.repo);

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced,
      git: async (args, options) => {
        if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes('update refs/heads/feat/daemon-demo ')) moved.push(options.input);
        return native(args, options);
      },
    })).resolves.toMatchObject({ kind: 'applied' });

    const rewrittenHalt = await subject.rev('feat/daemon-demo');
    expect(rewrittenHalt).not.toBe(haltRecord);
    expect((await subject.git(['show', '-s', '--format=%s %P', rewrittenHalt])).stdout.trim()).toBe(`halt record ${advanced}`);
    expect(await subject.rev('feat/c1/demo^')).toBe(rewrittenHalt);
    // One transaction moved the leaf together with child 1 and child 2.
    expect(moved).toHaveLength(1);
    expect(moved[0]).toContain('update refs/heads/feat/c1/demo ');
    expect(moved[0]).toContain('update refs/heads/feat/c2/demo ');
    expect(moved[0]).not.toContain('leaf-moved');
    expect(await refExists(subject, marker)).toBe(false);

    // Child 2 later closes: the leaf moves onto its closure with no stray commit.
    await subject.git(['update-ref', 'refs/remotes/origin/main', advanced]);
    const childTwoClosure = await subject.rev('feat/c2/demo');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', childTwoClosure]);
    await expect(moveLeaf(subject.repo, 'demo', childTwoClosure)).resolves.toEqual({ kind: 'completed' });
    expect(await subject.rev('feat/daemon-demo')).toBe(childTwoClosure);
  });
});
