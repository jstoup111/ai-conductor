// Covers: task:14, task:15, task:16, task:19
import { describe, expect, it, vi } from 'vitest';
import { runDaemon, type FeatureOutcome } from '../../src/engine/daemon.js';
import { resolveConflictingPr } from '../../src/engine/autoresolve.js';
import { enrollWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import { RepairQueue } from '../../src/engine/repair-queue.js';
import { InMemoryWorkClaims } from '../../src/engine/work-claims.js';
import { PASSING_SUITE, buildPrFixture, skipReplay } from './autoresolve-pr-fixture.js';

const done = (slug: string): FeatureOutcome => ({ slug, status: 'done' });

describe('daemon pooled repairs', () => {
  it('claims repairs before features and releases their reserved pool key', async () => {
    const queue = new RepairQueue();
    queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/2', slug: 'p2', prCreatedAt: '2026-01-02T00:00:00Z', queuedAt: '2026-01-03T00:00:00Z' });
    queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/0', slug: 'p0', prCreatedAt: '2026-01-01T00:00:00Z', queuedAt: '2026-01-03T00:00:00Z' });
    const claims = new InMemoryWorkClaims();
    const repairs: string[] = [];
    const features: string[] = [];

    await runDaemon({
      claims,
      repairQueue: queue,
      repairPriority: (slug) => slug === 'p0' ? 'P0' : 'P2',
      runRepair: async (request) => {
        repairs.push(request.prUrl);
        expect(claims.list()).toContain(`repair:${request.prUrl}`);
      },
      discoverBacklog: async () => [{ slug: 'feature' }],
      runFeature: async (item) => { features.push(item.slug); return done(item.slug); },
    }, { concurrency: 1, once: true, maxItems: 1 });

    expect(repairs).toEqual(['https://example.test/0', 'https://example.test/2']);
    expect(features).toEqual(['feature']);
    expect(claims.list()).toEqual([]);
  });

  it('does not claim queued repairs while paused or rate limited', async () => {
    const queue = new RepairQueue();
    queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/1', slug: 'one', prCreatedAt: '2026-01-01T00:00:00Z', queuedAt: '2026-01-01T00:00:00Z' });
    const runRepair = vi.fn(async () => {});
    await runDaemon({
      repairQueue: queue, runRepair, isPaused: async () => true,
      discoverBacklog: async () => [], runFeature: async (item) => done(item.slug),
    }, { concurrency: 1, once: true });
    expect(runRepair).not.toHaveBeenCalled();
    expect(queue.list()).toHaveLength(1);
  });

  it('runs a pooled autoresolve through the sweep call-site with the sweep-only test judgement', async () => {
    const fixture = await buildPrFixture({
      initial: { 'rewrite.test.ts': 'base\n' },
      feature: [{ subject: 'test: rewrite assertion', files: { 'rewrite.test.ts': 'feature\n' } }],
      main: { 'rewrite.test.ts': 'upstream\n' },
    });
    const queue = new RepairQueue();
    const runners = new Map<string, () => Promise<void>>();
    const resolver = vi.fn(async ({ projectRoot, supersessionJudgement }) => {
      expect(supersessionJudgement).toBe(true);
      await skipReplay(projectRoot);
      return {
        resolved: true as const,
        verdict: {
          choice: 'superseded' as const,
          rationale: 'the upstream test already carries the assertion',
          superseded: fixture.shas,
        },
      };
    });

    try {
      await enrollWatch(fixture.repo, {
        prUrl: fixture.prUrl,
        slug: 'feature',
        repoCwd: fixture.repo,
      });
      await sweepMergeableLabels({
        projectRoot: fixture.repo,
        runGh: fixture.gh,
        operations: fixture.operations,
        tracker: {
          readPullRequestMergeState: async () => ({
            state: 'OPEN', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY',
            checksOutcome: 'none', hasFailingOrPendingChecks: false, statusCheckRollup: [],
            labels: [], isDraft: false, hasHaltBodyMarker: false,
          }),
        },
        repairQueue: queue,
        registerRepair: (request, run) => runners.set(request.prUrl, run),
        autoresolve: {
          enabled: true,
          isEligible: async () => ({ eligible: true }),
          dispatch: async (entry) => resolveConflictingPr(
            entry,
            'feature',
            { enabled: true, suiteCommand: 'unused', cooldownMinutes: 0, attemptCap: 1 },
            { ...fixture.deps, runSuite: PASSING_SUITE, resolver, log: fixture.log },
          ),
        },
      });

      await runDaemon({
        repairQueue: queue,
        runRepair: async (request) => runners.get(request.prUrl)?.(),
        discoverBacklog: async () => [],
        runFeature: async (item) => done(item.slug),
      }, { concurrency: 1, once: true });

      expect(resolver).toHaveBeenCalledOnce();
    } finally {
      await fixture.cleanup();
    }
  });
});
