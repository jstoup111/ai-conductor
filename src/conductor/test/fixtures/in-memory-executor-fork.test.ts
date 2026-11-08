// Covers: task:5, task:34
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../../src/engine/conductor-event-emitter.js';
import { createChildProcessFeatureExecutor } from '../../src/engine/child-feature-executor.js';
import { createExecutorBroker } from '../../src/engine/executor-broker.js';
import { installDaemonBotCoAuthor, type BotCoAuthorResolver } from '../../src/engine/bot-co-author.js';
import { createProviderAvailability } from '../../src/engine/provider-availability.js';
import { create as createRateLimitEpisode } from '../../src/engine/rate-limit-episode.js';
import { WorktreeLifecycleQueue } from '../../src/engine/worktree.js';
import type { WorkOrder } from '../../src/engine/work-order.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { commitAll, initTestRepo } from './git-repo.js';

const seams = vi.hoisted(() => ({
  prepareWorktree: vi.fn(),
  loadMergedConfig: vi.fn(),
}));

vi.mock('../../src/engine/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/config.js')>();
  return { ...actual, loadMergedConfig: seams.loadMergedConfig };
});

vi.mock('../../src/engine/provider-discovery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/provider-discovery.js')>();
  return { ...actual, discoverInstalledProviders: async () => ({ installed: ['codex'], missing: [] }) };
});

vi.mock('../../src/engine/provider-model-probe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/provider-model-probe.js')>();
  return { ...actual, validateConfiguredProviderModels: async () => {}, resolveProviderModelTiers: async () => {} };
});

vi.mock('../../src/engine/worktree-prepare.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/worktree-prepare.js')>();
  return { ...actual, prepareWorktree: seams.prepareWorktree };
});

import { createInMemoryExecutorFork } from './in-memory-executor-fork.js';
import { useTempEngineStore } from './in-memory-executor-fork.js';
import { runDaemonMode } from '../../src/daemon-cli.js';
import { allInstalledProviderDiscoveryRunner } from '../engine/boot-test-helpers.js';

const VERSION = '20261107T000000Z-0123456789ab' as WorkOrder['engineVersionId'];
const roots: string[] = [];

function order(slug: string, baseSha: string): WorkOrder {
  return {
    schemaVersion: 1,
    repository: 'owner/repository',
    slug,
    baseSha,
    baseBranch: 'main',
    engineVersionId: VERSION,
    manifest: [],
  };
}

async function completeConductorState(worktree: string): Promise<void> {
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(
    join(worktree, '.pipeline', 'conduct-state.json'),
    JSON.stringify(Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']))),
  );
}

async function fixtureOrder(slug: string): Promise<{ root: string; order: WorkOrder }> {
  const root = await mkdtemp(join(tmpdir(), 'in-memory-executor-fork-'));
  roots.push(root);
  await initTestRepo(root);
  await writeFile(join(root, 'README.md'), 'base\n');
  await commitAll(root, 'initial');
  const baseSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  return { root, order: order(slug, baseSha) };
}

function executor(
  root: string,
  fork: ReturnType<typeof createInMemoryExecutorFork>,
  timeout = 50,
  rootEvents = new ConductorEventEmitter(),
) {
  const broker = createExecutorBroker({
    rateLimitEpisode: createRateLimitEpisode(),
    providerAvailability: createProviderAvailability({ now: () => Date.now() }),
    worktreeLifecycle: new WorktreeLifecycleQueue(),
    rootEvents,
    featureLogFor: () => () => {},
  });
  return createChildProcessFeatureExecutor({
    projectRoot: root,
    engineDirForOrder: () => join(root, 'dist-versions', VERSION),
    supervisorEngineVersionId: VERSION,
    rootEvents,
    attachBroker: (slug, port, engineVersionId) => broker.attach(slug, port, engineVersionId),
    fork,
    dispatchStartTimeoutMs: timeout,
    teardownTimeoutMs: 1,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seams.loadMergedConfig.mockResolvedValue({ ok: true as const, config: { llm_provider: 'codex' }, warnings: [] });
});

afterEach(async () => {
  installDaemonBotCoAuthor(undefined);
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('in-memory executor fork', () => {
  it('delivers hello to the real broker, runs the production child runtime, and returns its outcome', async () => {
    const fixture = await fixtureOrder('fixture-conductor');
    seams.prepareWorktree.mockImplementation(async (worktree: string) => completeConductorState(worktree));
    const brokerHellos: string[] = [];
    const completed: string[] = [];
    const rootEvents = new ConductorEventEmitter();
    rootEvents.on('feature_complete', (event) => {
      if (event.type === 'feature_complete' && event.featureDesc !== undefined) completed.push(event.featureDesc);
    });
    const fork = createInMemoryExecutorFork({
      projectRoot: fixture.root,
      onHello: (hello) => { brokerHellos.push(hello.engineVersionId); },
    });

    await expect(executor(fixture.root, fork, 50, rootEvents).execute(fixture.order)).resolves.toMatchObject({
      slug: 'fixture-conductor',
      status: 'halted',
      reason: 'done without a finish-choice marker (expected finishChoice: "pr")',
    });

    expect(brokerHellos).toEqual([VERSION]);
    expect(completed).toEqual(['fixture-conductor']);
    await expect(readFile(join(fixture.root, '.worktrees', fixture.order.slug, '.pipeline', 'work-order.json'), 'utf8'))
      .resolves.toContain('fixture-conductor');
  });

  it('keeps concurrent child console lines separate and preserves the installed co-author resolver', async () => {
    const fixture = await fixtureOrder('first');
    const secondOrder = order('second', fixture.order.baseSha);
    const release = new Map<string, () => void>();
    const entered = new Set<string>();
    seams.prepareWorktree.mockImplementation(async (worktree: string) => {
      const slug = basename(worktree);
      console.warn(`child ${slug}`);
      entered.add(slug);
      await new Promise<void>((resolve) => release.set(slug, resolve));
      await completeConductorState(worktree);
    });
    const resolver: BotCoAuthorResolver = { prepare: async () => ({ kind: 'unconfigured' }), current: () => undefined };
    installDaemonBotCoAuthor(resolver);
    const sinks = new Map<string, string[]>();
    const childExecutor = executor(fixture.root, createInMemoryExecutorFork({
      projectRoot: fixture.root,
      consoleSinks: sinks,
      captureConsole: true,
    }));

    const first = childExecutor.execute(fixture.order);
    await vi.waitFor(() => expect(entered.has('first')).toBe(true));
    const second = childExecutor.execute(secondOrder);
    await vi.waitFor(() => expect(entered).toEqual(new Set(['first', 'second'])));
    release.get('second')?.();
    await second;
    release.get('first')?.();
    await first;

    expect(sinks.get('first')).toContain('child first');
    expect(sinks.get('second')).toContain('child second');
    const { daemonBotCoAuthorResolver } = await import('../../src/engine/bot-co-author.js');
    expect(daemonBotCoAuthorResolver()).toBe(resolver);
  });

  it('returns the startup-handshake error when a silent child sends no hello', async () => {
    const fixture = await fixtureOrder('silent');
    const onHello = vi.fn();

    await expect(executor(fixture.root, createInMemoryExecutorFork({ projectRoot: fixture.root, handshake: 'silent', onHello }), 1).execute(fixture.order))
      .resolves.toEqual({ slug: 'silent', status: 'error', reason: 'executor missing startup handshake' });
    expect(onHello).not.toHaveBeenCalled();
  });

  it('reports the version encoded in the forked module path as the child engine identity', async () => {
    const identities: string[] = [];
    const fixture = await fixtureOrder('engine-identity');
    seams.prepareWorktree.mockImplementation(async (worktree: string) => completeConductorState(worktree));
    const rootEvents = new ConductorEventEmitter();
    rootEvents.on('executor_started', (event) => {
      if (event.type === 'executor_started') identities.push(event.engineVersionId);
    });

    await executor(fixture.root, createInMemoryExecutorFork({ projectRoot: fixture.root }), 50, rootEvents).execute(fixture.order);

    expect(identities).toEqual([VERSION]);
  });

  it('rejects a stale executor-isolation fixture before forking, then dispatches once the key is removed', async () => {
    const fixture = await fixtureOrder('retired-fixture-key');
    await Promise.all([
      mkdir(join(fixture.root, '.docs', 'stories'), { recursive: true }),
      mkdir(join(fixture.root, '.docs', 'plans'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(fixture.root, '.docs', 'stories', `${fixture.order.slug}.md`), '# fixture\n'),
      writeFile(join(fixture.root, '.docs', 'plans', `${fixture.order.slug}.md`), '# fixture\n'),
    ]);
    await commitAll(fixture.root, 'add fixture documents');
    const daemonOrder = { ...fixture.order, baseSha: (await execa('git', ['rev-parse', 'HEAD'], { cwd: fixture.root })).stdout.trim() };
    const store = await useTempEngineStore();
    const fork = vi.fn(createInMemoryExecutorFork({
      projectRoot: fixture.root,
      run: async ({ order }) => ({ slug: order.slug, status: 'done' }),
    }));
    const options = {
      projectRoot: fixture.root,
      engineRoot: store.engineRoot,
      concurrency: 1,
      maxItems: 1,
      baseBranch: 'main',
      ensureFresh: async () => {},
      probeGhVersion: async () => ({ kind: 'ok' as const, version: { major: 2, minor: 73, patch: 0 } }),
      providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
      watch: false,
      workSource: { discover: async () => [{ slug: daemonOrder.slug, baseSha: daemonOrder.baseSha }] },
      executorFork: fork,
    };
    try {
      await mkdir(join(fixture.root, '.ai-conductor'), { recursive: true });
      await writeFile(join(fixture.root, '.ai-conductor', 'config.yml'), 'executor_isolation: in-process\n');
      seams.loadMergedConfig.mockImplementation(async (projectRoot: string) => {
        const config = await readFile(join(projectRoot, '.ai-conductor', 'config.yml'), 'utf8').catch(() => '');
        if (config.includes('executor_isolation:')) {
          return { ok: false as const, error: { type: 'validation_error' as const, message: 'Unknown top-level key: "executor_isolation"' } };
        }
        return { ok: true as const, config: { llm_provider: 'codex' }, warnings: [] };
      });
      await expect(runDaemonMode(options)).rejects.toThrow('Unknown top-level key: "executor_isolation"');
      expect(fork).not.toHaveBeenCalled();

      await rm(join(fixture.root, '.ai-conductor', 'config.yml'));
      await expect(runDaemonMode(options)).resolves.toMatchObject({
        processed: [{ slug: fixture.order.slug, status: 'done' }],
      });
      expect(fork).toHaveBeenCalledOnce();
    } finally {
      await store.teardown();
    }
  });
});
