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
});
