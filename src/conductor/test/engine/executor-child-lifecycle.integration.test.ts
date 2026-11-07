// Covers: task:8, task:9
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupFailureError } from '../../src/engine/worktree-prepare.js';

const seams = vi.hoisted(() => ({
  prepareWorktree: vi.fn(),
  acquireFeatureDispatchLease: vi.fn(),
}));

vi.mock('../../src/engine/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/config.js')>();
  return {
    ...actual,
    loadConfig: async () => ({ ok: true as const, config: { llm_provider: 'codex' }, warnings: [] }),
  };
});

vi.mock('../../src/engine/provider-discovery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/provider-discovery.js')>();
  return {
    ...actual,
    discoverInstalledProviders: async () => ({ installed: ['codex'], missing: [] }),
  };
});

vi.mock('../../src/engine/provider-model-probe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/provider-model-probe.js')>();
  return {
    ...actual,
    validateConfiguredProviderModels: async () => {},
    resolveProviderModelTiers: async () => {},
  };
});

vi.mock('../../src/engine/worktree-prepare.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/worktree-prepare.js')>();
  return { ...actual, prepareWorktree: seams.prepareWorktree };
});

vi.mock('../../src/engine/feature-dispatch-lease.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/feature-dispatch-lease.js')>();
  return {
    ...actual,
    acquireFeatureDispatchLease: async (...args: Parameters<typeof actual.acquireFeatureDispatchLease>) => {
      seams.acquireFeatureDispatchLease(...args);
      return actual.acquireFeatureDispatchLease(...args);
    },
  };
});

import { ALL_STEPS } from '../../src/engine/steps.js';
import { createChildProcessFeatureExecutor } from '../../src/engine/child-feature-executor.js';
import { Conductor } from '../../src/engine/conductor.js';
import { createExecutorBroker } from '../../src/engine/executor-broker.js';
import { ConductorEventEmitter } from '../../src/engine/conductor-event-emitter.js';
import { removeOperatorPark, writeOperatorPark } from '../../src/engine/park-marker.js';
import { createProviderAvailability } from '../../src/engine/provider-availability.js';
import { create as createRateLimitEpisode } from '../../src/engine/rate-limit-episode.js';
import { WorktreeLifecycleQueue } from '../../src/engine/worktree.js';
import type { WorkOrder } from '../../src/engine/work-order.js';
import { createInMemoryExecutorFork, useTempEngineStore } from '../fixtures/in-memory-executor-fork.js';
import { commitAll, initTestRepo } from '../fixtures/git-repo.js';

const roots: string[] = [];
let engineStore: Awaited<ReturnType<typeof useTempEngineStore>> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await engineStore?.teardown();
  engineStore = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function completeConductorState(worktree: string): Promise<void> {
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(
    join(worktree, '.pipeline', 'conduct-state.json'),
    JSON.stringify(Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']))),
  );
}

async function fixture(slug: string, { durableChildState = true }: { durableChildState?: boolean } = {}): Promise<{
  root: string;
  order: WorkOrder;
  rootEvents: ConductorEventEmitter;
  execute(): ReturnType<ReturnType<typeof createChildProcessFeatureExecutor>['execute']>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'executor-child-lifecycle-'));
  roots.push(root);
  await initTestRepo(root);
  await writeFile(join(root, 'README.md'), 'base\n');
  await commitAll(root, 'initial');
  const baseSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  if (durableChildState) await mkdir(join(root, '.pipeline', 'children', 'first'), { recursive: true });
  engineStore = await useTempEngineStore();
  const rootEvents = new ConductorEventEmitter();
  const broker = createExecutorBroker({
    rateLimitEpisode: createRateLimitEpisode(),
    providerAvailability: createProviderAvailability({ now: () => Date.now() }),
    worktreeLifecycle: new WorktreeLifecycleQueue(),
    rootEvents,
    featureLogFor: () => () => {},
  });
  const order: WorkOrder = {
    schemaVersion: 1,
    repository: 'owner/repository',
    slug,
    baseSha,
    baseBranch: 'main',
    engineVersionId: '20261107T000000Z-0123456789ab',
    tier: 'S',
    track: 'technical',
    manifest: [],
  };
  const executor = createChildProcessFeatureExecutor({
    projectRoot: root,
    engineDirForOrder: () => engineStore!.engineRoot.ownEngineDir,
    supervisorEngineVersionId: order.engineVersionId,
    rootEvents,
    attachBroker: (feature, port, engineVersionId) => broker.attach(feature, port, engineVersionId),
    fork: createInMemoryExecutorFork({ projectRoot: root }),
    dispatchStartTimeoutMs: 100,
    teardownTimeoutMs: 1,
  });
  return { root, order, rootEvents, execute: () => executor.execute(order) };
}

describe('executor child shared lifecycle', () => {
  it('uses its admitted stacked-dispatch lease once and runs the shared conductor', async () => {
    const subject = await fixture('stacked-child');
    const completions: string[] = [];
    subject.rootEvents.on('feature_complete', (event) => completions.push(event.featureDesc));
    seams.prepareWorktree.mockImplementation(async (worktree: string) => completeConductorState(worktree));

    const outcome = await subject.execute();

    expect(seams.acquireFeatureDispatchLease).toHaveBeenCalledTimes(1);
    expect(completions).toEqual([subject.order.slug]);
    expect(outcome).not.toMatchObject({ status: 'parked', reason: 'feature-lease-held' });
  });

  it('keeps ordinary setup and forced setup triage pinned to the order base', async () => {
    const subject = await fixture('pinned-base');
    const observedBaseShas: Array<string | undefined> = [];
    seams.prepareWorktree.mockImplementation(async (worktree: string, _log: unknown, options: { baseSha?: string; force?: boolean }) => {
      observedBaseShas.push(options.baseSha);
      if (!options.force) {
        await writeFile(join(worktree, 'README.md'), 'dirty setup state\n');
        throw new SetupFailureError('setup failed', 'setup failed');
      }
      await completeConductorState(worktree);
    });
    await writeFile(join(subject.root, 'advanced-base.txt'), 'B2\n');
    await commitAll(subject.root, 'advance configured base to B2');

    const outcome = await subject.execute();

    expect(outcome.status).not.toBe('parked');
    expect(observedBaseShas).toEqual([subject.order.baseSha, subject.order.baseSha]);
  });

  it('preserves REKICK and skips the conductor only while the claimed feature is operator-parked', async () => {
    const subject = await fixture('parked-rekick', { durableChildState: false });
    const worktree = join(subject.root, '.worktrees', subject.order.slug);
    await mkdir(join(subject.root, '.worktrees'), { recursive: true });
    await execa('git', ['worktree', 'add', '-b', `feat/daemon-${subject.order.slug}`, worktree, subject.order.baseSha], {
      cwd: subject.root,
    });
    const pipelineDir = join(worktree, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(
      join(pipelineDir, 'conduct-state.json'),
      JSON.stringify({ build: 'pending' }),
    );
    const rekickPath = join(pipelineDir, 'REKICK');
    await writeFile(rekickPath, '');
    seams.prepareWorktree.mockResolvedValue(undefined);
    await writeOperatorPark(subject.root, subject.order.slug);
    const run = vi.spyOn(Conductor.prototype, 'run');
    run.mockResolvedValue(undefined);
    run.mockClear();

    const parked = await subject.execute();

    expect(parked).toMatchObject({ status: 'parked' });
    expect(run).not.toHaveBeenCalled();
    await expect(readFile(rekickPath, 'utf8')).resolves.toBe('');

    await removeOperatorPark(subject.root, subject.order.slug);
    const unparked = await subject.execute();

    expect(unparked.status).not.toBe('parked');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
