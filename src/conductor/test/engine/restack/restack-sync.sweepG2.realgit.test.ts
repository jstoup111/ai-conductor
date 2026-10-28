import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createProtectedArtifactSeal, verifyProtectedArtifactSeal } from '../../../src/engine/protected-artifact-seal.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { sealSliceTopologyPositions, writeSliceTopologyFixture } from '../slice-topology-fixture.js';
import { createSweepRepository, removeAll, stackRefs } from './restack-sweepG2-fixture.js';

const cleanup: string[] = [];

afterEach(async () => {
  await removeAll(cleanup);
});

async function threeChildStack() {
  const subject = await createSweepRepository('restack-sync-sweep-', cleanup);
  await subject.commit('base', 'notes.txt', 'base notes\n');
  await subject.commit('approved plan', '.docs/plans/demo.md', 'approved\n');
  await writeSliceTopologyFixture(subject.repo, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
    materializeTopologyCommit: true,
  });
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await subject.commit('C1', 'c1.txt', 'c1\n');
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await subject.git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await subject.commit('C2', 'c2.txt', 'c2\n');
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  const oldLeaf = await subject.commit('L1', 'leaf.txt', 'leaf\n');
  await sealSliceTopologyPositions(subject.repo, {
    slug: 'demo',
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
  });
  await subject.git(['checkout', '-q', 'main']);
  const advanced = await subject.commit('base advance', 'base.txt', 'advanced\n');
  await subject.git(['checkout', '-q', 'feat/daemon-demo']);
  return { ...subject, oldLeaf, advanced };
}

function restack(subject: Awaited<ReturnType<typeof threeChildStack>>) {
  return runRestack({
    worktree: subject.repo,
    slug: 'demo',
    cause: 'base-refresh',
    newDefault: subject.advanced,
    git: makeGitRunner(subject.repo),
  });
}

interface SealFile {
  readonly baselineCommit: string;
  readonly rebaselines: ReadonlyArray<{ fromCommit: string; toCommit: string; trigger: string }>;
}

describe('restack seal rotation sweep (real local Git)', () => {
  // Covers: S5.1, S5.7, task:10
  it('verifies the protected-artifact seal before moving a clean three-child stack and rotates it to the new leaf after the sync', async () => {
    // Verified before the move: a seal that does not verify against the old
    // checked-out tip refuses the restack before any stack ref moves.
    const tampered = await threeChildStack();
    await createProtectedArtifactSeal({ projectRoot: tampered.repo, baselineCommit: tampered.oldLeaf });
    const sealBefore = await readFile(join(tampered.repo, '.pipeline', 'protected-artifact-seal.json'), 'utf8');
    const refsBefore = await stackRefs(tampered);
    await writeFile(join(tampered.repo, '.docs', 'plans', 'demo.md'), 'tampered\n');

    await expect(restack(tampered)).resolves.toEqual({ kind: 'halted' });
    expect(await stackRefs(tampered)).toBe(refsBefore);
    await expect(readFile(join(tampered.repo, '.pipeline', 'protected-artifact-seal.json'), 'utf8')).resolves.toBe(sealBefore);
    await expect(readFile(join(tampered.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('protected-artifact seal');

    // Rotated after the sync: the clean stack moves the leaf and the existing
    // seal gains a proactive rotation from the old leaf to the new leaf.
    const clean = await threeChildStack();
    await createProtectedArtifactSeal({ projectRoot: clean.repo, baselineCommit: clean.oldLeaf });
    await expect(verifyProtectedArtifactSeal({ projectRoot: clean.repo, baselineCommit: clean.oldLeaf }))
      .resolves.toMatchObject({ ok: true });

    await expect(restack(clean)).resolves.toMatchObject({ kind: 'applied' });

    const newLeaf = await clean.rev('feat/daemon-demo');
    expect(newLeaf).not.toBe(clean.oldLeaf);
    expect(await clean.rev('HEAD')).toBe(newLeaf);
    const seal = JSON.parse(await readFile(join(clean.repo, '.pipeline', 'protected-artifact-seal.json'), 'utf8')) as SealFile;
    expect(seal.baselineCommit).toBe(newLeaf);
    expect(seal.rebaselines[0]).toMatchObject({ fromCommit: clean.oldLeaf, toCommit: newLeaf, trigger: 'proactive-rebase' });
    await expect(verifyProtectedArtifactSeal({ projectRoot: clean.repo, baselineCommit: newLeaf }))
      .resolves.toMatchObject({ ok: true });
  });
});
