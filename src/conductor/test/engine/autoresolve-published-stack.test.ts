// Covers: Task: 34
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveConflictingPr } from '../../src/engine/autoresolve.js';
import { enrollWatch, readWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import { buildPrFixture, PASSING_SUITE, type PrFixture } from './autoresolve-pr-fixture.js';

const fixtures: PrFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

describe('published stacked feature autoresolve refusal', () => {
  it('escalates before creating a replay worktree or pushing', async () => {
    const fixture = await buildPrFixture({
      initial: { 'a.ts': 'base\n' },
      feature: [{ subject: 'feat: stack leaf', files: { 'feature.ts': 'feature\n' } }],
      main: { 'a.ts': 'upstream\n' },
    });
    fixtures.push(fixture);
    await mkdir(join(fixture.repo, '.pipeline', 'children', '1'), { recursive: true });
    let resolverCalls = 0;

    const result = await resolveConflictingPr(
      { prUrl: fixture.prUrl, slug: 'feature', repoCwd: fixture.repo },
      'feature',
      { enabled: true, suiteCommand: 'npm test', cooldownMinutes: 0, attemptCap: 2 },
      {
        ...fixture.deps,
        events: fixture.events,
        runSuite: PASSING_SUITE,
        resolver: async () => {
          resolverCalls++;
          return { resolved: false, reason: 'unreachable' };
        },
        log: fixture.log,
      },
    );

    expect(result).toEqual({ kind: 'published-stack' });
    expect(resolverCalls).toBe(0);
    expect(await fixture.pushes()).toBe(0);
    expect(fixture.emitted).toContainEqual(expect.objectContaining({
      type: 'restack_refused', reason: 'published-stack', detail: '#2945',
    }));
    expect(fixture.commentBodies().join('\n')).toContain('published-stack');
  });

  it('does not consume the sweep resolution-attempt budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'published-stack-sweep-'));
    try {
      const entry = {
        prUrl: 'https://github.com/acme/demo/pull/1', slug: 'demo', repoCwd: root,
        resolveAttempts: 2,
      };
      await enrollWatch(root, entry);
      await sweepMergeableLabels({
        projectRoot: root,
        runGh: async () => ({ stdout: '' }),
        tracker: {
          readPullRequestMergeState: async () => ({
            state: 'OPEN', mergeable: 'CONFLICTING', hasFailingOrPendingChecks: false,
            labels: [], checksOutcome: 'none' as const, isDraft: false,
          }),
        },
        autoresolve: {
          enabled: true,
          isEligible: async () => ({ eligible: true }),
          dispatch: async () => ({ kind: 'published-stack' }),
        },
      });
      expect((await readWatch(root))[0]?.resolveAttempts).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
