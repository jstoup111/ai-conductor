// Covers: task:5
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../../src/engine/conductor-event-emitter.js';
import { createChildProcessFeatureExecutor } from '../../src/engine/child-feature-executor.js';
import { createExecutorBroker } from '../../src/engine/executor-broker.js';
import { installDaemonBotCoAuthor, type BotCoAuthorResolver } from '../../src/engine/bot-co-author.js';
import { createProviderAvailability } from '../../src/engine/provider-availability.js';
import { create as createRateLimitEpisode } from '../../src/engine/rate-limit-episode.js';
import { WorktreeLifecycleQueue } from '../../src/engine/worktree.js';
import type { ExecutorChildRunInput } from '../../src/engine/executor-child.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

const seams = vi.hoisted(() => ({
  runtime: undefined as undefined | {
    admitDispatch(order: WorkOrder): Promise<{ kind: 'admitted' }>;
    createWorktree(order: WorkOrder): Promise<{ path: string }>;
    run(input: ExecutorChildRunInput): Promise<{ slug: string; status: 'done' }>;
  },
  runtimeFactory: vi.fn(),
}));

vi.mock('../../src/engine/executor-child-runtime.js', () => ({
  createExecutorChildRuntime: seams.runtimeFactory,
}));

import { createInMemoryExecutorFork } from './in-memory-executor-fork.js';

const VERSION = '20261107T000000Z-0123456789ab' as WorkOrder['engineVersionId'];
const roots: string[] = [];

function order(slug: string): WorkOrder {
  return {
    schemaVersion: 1,
    repository: 'owner/repository',
    slug,
    baseSha: 'a'.repeat(40),
    engineVersionId: VERSION,
    manifest: [],
  };
}

function executor(root: string, fork: ReturnType<typeof createInMemoryExecutorFork>, timeout = 50) {
  const rootEvents = new ConductorEventEmitter();
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
  seams.runtimeFactory.mockImplementation(() => seams.runtime);
});

afterEach(async () => {
  installDaemonBotCoAuthor(undefined);
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('in-memory executor fork', () => {
  it('delivers hello to the real broker, runs the child runtime, and returns its outcome', async () => {
    const root = await mkdtemp(join(tmpdir(), 'in-memory-executor-fork-'));
    roots.push(root);
    const received: ExecutorChildRunInput[] = [];
    seams.runtime = {
      admitDispatch: async () => ({ kind: 'admitted' }),
      createWorktree: async (workOrder) => ({ path: join(root, '.worktrees', workOrder.slug) }),
      run: async (input) => {
        received.push(input);
        return { slug: input.order.slug, status: 'done' };
      },
    };
    const brokerHellos: string[] = [];
    const fork = createInMemoryExecutorFork({ projectRoot: root, onHello: (hello) => brokerHellos.push(hello.engineVersionId) });

    await expect(executor(root, fork).execute(order('fixture-conductor'))).resolves.toEqual({
      slug: 'fixture-conductor', status: 'done',
    });

    expect(brokerHellos).toEqual([VERSION]);
    expect(received).toHaveLength(1);
    expect(received[0]?.order).toMatchObject({ slug: 'fixture-conductor' });
    expect(seams.runtimeFactory).toHaveBeenCalledWith({ projectRoot: root, processServices: 'inherited' });
  });

  it('keeps concurrent child console lines separate and preserves the installed co-author resolver', async () => {
    const root = await mkdtemp(join(tmpdir(), 'in-memory-executor-fork-'));
    roots.push(root);
    const release = new Map<string, () => void>();
    const entered = new Set<string>();
    seams.runtime = {
      admitDispatch: async () => ({ kind: 'admitted' }),
      createWorktree: async (workOrder) => ({ path: join(root, '.worktrees', workOrder.slug) }),
      run: async (input) => {
        console.warn(`child ${input.order.slug}`);
        entered.add(input.order.slug);
        await new Promise<void>((resolve) => release.set(input.order.slug, resolve));
        return { slug: input.order.slug, status: 'done' };
      },
    };
    const resolver: BotCoAuthorResolver = { prepare: async () => ({ kind: 'unconfigured' }), current: () => undefined };
    installDaemonBotCoAuthor(resolver);
    const sinks = new Map<string, string[]>();
    const childExecutor = executor(root, createInMemoryExecutorFork({ projectRoot: root, consoleSinks: sinks }));

    const first = childExecutor.execute(order('first'));
    await vi.waitFor(() => expect(entered.has('first')).toBe(true));
    const second = childExecutor.execute(order('second'));
    await vi.waitFor(() => expect(entered).toEqual(new Set(['first', 'second'])));
    release.get('second')?.();
    await second;
    release.get('first')?.();
    await first;

    expect(sinks.get('first')).toEqual(['child first']);
    expect(sinks.get('second')).toEqual(['child second']);
    const { daemonBotCoAuthorResolver } = await import('../../src/engine/bot-co-author.js');
    expect(daemonBotCoAuthorResolver()).toBe(resolver);
  });

  it('returns the startup-handshake error when a silent child sends no hello', async () => {
    const root = await mkdtemp(join(tmpdir(), 'in-memory-executor-fork-'));
    roots.push(root);
    seams.runtime = {
      admitDispatch: async () => ({ kind: 'admitted' }),
      createWorktree: async (workOrder) => ({ path: join(root, '.worktrees', workOrder.slug) }),
      run: async (input) => ({ slug: input.order.slug, status: 'done' }),
    };
    const onHello = vi.fn();

    await expect(executor(root, createInMemoryExecutorFork({ projectRoot: root, handshake: 'silent', onHello }), 1).execute(order('silent')))
      .resolves.toEqual({ slug: 'silent', status: 'error', reason: 'executor missing startup handshake' });
    expect(onHello).not.toHaveBeenCalled();
  });

  it('reports the version encoded in the forked module path as the child engine identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'in-memory-executor-fork-'));
    roots.push(root);
    const identities: string[] = [];
    seams.runtime = {
      admitDispatch: async () => ({ kind: 'admitted' }),
      createWorktree: async (workOrder) => ({ path: join(root, '.worktrees', workOrder.slug) }),
      run: async (input) => {
        identities.push(input.engineVersionId);
        return { slug: input.order.slug, status: 'done' };
      },
    };

    await executor(root, createInMemoryExecutorFork({ projectRoot: root })).execute(order('engine-identity'));

    expect(identities).toEqual([VERSION]);
  });
});
