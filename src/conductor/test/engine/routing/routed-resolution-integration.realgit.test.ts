// Covers: task:14, task:8
import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { writeConflictRecord, resolutionRefFor, type RestackConflictRecord } from '../../../src/engine/restack/restack-conflict-record.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { createSweepRepository, removeAll, sealStack, sha } from '../restack/restack-sweepG2-fixture.js';

const cleanup: string[] = [];

afterEach(async () => {
  await removeAll(cleanup);
});

function child(value: number) {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`invalid child ${value}`);
  return parsed;
}

describe('recorded-resolution restack consumption (real local Git)', () => {
  it('reconstructs duplicate-subject child commits by patch-id when the consumed exact map omits them', async () => {
    const subject = await createSweepRepository('restack-resolution-consume-', cleanup);
    const git = makeGitRunner(subject.repo);
    const base = await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const first = await subject.commit('first child', 'first.txt', 'first\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', first]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const duplicateOne = await subject.commit('duplicate subject', 'one.txt', 'one\n');
    const duplicateTwo = await subject.commit('duplicate subject', 'two.txt', 'two\n');
    await subject.git(['branch', 'feat/daemon-demo', duplicateTwo]);
    await sealStack(subject.repo);

    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    const repairedParent = await subject.commit('repair first child', 'repair.txt', 'repair\n');
    await subject.git(['checkout', '-qb', 'recorded-resolution', repairedParent]);
    // The record intentionally omits same-subject entries. Their contents
    // remain patch-identical, so translation must reconstruct both after the
    // consumed resolution is replayed.
    await subject.commit('duplicate subject', 'one.txt', 'one\n');
    const resolutionTip = await subject.commit('duplicate subject', 'two.txt', 'two\n');
    const parentTree = sha((await subject.git(['rev-parse', `${repairedParent}^{tree}`])).stdout);
    const record: RestackConflictRecord = {
      opId: 'duplicate-resolution' as never,
      child: child(2),
      oldParent: first,
      oldTip: duplicateTwo,
      newParent: repairedParent,
      newParentTree: parentTree,
      candidateSubjects: ['duplicate subject', 'duplicate subject'],
      commit: duplicateOne,
      paths: ['one.txt', 'two.txt'],
    };
    await expect(writeConflictRecord(subject.repo, 'demo', record, { git })).resolves.toEqual({ kind: 'updated' });
    await subject.git(['update-ref', resolutionRefFor('demo', child(2)), resolutionTip]);
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git }))
      .resolves.toMatchObject({ kind: 'applied' });

    const [leaf, consumedTip] = await Promise.all([
      subject.rev('feat/daemon-demo'),
      subject.rev('feat/c2/demo'),
    ]);
    expect(leaf).toBe(consumedTip);
    const rewrites = JSON.parse(await readFile(`${subject.repo}/.pipeline/rebase-rewrites.json`, 'utf8')) as Record<string, string>;
    const rebuilt = (await subject.git(['rev-list', '--reverse', `${repairedParent}..${consumedTip}`])).stdout
      .trim().split('\n').filter(Boolean);
    expect(rebuilt).toHaveLength(2);
    expect(rewrites[duplicateOne]).toBe(rebuilt[0]);
    expect(rewrites[duplicateTwo]).toBe(rebuilt[1]);
    expect(consumedTip).not.toBe(resolutionTip);
    expect(await subject.rev('main')).toBe(base);
  });

  it('uses the translator patch-id reconstruction for a non-tip duplicate-subject leaf, including an extra post-image match', async () => {
    const subject = await createSweepRepository('restack-resolution-consume-leaf-', cleanup);
    const git = makeGitRunner(subject.repo);
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const first = await subject.commit('first child', 'first.txt', 'first\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', first]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const duplicateOne = await subject.commit('duplicate subject', 'one.txt', 'one\n');
    const duplicateTwo = await subject.commit('duplicate subject', 'two.txt', 'two\n');
    await subject.git(['branch', 'feat/daemon-demo', duplicateOne]);
    await sealStack(subject.repo);

    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    const repairedParent = await subject.commit('repair first child', 'repair.txt', 'repair\n');
    await subject.git(['checkout', '-qb', 'recorded-resolution', repairedParent]);
    await subject.commit('duplicate subject', 'one.txt', 'one\n');
    await subject.commit('duplicate subject', 'two.txt', 'two\n');
    await subject.commit('remove extra post-image match', 'one.txt', '');
    await subject.commit('extra post-image match', 'one.txt', 'one\n');
    const resolutionTip = await subject.rev('HEAD');
    const parentTree = sha((await subject.git(['rev-parse', `${repairedParent}^{tree}`])).stdout);
    const record: RestackConflictRecord = {
      opId: 'duplicate-resolution-leaf' as never,
      child: child(2),
      oldParent: first,
      oldTip: duplicateTwo,
      newParent: repairedParent,
      newParentTree: parentTree,
      candidateSubjects: ['duplicate subject', 'duplicate subject'],
      commit: duplicateOne,
      paths: ['one.txt', 'two.txt'],
    };
    await expect(writeConflictRecord(subject.repo, 'demo', record, { git })).resolves.toEqual({ kind: 'updated' });
    await subject.git(['update-ref', resolutionRefFor('demo', child(2)), resolutionTip]);
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git }))
      .resolves.toMatchObject({ kind: 'applied' });

    const [leaf, consumedTip] = await Promise.all([
      subject.rev('feat/daemon-demo'),
      subject.rev('feat/c2/demo'),
    ]);
    const rewrites = JSON.parse(await readFile(`${subject.repo}/.pipeline/rebase-rewrites.json`, 'utf8')) as Record<string, string>;
    const rebuilt = (await subject.git(['rev-list', '--reverse', `${repairedParent}..${consumedTip}`])).stdout
      .trim().split('\n').filter(Boolean);

    expect(rebuilt).toHaveLength(4);
    expect(rewrites[duplicateOne]).toBe(rebuilt[0]);
    expect(leaf).toBe(rewrites[duplicateOne]);
    expect(leaf).not.toBe(rebuilt.at(-1));
  });
});
