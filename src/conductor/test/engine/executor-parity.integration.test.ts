// Covers: task:rem-prd-audit-rem-vg-2
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createChildProcessFeatureExecutor, type ForkedExecutor } from '../../src/engine/child-feature-executor.js';
import { runExecutorChild, withExecutorBrokerProxies, type ExecutorChildRunInput } from '../../src/engine/executor-child.js';
import { createExecutorBroker } from '../../src/engine/executor-broker.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { createInProcessFeatureExecutor, type FeatureExecutionOutcome } from '../../src/engine/feature-executor.js';
import { createEpisodeHaltTracker } from '../../src/engine/episode-halt-tracker.js';
import { recoverEpisodeHalts } from '../../src/engine/daemon-rekick.js';
import { createProviderAvailability } from '../../src/engine/provider-availability.js';
import { create as createRateLimitEpisode, type RateLimitEpisode } from '../../src/engine/rate-limit-episode.js';
import { WorktreeLifecycleQueue } from '../../src/engine/worktree.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ExecutorIpcPort } from '../../src/engine/executor-proxies.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

const VERSION = '20261020T120000Z-aaaaaaaaaaaa' as WorkOrder['engineVersionId'];
const ORDER: WorkOrder = {
  schemaVersion: 1,
  repository: 'owner/repository',
  slug: 'executor-parity-fixture',
  baseSha: 'a'.repeat(40),
  engineVersionId: VERSION,
  manifest: [],
};

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve };
}

/**
 * One in-memory IPC channel with the same directionality as node's fork IPC.
 * The child adapter and broker see a ForkedExecutor; the child entrypoint sees
 * an ExecutorIpcPort. No provider or operating-system child is involved.
 */
class FixtureChild implements ForkedExecutor {
  pid = 4102;
  private readonly supervisorListeners = new Map<'message' | 'disconnect', Array<(value?: unknown) => void>>();
  private readonly childListeners = new Map<'message' | 'disconnect', Array<(value?: unknown) => void>>();
  private exitListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;

  readonly port: ExecutorIpcPort = {
    send: (message) => {
      for (const listener of this.supervisorListeners.get('message') ?? []) listener(message);
      return true;
    },
    on: (event, listener) => {
      const listeners = this.childListeners.get(event) ?? [];
      listeners.push(listener);
      this.childListeners.set(event, listeners);
      return this.port;
    },
    disconnect: () => {
      for (const listener of this.supervisorListeners.get('disconnect') ?? []) listener();
    },
  };

  send(message: unknown): boolean {
    for (const listener of this.childListeners.get('message') ?? []) listener(message);
    return true;
  }

  on(event: 'message' | 'disconnect', listener: (value?: unknown) => void): this {
    const listeners = this.supervisorListeners.get(event) ?? [];
    listeners.push(listener);
    this.supervisorListeners.set(event, listeners);
    return this;
  }

  once(_event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this {
    this.exitListener = listener;
    return this;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.exitListener?.(null, signal);
    return true;
  }

  exit(): void {
    this.exitListener?.(0, null);
  }
}

interface EpisodeFixture {
  episode: RateLimitEpisode;
  deadline: number;
  advanceToDeadline(): void;
}

function episodeFixture(): EpisodeFixture {
  let now = Date.now();
  const deadline = now + 1_000;
  const timers: Array<() => void> = [];
  return {
    episode: createRateLimitEpisode({
      now: () => now,
      rng: () => 0,
      setTimer: (callback) => { timers.push(callback); },
    }),
    deadline,
    advanceToDeadline() {
      now = deadline;
      timers.shift()?.();
    },
  };
}

async function ledgerTypes(root: string): Promise<string[]> {
  const events = (await readFile(join(root, '.worktrees', ORDER.slug, '.pipeline', 'events.jsonl'), 'utf8'))
    .trim().split('\n').map((line) => JSON.parse(line) as { type: string });
  return events.map((event) => event.type).filter((type) => type !== 'executor_started');
}

async function ledgerStepSequence(root: string): Promise<string[]> {
  const events = (await readFile(join(root, '.worktrees', ORDER.slug, '.pipeline', 'events.jsonl'), 'utf8'))
    .trim().split('\n').map((line) => JSON.parse(line) as { type: string; step?: string });
  return events
    .filter((event) => event.type === 'step_started' || event.type === 'step_completed')
    .map((event) => `${event.type}:${event.step}`);
}

async function runInProcess(
  root: string,
  episode: RateLimitEpisode,
  run: (input: Pick<ExecutorChildRunInput, 'events' | 'rateLimitEpisode'> & { worktree: string }) => Promise<FeatureExecutionOutcome>,
): Promise<FeatureExecutionOutcome> {
  const worktree = join(root, '.worktrees', ORDER.slug);
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
  persister.start();
  try {
    return await createInProcessFeatureExecutor({
      run: () => run({ events, rateLimitEpisode: episode, worktree }),
    }).execute(ORDER);
  } finally {
    persister.stop();
  }
}

async function runChildProcess(
  root: string,
  episode: RateLimitEpisode,
  run: (input: Pick<ExecutorChildRunInput, 'events' | 'rateLimitEpisode'> & { worktree: string }) => Promise<FeatureExecutionOutcome>,
): Promise<FeatureExecutionOutcome> {
  const rootEvents = new ConductorEventEmitter();
  const broker = createExecutorBroker({
    rateLimitEpisode: episode,
    providerAvailability: createProviderAvailability({ now: () => 1_000 }),
    worktreeLifecycle: new WorktreeLifecycleQueue(),
    rootEvents,
    featureLogFor: () => () => {},
    now: () => 1_000,
  });
  let child!: FixtureChild;
  const executor = createChildProcessFeatureExecutor({
    projectRoot: root,
    engineDirForOrder: () => join(root, 'engine'),
    supervisorEngineVersionId: VERSION,
    rootEvents,
    attachBroker: (slug, port, engineVersionId) => broker.attach(slug, port, engineVersionId),
    fork: () => {
      child = new FixtureChild();
      queueMicrotask(() => {
        void runExecutorChild(child.port, withExecutorBrokerProxies(child.port, {
          engineVersionId: VERSION,
          createWorktree: async () => ({ path: join(root, '.worktrees', ORDER.slug) }),
          run: async (input) => run({
            events: input.events,
            rateLimitEpisode: input.rateLimitEpisode,
            worktree: join(root, '.worktrees', ORDER.slug),
          }),
          exit: () => child.exit(),
        }));
      });
      return child;
    },
  });
  return executor.execute(ORDER);
}

function completedFixture(input: Pick<ExecutorChildRunInput, 'events' | 'rateLimitEpisode'> & { worktree: string }): Promise<FeatureExecutionOutcome> {
  return (async () => {
    await input.events.emit({ type: 'step_started', step: 'memory', index: 0 });
    await input.events.emit({ type: 'step_completed', step: 'memory', status: 'done' });
    await input.events.emit({ type: 'step_started', step: 'build', index: 1 });
    await input.events.emit({ type: 'step_completed', step: 'build', status: 'done' });
    await input.events.emit({ type: 'feature_complete', featureDesc: ORDER.slug, prUrl: 'https://example.test/pr/fixture' });
    return {
      slug: ORDER.slug,
      status: 'done',
      prUrl: 'https://example.test/pr/fixture',
      terminalEffects: {
        markProcessed: { prUrl: 'https://example.test/pr/fixture' },
        enrollWatch: { prUrl: 'https://example.test/pr/fixture' },
        sweep: true,
      },
    };
  })();
}

describe('executor parity', () => {
  it('keeps ordered steps, ledger types, terminal status, and root-owned effects identical', async () => {
    const inProcessRoot = await mkdtemp(join(tmpdir(), 'executor-parity-in-process-'));
    const childRoot = await mkdtemp(join(tmpdir(), 'executor-parity-child-'));
    roots.push(inProcessRoot, childRoot);

    const inProcess = await runInProcess(inProcessRoot, episodeFixture().episode, completedFixture);
    const child = await runChildProcess(childRoot, episodeFixture().episode, completedFixture);

    expect(await ledgerTypes(childRoot)).toEqual(await ledgerTypes(inProcessRoot));
    expect(await ledgerStepSequence(childRoot)).toEqual(await ledgerStepSequence(inProcessRoot));
    expect(child).toEqual(inProcess);
    expect(await ledgerTypes(childRoot)).toEqual([
      'step_started', 'step_completed', 'step_started', 'step_completed', 'feature_complete',
    ]);
    expect(await ledgerStepSequence(childRoot)).toEqual([
      'step_started:memory', 'step_completed:memory', 'step_started:build', 'step_completed:build',
    ]);
  });

  it('waits on the daemon-wide rate-limit episode in both modes before completing', async () => {
    const inProcessRoot = await mkdtemp(join(tmpdir(), 'executor-parity-in-process-'));
    const childRoot = await mkdtemp(join(tmpdir(), 'executor-parity-child-'));
    roots.push(inProcessRoot, childRoot);
    const inProcessEpisode = episodeFixture();
    const childEpisode = episodeFixture();
    const inProcessWaiting = deferred();
    const childWaiting = deferred();
    const rateLimited = (waiting: Deferred<void>, deadline: number) => async (input: Pick<ExecutorChildRunInput, 'events' | 'rateLimitEpisode'> & { worktree: string }): Promise<FeatureExecutionOutcome> => {
      await input.events.emit({ type: 'step_started', step: 'build', index: 0 });
      input.rateLimitEpisode.enter(deadline);
      await Promise.resolve();
      await input.events.emit({ type: 'rate_limit', waitSeconds: 1 });
      waiting.resolve();
      await input.rateLimitEpisode.clear();
      await input.events.emit({ type: 'step_completed', step: 'build', status: 'done' });
      return { slug: ORDER.slug, status: 'done', terminalEffects: { sweep: true } };
    };

    const inProcessRun = runInProcess(inProcessRoot, inProcessEpisode.episode, rateLimited(inProcessWaiting, inProcessEpisode.deadline));
    await inProcessWaiting.promise;
    inProcessEpisode.advanceToDeadline();
    const childRun = runChildProcess(childRoot, childEpisode.episode, rateLimited(childWaiting, childEpisode.deadline));
    await childWaiting.promise;
    childEpisode.advanceToDeadline();

    await expect(inProcessRun).resolves.toEqual(await childRun);
    expect(await ledgerTypes(childRoot)).toEqual(await ledgerTypes(inProcessRoot));
    expect(await ledgerTypes(childRoot)).toEqual(['step_started', 'rate_limit', 'step_completed']);
  });

  it('stamps a halt during a rate-limit episode in either mode and recovers it at episode end', async () => {
    const inProcessRoot = await mkdtemp(join(tmpdir(), 'executor-parity-in-process-'));
    const childRoot = await mkdtemp(join(tmpdir(), 'executor-parity-child-'));
    roots.push(inProcessRoot, childRoot);

    const haltDuringEpisode = (tracker: ReturnType<typeof createEpisodeHaltTracker>, deadline: number) => async (input: Pick<ExecutorChildRunInput, 'events' | 'rateLimitEpisode'> & { worktree: string }): Promise<FeatureExecutionOutcome> => {
      await input.events.emit({ type: 'step_started', step: 'build', index: 0 });
      input.rateLimitEpisode.enter(deadline);
      await Promise.resolve();
      await writeFile(join(input.worktree, '.pipeline', 'HALT'), 'episode-caused halt\n');
      tracker.onHaltWritten(ORDER.slug, input.rateLimitEpisode.active());
      await input.events.emit({ type: 'rate_limit', waitSeconds: 1 });
      return { slug: ORDER.slug, status: 'halted', terminalEffects: { sweep: true } };
    };
    const inProcessEpisode = episodeFixture();
    const childEpisode = episodeFixture();
    const inProcessTracker = createEpisodeHaltTracker();
    const childTracker = createEpisodeHaltTracker();

    const inProcess = await runInProcess(inProcessRoot, inProcessEpisode.episode, haltDuringEpisode(inProcessTracker, inProcessEpisode.deadline));
    const child = await runChildProcess(childRoot, childEpisode.episode, haltDuringEpisode(childTracker, childEpisode.deadline));

    expect(child).toEqual(inProcess);
    expect(await ledgerTypes(childRoot)).toEqual(await ledgerTypes(inProcessRoot));
    for (const fixture of [
      { root: inProcessRoot, tracker: inProcessTracker, episode: inProcessEpisode },
      { root: childRoot, tracker: childTracker, episode: childEpisode },
    ]) {
      const halt = join(fixture.root, '.worktrees', ORDER.slug, '.pipeline', 'HALT');
      expect(await fixture.tracker.getEpisodeHalts(async () => true)).toEqual([ORDER.slug]);
      fixture.episode.advanceToDeadline();
      await fixture.episode.episode.clear();
      await expect(recoverEpisodeHalts({
        stampedHalts: () => fixture.tracker.getEpisodeHalts(async () => true),
        readHaltClass: async () => 'mechanical',
        clearMarker: async () => rm(halt),
      })).resolves.toEqual([ORDER.slug]);
      await expect(readFile(halt, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
});
