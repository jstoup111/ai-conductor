import { describe, expect, it, vi } from 'vitest';

import { reconcileMergedPark } from '../../src/engine/park-reconciliation.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';

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
});
