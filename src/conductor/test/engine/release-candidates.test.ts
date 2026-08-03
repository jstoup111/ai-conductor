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
          };
        }
        return {
          items: [
            { number: 101, merged: true, mergedAt: '2026-08-02T11:00:00Z', mergeSha: 'merge-101', body: 'Release-Disposition: no-note' },
            { number: 99, merged: true, mergedAt: '2026-07-30T11:00:00Z', mergeSha: 'pre-tag-99', body: 'Release-Disposition: no-note' },
          ],
          hasNextPage: false,
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
});
