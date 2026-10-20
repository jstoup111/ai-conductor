// Covers: task:rem-as-built-rem-vg-1
// Covers: task:rem-as-built-R1
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { makeExecutorChildFeatureRunner } from '../../src/engine/executor-child-runtime.js';
import type { FeatureRunnerDeps, FeatureWorktree, WorktreeOutcome } from '../../src/engine/daemon-runner.js';
import { SetupFailureError } from '../../src/engine/worktree-prepare.js';
import type { WorkOrder } from '../../src/engine/work-order.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import { EVENT_SINKS } from '../../src/engine/event-sinks.js';
import type { ConductorEvent } from '../../src/types/events.js';

const VERSION = '20261020T120000Z-aaaaaaaaaaaa' as WorkOrder['engineVersionId'];
const order: WorkOrder = {
  schemaVersion: 1,
  repository: 'repo',
  slug: 'feature',
  baseSha: 'a'.repeat(40),
  engineVersionId: VERSION,
  manifest: [],
};

const providerExecution = {} as ProviderExecutionContext;

function recordingBus(): { bus: ConductorEventEmitter; seen: ConductorEvent[] } {
  const bus = new ConductorEventEmitter();
  const seen: ConductorEvent[] = [];
  for (const type of Object.keys(EVENT_SINKS) as Array<ConductorEvent['type']>) {
    bus.on(type, (event) => { seen.push(event); });
  }
  return { bus, seen };
}

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

function lifecycle(
  worktree: FeatureWorktree,
  outcome: WorktreeOutcome,
  overrides: Partial<FeatureRunnerDeps> = {},
): FeatureRunnerDeps {
  return {
    createWorktree: vi.fn(async () => worktree),
    runConductor: vi.fn(async () => {}),
    readOutcome: vi.fn(async () => outcome),
    teardownWorktree: vi.fn(async () => {}),
    markProcessed: vi.fn(async () => {}),
    daemon: true,
    project: 'repo',
    projectRoot: root,
    shipmentEvidence: vi.fn(async (input) => ({
      kind: 'valid' as const,
      slug: input.slug,
      pr: input.implementationPr,
      recordPath: '.docs/shipped/feature.md',
      hash: 'a'.repeat(64),
      commit: input.candidateCommit,
    })),
    ...overrides,
  };
}

describe('executor child runtime lifecycle composition', () => {
  it('returns setup-triage parking as a deferred autoPark effect and tears down the kept worktree', async () => {
    const testRoot = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'executor-runtime-')));
    root = testRoot;
    const worktree = { path: join(testRoot, '.worktrees', order.slug), branch: 'feature/branch' };
    await mkdir(worktree.path, { recursive: true });
    const deps = lifecycle(worktree, { done: false, halted: false }, {
      prepareWorktree: vi.fn(async () => { throw new SetupFailureError('setup failed', 'setup tail'); }),
      runSetupTriage: vi.fn(async () => ({ kind: 'park' as const, outputTail: 'setup tail' })),
    });

    const outcome = await makeExecutorChildFeatureRunner({
      order,
      worktree,
      events: new ConductorEventEmitter(),
      providerExecution,
    }, deps)();

    expect(outcome).toMatchObject({
      slug: order.slug,
      status: 'error',
      terminalEffects: { autoPark: { reason: 'setup tail' } },
    });
    expect(deps.teardownWorktree).toHaveBeenCalledWith(worktree, true);
  });

  it('returns halt-cleanup and engineer signalling declaratively after a verified ship', async () => {
    const testRoot = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'executor-runtime-')));
    root = testRoot;
    const worktree = { path: join(testRoot, '.worktrees', order.slug), branch: 'feature/branch' };
    await mkdir(join(worktree.path, '.pipeline'), { recursive: true });
    await writeFile(join(worktree.path, '.pipeline', 'events.jsonl'), '{"type":"feature_shipped"}\n');
    const deps = lifecycle(worktree, {
      done: true,
      halted: false,
      prUrl: 'https://github.com/example/repo/pull/42',
      finishChoice: 'pr',
    });

    const outcome = await makeExecutorChildFeatureRunner({
      order,
      worktree,
      events: new ConductorEventEmitter(),
      providerExecution,
    }, deps)();

    expect(outcome.terminalEffects).toMatchObject({
      cleanupHaltPresentation: { prUrl: 'https://github.com/example/repo/pull/42' },
      engineerSignal: {
        outcome: { slug: order.slug, status: 'done', prUrl: 'https://github.com/example/repo/pull/42' },
        eventsContent: '{"type":"feature_shipped"}\n',
      },
      markProcessed: { prUrl: 'https://github.com/example/repo/pull/42' },
      enrollWatch: { prUrl: 'https://github.com/example/repo/pull/42' },
      sweep: true,
    });
    expect(deps.teardownWorktree).not.toHaveBeenCalled();
  });

  it('invokes lifecycle teardown when the conductor reports a halt', async () => {
    const testRoot = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'executor-runtime-')));
    root = testRoot;
    const worktree = { path: join(testRoot, '.worktrees', order.slug), branch: 'feature/branch' };
    await mkdir(worktree.path, { recursive: true });
    const deps = lifecycle(worktree, { done: false, halted: true, reason: 'gate halted' });

    const outcome = await makeExecutorChildFeatureRunner({
      order,
      worktree,
      events: new ConductorEventEmitter(),
      providerExecution,
    }, deps)();

    expect(outcome).toMatchObject({
      slug: order.slug,
      status: 'halted',
      terminalEffects: { sweep: true, engineerSignal: { outcome: { status: 'halted' } } },
    });
    expect(deps.teardownWorktree).toHaveBeenCalledWith(worktree, true);
  });

  it('binds the child-owned bus as the runner feature scope without emitting supervisor-owned dispatch lifecycle', async () => {
    const testRoot = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'executor-runtime-')));
    root = testRoot;
    const worktree = { path: join(testRoot, '.worktrees', order.slug), branch: 'feature/branch' };
    await mkdir(join(worktree.path, '.pipeline'), { recursive: true });
    const { bus, seen } = recordingBus();
    const deps = lifecycle(worktree, {
      done: true,
      halted: false,
      prUrl: 'https://github.com/example/repo/pull/42',
      finishChoice: 'pr',
    }, {
      prepareWorktree: vi.fn(async () => {}),
    });

    await makeExecutorChildFeatureRunner({ order, worktree, events: bus, providerExecution }, deps)();

    // Setup events travel on the child bus, and the verified ship reaches it.
    expect(vi.mocked(deps.prepareWorktree!).mock.calls[0]?.[2]).toBe(bus);
    expect(seen.map((event) => event.type)).toContain('feature_shipped');
    // The supervisor alone emits the once-per-claim dispatch pair (ADR D4).
    expect(seen.map((event) => event.type)).not.toContain('feature_dispatch_started');
    expect(seen.map((event) => event.type)).not.toContain('feature_dispatch_ended');
  });

  it('routes setup-triage events through the child-owned bus and resolves the scope provider execution', async () => {
    const testRoot = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'executor-runtime-')));
    root = testRoot;
    const worktree = { path: join(testRoot, '.worktrees', order.slug), branch: 'feature/branch' };
    await mkdir(worktree.path, { recursive: true });
    const { bus, seen } = recordingBus();
    const deps = lifecycle(worktree, { done: false, halted: false }, {
      prepareWorktree: vi.fn(async () => { throw new SetupFailureError('setup failed', 'setup tail'); }),
      runSetupTriage: vi.fn(async () => ({ kind: 'park' as const, outputTail: 'setup tail' })),
    });

    await makeExecutorChildFeatureRunner({ order, worktree, events: bus, providerExecution }, deps)();

    const triageCall = vi.mocked(deps.runSetupTriage!).mock.calls[0];
    expect(triageCall?.[3]).toBe(providerExecution);
    expect(triageCall?.[5]).toBe(bus);
    expect(seen.map((event) => event.type)).not.toContain('feature_dispatch_started');
    expect(seen.map((event) => event.type)).not.toContain('feature_dispatch_ended');
  });
});
