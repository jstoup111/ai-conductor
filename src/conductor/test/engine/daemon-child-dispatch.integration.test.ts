// Covers: task:3, task:28, task:29, task:33, task:36
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

const seams = vi.hoisted(() => ({
  abortAll: vi.fn(),
  nodeFork: vi.fn(),
  featureBusEvents: new Map<string, string[]>(),
  visualizerEvents: new Map<string, string[]>(),
  visualizerStops: new Map<string, number>(),
}));

// The daemon loop checks its build credential before dispatch. These tests own
// dispatch wiring, so they supply a deterministic credential boundary rather
// than depending on a developer or CI host token.
vi.mock('../../src/engine/self-host/daemon-build-token.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/self-host/daemon-build-token.js')>()),
  readDaemonBuildToken: async () => ({ state: 'ok' as const, token: 'test-daemon-token' }),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
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

vi.mock('../../src/engine/otel/wire.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/otel/wire.js')>();
  return {
    ...actual,
    wireOtelVisualizer: vi.fn((_config, context, events) => {
      const slug = context.feature;
      if (slug === undefined) return null;
      const eventTypes = ['step_interrupted', 'loop_halt', 'feature_complete'] as const;
      for (const type of eventTypes) {
        events.on(type, (event) => {
          const seen = seams.featureBusEvents.get(slug) ?? [];
          seen.push(event.type);
          seams.featureBusEvents.set(slug, seen);
        });
        events.on(type, (event) => {
          const seen = seams.visualizerEvents.get(slug) ?? [];
          seen.push(event.type);
          seams.visualizerEvents.set(slug, seen);
        });
      }
      let stopped: Promise<void> | undefined;
      return {
        name: `recording-otel-${slug}`,
        start: () => {},
        stop: () =>
          (stopped ??= Promise.resolve().then(() => {
            seams.visualizerStops.set(slug, (seams.visualizerStops.get(slug) ?? 0) + 1);
          })),
      };
    }),
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
  seams.featureBusEvents.clear();
  seams.visualizerEvents.clear();
  seams.visualizerStops.clear();
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
  await Promise.all(
    ['feature', 'first', 'second', 'feature-a', 'feature-b'].flatMap((slug) => [
      writeFile(join(root, '.docs', 'stories', `${slug}.md`), `# ${slug}\n`),
      writeFile(join(root, '.docs', 'plans', `${slug}.md`), `# ${slug}\n`),
    ]),
  );
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
    const executorFork = vi.fn(
      createInMemoryExecutorFork({
        projectRoot: root,
        onSupervisorMessage: (message) => {
          if ((message as { kind?: string }).kind === 'work-order') workOrders.push(message);
        },
      }),
    );

    try {
      const daemon = runDaemonMode(
        daemonOptions(root, store.engineRoot, { discover: async () => [{ slug: 'feature', baseSha }] }, executorFork),
      );
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
      expect(
        events
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      ).toContainEqual(
        expect.objectContaining({
          type: 'executor_started',
          engineVersionId: '20261107T000000Z-0123456789ab',
        }),
      );
    } finally {
      await store.teardown();
    }
  });

  it('rejects the retired executor-isolation key before it can claim or fork', async () => {
    const { root } = await project();
    const store = await useTempEngineStore();
    const executorFork = vi.fn(createInMemoryExecutorFork({ projectRoot: root }));
    try {
      await mkdir(join(root, '.ai-conductor'), { recursive: true });
      await writeFile(join(root, '.ai-conductor', 'config.yml'), 'executor_isolation: in-process\n');
      await expect(
        runDaemonMode(daemonOptions(root, store.engineRoot, { discover: async () => [] }, executorFork)),
      ).rejects.toThrow('Unknown top-level key: "executor_isolation"');
      expect(executorFork).not.toHaveBeenCalled();
    } finally {
      await store.teardown();
    }
  });

  it('uses Node fork with the WorkOrder-pinned engine directory when no fork is injected', async () => {
    const { root, baseSha } = await project();
    const store = await useTempEngineStore();
    const workOrders: unknown[] = [];
    seams.nodeFork.mockImplementation(
      createInMemoryExecutorFork({
        projectRoot: root,
        onSupervisorMessage: (message) => {
          if ((message as { kind?: string }).kind === 'work-order') workOrders.push(message);
        },
      }),
    );

    try {
      const daemon = runDaemonMode(
        daemonOptions(root, store.engineRoot, { discover: async () => [{ slug: 'feature', baseSha }] }),
      );
      await vi.waitFor(() => expect(workOrders).toHaveLength(1));
      process.emit('SIGTERM');
      await daemon;

      expect(seams.nodeFork).toHaveBeenCalledWith(join(store.engineRoot.ownEngineDir, 'index.js'), ['executor-child'], {
        silent: true,
      });
    } finally {
      await store.teardown();
    }
  });

  it('ends a silent child dispatch without relaunching or running a feature step', async () => {
    const { root, baseSha } = await project();
    const store = await useTempEngineStore();
    const supervisorMessages: unknown[] = [];
    const featureSteps: string[] = [];
    const executorFork = vi.fn(
      createInMemoryExecutorFork({
        projectRoot: root,
        handshake: 'silent',
        onSupervisorMessage: (message) => supervisorMessages.push(message),
        run: async ({ order }) => {
          featureSteps.push(order.slug);
          return { slug: order.slug, status: 'done' };
        },
      }),
    );

    try {
      await mkdir(join(root, '.ai-conductor'), { recursive: true });
      await writeFile(join(root, '.ai-conductor', 'config.yml'), 'dispatch_start_timeout_seconds: 0.01\n');

      const result = await runDaemonMode(
        daemonOptions(root, store.engineRoot, { discover: async () => [{ slug: 'feature', baseSha }] }, executorFork),
      );

      expect(result).toMatchObject({
        stoppedReason: 'max_items',
        processed: [{ slug: 'feature', status: 'error', reason: 'executor missing startup handshake' }],
      });
      expect(executorFork).toHaveBeenCalledOnce();
      expect(supervisorMessages.filter((message) => (message as { kind?: string }).kind === 'work-order')).toEqual([]);
      expect(featureSteps).toEqual([]);
    } finally {
      await store.teardown();
    }
  });

  it('terminates a protocol-mismatched child before relaunching with the supervisor engine', async () => {
    const { root, baseSha } = await project();
    const store = await useTempEngineStore();
    const childKills: NodeJS.Signals[] = [];
    const featureSteps: string[] = [];
    const executorFork = vi.fn(
      createInMemoryExecutorFork({
        projectRoot: root,
        protocolVersions: [2, 1],
        onChildKill: (signal) => childKills.push(signal),
        run: async ({ order }) => {
          featureSteps.push(order.slug);
          return { slug: order.slug, status: 'done' };
        },
      }),
    );

    try {
      const daemon = runDaemonMode(
        daemonOptions(root, store.engineRoot, { discover: async () => [{ slug: 'feature', baseSha }] }, executorFork),
      );

      await vi.waitFor(() => expect(executorFork).toHaveBeenCalledTimes(2));
      expect(childKills).toEqual(['SIGTERM']);
      expect(executorFork).toHaveBeenNthCalledWith(
        2,
        join(store.engineRoot.ownEngineDir, 'index.js'),
        ['executor-child'],
        { silent: true },
      );
      await vi.waitFor(() => expect(featureSteps).toEqual(['feature']));
      process.emit('SIGTERM');
      await daemon;
    } finally {
      await store.teardown();
    }
  });

  it('forwards each stopping child closing sequence to its supervisor feature bus and OTel visualizer', async () => {
    const { root, baseSha } = await project();
    const store = await useTempEngineStore();
    await mkdir(join(root, '.ai-conductor'), { recursive: true });
    await writeFile(
      join(root, '.ai-conductor', 'config.yml'),
      'daemon_concurrency: 2\nteardown_timeout_seconds: 1\notel:\n  exporter: file\n',
    );
    const stops: string[] = [];
    const entered = new Set<string>();
    const stopped = new Set<string>();
    const executorFork = vi.fn(
      createInMemoryExecutorFork({
        projectRoot: root,
        onSupervisorMessage: (message) => {
          const candidate = message as { kind?: string };
          if (candidate.kind === 'stop') stops.push(candidate.kind);
        },
        run: async ({ order, events, signal }) => {
          entered.add(order.slug);
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
          stopped.add(order.slug);
          await events.emit({ type: 'step_interrupted', step: 'build', reason: `shutdown ${order.slug}` });
          await events.emit({ type: 'loop_halt', reason: `shutdown ${order.slug}` });
          await events.emit({ type: 'feature_complete', featureDesc: order.slug });
          return { slug: order.slug, status: 'done' };
        },
      }),
    );

    try {
      const daemon = runDaemonMode(
        daemonOptions(
          root,
          store.engineRoot,
          {
            discover: async () => [
              { slug: 'first', baseSha },
              { slug: 'second', baseSha },
            ],
          },
          executorFork,
          2,
        ),
      );
      await vi.waitFor(() => expect(executorFork).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(entered).toEqual(new Set(['first', 'second'])));
      process.emit('SIGTERM');
      await daemon;

      expect(stops.length).toBeGreaterThanOrEqual(2);
      expect(stopped).toEqual(new Set(['first', 'second']));
      expect(seams.abortAll).toHaveBeenCalledOnce();
      const closingSequence = ['step_interrupted', 'loop_halt', 'feature_complete'];
      for (const slug of ['first', 'second']) {
        expect(seams.featureBusEvents.get(slug)).toEqual(closingSequence);
        expect(seams.visualizerEvents.get(slug)).toEqual(closingSequence);
        expect(seams.visualizerStops.get(slug)).toBe(1);
      }
    } finally {
      await store.teardown();
    }
  });

  it('tags every concurrent child log only with its own slug while leaving supervisor warnings untagged', async () => {
    const { root, baseSha } = await project();
    const store = await useTempEngineStore();
    const entered = new Set<string>();
    const release: Array<() => void> = [];
    const childConsoleSinks = new Map<string, string[]>();
    const executorFork = createInMemoryExecutorFork({
      projectRoot: root,
      consoleSinks: childConsoleSinks,
      captureConsole: true,
      run: async ({ order, log }) => {
        log?.(`feature log ${order.slug}`);
        console.warn(`child warning ${order.slug}`);
        entered.add(order.slug);
        await new Promise<void>((resolve) => release.push(resolve));
        return { slug: order.slug, status: 'done' };
      },
    });

    try {
      await mkdir(join(root, '.ai-conductor'), { recursive: true });
      await writeFile(join(root, '.ai-conductor', 'config.yml'), 'daemon_concurrency: 2\n');
      const daemon = runDaemonMode(
        daemonOptions(
          root,
          store.engineRoot,
          {
            discover: async () => [
              { slug: 'feature-a', baseSha },
              { slug: 'feature-b', baseSha },
            ],
          },
          executorFork,
          2,
        ),
      );
      await vi.waitFor(() => expect(entered).toEqual(new Set(['feature-a', 'feature-b'])));
      console.warn('supervisor warning during child dispatch');
      release.splice(0).forEach((resolve) => resolve());
      await daemon;

      const daemonLog = await readFile(join(root, '.daemon', 'daemon.log'), 'utf8');
      for (const [slug, otherSlug] of [
        ['feature-a', 'feature-b'],
        ['feature-b', 'feature-a'],
      ] as const) {
        expect(childConsoleSinks.get(slug)).toContain(`child warning ${slug}`);
        for (const message of [`[executor:info] feature log ${slug}`, `[executor:warn] child warning ${slug}`]) {
          const lines = daemonLog.split('\n').filter((candidate) => candidate.includes(message));
          expect(lines).toHaveLength(1);
          expect(lines[0]).toContain(`[daemon][${slug}] ${message}`);
          expect(lines[0]).not.toContain(`[${otherSlug}]`);
        }
      }
      const supervisorWarning = daemonLog
        .split('\n')
        .find((candidate) => candidate.includes('supervisor warning during child dispatch'));
      expect(supervisorWarning).toContain('[daemon] [warn] supervisor warning during child dispatch');
      expect(supervisorWarning).not.toMatch(/\[daemon\]\[[^\]]+\]/);
    } finally {
      release.splice(0).forEach((resolve) => resolve());
      await store.teardown();
    }
  });
});
