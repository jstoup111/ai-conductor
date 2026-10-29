// Covers: task:14, task:8
import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { writeConflictRecord, resolutionRefFor, type RestackConflictRecord } from '../../../src/engine/restack/restack-conflict-record.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { createSweepRepository, removeAll, sealStack, sha } from './restack-sweepG2-fixture.js';

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
  it('moves an unentered leaf at a duplicate-subject child tip to the consumed tip without adding either duplicate to the rewrite map', async () => {
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
    await subject.commit('duplicate subject', 'one.txt', 'resolved one\n');
    const resolutionTip = await subject.commit('duplicate subject', 'two.txt', 'resolved two\n');
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
    expect(rewrites[duplicateOne]).toBeUndefined();
    expect(rewrites[duplicateTwo]).toBeUndefined();
    expect(consumedTip).not.toBe(resolutionTip);
    expect(await subject.rev('main')).toBe(base);
  });
});
