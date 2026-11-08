// Covers: task:28
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

const seams = vi.hoisted(() => ({ abortAll: vi.fn(), nodeFork: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  fork: seams.nodeFork,
}));

vi.mock('../../src/engine/executor-broker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/executor-broker.js')>();
  return {
    ...actual,
    createExecutorBroker: (...args: Parameters<typeof actual.createExecutorBroker>) => {
      const broker = actual.createExecutorBroker(...args);
      const abortAll = broker.abortAll.bind(broker);
      broker.abortAll = () => {
        seams.abortAll();
        abortAll();
      };
      return broker;
    },
  };
});

import { runDaemonMode } from '../../src/daemon-cli.js';
import { allInstalledProviderDiscoveryRunner } from './boot-test-helpers.js';
import { createInMemoryExecutorFork, useTempEngineStore } from '../fixtures/in-memory-executor-fork.js';
import { commitAll, initTestRepo } from '../fixtures/git-repo.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  seams.abortAll.mockReset();
  seams.nodeFork.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(): Promise<{ root: string; baseSha: string }> {
  const root = await mkdtemp(join(tmpdir(), 'daemon-child-dispatch-'));
  roots.push(root);
  await initTestRepo(root);
  await Promise.all([
    mkdir(join(root, '.docs', 'stories'), { recursive: true }),
    mkdir(join(root, '.docs', 'plans'), { recursive: true }),
  ]);
  await writeFile(join(root, 'README.md'), 'base\n');
  await Promise.all(['feature', 'first', 'second'].flatMap((slug) => [
    writeFile(join(root, '.docs', 'stories', `${slug}.md`), `# ${slug}\n`),
    writeFile(join(root, '.docs', 'plans', `${slug}.md`), `# ${slug}\n`),
  ]));
  await commitAll(root, 'initial');
  const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: root });
  return { root, baseSha: baseSha.trim() };
}

function daemonOptions(
  projectRoot: string,
  engineRoot: { conductorRoot: string; ownEngineDir: string },
  workSource: { discover: () => Promise<Array<{ slug: string; baseSha: string }>> },
  executorFork?: NonNullable<Parameters<typeof runDaemonMode>[0]['executorFork']>,
  maxItems = 1,
) {
  return {
    projectRoot,
    concurrency: 2,
    maxItems,
    baseBranch: 'main',
    engineRoot,
    ensureFresh: async () => {},
    probeGhVersion: async () => ({ kind: 'ok' as const, version: { major: 2, minor: 73, patch: 0 } }),
    providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
    workSource,
    watch: false,
    ...(executorFork === undefined ? {} : { executorFork }),
    exitProcess: () => {},
  };
}

describe('daemon child dispatch composition', () => {
  it('dispatches a claimed feature through one pinned child and records its executor start', async () => {
    const { root, baseSha } = await project();
    const store = await useTempEngineStore();
    const workOrders: unknown[] = [];
    const executorFork = vi.fn(createInMemoryExecutorFork({
      projectRoot: root,
      onSupervisorMessage: (message) => {
        if ((message as { kind?: string }).kind === 'work-order') workOrders.push(message);
      },
    }));

    try {
      const daemon = runDaemonMode(daemonOptions(
        root,
        store.engineRoot,
        { discover: async () => [{ slug: 'feature', baseSha }] },
        executorFork,
      ));
      await vi.waitFor(() => expect(workOrders).toHaveLength(1));
      const eventsPath = join(root, '.worktrees', 'feature', '.pipeline', 'events.jsonl');
      await vi.waitFor(async () => {
        const events = await readFile(eventsPath, 'utf8');
        expect(events).toContain('"type":"executor_started"');
      });
      process.emit('SIGTERM');
      await daemon;

      const order = (workOrders[0] as { order: { engineVersionId: string } }).order;
      expect(executorFork).toHaveBeenCalledOnce();
      expect(order.engineVersionId).toBe('20261107T000000Z-0123456789ab');
      const events = await readFile(eventsPath, 'utf8');
      expect(events.split('\n').filter(Boolean).map((line) => JSON.parse(line))).toContainEqual(
        expect.objectContaining({
          type: 'executor_started',
          engineVersionId: '20261107T000000Z-0123456789ab',
        }),
      );
    } finally {
      await store.teardown();
    }
  });

  it('does not log an executor-isolation mode or disabled pinning', async () => {
    const { root } = await project();
    const store = await useTempEngineStore();
    try {
      await mkdir(join(root, '.ai-conductor'), { recursive: true });
      await writeFile(join(root, '.ai-conductor', 'config.yml'), 'executor_isolation: in-process\n');
      await runDaemonMode(daemonOptions(root, store.engineRoot, { discover: async () => [] }, createInMemoryExecutorFork({ projectRoot: root })));
      const startupLog = await readFile(join(root, '.daemon', 'daemon.log'), 'utf8');
      expect(startupLog).not.toMatch(/executor isolation|per-dispatch engine pinning is disabled/);
    } finally {
      await store.teardown();
    }
  });

  it('uses Node fork with the WorkOrder-pinned engine directory when no fork is injected', async () => {
    const { root, baseSha } = await project();
    const store = await useTempEngineStore();
    const workOrders: unknown[] = [];
    seams.nodeFork.mockImplementation(createInMemoryExecutorFork({
      projectRoot: root,
      onSupervisorMessage: (message) => {
        if ((message as { kind?: string }).kind === 'work-order') workOrders.push(message);
      },
    }));

    try {
      const daemon = runDaemonMode(daemonOptions(
        root,
        store.engineRoot,
        { discover: async () => [{ slug: 'feature', baseSha }] },
      ));
      await vi.waitFor(() => expect(workOrders).toHaveLength(1));
      process.emit('SIGTERM');
      await daemon;

      expect(seams.nodeFork).toHaveBeenCalledWith(
        join(store.engineRoot.ownEngineDir, 'index.js'),
        ['executor-child'],
        { silent: true },
      );
    } finally {
      await store.teardown();
    }
  });

  it('stops every child and aborts broker coordination before SIGTERM resolves', async () => {
    const { root, baseSha } = await project();
    const store = await useTempEngineStore();
    await mkdir(join(root, '.ai-conductor'), { recursive: true });
    await writeFile(join(root, '.ai-conductor', 'config.yml'), 'daemon_concurrency: 2\nteardown_timeout_seconds: 1\n');
    const stops: string[] = [];
    const executorFork = vi.fn(createInMemoryExecutorFork({
      projectRoot: root,
      handshake: 'silent',
      onSupervisorMessage: (message) => {
        const candidate = message as { kind?: string };
        if (candidate.kind === 'stop') stops.push(candidate.kind);
      },
    }));

    try {
      const daemon = runDaemonMode(daemonOptions(
        root,
        store.engineRoot,
        { discover: async () => [{ slug: 'first', baseSha }, { slug: 'second', baseSha }] },
        executorFork,
        2,
      ));
      await vi.waitFor(() => expect(executorFork).toHaveBeenCalledTimes(2));
      process.emit('SIGTERM');
      await daemon;

      expect(stops).toEqual(['stop', 'stop']);
      expect(seams.abortAll).toHaveBeenCalledOnce();
    } finally {
      await store.teardown();
    }
  });
});
