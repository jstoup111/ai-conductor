// Covers: task:11
import { describe, expect, it, vi } from 'vitest';
import {
  ciRepairOutcomeDiagnostic,
  ciRepairPreDispatchDisposition,
  classifyCiContextFailure,
  createDaemonCiFixDispatch,
} from '../src/engine/daemon-ci-fix.js';
import type { PrMergeState } from '../src/engine/pr-labels.js';
import type { WatchEntry } from '../src/engine/mergeable-sweep.js';

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
    for (const gh of [vi.fn(async () => ({ stdout: '{bad json' })), vi.fn(async () => { throw new Error('permission denied'); })]) {
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
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'pr') return { stdout: JSON.stringify({ headRefName: 'repair-branch' }) };
      logReads += 1;
      return { stdout: 'é'.repeat(20_000) };
    });
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
