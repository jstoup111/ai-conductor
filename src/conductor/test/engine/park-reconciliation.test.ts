import { describe, expect, it, vi } from 'vitest';

import { reconcileMergedPark } from '../../src/engine/park-reconciliation.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';

describe('engine/park-reconciliation — reconcileMergedPark', () => {
  it.each(['*', 'a/b', 'a,b', ''])(
    'refuses invalid single-slug input %j before invoking git',
    async (slug) => {
      const runGit = vi.fn<GitRunner>();

      const outcome = await reconcileMergedPark({
        projectRoot: '/project',
        slug,
        runGit,
      });

      expect({ outcome, calls: runGit.mock.calls }).toEqual({
        outcome: { slug, steps: [], refusal: 'invalid-slug' },
        calls: [],
      });
    },
  );

  it.each([
    {
      name: 'not an ancestor',
      error: Object.assign(new Error('not an ancestor'), { code: 1 }),
      refusal: 'not-ancestor',
    },
    {
      name: 'an unexpected ancestry failure',
      error: Object.assign(new Error('fatal git failure'), { code: 128 }),
      refusal: 'ancestry-check-failed',
    },
    {
      name: 'a missing feature branch',
      error: Object.assign(new Error('missing branch'), {
        code: 128,
        stderr: 'fatal: Not a valid object name feature/missing-branch',
      }),
      refusal: 'branch-missing',
    },
  ])('re-verifies ancestry and refuses when $name', async ({ error, refusal }) => {
    const runGit = vi.fn<GitRunner>().mockRejectedValue(error);

    const outcome = await reconcileMergedPark({
      projectRoot: '/project',
      slug: 'missing-branch',
      runGit,
    });

    expect({ outcome, calls: runGit.mock.calls }).toEqual({
      outcome: { slug: 'missing-branch', steps: [], refusal },
      calls: [
        [
          ['merge-base', '--is-ancestor', 'feature/missing-branch', 'origin/main'],
          { cwd: '/project' },
        ],
      ],
    });
  });

  it('reads shipped records from origin/main before continuing past the record gate', async () => {
    const runGit = vi
      .fn<GitRunner>()
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: 'recorded.md\n' });
    const runGh = vi.fn<GhRunner>();

    const outcome = await reconcileMergedPark({
      projectRoot: '/project',
      slug: 'recorded',
      runGit,
      runGh,
    });

    expect({ outcome, gitCalls: runGit.mock.calls, ghCalls: runGh.mock.calls }).toEqual({
      outcome: { slug: 'recorded', steps: [], refusal: 'not-implemented' },
      gitCalls: [
        [
          ['merge-base', '--is-ancestor', 'feature/recorded', 'origin/main'],
          { cwd: '/project' },
        ],
        [['ls-tree', '--name-only', 'origin/main:.docs/shipped'], { cwd: '/project' }],
      ],
      ghCalls: [],
    });
  });

  it('defers a missing record to the ST-916 repair seam when its merged PR resolves', async () => {
    const runGit = vi
      .fn<GitRunner>()
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '' });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({
      stdout: '[{"url":"https://example.test/pr/1060"}]',
    });
    const requestRecordRepair = vi.fn(async () => {});
    const log = vi.fn<(message: string) => void>();

    const outcome = await reconcileMergedPark({
      projectRoot: '/project',
      slug: 'missing-record',
      runGit,
      runGh,
      requestRecordRepair,
      log,
    });

    expect({ outcome, gitCalls: runGit.mock.calls, ghCalls: runGh.mock.calls, repairs: requestRecordRepair.mock.calls, logs: log.mock.calls }).toEqual({
      outcome: { slug: 'missing-record', steps: [], refusal: 'record-missing', deferred: true },
      gitCalls: [
        [
          ['merge-base', '--is-ancestor', 'feature/missing-record', 'origin/main'],
          { cwd: '/project' },
        ],
        [['ls-tree', '--name-only', 'origin/main:.docs/shipped'], { cwd: '/project' }],
      ],
      ghCalls: [
        [
          ['pr', 'list', '--state', 'merged', '--head', 'feature/missing-record', '--json', 'url', '--limit', '1'],
          { cwd: '/project' },
        ],
      ],
      repairs: [[{ slug: 'missing-record', prUrl: 'https://example.test/pr/1060' }]],
      logs: [['[parked-reconciliation] missing-record not reconcilable until the record lands']],
    });
  });

  it('defers without repair when a missing record has no merged PR', async () => {
    const runGit = vi
      .fn<GitRunner>()
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '' });
    const runGh = vi.fn<GhRunner>().mockResolvedValue({ stdout: '[]' });
    const requestRecordRepair = vi.fn(async () => {});
    const log = vi.fn<(message: string) => void>();

    const outcome = await reconcileMergedPark({
      projectRoot: '/project',
      slug: 'no-merged-pr',
      runGit,
      runGh,
      requestRecordRepair,
      log,
    });

    expect({ outcome, repairs: requestRecordRepair.mock.calls, logs: log.mock.calls }).toEqual({
      outcome: { slug: 'no-merged-pr', steps: [], refusal: 'record-missing', deferred: true },
      repairs: [],
      logs: [['[parked-reconciliation] no-merged-pr not reconcilable until the record lands']],
    });
  });
});
