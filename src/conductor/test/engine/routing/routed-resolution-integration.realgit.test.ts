// Covers: task:14, task:8
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseChildId } from '../../../src/engine/child-context.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { writeConflictRecord, resolutionRefFor, type RestackConflictRecord } from '../../../src/engine/restack/restack-conflict-record.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { consumeLowestQueued } from '../../../src/engine/routing/revalidation-queue.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
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
  // Covers: task:rem-prd-audit-14
  it('reconstructs duplicate-subject child commits by patch-id, then runs child 2 revalidation', async () => {
    const subject = await createSweepRepository('restack-resolution-consume-', cleanup);
    const git = makeGitRunner(subject.repo);
    await subject.write('.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  max_slices: 3\n  route_whole_feature_fixes: true\n');
    await subject.git(['add', '.gitignore', '.ai-conductor/config.yml']);
    await subject.git(['commit', '-qm', 'configure stack routing']);
    const base = await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const first = await subject.commit('first child', 'first.txt', 'first\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', first]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const duplicateOne = await subject.commit('duplicate subject', 'one.txt', 'one\n');
    const duplicateTwo = await subject.commit('duplicate subject', 'two.txt', 'two\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', duplicateTwo]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await subject.commit('leaf', 'leaf.txt', 'leaf\n');
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
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
    await mkdir(join(subject.repo, '.pipeline', 'children', '2'), { recursive: true });
    await writeFile(join(subject.repo, '.pipeline', 'conduct-state.json'), JSON.stringify({
      ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])), feature_desc: 'demo',
    }));
    // The missing verdicts make the rewritten, closed child a revalidation
    // obligation. The conductor must consume that obligation rather than
    // treating the applied restack as its terminal boundary.
    await writeFile(join(subject.repo, '.pipeline', 'children', '2', 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    }));

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git }))
      .resolves.toMatchObject({ kind: 'applied' });

    const [leaf, consumedTip] = await Promise.all([
      subject.rev('feat/daemon-demo'),
      subject.rev('feat/c2/demo'),
    ]);
    expect(await subject.rev(`${leaf}^`)).toBe(consumedTip);
    const rewrites = JSON.parse(await readFile(`${subject.repo}/.pipeline/rebase-rewrites.json`, 'utf8')) as Record<string, string>;
    const rebuilt = (await subject.git(['rev-list', '--reverse', `${repairedParent}..${consumedTip}`])).stdout
      .trim().split('\n').filter(Boolean);
    expect(rebuilt).toHaveLength(2);
    expect(rewrites[duplicateOne]).toBe(rebuilt[0]);
    expect(rewrites[duplicateTwo]).toBe(rebuilt[1]);
    // Replaying an identical resolution can legitimately reuse its Git object
    // when parent, tree, message, and timestamp metadata all coincide.
    // The rewrite-map assertions above prove the required reconstruction.
    expect(await subject.rev('main')).toBe(base);

    await expect(consumeLowestQueued(subject.repo, 'demo', { git })).resolves.toMatchObject({ kind: 'admitted', host: child(2) });
    const dispatched: string[] = [];
    let suiteRuns = 0;
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      fromStep: 'build',
      mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 3, route_whole_feature_fixes: true } },
      events: new ConductorEventEmitter(),
      fullSuiteVerifier: {
        ensure: async () => {
          suiteRuns += 1;
          return { status: 'REUSED' as const, evidence: {} as never };
        },
        inspect: async () => ({ status: 'CURRENT' as const, evidence: {} as never }),
      },
      stepRunner: {
        run: async (step) => {
          dispatched.push(step);
          return step === 'build'
            ? { success: true }
            : { success: false, operatorParkedBeforeDispatch: true };
        },
      },
      acceptanceRedExec: async () => ({}) as never,
    });

    await conductor.run();
    expect(dispatched[0]).toBe('build');
    expect(dispatched).toContain('build_review');
    expect(suiteRuns).toBe(1);
    expect(JSON.parse(await readFile(join(subject.repo, '.pipeline', 'children', '2', 'conduct-state.json'), 'utf8')))
      .toMatchObject({ build: 'done' });
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
