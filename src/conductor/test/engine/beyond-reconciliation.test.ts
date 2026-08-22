import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { reconcileBeyondRecords } from '../../src/engine/beyond-reconciliation.js';
import { BuildReviewDispositionStore } from '../../src/engine/build-review-dispositions.js';
import type { TrackerClient } from '../../src/engine/tracker-client.js';

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
    const createIssue = vi.fn<TrackerClient['createIssue']>(async () => 'https://github.com/acme/repo/issues/1');
    const emitted = vi.fn();

    await reconcileBeyondRecords({
      projectRoot: root, tracker: { findIssueBySourceRef: vi.fn(async () => null), createIssue } as never,
      gh: vi.fn(async () => ({ stdout: '' })), log: vi.fn(), emit: emitted,
    });

    expect(createIssue).toHaveBeenCalledOnce();
    expect(createIssue.mock.calls[0]?.[0]?.body).toContain('Source-Ref: feature:sha256:one');
    const listed = await store.listBeyond(feature);
    expect(listed).toMatchObject({ ok: true, records: [{ status: 'filed', issueUrl: 'https://github.com/acme/repo/issues/1' }] });
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ type: 'build_review_beyond_filed', findingId: 'sha256:one' }));
  });

  it('continues with later records after one tracker failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beyond-reconcile-'));
    roots.push(root);
    const worktree = join(root, '.worktrees', 'feature');
    await mkdir(worktree, { recursive: true });
    const store = new BuildReviewDispositionStore(worktree);
    const feature = { version: 'v1' as const, repository: root, feature: 'feature' };
    await store.appendBeyondIfAbsent({ feature, findingId: 'sha256:first', rubric: 'scope', summary: 'first', evidenceLocations: ['src/x.ts:1'] });
    await store.appendBeyondIfAbsent({ feature, findingId: 'sha256:second', rubric: 'scope', summary: 'second', evidenceLocations: ['src/y.ts:1'] });
    const createIssue = vi.fn<TrackerClient['createIssue']>()
      .mockRejectedValueOnce(new Error('tracker offline'))
      .mockResolvedValueOnce('https://github.com/acme/repo/issues/2');

    await reconcileBeyondRecords({
      projectRoot: root, tracker: { findIssueBySourceRef: vi.fn(async () => null), createIssue } as never,
      gh: vi.fn(async () => ({ stdout: '' })), log: vi.fn(),
    });

    expect(createIssue).toHaveBeenCalledTimes(2);
    expect(createIssue.mock.calls[1]?.[0]?.body).toContain('Source-Ref: feature:sha256:second');
    await expect(store.listBeyond(feature)).resolves.toMatchObject({
      ok: true,
      records: [{ findingId: 'sha256:first', status: 'unfiled' }, { findingId: 'sha256:second', status: 'filed' }],
    });
  });

  it('does not re-file an already filed record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beyond-reconcile-'));
    roots.push(root);
    const worktree = join(root, '.worktrees', 'feature');
    await mkdir(worktree, { recursive: true });
    const store = new BuildReviewDispositionStore(worktree);
    const feature = { version: 'v1' as const, repository: root, feature: 'feature' };
    await store.appendBeyondIfAbsent({ feature, findingId: 'sha256:filed', rubric: 'scope', summary: 'done', evidenceLocations: ['src/x.ts:1'] });
    await store.markBeyondFiled(feature, 'sha256:filed', 'https://github.com/acme/repo/issues/3');
    const createIssue = vi.fn<TrackerClient['createIssue']>();

    await reconcileBeyondRecords({ projectRoot: root, tracker: { findIssueBySourceRef: vi.fn(async () => null), createIssue } as never, gh: vi.fn(async () => ({ stdout: '' })), log: vi.fn() });

    expect(createIssue).not.toHaveBeenCalled();
  });

  it('recovers an issue by sourceRef after a post-create stamp failure without creating a duplicate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beyond-reconcile-'));
    roots.push(root);
    const worktree = join(root, '.worktrees', 'feature');
    await mkdir(worktree, { recursive: true });
    const store = new BuildReviewDispositionStore(worktree);
    const feature = { version: 'v1' as const, repository: root, feature: 'feature' };
    await store.appendBeyondIfAbsent({ feature, findingId: 'sha256:retry', rubric: 'scope', summary: 'retry', evidenceLocations: ['src/x.ts:1'] });
    const createIssue = vi.fn<TrackerClient['createIssue']>(async () => 'https://github.com/acme/repo/issues/4');
    const findIssueBySourceRef = vi.fn<TrackerClient['findIssueBySourceRef']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('https://github.com/acme/repo/issues/4');
    const originalRemember = BuildReviewDispositionStore.prototype.rememberBeyondIssueUrl;
    vi.spyOn(BuildReviewDispositionStore.prototype, 'rememberBeyondIssueUrl')
      .mockImplementationOnce(async () => ({ ok: false, kind: 'filesystem', message: 'simulated stamp failure' }))
      .mockImplementation(originalRemember);

    const input = { projectRoot: root, tracker: { findIssueBySourceRef, createIssue } as never, gh: vi.fn(async () => ({ stdout: '' })), log: vi.fn() };
    await reconcileBeyondRecords(input);
    await reconcileBeyondRecords(input);

    expect(createIssue).toHaveBeenCalledOnce();
    expect(findIssueBySourceRef).toHaveBeenCalledTimes(2);
    await expect(store.listBeyond(feature)).resolves.toMatchObject({ ok: true, records: [{ status: 'filed', issueUrl: 'https://github.com/acme/repo/issues/4' }] });
  });
});
