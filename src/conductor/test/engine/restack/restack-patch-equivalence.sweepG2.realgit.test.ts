import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { createSweepRepository, removeAll, sealStack, type SweepRepository } from './restack-sweepG2-fixture.js';

const cleanup: string[] = [];

afterEach(async () => {
  await removeAll(cleanup);
});

async function revList(subject: SweepRepository, range: string): Promise<string[]> {
  return (await subject.git(['rev-list', '--reverse', range])).stdout.split('\n').filter(Boolean);
}

async function subjects(subject: SweepRepository, range: string): Promise<string[]> {
  return (await subject.git(['log', '--reverse', '--format=%s', range])).stdout.split('\n').filter(Boolean);
}

describe('runRestack patch equivalence sweep (real local Git)', () => {
  // Covers: S1.4, task:11
  it('leaves exactly the rewrite of A1 on child 1 when A2 was cherry-picked into the default advance', async () => {
    const subject = await createSweepRepository('restack-patch-equivalence-sweep-', cleanup);
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.commit('shared base', 'shared.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    await subject.commit('A1', 'a1.txt', 'a1\n');
    const a2 = await subject.commit('A2', 'shared.txt', 'feature\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', a2]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await subject.commit('L1', 'leaf.txt', 'leaf\n');
    await subject.git(['checkout', '-q', 'main']);
    await subject.git(['cherry-pick', a2]);
    const advanced = await subject.commit('main follow-up', 'shared.txt', 'main\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await sealStack(subject.repo, [1, 2]);

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'applied' });

    const childOne = await revList(subject, `${advanced}..feat/c1/demo`);
    expect(childOne).toHaveLength(1);
    expect(await subjects(subject, `${advanced}..feat/c1/demo`)).toEqual(['A1']);
    // Child 1's tree is exactly B' with A1's change applied.
    expect((await subject.git(['diff', '--name-status', advanced, 'feat/c1/demo'])).stdout).toBe('A\ta1.txt\n');
    expect((await subject.git(['show', 'feat/c1/demo:a1.txt'])).stdout).toBe('a1\n');
    expect((await subject.git(['show', 'feat/c1/demo:shared.txt'])).stdout).toBe('main\n');
  });

  // Covers: S1.8, task:11
  it('drops X2 from child 2 when a feature-repair restack carries originating commit X from child 1', async () => {
    const subject = await createSweepRepository('restack-repair-equivalence-sweep-', cleanup);
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const closure = await subject.commit('C1', 'c1.txt', 'c1\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    await subject.commit('C2', 'c2.txt', 'c2\n');
    // The operator's repair X lands on child 1 and was also cherry-picked into child 2.
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    const x = await subject.commit('X', 'x.txt', 'x\n');
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    await subject.git(['cherry-pick', x]);
    const childTwoClosure = await subject.rev('HEAD');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', childTwoClosure]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await subject.commit('L1', 'leaf.txt', 'leaf\n');
    await sealStack(subject.repo);

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'applied' });

    expect(await subject.rev('feat/c1/demo')).toBe(x);
    expect(await subject.rev('refs/conductor/demo/closed/c1')).toBe(x);
    // The new child 2 is exactly C2 on top of X: no commit corresponds to X2.
    expect(await subjects(subject, `${x}..feat/c2/demo`)).toEqual(['C2']);
    expect((await subject.git(['diff', '--name-status', x, 'feat/c2/demo'])).stdout).toBe('A\tc2.txt\n');
    expect(await subjects(subject, 'feat/c2/demo..feat/daemon-demo')).toEqual(['L1']);
  });
});
