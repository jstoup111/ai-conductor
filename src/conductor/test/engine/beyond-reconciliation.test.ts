import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { reconcileBeyondRecords } from '../../src/engine/beyond-reconciliation.js';
import { BuildReviewDispositionStore } from '../../src/engine/build-review-dispositions.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('reconcileBeyondRecords', () => {
  it('files each unfiled record with a stable source ref and marks it filed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beyond-reconcile-'));
    roots.push(root);
    const worktree = join(root, '.worktrees', 'feature');
    await mkdir(worktree, { recursive: true });
    const store = new BuildReviewDispositionStore(worktree);
    const feature = { version: 'v1' as const, repository: root, feature: 'feature' };
    await store.appendBeyondIfAbsent({
      feature, findingId: 'sha256:one', rubric: 'scope', summary: 'outside the plan', evidenceLocations: ['src/x.ts:1'],
    });
    const createIssue = vi.fn(async () => 'https://github.com/acme/repo/issues/1');
    const emitted = vi.fn();

    await reconcileBeyondRecords({
      projectRoot: root, tracker: { createIssue } as never,
      gh: vi.fn(async () => ({ stdout: '' })), log: vi.fn(), emit: emitted,
    });

    expect(createIssue).toHaveBeenCalledOnce();
    expect(createIssue.mock.calls[0]?.[0].body).toContain('Source-Ref: feature:sha256:one');
    expect((await store.listBeyond(feature)).records).toMatchObject([{ status: 'filed', issueUrl: 'https://github.com/acme/repo/issues/1' }]);
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ type: 'build_review_beyond_filed', findingId: 'sha256:one' }));
  });
});
