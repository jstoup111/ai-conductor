// Covers: task:32
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createChildProcessFeatureExecutor, type ForkedExecutor } from '../../src/engine/child-feature-executor.js';
import {
  runExecutorChild,
  withExecutorBrokerProxies,
  type ExecutorChildRunInput,
} from '../../src/engine/executor-child.js';
import { createExecutorBroker } from '../../src/engine/executor-broker.js';
import type { FeatureExecutionOutcome } from '../../src/engine/feature-executor.js';
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
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve,
  };
}

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
      this.childListeners.set(event, [...(this.childListeners.get(event) ?? []), listener]);
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
    this.supervisorListeners.set(event, [...(this.supervisorListeners.get(event) ?? []), listener]);
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
      setTimer: (callback) => {
        timers.push(callback);
      },
    }),
    deadline,
    advanceToDeadline() {
      now = deadline;
      timers.shift()?.();
    },
  };
}

async function ledger(root: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(join(root, '.worktrees', ORDER.slug, '.pipeline', 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.type !== 'executor_started')
    .map(({ ts: _ts, activeInterval: _activeInterval, ...event }) => event);
}

async function runChildProcess(
  root: string,
  episode: RateLimitEpisode,
  run: (
    input: Pick<ExecutorChildRunInput, 'events' | 'rateLimitEpisode'> & { worktree: string },
  ) => Promise<FeatureExecutionOutcome>,
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
        void runExecutorChild(
          child.port,
          withExecutorBrokerProxies(child.port, {
            engineVersionId: VERSION,
            createWorktree: async () => ({ path: join(root, '.worktrees', ORDER.slug) }),
            run: async (input) =>
              run({
                events: input.events,
                rateLimitEpisode: input.rateLimitEpisode,
                worktree: join(root, '.worktrees', ORDER.slug),
              }),
            exit: () => child.exit(),
          }),
        );
      });
      return child;
    },
  });
  return executor.execute(ORDER);
}

describe('child executor lifecycle with literal clean, rate-limited, and halted outcomes plus a type-only feature-executor import', () => {
  // FeatureExecutionOutcome is imported above with `import type`; these child
  // cases use only literal expectations for their ledger and terminal values.
  it('records ordered clean-run steps, ledger events, outcome, and terminal effects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'executor-child-'));
    roots.push(root);
    const outcome = await runChildProcess(root, episodeFixture().episode, async ({ events }) => {
      await events.emit({ type: 'step_started', step: 'memory', index: 0 });
      await events.emit({ type: 'step_completed', step: 'memory', status: 'done' });
      await events.emit({ type: 'step_started', step: 'build', index: 1 });
      await events.emit({ type: 'step_completed', step: 'build', status: 'done' });
      await events.emit({
        type: 'feature_complete',
        featureDesc: ORDER.slug,
        prUrl: 'https://example.test/pr/fixture',
      });
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
    });
    expect(await ledger(root)).toEqual([
      { type: 'step_started', step: 'memory', index: 0 },
      { type: 'step_completed', step: 'memory', status: 'done' },
      { type: 'step_started', step: 'build', index: 1 },
      { type: 'step_completed', step: 'build', status: 'done' },
      { type: 'feature_complete', featureDesc: ORDER.slug, prUrl: 'https://example.test/pr/fixture' },
    ]);
    expect(outcome).toMatchObject({
      status: 'done',
      terminalEffects: {
        markProcessed: { prUrl: 'https://example.test/pr/fixture' },
        enrollWatch: { prUrl: 'https://example.test/pr/fixture' },
        sweep: true,
      },
    });
  });

  it('waits on the daemon-wide rate-limit episode before completing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'executor-child-'));
    roots.push(root);
    const episode = episodeFixture();
    const waiting = deferred();
    const run = runChildProcess(root, episode.episode, async ({ events, rateLimitEpisode }) => {
      await events.emit({ type: 'step_started', step: 'build', index: 0 });
      rateLimitEpisode.enter(episode.deadline);
      await Promise.resolve();
      await events.emit({ type: 'rate_limit', waitSeconds: 1 });
      waiting.resolve();
      await rateLimitEpisode.clear();
      await events.emit({ type: 'step_completed', step: 'build', status: 'done' });
      return { slug: ORDER.slug, status: 'done', terminalEffects: { sweep: true } };
    });
    await waiting.promise;
    episode.advanceToDeadline();
    await expect(run).resolves.toMatchObject({ status: 'done', terminalEffects: { sweep: true } });
    expect((await ledger(root)).map((event) => event.type)).toEqual(['step_started', 'rate_limit', 'step_completed']);
  });

  it('recovers an episode-caused halt after the shared rate-limit episode ends', async () => {
    const root = await mkdtemp(join(tmpdir(), 'executor-child-'));
    roots.push(root);
    const episode = episodeFixture();
    const tracker = createEpisodeHaltTracker();
    const reason = 'episode-caused halt';
    const outcome = await runChildProcess(root, episode.episode, async ({ events, rateLimitEpisode, worktree }) => {
      await events.emit({ type: 'step_started', step: 'build', index: 0 });
      rateLimitEpisode.enter(episode.deadline);
      await Promise.resolve();
      await writeFile(join(worktree, '.pipeline', 'HALT'), `${reason}\n`);
      tracker.onHaltWritten(ORDER.slug, rateLimitEpisode.active());
      await events.emit({ type: 'rate_limit', waitSeconds: 1 });
      return { slug: ORDER.slug, status: 'halted', terminalEffects: { sweep: true } };
    });
    const halt = join(root, '.worktrees', ORDER.slug, '.pipeline', 'HALT');
    expect(outcome.status).toBe('halted');
    expect(await tracker.getEpisodeHalts(async () => true)).toEqual([ORDER.slug]);
    episode.advanceToDeadline();
    await episode.episode.clear();
    await expect(
      recoverEpisodeHalts({
        stampedHalts: () => tracker.getEpisodeHalts(async () => true),
        readHaltClass: async () => 'mechanical',
        clearMarker: async () => rm(halt),
      }),
    ).resolves.toEqual([ORDER.slug]);
    await expect(readFile(halt, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a gate halt marker, ledger events, and terminal effects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'executor-child-'));
    roots.push(root);
    const reason = 'build_review gate requires operator remediation';
    const outcome = await runChildProcess(root, episodeFixture().episode, async ({ events, worktree }) => {
      await events.emit({ type: 'step_started', step: 'build_review', index: 0 });
      await events.emit({ type: 'loop_halt', step: 'build_review', reason, tier: 'S' });
      await writeFile(join(worktree, '.pipeline', 'HALT'), `${reason}\n`);
      return {
        slug: ORDER.slug,
        status: 'halted',
        reason,
        terminalEffects: {
          engineerSignal: {
            outcome: { slug: ORDER.slug, status: 'halted', reason },
            eventsContent: 'captured before teardown\n',
          },
          sweep: true,
        },
      };
    });
    await expect(readFile(join(root, '.worktrees', ORDER.slug, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
      `${reason}\n`,
    );
    expect(await ledger(root)).toEqual([
      { type: 'step_started', step: 'build_review', index: 0 },
      { type: 'loop_halt', step: 'build_review', reason, tier: 'S' },
    ]);
    expect(outcome).toMatchObject({
      status: 'halted',
      terminalEffects: { engineerSignal: { outcome: { status: 'halted', reason } }, sweep: true },
    });
  });
});
