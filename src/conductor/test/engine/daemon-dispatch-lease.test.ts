// Covers: task:2, task:rem-as-built-rem-as-built-r5
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BacklogItem } from '../../src/engine/daemon.js';
import { makeRunFeature, type FeatureRunnerDeps } from '../../src/engine/daemon-runner.js';
import { rekickSweep, type RekickSweepDeps } from '../../src/engine/daemon-rekick.js';

const seams = vi.hoisted(() => ({
  acquire: vi.fn(),
  durable: vi.fn(),
  parked: vi.fn(),
}));

vi.mock('../../src/engine/feature-dispatch-lease.js', () => ({
  acquireFeatureDispatchLease: seams.acquire,
}));

vi.mock('../../src/engine/child-cursor.js', () => ({
  hasDurableChildState: seams.durable,
  resolveActiveChild: vi.fn(),
}));

vi.mock('../../src/engine/park-marker.js', () => ({
  isOperatorParked: seams.parked,
}));

const ITEM: BacklogItem = { slug: 'stacked' };

beforeEach(() => {
  vi.clearAllMocks();
});

function runnerDeps(trace: string[]): FeatureRunnerDeps {
  return {
    // The daemon runner reaches the production `git worktree add` mutation
    // through this seam. Keep it real while observing the ordering boundary.
    createWorktree: async () => {
      trace.push('create');
      return { path: '/repo/.worktrees/stacked', branch: 'feat/stacked' };
    },
    prepareWorktree: async () => { trace.push('prepare'); },
    runConductor: async () => { trace.push('conductor'); },
    readOutcome: async () => ({ done: false, halted: false }),
    teardownWorktree: async () => { trace.push('teardown'); },
    markProcessed: async () => {},
    daemon: true,
    project: 'repo',
    projectRoot: '/repo',
  };
}

function acquired(trace: string[]) {
  return {
    kind: 'acquired' as const,
    lease: { release: async () => { trace.push('release'); return { ok: true } as const; } },
  };
}

describe('engine/daemon dispatch lease', () => {
  it('leases a stacked daemon dispatch before creating or preparing its worktree and releases at the unit boundary', async () => {
    const trace: string[] = [];
    seams.durable.mockResolvedValue(true);
    seams.parked.mockResolvedValue(false);
    seams.acquire.mockImplementation(async () => { trace.push('acquire'); return acquired(trace); });

    await expect(makeRunFeature(runnerDeps(trace))(ITEM)).resolves.toMatchObject({ status: 'error' });

    expect(trace).toEqual(['acquire', 'create', 'prepare', 'conductor', 'teardown', 'release']);
  });

  it('rechecks parking after acquisition, releases, and skips without preparation', async () => {
    const trace: string[] = [];
    seams.durable.mockResolvedValue(true);
    seams.parked.mockResolvedValue(true);
    seams.acquire.mockImplementation(async () => { trace.push('acquire'); return acquired(trace); });

    await expect(makeRunFeature(runnerDeps(trace))(ITEM)).resolves.toMatchObject({
      status: 'parked', reason: 'parked-after-lease',
    });
    expect(trace).toEqual(['acquire', 'release']);
  });

  it('keeps a live operator lease intact by skipping the stacked dispatch before preparation', async () => {
    const trace: string[] = [];
    seams.durable.mockResolvedValue(true);
    seams.acquire.mockResolvedValue({
      kind: 'live-owner',
      owner: { host: 'operator', pid: 7, processStartTime: '1', token: 'owner', purpose: 'manual review' },
    });

    await expect(makeRunFeature(runnerDeps(trace))(ITEM)).resolves.toMatchObject({
      status: 'parked', reason: 'feature-lease-held',
    });
    expect(trace).toEqual([]);
  });

  it('does not consult the lease for a flat daemon dispatch', async () => {
    const trace: string[] = [];
    seams.durable.mockResolvedValue(false);

    await expect(makeRunFeature(runnerDeps(trace))(ITEM)).resolves.toMatchObject({ status: 'error' });

    expect(seams.acquire).not.toHaveBeenCalled();
    expect(trace).toContain('prepare');
  });

  it('leases a stacked re-kick before aborting and clearing, and skips a live lease owner', async () => {
    const trace: string[] = [];
    const deps: RekickSweepDeps = {
      listHaltedWorktrees: async () => ['stacked'],
      readHaltReason: async () => 'halted',
      hasRebaseInProgress: async () => true,
      abortRebase: async () => { trace.push('abort'); },
      clearMarker: async () => { trace.push('clear'); },
      lastRekickSha: new Map(),
      isOperatorParked: async () => false,
      hasDurableChildState: async () => true,
      acquireFeatureDispatchLease: async () => { trace.push('acquire'); return acquired(trace); },
    };

    await expect(rekickSweep(deps, 'a'.repeat(40))).resolves.toEqual({ cleared: ['stacked'], skipped: [] });
    expect(trace).toEqual(['acquire', 'abort', 'clear', 'release']);

    deps.acquireFeatureDispatchLease = async () => ({
      kind: 'live-owner',
      owner: { host: 'operator', pid: 7, processStartTime: '1', token: 'owner', purpose: 'manual review' },
    });
    trace.length = 0;
    deps.lastRekickSha.clear();
    await expect(rekickSweep(deps, 'b'.repeat(40))).resolves.toEqual({ cleared: [], skipped: ['stacked'] });
    expect(trace).toEqual([]);
  });

  it('rechecks parking after a re-kick lease and releases without touching the halted worktree', async () => {
    const trace: string[] = [];
    let parkChecks = 0;
    const deps: RekickSweepDeps = {
      listHaltedWorktrees: async () => ['stacked'],
      readHaltReason: async () => 'halted',
      hasRebaseInProgress: async () => { trace.push('rebase'); return true; },
      abortRebase: async () => { trace.push('abort'); },
      clearMarker: async () => { trace.push('clear'); },
      lastRekickSha: new Map(),
      isOperatorParked: async () => ++parkChecks > 1,
      hasDurableChildState: async () => true,
      acquireFeatureDispatchLease: async () => { trace.push('acquire'); return acquired(trace); },
    };

    await expect(rekickSweep(deps, 'c'.repeat(40))).resolves.toEqual({ cleared: [], skipped: ['stacked'] });
    expect(trace).toEqual(['acquire', 'release']);
    expect(parkChecks).toBe(2);
  });
});
