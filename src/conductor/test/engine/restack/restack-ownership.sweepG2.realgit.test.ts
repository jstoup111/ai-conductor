import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { journalRefFor, readRestackJournal, stagingRefFor } from '../../../src/engine/restack/restack-journal.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { createSweepRepository, removeAll, sealStack, stackRefs } from './restack-sweepG2-fixture.js';

const cleanup: string[] = [];

afterEach(async () => {
  await removeAll(cleanup);
});

describe('restack path ownership sweep (real local Git)', () => {
  // Covers: S3.4, task:13
  it('halts a feature repair whose repaired parent adds X that child 2 added and reverted, moving no ref and keeping the aborted journal and staging refs', async () => {
    const subject = await createSweepRepository('restack-ownership-sweep-', cleanup);
    await subject.write('src/g.ts', 'original\n');
    await subject.git(['add', 'src/g.ts']);
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const c1 = await subject.commit('C1', 'c1.txt', 'c1\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    await subject.commit('add X', 'src/g.ts', 'X\n');
    const c2 = await subject.commit('revert X', 'src/g.ts', 'original\n');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await subject.commit('L1', 'leaf.txt', 'leaf\n');
    // The repair: child 1 now adds X itself.
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('repair adds X', 'src/g.ts', 'X\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await sealStack(subject.repo);
    const before = await stackRefs(subject);
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => { refusals.push(event); });

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', events, git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'halted' });

    expect(refusals).toEqual([expect.objectContaining({ reason: 'replay-mismatch', child: 2, detail: 'src/g.ts' })]);
    expect(await stackRefs(subject)).toBe(before);
    await expect(readRestackJournal(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'journal', journal: { state: 'aborted', cause: 'feature-repair' } });
    await expect(subject.git(['rev-parse', '--verify', journalRefFor('demo')])).resolves.toMatchObject({ stdout: expect.stringMatching(/^[0-9a-f]{40}\n$/) });
    const staging = (await subject.git(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/restack/staging/'])).stdout;
    expect(staging).toContain(`${stagingRefFor('demo', parseChildId(2)!)}\n`);
  });
});
