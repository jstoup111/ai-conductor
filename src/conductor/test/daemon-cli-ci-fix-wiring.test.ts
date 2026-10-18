// Covers: task:4, task:11
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaimTimeRepairRunner } from '../src/daemon-cli.js';
import {
  ciRepairOutcomeDiagnostic,
  ciRepairPreDispatchDisposition,
  classifyCiContextFailure,
  createDaemonCiFixDispatch,
} from '../src/engine/daemon-ci-fix.js';
import type { PrMergeState } from '../src/engine/pr-labels.js';
import { RepairQueue } from '../src/engine/repair-queue.js';
import { sweepMergeableLabels, type WatchEntry } from '../src/engine/mergeable-sweep.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const entry: WatchEntry = {
  prUrl: 'https://github.com/acme/widget/pull/7', slug: 'widget', repoCwd: '/repo', ciFixAttempts: 1,
};
const selected: PrMergeState = {
  state: 'OPEN', mergeable: 'MERGEABLE', hasFailingOrPendingChecks: true, labels: [], checksOutcome: 'failed',
  statusCheckRollup: [
    { kind: 'check-run', status: 'COMPLETED', conclusion: 'FAILURE', name: 'unit', detailsUrl: 'https://github.com/acme/widget/actions/runs/41' },
    { kind: 'status-context', state: 'ERROR', context: 'external lint', targetUrl: 'https://github.com/acme/widget/actions/runs/42' },
    { kind: 'check-run', status: 'COMPLETED', conclusion: 'FAILURE' },
    { kind: 'check-run', status: 'COMPLETED', conclusion: 'SUCCESS', name: 'passing' },
  ],
};

function longFailedLog(): string {
  const prefix = [
    ...Array.from({ length: 600 }, (_, index) => `* [new branch] feat/fail-fast-${index} -> origin/feat/fail-fast-${index}`),
    'FAIL  test/engine/foo.test.ts > foo > bar',
    'AssertionError: expected 1 to be 2',
  ].join('\n');
  const lastLine = '##[error]Process completed with exit code 1.';
  const padding = 'p'.repeat(127_189 - Buffer.byteLength(`${prefix}\n\n${lastLine}`, 'utf8'));
  return `${prefix}\n${padding}\n${lastLine}`;
}

function factory(overrides: Partial<Parameters<typeof createDaemonCiFixDispatch>[0]> = {}) {
  const gh = vi.fn(async (args: string[]) => {
    if (args[0] === 'pr') return { stdout: JSON.stringify({ headRefName: 'repair-branch' }) };
    if (args[0] === 'run') throw new Error('logs unavailable');
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  });
  const runner = vi.fn(async ({ hint }: { hint: string }) => {
    expect(hint).toContain('unit');
    expect(hint).toContain('external lint');
    expect(hint).toContain('(unnamed check #3)');
    expect(hint).toContain('https://github.com/acme/widget/actions/runs/41');
    expect(hint).not.toContain('passing');
    return { kind: 'session-completed' as const };
  });
  const run = vi.fn(async (_entry, branch, hint, deps) => {
    expect(branch).toBe('repair-branch');
    return deps.fixRunner.run({ worktreePath: '/repair', hint, entry: _entry });
  });
  const dispatch = createDaemonCiFixDispatch({
    tracker: {
      getPullRequestHeadRef: async () => JSON.parse((await gh(['pr'])).stdout).headRefName,
      viewWorkflowRunFailedLog: async (repo: string, run: string, _cwd: string, _opts: { timeout: number; maxBuffer: number }) => (await gh(['run', 'view', run, '--repo', repo, '--log-failed'])).stdout,
    } as any, createDispatcher: () => ({ resolveCiFailure: async () => ({ kind: 'session-completed' }) }),
    fixRunner: { run: runner }, run, ...overrides,
  });
  return { dispatch, gh, runner, run };
}

describe('daemon CI-fix production dispatch callback', () => {
  it.each([
    ['UNKNOWN', { ...selected, state: 'UNKNOWN' }, 'ci-fix'],
    ['NOTFOUND', { ...selected, state: 'NOTFOUND' }, 'ci-fix'],
    ['read failure', { ...selected, readFailure: { kind: 'runner', error: new Error('unavailable') } }, 'ci-fix'],
    ['pending rollup', { ...selected, checksOutcome: 'pending' }, 'ci-fix'],
    ['no rollup', { ...selected, checksOutcome: 'none' }, 'ci-fix'],
    ['non-conflicting autoresolve', { ...selected, mergeable: 'MERGEABLE' }, 'autoresolve'],
    ['rejected state read', undefined, 'autoresolve'],
  ] as const)('drops a stale %s repair before its attempt write or adapter call', async (_caseName, result, kind) => {
    const root = await mkdtemp('/tmp/daemon-claim-repair-');
    roots.push(root);
    await mkdir(join(root, '.daemon'), { recursive: true });
    const prUrl = 'https://github.com/acme/widget/pull/7';
    await writeFile(join(root, '.daemon', 'mergeable-watch.jsonl'), `${JSON.stringify({
      prUrl, slug: 'widget', repoCwd: root, ciFixAttempts: 3, resolveAttempts: 2,
    })}\n`);
    const adapter = vi.fn();
    const log = vi.fn();
    const runner = createClaimTimeRepairRunner({
      projectRoot: root,
      tracker: {
        readPullRequestMergeState: async () => {
          if (result === undefined) throw new Error('read rejected');
          return result;
        },
      },
      log,
      isWorkClaimActive: () => false,
    });

    if (kind === 'ci-fix') {
      await runner({ kind, prUrl, slug: 'widget', prCreatedAt: '2026-10-01T00:00:00.000Z', queuedAt: '2026-10-01T00:00:00.000Z', run: async () => {
        adapter();
        return { kind: 'failed', stage: 'worktree' };
      } });
    } else {
      await runner({ kind, prUrl, slug: 'widget', prCreatedAt: '2026-10-01T00:00:00.000Z', queuedAt: '2026-10-01T00:00:00.000Z', run: async () => {
        adapter();
        return { kind: 'escalated' };
      } });
    }

    expect(adapter).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    await expect(readFile(join(root, '.daemon', 'mergeable-watch.jsonl'), 'utf8')).resolves.toBe(`${JSON.stringify({
      prUrl, slug: 'widget', repoCwd: root, ciFixAttempts: 3, resolveAttempts: 2,
    })}\n`);
  });

  it('writes the claimed failed CI-fix attempt before calling its adapter', async () => {
    const root = await mkdtemp('/tmp/daemon-claim-repair-');
    roots.push(root);
    await mkdir(join(root, '.daemon'), { recursive: true });
    const prUrl = 'https://github.com/acme/widget/pull/7';
    await writeFile(join(root, '.daemon', 'mergeable-watch.jsonl'), `${JSON.stringify({ prUrl, slug: 'widget', repoCwd: root, ciFixAttempts: 3 })}\n`);
    const adapter = vi.fn(async () => {
      const stored = JSON.parse(await readFile(join(root, '.daemon', 'mergeable-watch.jsonl'), 'utf8')) as WatchEntry;
      expect(stored.ciFixAttempts).toBe(4);
      return { kind: 'failed' as const, stage: 'worktree' as const };
    });
    const runner = createClaimTimeRepairRunner({
      projectRoot: root,
      tracker: { readPullRequestMergeState: async () => selected },
      log: vi.fn(),
      isWorkClaimActive: () => false,
      now: () => new Date('2026-10-17T00:00:00.000Z'),
    });

    await runner({ kind: 'ci-fix', prUrl, slug: 'widget', prCreatedAt: '2026-10-01T00:00:00.000Z', queuedAt: '2026-10-01T00:00:00.000Z', run: adapter });

    expect(adapter).toHaveBeenCalledOnce();
  });

  it('keeps the request-owned adapter with a repair deferred for an in-flight feature', async () => {
    const root = await mkdtemp('/tmp/daemon-claim-repair-');
    roots.push(root);
    const queue = new RepairQueue();
    const prUrl = 'https://github.com/acme/widget/pull/7';
    const adapter = vi.fn(async () => ({ kind: 'failed' as const, stage: 'worktree' as const }));
    const request = {
      kind: 'ci-fix' as const, prUrl, slug: 'widget',
      prCreatedAt: '2026-10-01T00:00:00.000Z', queuedAt: '2026-10-01T00:00:00.000Z', run: adapter,
    };
    const runner = createClaimTimeRepairRunner({
      projectRoot: root, tracker: { readPullRequestMergeState: async () => selected }, log: vi.fn(),
      isWorkClaimActive: () => true, requeue: (deferred) => { queue.enqueue(deferred); },
    });

    await runner(request);

    expect(adapter).not.toHaveBeenCalled();
    expect(queue.take()).toBe(request);
  });

  it('stamps a claimed autoresolve before its adapter and makes the next sweep observe cooldown', async () => {
    const root = await mkdtemp('/tmp/daemon-claim-repair-');
    roots.push(root);
    await mkdir(join(root, '.daemon'), { recursive: true });
    const prUrl = 'https://github.com/acme/widget/pull/7';
    await writeFile(join(root, '.daemon', 'mergeable-watch.jsonl'), `${JSON.stringify({ prUrl, slug: 'widget', repoCwd: root, resolveAttempts: 2 })}\n`);
    const at = '2026-10-17T00:00:00.000Z';
    const adapter = vi.fn(async () => {
      const stored = JSON.parse(await readFile(join(root, '.daemon', 'mergeable-watch.jsonl'), 'utf8')) as WatchEntry;
      expect(stored).toMatchObject({ resolveAttempts: 3, lastResolveAt: at });
      return { kind: 'escalated' as const };
    });
    const runner = createClaimTimeRepairRunner({
      projectRoot: root,
      tracker: { readPullRequestMergeState: async () => ({ ...selected, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', checksOutcome: 'none' }) },
      log: vi.fn(), isWorkClaimActive: () => false,
      now: () => new Date(at),
    });

    await runner({ kind: 'autoresolve', prUrl, slug: 'widget', prCreatedAt: at, queuedAt: at, run: adapter });
    const eligible = vi.fn(async (entry: WatchEntry) => ({ eligible: entry.lastResolveAt !== at }));
    const queue = new RepairQueue();
    await sweepMergeableLabels({
      projectRoot: root, repairs: { queue },
      tracker: { readPullRequestMergeState: async () => ({ ...selected, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', checksOutcome: 'none' }) },
      autoresolve: { enabled: true, isEligible: eligible, dispatch: async () => ({ kind: 'escalated' }) },
    });
    expect(eligible).toHaveBeenCalledWith(expect.objectContaining({ lastResolveAt: at }), expect.anything());
    expect(queue.list()).toEqual([]);
  });

  it.each([
    ['auth', { readFailure: { kind: 'runner', error: new Error('401 unauthorized') } }, 'auth'],
    ['permission', { readFailure: { kind: 'runner', error: new Error('403 forbidden') } }, 'permission'],
    ['timeout', { readFailure: { kind: 'runner', error: new Error('timed out') } }, 'timeout'],
    ['api', { readFailure: { kind: 'runner', error: new Error('upstream unavailable') } }, 'api'],
    ['malformed', { contextFailure: { kind: 'invalid-rollup' } }, 'malformed-context'],
  ] as const)('classifies selected %s context failures without dispatching a provider', (_label, partial, reason) => {
    expect(classifyCiContextFailure({ ...selected, ...partial })).toBe(reason);
  });

  it('delivers the sweep snapshot’s mixed identities and usable context despite optional log failure, without a second check read', async () => {
    const { dispatch, gh, runner, run } = factory();
    await expect(dispatch(entry, selected)).resolves.toEqual({ kind: 'session-completed' });
    expect(runner).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(gh.mock.calls.filter(([args]) => args[0] === 'pr')).toHaveLength(1);
    expect(gh.mock.calls.filter(([args]) => args[0] === 'run')).toHaveLength(2);
  });

  it('hands the repair callback the failure excerpt from a long workflow log', async () => {
    const run = vi.fn(async (_entry, _branch, hint) => {
      expect(hint).toContain('FAIL  test/engine/foo.test.ts > foo > bar');
      expect(hint).toContain('AssertionError: expected 1 to be 2');
      expect(hint).not.toContain('* [new branch] feat/fail-fast-');
      return { kind: 'noop' as const };
    });
    const diagnostic = vi.fn();
    const dispatch = createDaemonCiFixDispatch({
      tracker: {
        getPullRequestHeadRef: async () => 'repair-branch',
        viewWorkflowRunFailedLog: async () => longFailedLog(),
      } as any,
      createDispatcher: () => ({ resolveCiFailure: async () => ({ kind: 'session-completed' }) }),
      diagnostic,
      run,
    });

    await expect(dispatch(entry, { ...selected, statusCheckRollup: [selected.statusCheckRollup![0]] })).resolves.toEqual({ kind: 'noop' });
    expect(run).toHaveBeenCalledOnce();
    expect(diagnostic).not.toHaveBeenCalledWith(expect.objectContaining({
      stage: 'log-enrichment', reason: 'log-unavailable',
    }));
  });

  it('forwards the available event emitter to the CI repair publication boundary', async () => {
    const events = { emit: vi.fn(async () => undefined) };
    const { dispatch, run } = factory({ events: events as never });

    await dispatch(entry, selected);

    expect(run).toHaveBeenCalledWith(entry, 'repair-branch', expect.any(String), expect.objectContaining({ events }), expect.any(Function));
  });

  it('emits an attributed degraded log-enrichment diagnostic while still dispatching', async () => {
    const diagnostic = vi.fn();
    const { dispatch, runner } = factory({ diagnostic });
    await dispatch(entry, selected);
    expect(runner).toHaveBeenCalledOnce();
    expect(diagnostic).toHaveBeenCalledWith({
      entry, stage: 'log-enrichment', reason: 'log-unavailable',
    });
    expect(ciRepairPreDispatchDisposition('log-enrichment')).toBe('degraded');
  });

  it.each<PrMergeState>([
    { ...selected, readFailure: { kind: 'runner', error: new Error('401') } },
    { ...selected, contextFailure: { kind: 'invalid-rollup' } },
    { ...selected, statusCheckRollup: [] },
  ])('refuses unusable selected context before provider execution', async (state) => {
    const { dispatch, runner, run } = factory();
    await expect(dispatch(entry, state)).resolves.toEqual({ kind: 'not-started' });
    expect(runner).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('returns not-started when canonical branch lookup is malformed or throws', async () => {
    for (const {} of [vi.fn(async () => ({ stdout: '{bad json' })), vi.fn(async () => { throw new Error('permission denied'); })]) {
      const run = vi.fn();
      const dispatch = createDaemonCiFixDispatch({
        tracker: { getPullRequestHeadRef: async () => { throw new Error('permission denied'); }, viewWorkflowRunFailedLog: async () => '' } as any, createDispatcher: () => ({ resolveCiFailure: async () => ({ kind: 'session-completed' }) }), run,
      });
      await expect(dispatch(entry, selected)).resolves.toEqual({ kind: 'not-started' });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('preserves the resolving provider and classified readiness refusal as a deferred execution diagnostic', async () => {
    const diagnostic = vi.fn();
    const resolveCiFailure = vi.fn(async () => ({
      kind: 'not-started' as const,
      actualProvider: 'codex',
      reason: 'provider-unavailable' as const,
    }));
    const run = vi.fn(async (_entry, _branch, hint, deps) => {
      const session = await deps.fixRunner.run({ worktreePath: '/repair', hint, entry: _entry });
      return session.kind === 'not-started'
        ? { kind: 'not-started' as const, provider: session.actualProvider, reason: session.reason }
        : { kind: 'failed' as const, stage: 'provider' as const };
    });
    const dispatch = createDaemonCiFixDispatch({
      tracker: { getPullRequestHeadRef: async () => 'repair-branch', viewWorkflowRunFailedLog: async () => '' } as any,
      createDispatcher: () => ({ resolveCiFailure }),
      diagnostic,
      run,
    });

    const savedKillSwitch = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    try {
      await expect(dispatch(entry, selected)).resolves.toEqual({
        kind: 'not-started', provider: 'codex', reason: 'provider-unavailable',
      });
    } finally {
      if (savedKillSwitch !== undefined) process.env.AI_CONDUCTOR_NO_REAL_EXEC = savedKillSwitch;
    }
    expect(resolveCiFailure).toHaveBeenCalledOnce();
    expect(diagnostic).toHaveBeenCalledWith({
      entry, stage: 'readiness', reason: 'provider-unavailable', provider: 'codex',
    });
  });

  it('keeps the three-request and final-byte boundary when enriched context reaches repair', async () => {
    const state: PrMergeState = {
      ...selected,
      statusCheckRollup: [1, 2, 3, 4].map((run) => ({
        kind: 'check-run' as const, status: 'COMPLETED', conclusion: 'FAILURE', name: `check-${run}`,
        detailsUrl: `https://github.com/acme/widget/actions/runs/${run}`,
      })),
    };
    let logReads = 0;
    const run = vi.fn(async (_entry, _branch, hint) => {
      expect(Buffer.byteLength(hint, 'utf8')).toBeLessThanOrEqual(24_576);
      expect(hint).toContain('[log enrichment omitted for 1 workflow runs]');
      return { kind: 'failed' as const, stage: 'provider' as const };
    });
    const dispatch = createDaemonCiFixDispatch({
      tracker: { getPullRequestHeadRef: async () => 'repair-branch', viewWorkflowRunFailedLog: async () => { logReads += 1; return 'é'.repeat(20_000); } } as any, createDispatcher: () => ({ resolveCiFailure: async () => ({ kind: 'session-completed' }) }), run,
    });
    await expect(dispatch(entry, state)).resolves.toEqual({ kind: 'failed', stage: 'provider' });
    expect(logReads).toBe(3);
  });

  it('emits a context-truncated degradation while retaining a bounded dispatch hint', async () => {
    const diagnostic = vi.fn();
    const state: PrMergeState = {
      ...selected,
      statusCheckRollup: [41, 42, 43].map((run) => ({
        kind: 'check-run' as const, status: 'COMPLETED', conclusion: 'FAILURE', name: `unit-${run}`,
        detailsUrl: `https://github.com/acme/widget/actions/runs/${run}`,
      })),
    };
    const dispatch = createDaemonCiFixDispatch({
      tracker: {
        getPullRequestHeadRef: async () => 'repair-branch',
        viewWorkflowRunFailedLog: async () => 'x'.repeat(20_000),
      } as any,
      createDispatcher: () => ({ resolveCiFailure: async () => ({ kind: 'session-completed' }) }),
      diagnostic,
      run: async () => ({ kind: 'noop' }),
    });
    await dispatch(entry, state);
    expect(diagnostic).toHaveBeenCalledWith({
      entry, stage: 'log-enrichment', reason: 'context-truncated',
    });
  });

  it.each([
    [{ kind: 'failed', stage: 'guard', provider: 'codex' }, 'guard', 'guard-refused', 'failed'],
    [{ kind: 'failed', stage: 'verification', provider: 'codex' }, 'verification', 'verification-failed', 'failed'],
    [{ kind: 'failed', stage: 'publication', provider: 'codex' }, 'publication', 'publication-refused', 'failed'],
    [{ kind: 'published', provider: 'codex' }, 'publication', 'verified-publication', 'published'],
    [{ kind: 'failed', stage: 'provider', provider: 'codex', reason: 'timeout' }, 'execution', 'timeout', 'failed'],
  ] as const)('maps attributed repair outcome diagnostics', (outcome, stage, reason, disposition) => {
    expect(ciRepairOutcomeDiagnostic(entry, outcome)).toMatchObject({
      prUrl: entry.prUrl, slug: entry.slug, stage, reason, disposition, provider: 'codex',
    });
  });
});
