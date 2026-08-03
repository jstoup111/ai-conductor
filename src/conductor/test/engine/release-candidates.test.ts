import { describe, expect, it, vi } from 'vitest';

import { collectReleaseCandidates } from '../../src/engine/release-candidates.js';

describe('engine/release-candidates — merged pull requests after the latest tag (Task 7)', () => {
  it('uses the latest tag boundary, follows two pages, excludes unmerged PRs, and returns a stable merge order', async () => {
    const git = {
      latestTag: vi.fn(async () => 'v1.2.3'),
      mergeRange: vi.fn(async (tag: string) => {
        expect(tag).toBe('v1.2.3');
        return ['merge-102', 'merge-101'];
      }),
    };
    const github = {
      listMergedPullRequests: vi.fn(async (page: number) => {
        if (page === 1) {
          return {
            items: [
              { number: 102, merged: true, mergedAt: '2026-08-02T12:00:00Z', mergeSha: 'merge-102', body: 'Release-Disposition: no-note' },
              { number: 103, merged: false, mergedAt: null, mergeSha: 'merge-103', body: 'Release-Disposition: no-note' },
            ],
            hasNextPage: true,
            totalCount: 4,
          };
        }
        return {
          items: [
            { number: 101, merged: true, mergedAt: '2026-08-02T11:00:00Z', mergeSha: 'merge-101', body: 'Release-Disposition: no-note' },
            { number: 99, merged: true, mergedAt: '2026-07-30T11:00:00Z', mergeSha: 'pre-tag-99', body: 'Release-Disposition: no-note' },
          ],
          hasNextPage: false,
          totalCount: 4,
        };
      }),
    };

    const collected = await collectReleaseCandidates({ git, github });

    expect(collected).toMatchObject({
      latestTag: 'v1.2.3',
      candidates: [
        { number: 101, mergeSha: 'merge-101' },
        { number: 102, mergeSha: 'merge-102' },
      ],
    });
    expect(github.listMergedPullRequests).toHaveBeenCalledTimes(2);
    expect(github.listMergedPullRequests).toHaveBeenNthCalledWith(1, 1);
    expect(github.listMergedPullRequests).toHaveBeenNthCalledWith(2, 2);
    expect(git.mergeRange).toHaveBeenCalledWith('v1.2.3');
  });

  it('returns an incomplete verdict when a later page cannot be reached', async () => {
    const collected = await collectReleaseCandidates({
      git: { latestTag: vi.fn(async () => 'v1.2.3'), mergeRange: vi.fn(async () => ['merge-101']) },
      github: {
        listMergedPullRequests: vi.fn(async (page: number) => {
          if (page === 1) {
            return {
              items: [pullRequest(101, 'merge-101')],
              hasNextPage: true,
              totalCount: 2,
            };
          }
          throw new Error('GitHub unavailable');
        }),
      },
    });

    expect(collected.completeness).toEqual({
      status: 'incomplete',
      reasons: [{ kind: 'unreachable-page', page: 2 }],
    });
  });

  it('returns an incomplete verdict when GitHub pagination ends before its declared total', async () => {
    const collected = await collectReleaseCandidates({
      git: { latestTag: vi.fn(async () => 'v1.2.3'), mergeRange: vi.fn(async () => ['merge-101']) },
      github: {
        listMergedPullRequests: vi.fn(async () => ({
          items: [pullRequest(101, 'merge-101')],
          hasNextPage: false,
          totalCount: 2,
        })),
      },
    });

    expect(collected.completeness).toEqual({
      status: 'incomplete',
      reasons: [{ kind: 'truncated-total', expected: 2, actual: 1 }],
    });
  });

  it('returns an incomplete verdict for a Git merge with no corresponding merged PR', async () => {
    const collected = await collectReleaseCandidates({
      git: { latestTag: vi.fn(async () => 'v1.2.3'), mergeRange: vi.fn(async () => ['merge-101', 'merge-102']) },
      github: {
        listMergedPullRequests: vi.fn(async () => ({
          items: [pullRequest(101, 'merge-101')],
          hasNextPage: false,
          totalCount: 1,
        })),
      },
    });

    expect(collected.completeness).toEqual({
      status: 'incomplete',
      reasons: [{ kind: 'unexplained-merge', mergeSha: 'merge-102' }],
    });
  });

  it('returns an incomplete verdict when a PR or merge disposition appears more than once', async () => {
    const collected = await collectReleaseCandidates({
      git: { latestTag: vi.fn(async () => 'v1.2.3'), mergeRange: vi.fn(async () => ['merge-101']) },
      github: {
        listMergedPullRequests: vi.fn(async () => ({
          items: [pullRequest(101, 'merge-101'), pullRequest(101, 'merge-101')],
          hasNextPage: false,
          totalCount: 2,
        })),
      },
    });

    expect(collected.completeness).toEqual({
      status: 'incomplete',
      reasons: [
        { kind: 'duplicate-pr', number: 101 },
        { kind: 'duplicate-merge', mergeSha: 'merge-101' },
      ],
    });
  });

  it('returns an incomplete verdict when Git reports the same merge more than once', async () => {
    const collected = await collectReleaseCandidates({
      git: { latestTag: vi.fn(async () => 'v1.2.3'), mergeRange: vi.fn(async () => ['merge-101', 'merge-101']) },
      github: {
        listMergedPullRequests: vi.fn(async () => ({
          items: [pullRequest(101, 'merge-101')],
          hasNextPage: false,
          totalCount: 1,
        })),
      },
    });

    expect(collected.completeness).toEqual({
      status: 'incomplete',
      reasons: [{ kind: 'duplicate-merge', mergeSha: 'merge-101' }],
    });
  });

  it('keeps identical note text from distinct PRs as separate complete audit dispositions', async () => {
    const note = 'Shared reader-facing wording';
    const collected = await collectReleaseCandidates({
      git: { latestTag: vi.fn(async () => 'v1.2.3'), mergeRange: vi.fn(async () => ['merge-101', 'merge-102']) },
      github: {
        listMergedPullRequests: vi.fn(async () => ({
          items: [
            pullRequest(101, 'merge-101', note),
            pullRequest(102, 'merge-102', note),
          ],
          hasNextPage: false,
          totalCount: 2,
        })),
      },
    });

    expect(collected.completeness).toEqual({ status: 'complete' });
    expect(collected.audit).toEqual([
      { number: 101, mergeSha: 'merge-101', disposition: 'note' },
      { number: 102, mergeSha: 'merge-102', disposition: 'note' },
    ]);
    expect(collected.candidates.map((candidate) => candidate.disposition)).toEqual([
      { disposition: 'note', category: 'Fixed', semver: 'patch', note },
      { disposition: 'note', category: 'Fixed', semver: 'patch', note },
    ]);
  });
});

function pullRequest(number: number, mergeSha: string, note?: string) {
  const body = note === undefined
    ? 'Release-Disposition: no-note'
    : `Release-Disposition: note\nRelease-Category: Fixed\nRelease-Semver: patch\nRelease-Note: ${note}`;
  return {
    number,
    merged: true,
    mergedAt: `2026-08-02T${String(number).padStart(2, '0')}:00:00Z`,
    mergeSha,
    body,
  };
}
