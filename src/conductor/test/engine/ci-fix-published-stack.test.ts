// Covers: task:24
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isEligibleForCiFix } from '../../src/engine/ci-fix.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { enrollWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { RepairQueue } from '../../src/engine/repair-queue.js';
import { writePublicationRecord, type PublicationRecord } from '../../src/engine/stack-publication-record.js';

const roots: string[] = [];
const child = parseChildId(1)!;
const leaf = parseChildId(2)!;
const prUrl = 'https://github.com/acme/demo/pull/500';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ci-fix-published-stack-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'ci-fix@example.test']);
  await git(['config', 'user.name', 'CI fix']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  return root;
}

const publication: PublicationRecord = {
  version: 1,
  members: [
    { position: child, branch: 'feat/c1/demo', pr: 101 },
    { position: leaf, branch: 'feat/daemon-demo', pr: 500 },
  ],
};

describe('ci-fix published-stack refusal', () => {
  it('escalates failed leaf CI through published-stack without queueing ci-fix', async () => {
    const root = await createRepository();
    await writePublicationRecord(root, 'demo', undefined, publication);
    await enrollWatch(root, { prUrl, slug: 'demo', repoCwd: root, ciFixAttempts: 0 });

    const dispatch = vi.fn();
    const events: unknown[] = [];
    await sweepMergeableLabels({
      projectRoot: root,
      runGh: async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ comments: [] }) };
        return { stdout: '' };
      },
      tracker: {
        readPullRequestMergeState: async () => ({
          state: 'OPEN' as const,
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'CLEAN',
          baseRefName: 'main',
          hasFailingOrPendingChecks: true,
          labels: [],
          checksOutcome: 'failed' as const,
          isDraft: false,
          statusCheckRollup: [{ kind: 'check-run' as const, status: 'COMPLETED', conclusion: 'FAILURE', name: 'test' }],
        }),
      },
      ciFix: {
        enabled: true,
        isEligible: (entry, state) => isEligibleForCiFix(entry, state, undefined, new Date(), () => {}),
        dispatch,
      },
      onEvent: (event) => events.push(event),
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: 'restack_refused', reason: 'published-stack' }));
  });

  it('retains ordinary N=1 failed CI as a ci-fix candidate', async () => {
    const root = await createRepository();
    await enrollWatch(root, { prUrl, slug: 'demo', repoCwd: root, ciFixAttempts: 0 });
    const queue = new RepairQueue();
    const eligibility = vi.fn((entry, state) => isEligibleForCiFix(entry, state, undefined, new Date(), () => {}));

    await sweepMergeableLabels({
      projectRoot: root,
      tracker: {
        readPullRequestMergeState: async () => ({
          state: 'OPEN' as const,
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'CLEAN',
          baseRefName: 'main',
          hasFailingOrPendingChecks: true,
          labels: [],
          checksOutcome: 'failed' as const,
          isDraft: false,
          statusCheckRollup: [{ kind: 'check-run' as const, status: 'COMPLETED', conclusion: 'FAILURE', name: 'test' }],
        }),
      },
      ciFix: {
        enabled: true,
        isEligible: eligibility,
        dispatch: async () => ({ kind: 'not-started' }),
      },
      repairs: { queue },
    });

    await expect(eligibility.mock.results[0]?.value).resolves.toEqual({ eligible: true });
    expect(queue.list()).toEqual([expect.objectContaining({ kind: 'ci-fix', prUrl })]);
  });
});
