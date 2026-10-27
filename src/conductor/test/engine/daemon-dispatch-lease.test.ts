// Covers: task:2, task:rem-as-built-rem-as-built-r5, task:rem-prd-audit-rem-child-dispatch-lease
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BacklogItem } from '../../src/engine/daemon.js';
import { makeRunFeature, type FeatureRunnerDeps } from '../../src/engine/daemon-runner.js';
import { rekickSweep, type RekickSweepDeps } from '../../src/engine/daemon-rekick.js';
import { runExecutorChild } from '../../src/engine/executor-child.js';
import { makeExecutorChildDispatchAdmission } from '../../src/engine/executor-child-runtime.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

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

const childRoots: string[] = [];

afterEach(async () => {
  await Promise.all(childRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class ChildPort {
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Array<(value?: unknown) => void>>();

  send(value: unknown, callback?: (error: Error | null) => void): boolean {
    this.sent.push(value);
    callback?.(null);
    return true;
  }

  on(event: 'message' | 'disconnect', listener: (value?: unknown) => void): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  dispatch(value: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) listener(value);
  }

  disconnect(): void {}
}

function childOrder(slug = 'stacked'): WorkOrder {
  return {
    schemaVersion: 1,
    repository: 'repo',
    slug,
    baseSha: 'a'.repeat(40),
    engineVersionId: '20261020T120000Z-aaaaaaaaaaaa' as WorkOrder['engineVersionId'],
    manifest: [],
  };
}

async function dispatchChild(
  root: string,
  trace: string[],
  order = childOrder(),
): Promise<ChildPort> {
  const port = new ChildPort();
  const worktree = join(root, '.worktrees', order.slug);
  const complete = runExecutorChild(port, {
    moduleDir: '/engine',
    admitDispatch: (receivedOrder) => makeExecutorChildDispatchAdmission({ projectRoot: root }, receivedOrder),
    createWorktree: async () => {
      trace.push('create');
      return { path: worktree };
    },
    run: async () => {
      trace.push('run');
      return { slug: order.slug, status: 'done' };
    },
  });
  port.dispatch({ kind: 'work-order', order });
  await complete;
  return port;
}

function childOutcome(port: ChildPort): unknown {
  return port.sent.find((message) => (message as { kind?: string }).kind === 'outcome');
}

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

  it('leases a stacked child dispatch before it creates or binds its worktree, then releases at unit end', async () => {
    const root = await mkdtemp(join(tmpdir(), 'child-dispatch-lease-'));
    childRoots.push(root);
    const trace: string[] = [];
    seams.durable.mockResolvedValue(true);
    seams.parked.mockResolvedValue(false);
    seams.acquire.mockImplementation(async () => { trace.push('acquire'); return acquired(trace); });

    const port = await dispatchChild(root, trace);

    expect(seams.acquire).toHaveBeenCalledWith(root, 'stacked', 'daemon dispatch');
    expect(trace).toEqual(['acquire', 'create', 'run', 'release']);
    expect(childOutcome(port)).toEqual({ kind: 'outcome', outcome: { slug: 'stacked', status: 'done' } });
  });

  it('keeps a live operator lease record and existing child worktree unchanged by skipping before binding it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'child-dispatch-lease-'));
    childRoots.push(root);
    const worktree = join(root, '.worktrees', 'stacked');
    const ownerPath = join(root, '.daemon', 'leases', 'stacked', 'owner.json');
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.daemon', 'leases', 'stacked'), { recursive: true });
    await writeFile(join(worktree, '.pipeline', 'sentinel'), 'unchanged\n');
    await writeFile(ownerPath, '{"operator":"manual review"}\n');
    const ownerBefore = await readFile(ownerPath, 'utf8');
    const trace: string[] = [];
    seams.durable.mockResolvedValue(true);
    seams.acquire.mockResolvedValue({
      kind: 'live-owner',
      owner: { host: 'operator', pid: 7, processStartTime: '1', token: 'owner', purpose: 'manual review' },
    });

    const port = await dispatchChild(root, trace);

    expect(trace).toEqual([]);
    await expect(readFile(ownerPath, 'utf8')).resolves.toBe(ownerBefore);
    await expect(readFile(join(worktree, '.pipeline', 'sentinel'), 'utf8')).resolves.toBe('unchanged\n');
    expect(childOutcome(port)).toEqual({
      kind: 'outcome',
      outcome: { slug: 'stacked', status: 'parked', reason: 'feature-lease-held' },
    });
  });

  it('rechecks a child dispatch park marker after acquiring the lease, releases, and skips before binding the worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'child-dispatch-lease-'));
    childRoots.push(root);
    const trace: string[] = [];
    seams.durable.mockResolvedValue(true);
    seams.parked.mockResolvedValue(true);
    seams.acquire.mockImplementation(async () => { trace.push('acquire'); return acquired(trace); });

    const port = await dispatchChild(root, trace);

    expect(trace).toEqual(['acquire', 'release']);
    expect(childOutcome(port)).toEqual({
      kind: 'outcome',
      outcome: { slug: 'stacked', status: 'parked', reason: 'parked-after-lease' },
    });
  });

  it('does not access a lease for a flat child dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'child-dispatch-lease-'));
    childRoots.push(root);
    const trace: string[] = [];
    seams.durable.mockResolvedValue(false);
    seams.acquire.mockImplementation(() => { throw new Error('flat child must not acquire a lease'); });
    seams.parked.mockImplementation(() => { throw new Error('flat child must not read the stacked park marker'); });

    const port = await dispatchChild(root, trace, childOrder('flat'));

    expect(seams.acquire).not.toHaveBeenCalled();
    expect(seams.parked).not.toHaveBeenCalled();
    expect(trace).toEqual(['create', 'run']);
    expect(childOutcome(port)).toEqual({ kind: 'outcome', outcome: { slug: 'flat', status: 'done' } });
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
