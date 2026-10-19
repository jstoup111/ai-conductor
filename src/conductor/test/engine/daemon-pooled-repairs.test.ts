// Covers: task:14, task:15, task:16, task:19, task:rem-prd-audit-R3, task:rem-prd-audit-R3-2, task:rem-prd-audit-R4
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClaimTimeRepairRunner } from '../../src/daemon-cli.js';
import { runDaemon, type DaemonDeps, type FeatureOutcome } from '../../src/engine/daemon.js';
import { resolveConflictingPr } from '../../src/engine/autoresolve.js';
import { enrollWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import { RepairQueue, type RepairRequest } from '../../src/engine/repair-queue.js';
import { InMemoryWorkClaims } from '../../src/engine/work-claims.js';
import type { PrMergeState } from '../../src/engine/pr-labels.js';
import { PASSING_SUITE, buildPrFixture, skipReplay } from './autoresolve-pr-fixture.js';

const done = (slug: string): FeatureOutcome => ({ slug, status: 'done' });

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

const repairCapabilityContract = {
  // @ts-expect-error a queue cannot be injected without its claim-time runner.
  repairs: { queue: new RepairQueue() },
} satisfies Pick<DaemonDeps, 'repairs'>;
void repairCapabilityContract;

const autoresolveRequestContract: Extract<RepairRequest, { kind: 'autoresolve' }> = {
  kind: 'autoresolve', prUrl: 'https://example.test/autoresolve', prCreatedAt: '', queuedAt: '',
  // @ts-expect-error autoresolve requests cannot carry CI-fix outcomes.
  run: async () => ({ kind: 'failed', stage: 'worktree' }),
};
const ciFixRequestContract: Extract<RepairRequest, { kind: 'ci-fix' }> = {
  kind: 'ci-fix', prUrl: 'https://example.test/ci-fix', prCreatedAt: '', queuedAt: '',
  // @ts-expect-error CI-fix requests cannot carry autoresolve outcomes.
  run: async () => ({ kind: 'refreshed' }),
};
void autoresolveRequestContract;
void ciFixRequestContract;

describe('daemon pooled repairs', () => {
  // Covers: task:rem-prd-audit-R3, task:rem-prd-audit-R3-2, task:rem-prd-audit-R4.
  it('claims repairs before features and releases their reserved pool key', async () => {
    const queue = new RepairQueue();
    queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/2', slug: 'p2', prCreatedAt: '2026-01-02T00:00:00Z', queuedAt: '2026-01-03T00:00:00Z', run: async () => ({ kind: 'failed', stage: 'worktree' }) });
    queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/0', slug: 'p0', prCreatedAt: '2026-01-01T00:00:00Z', queuedAt: '2026-01-03T00:00:00Z', run: async () => ({ kind: 'failed', stage: 'worktree' }) });
    const claims = new InMemoryWorkClaims();
    const repairs: string[] = [];
    const features: string[] = [];
    const terminalEffects = vi.fn();

    const result = await runDaemon({
      claims,
      repairPriority: (slug) => slug === 'p0' ? 'P0' : 'P2',
      repairs: { queue,
      run: async (request) => {
        repairs.push(request.prUrl);
        expect(claims.list()).toContain(`repair:${request.prUrl}`);
      } },
      discoverBacklog: async () => [{ slug: 'feature' }],
      runFeature: async (item) => { features.push(item.slug); return done(item.slug); },
      onFeatureTerminalEffects: terminalEffects,
    }, { concurrency: 1, once: true, maxItems: 1 });

    expect(repairs).toEqual(['https://example.test/0', 'https://example.test/2']);
    expect(features).toEqual(['feature']);
    expect(claims.list()).toEqual([]);
    expect(terminalEffects).toHaveBeenCalledExactlyOnceWith(done('feature'));
    expect(result.processed).toEqual([done('feature')]);
  });

  it('does not claim queued repairs while paused or rate limited', async () => {
    const queue = new RepairQueue();
    queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/1', slug: 'one', prCreatedAt: '2026-01-01T00:00:00Z', queuedAt: '2026-01-01T00:00:00Z', run: async () => ({ kind: 'failed', stage: 'worktree' }) });
    const runRepair = vi.fn(async () => {});
    await runDaemon({
      repairs: { queue, run: runRepair }, isPaused: async () => true,
      discoverBacklog: async () => [], runFeature: async (item) => done(item.slug),
    }, { concurrency: 1, once: true });
    expect(runRepair).not.toHaveBeenCalled();
    expect(queue.list()).toHaveLength(1);
  });

  it('skips an in-flight feature repair and starts the next eligible repair before a new feature', async () => {
    const queue = new RepairQueue();
    const featureA = deferred<FeatureOutcome>();
    const events: string[] = [];
    const daemon = runDaemon({
      repairPriority: (slug) => slug === 'a' ? 'P0' : 'P2',
      repairs: {
        queue,
        run: async (request) => { events.push(`repair:${request.slug}`); },
      },
      discoverBacklog: async () => [{ slug: 'a' }, { slug: 'new-feature' }],
      runFeature: async (item) => {
        events.push(`feature:${item.slug}`);
        if (item.slug === 'a') {
          queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/a', slug: 'a', prCreatedAt: '2026-01-01T00:00:00Z', queuedAt: '', run: async () => ({ kind: 'failed', stage: 'worktree' }) });
          queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/b', slug: 'b', prCreatedAt: '2026-01-02T00:00:00Z', queuedAt: '', run: async () => ({ kind: 'failed', stage: 'worktree' }) });
          return featureA.promise;
        }
        return done(item.slug);
      },
    }, { concurrency: 2, once: true, maxItems: 2, idlePollMs: 0 });

    await vi.waitFor(() => expect(events).toContain('repair:b'));
    expect(events.indexOf('repair:b')).toBeLessThan(events.indexOf('feature:new-feature'));
    featureA.resolve(done('a'));
    await daemon;
  });

  // Covers: task:rem-prd-audit-rem-r4b-skip-inflight-repair.
  it('leaves an in-flight feature repair queued across fill passes, then starts it after collection', async () => {
    const queue = new RepairQueue();
    const featureA = deferred<FeatureOutcome>();
    const repair = vi.fn(async () => {});
    let discoveries = 0;
    let stop = false;
    const daemon = runDaemon({
      repairs: { queue, run: repair },
      discoverBacklog: async () => {
        discoveries++;
        return [{ slug: 'a' }];
      },
      runFeature: async (item) => {
        if (item.slug === 'a') {
          queue.enqueue({
            kind: 'ci-fix', prUrl: 'https://example.test/a', slug: 'a',
            prCreatedAt: '2026-01-01T00:00:00Z', queuedAt: '',
            run: async () => ({ kind: 'failed', stage: 'worktree' }),
          });
          return featureA.promise;
        }
        return done(item.slug);
      },
      shouldStop: () => stop,
    }, { concurrency: 2, once: false, idlePollMs: 0 });

    await vi.waitFor(() => expect(discoveries).toBeGreaterThanOrEqual(3));
    expect(repair).not.toHaveBeenCalled();
    expect(queue.list()).toHaveLength(1);

    featureA.resolve(done('a'));
    await vi.waitFor(() => expect(repair).toHaveBeenCalledOnce());
    stop = true;
    await daemon;
  });

  it('drops claimed repairs whose watch entries were removed without recreating them', async () => {
    const root = await mkdtemp('/tmp/daemon-pooled-repairs-');
    const watchPath = join(root, '.daemon', 'mergeable-watch.jsonl');
    const ciUrl = 'https://example.test/ci';
    const autoresolveUrl = 'https://example.test/autoresolve';
    const preserved = `${JSON.stringify({ prUrl: 'https://example.test/other', slug: 'other', repoCwd: root, ciFixAttempts: 2 })}\n`;
    await mkdir(join(root, '.daemon'), { recursive: true });
    await writeFile(watchPath, preserved);

    const ciAdapter = vi.fn(async () => ({ kind: 'failed' as const, stage: 'worktree' as const }));
    const autoresolveAdapter = vi.fn(async () => ({ kind: 'escalated' as const }));
    const logs: string[] = [];
    const states: Record<string, PrMergeState> = {
      [ciUrl]: {
        state: 'OPEN', mergeable: 'MERGEABLE', checksOutcome: 'failed', hasFailingOrPendingChecks: true,
        statusCheckRollup: [], labels: [],
      },
      [autoresolveUrl]: {
        state: 'OPEN', mergeable: 'CONFLICTING', checksOutcome: 'none', hasFailingOrPendingChecks: false,
        statusCheckRollup: [], labels: [],
      },
    };
    const runner = createClaimTimeRepairRunner({
      projectRoot: root,
      tracker: { readPullRequestMergeState: async (prUrl) => states[prUrl]! },
      log: (message) => { logs.push(message); },
      isWorkClaimActive: () => false,
    });
    const queue = new RepairQueue();
    queue.enqueue({ kind: 'ci-fix', prUrl: ciUrl, slug: 'ci', prCreatedAt: '', queuedAt: '', run: ciAdapter });
    queue.enqueue({ kind: 'autoresolve', prUrl: autoresolveUrl, slug: 'autoresolve', prCreatedAt: '', queuedAt: '', run: autoresolveAdapter });
    const claims = new InMemoryWorkClaims();

    try {
      await runDaemon({
        claims,
        repairs: { queue, run: runner },
        discoverBacklog: async () => [],
        runFeature: async (item) => done(item.slug),
      }, { concurrency: 1, once: true });

      expect(ciAdapter).not.toHaveBeenCalled();
      expect(autoresolveAdapter).not.toHaveBeenCalled();
      await expect(readFile(watchPath, 'utf8')).resolves.toBe(preserved);
      expect(logs).toEqual([
        `[daemon] dropping repair ${ciUrl}: watch entry missing`,
        `[daemon] dropping repair ${autoresolveUrl}: watch entry missing`,
      ]);
      expect(claims.list()).not.toContain(`repair:${ciUrl}`);
      expect(claims.list()).not.toContain(`repair:${autoresolveUrl}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs a pooled autoresolve through the sweep call-site with the sweep-only test judgement', async () => {
    const fixture = await buildPrFixture({
      initial: { 'rewrite.test.ts': 'base\n' },
      feature: [{ subject: 'test: rewrite assertion', files: { 'rewrite.test.ts': 'feature\n' } }],
      main: { 'rewrite.test.ts': 'upstream\n' },
    });
    const queue = new RepairQueue();
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
        repairs: { queue },
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
        repairs: { queue, run: async (request) => {
          await request.run({ prUrl: request.prUrl, slug: request.slug ?? '', repoCwd: fixture.repo });
        } },
        discoverBacklog: async () => [],
        runFeature: async (item) => done(item.slug),
      }, { concurrency: 1, once: true });

      expect(resolver).toHaveBeenCalledOnce();
    } finally {
      await fixture.cleanup();
    }
  });
});
