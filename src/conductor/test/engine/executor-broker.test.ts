// Covers: task:8, task:9, task:10, task:11
import { describe, expect, it } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { create as createRateLimitEpisode } from '../../src/engine/rate-limit-episode.js';
import { createProviderAvailability } from '../../src/engine/provider-availability.js';
import { WorktreeLifecycleQueue } from '../../src/engine/worktree.js';
import { createExecutorBroker } from '../../src/engine/executor-broker.js';
import { LiveBoundaryCoordinator } from '../../src/engine/self-host/live-boundary-coordinator.js';
import {
  createExecutorRequestClient,
  createLiveBoundaryProxy,
  createProviderAvailabilityProxy,
  createRateLimitEpisodeProxy,
  createWorktreeLifecycleProxy,
  type ExecutorIpcPort,
} from '../../src/engine/executor-proxies.js';

class Port implements ExecutorIpcPort {
  peer?: Port;
  private readonly handlers = new Map<'message' | 'disconnect', Set<(value?: unknown) => void>>();
  private readonly inbox: unknown[] = [];
  send(message: unknown): boolean { this.peer?.inbox.push(message); return true; }
  on(event: 'message' | 'disconnect', listener: (value?: unknown) => void): void {
    const set = this.handlers.get(event) ?? new Set(); set.add(listener); this.handlers.set(event, set);
  }
  emit(event: 'message' | 'disconnect', value?: unknown): void { for (const handler of this.handlers.get(event) ?? []) handler(value); }
  deliver(): boolean {
    const messages = this.inbox.splice(0);
    for (const message of messages) this.emit('message', message);
    return messages.length > 0;
  }
}

function pair(): { supervisor: Port; child: Port; flush(): void } {
  const supervisor = new Port();
  const child = new Port();
  supervisor.peer = child;
  child.peer = supervisor;
  return {
    supervisor,
    child,
    flush() {
      while (supervisor.deliver() || child.deliver()) {
        // Request handlers may synchronously queue a response for the peer.
      }
    },
  };
}

async function flushAsync(channel: ReturnType<typeof pair>): Promise<void> {
  // Requests that await a coordinator re-enter the fake channel on a later
  // microtask. Advance only microtasks and the explicit in-memory transport;
  // no timer or real process is involved.
  for (let i = 0; i < 5; i += 1) {
    channel.flush();
    await Promise.resolve();
  }
  channel.flush();
}

function brokerFixture() {
  let now = 1_000;
  const timers: Array<() => void> = [];
  const episode = createRateLimitEpisode({
    now: () => now,
    rng: () => 0,
    setTimer: (callback) => { timers.push(callback); },
  });
  const broker = createExecutorBroker({
    rateLimitEpisode: episode,
    providerAvailability: createProviderAvailability({ now: () => now }),
    worktreeLifecycle: new WorktreeLifecycleQueue(), rootEvents: new ConductorEventEmitter(), featureLogFor: () => () => {}, now: () => now,
  });
  return {
    broker,
    episode,
    now: (value: number) => { now = value; },
    fireNextTimer: () => timers.shift()?.(),
  };
}

describe('executor broker', () => {
  it('replays authoritative state after hello for the production attach ordering', () => {
    const fixture = brokerFixture();
    fixture.episode.enter(2_000);
    const channel = pair();
    // attach occurs at fork, before child composition registers a subscriber.
    fixture.broker.attach('late', channel.supervisor);
    channel.flush();
    const proxy = createRateLimitEpisodeProxy(createExecutorRequestClient(channel.child), () => 1_000);
    channel.child.send({ kind: 'hello', protocolVersion: 1, engineVersionId: '20261019T120000Z-aaaaaaaaaaaa' });
    channel.flush();
    expect(proxy.active()).toBe(true);
  });

  it('replicates the one supervisor rate-limit episode to child synchronous views', async () => {
    const fixture = brokerFixture();
    const a = pair();
    const b = pair();
    const proxyA = createRateLimitEpisodeProxy(createExecutorRequestClient(a.child), () => 1_000);
    const proxyB = createRateLimitEpisodeProxy(createExecutorRequestClient(b.child), () => 1_000);
    fixture.broker.attach('a', a.supervisor);
    fixture.broker.attach('b', b.supervisor);
    a.flush();
    b.flush();

    // A newly accepted executor causes every child to refresh from the
    // supervisor episode, including a state change made on the supervisor.
    fixture.episode.enter(1_500);
    const c = pair();
    const proxyC = createRateLimitEpisodeProxy(createExecutorRequestClient(c.child), () => 1_000);
    fixture.broker.attach('c', c.supervisor);
    a.flush();
    b.flush();
    c.flush();
    expect(proxyB.active()).toBe(true);
    expect(proxyC.active()).toBe(true);

    proxyA.enter(2_000);
    a.flush();
    b.flush();

    // This is the supervisor claim-loop gate: an active shared episode keeps
    // the dispatcher from picking another feature.
    expect(fixture.episode.active()).toBe(true);
    expect(!fixture.episode.active()).toBe(false);
    expect(proxyB.active()).toBe(true);
    expect(proxyB.nextWaitSeconds()).toBe(60);
    b.flush();
    expect(fixture.episode.snapshot?.()).toEqual({ deadline: 2_000, escalationCounter: 1 });

    let cleared = false;
    const wait = proxyB.clear().then(() => { cleared = true; });
    b.flush();
    expect(cleared).toBe(false);
    fixture.now(2_000);
    fixture.fireNextTimer();
    await Promise.resolve();
    b.flush();
    await wait;
    expect(proxyB.active()).toBe(false);
  });

  it('broadcasts supervisor-originated state changes to already-attached replicas', () => {
    const fixture = brokerFixture();
    const channel = pair();
    const proxy = createRateLimitEpisodeProxy(createExecutorRequestClient(channel.child), () => 1_000);
    fixture.broker.attach('child', channel.supervisor);
    channel.flush();

    // No child request and no new attachment: the authoritative supervisor
    // mutation alone must update this existing replica.
    fixture.episode.enter(2_000);
    channel.flush();
    expect(proxy.active()).toBe(true);
  });

  it('rejects a child rate-limit clear when the supervisor aborts all executors', async () => {
    const fixture = brokerFixture();
    const channel = pair();
    const proxy = createRateLimitEpisodeProxy(createExecutorRequestClient(channel.child), () => 1_000);
    fixture.broker.attach('b', channel.supervisor);
    channel.flush();
    proxy.enter(2_000);
    channel.flush();

    const wait = proxy.clear();
    channel.flush();
    fixture.broker.abortAll();
    channel.flush();
    await expect(wait).rejects.toThrow(/aborted/);
  });

  it('rejects a child rate-limit clear when its supervisor channel disconnects', async () => {
    const fixture = brokerFixture();
    const channel = pair();
    const proxy = createRateLimitEpisodeProxy(createExecutorRequestClient(channel.child), () => 1_000);
    fixture.broker.attach('b', channel.supervisor);
    channel.flush();
    proxy.enter(2_000);
    channel.flush();

    const wait = proxy.clear();
    channel.flush();
    channel.child.emit('disconnect');
    await expect(wait).rejects.toThrow(/disconnected/);
    fixture.broker.abortAll();
  });

  it('replicates provider suppression without making isAvailable asynchronous', async () => {
    let now = 1_000;
    const availability = createProviderAvailability({ now: () => now });
    const rootEvents = new ConductorEventEmitter();
    const brokerEvents: unknown[] = [];
    rootEvents.on('provider_suppressed', (event) => { brokerEvents.push(event); });
    const broker = createExecutorBroker({
      rateLimitEpisode: createRateLimitEpisode({ now: () => now }),
      providerAvailability: availability,
      worktreeLifecycle: new WorktreeLifecycleQueue(), rootEvents, featureLogFor: () => () => {}, now: () => now,
    });
    const a = pair();
    const b = pair();
    const proxyA = createProviderAvailabilityProxy(createExecutorRequestClient(a.child), () => now);
    const proxyB = createProviderAvailabilityProxy(createExecutorRequestClient(b.child), () => now);
    broker.attach('a', a.supervisor);
    broker.attach('b', b.supervisor);
    a.flush();
    b.flush();

    proxyA.suppress('codex', 2_000);
    // The suppressing executor does not wait for IPC to make its next
    // provider admission synchronous and safe.
    expect(proxyA.isAvailable('codex')).toBe(false);
    await flushAsync(a);
    await flushAsync(b);
    expect(availability.isAvailable('codex')).toBe(false);
    expect(proxyB.isAvailable('codex')).toBe(false);
    // The broker owns only shared state. The child callback is the one root
    // event producer, so this request itself cannot duplicate persistence.
    expect(brokerEvents).toEqual([]);

    const late = pair();
    const proxyLate = createProviderAvailabilityProxy(createExecutorRequestClient(late.child), () => now);
    broker.attach('late', late.supervisor);
    late.flush();
    expect(proxyLate.isAvailable('codex')).toBe(false);

    now = 2_001;
    expect(proxyB.isAvailable('codex')).toBe(true);
    expect(proxyLate.isAvailable('codex')).toBe(true);
  });

  it('broadcasts a supervisor-originated provider suppression to attached replicas', () => {
    let now = 1_000;
    const availability = createProviderAvailability({ now: () => now });
    const broker = createExecutorBroker({
      rateLimitEpisode: createRateLimitEpisode({ now: () => now }),
      providerAvailability: availability,
      worktreeLifecycle: new WorktreeLifecycleQueue(), rootEvents: new ConductorEventEmitter(), featureLogFor: () => () => {}, now: () => now,
    });
    const channel = pair();
    const proxy = createProviderAvailabilityProxy(createExecutorRequestClient(channel.child), () => now);
    broker.attach('child', channel.supervisor);
    channel.flush();

    availability.suppress('codex', 2_000);
    channel.flush();
    expect(proxy.isAvailable('codex')).toBe(false);
  });

  it('holds a root mutation behind a child live-boundary window', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    const fixture = brokerFixture();
    const channel = pair();
    const proxy = createLiveBoundaryProxy(createExecutorRequestClient(channel.child));
    fixture.broker = createExecutorBroker({
      rateLimitEpisode: fixture.episode,
      providerAvailability: createProviderAvailability({ now: () => 1_000 }),
      liveBoundaryCoordinator: coordinator,
      worktreeLifecycle: new WorktreeLifecycleQueue(), rootEvents: new ConductorEventEmitter(), featureLogFor: () => () => {},
    });
    fixture.broker.attach('feature', channel.supervisor);

    const window = proxy!.openWindow({ contained: false, reason: 'test' });
    await flushAsync(channel);
    const held = await window;

    let mutationStarted = false;
    const mutation = coordinator.runMutation(async () => { mutationStarted = true; });
    await Promise.resolve();
    expect(mutationStarted).toBe(false);

    held.close();
    await flushAsync(channel);
    await mutation;
    expect(mutationStarted).toBe(true);
  });

  it('opens a child window only after an active root mutation settles', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    const channel = pair();
    const broker = createExecutorBroker({
      rateLimitEpisode: createRateLimitEpisode({ now: () => 1_000 }),
      providerAvailability: createProviderAvailability({ now: () => 1_000 }),
      liveBoundaryCoordinator: coordinator,
      worktreeLifecycle: new WorktreeLifecycleQueue(), rootEvents: new ConductorEventEmitter(), featureLogFor: () => () => {},
    });
    const proxy = createLiveBoundaryProxy(createExecutorRequestClient(channel.child));
    broker.attach('feature', channel.supervisor);

    let finishMutation!: () => void;
    const mutation = coordinator.runMutation(() => new Promise<void>((resolve) => { finishMutation = resolve; }));
    await Promise.resolve();
    const opening = proxy!.openWindow({ contained: false, reason: 'test' });
    channel.flush();
    let opened = false;
    void opening.then(() => { opened = true; });
    await Promise.resolve();
    expect(opened).toBe(false);

    finishMutation();
    await mutation;
    await flushAsync(channel);
    await expect(opening).resolves.toMatchObject({ close: expect.any(Function) });
  });

  it('releases every child window when its channel disconnects', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    const channel = pair();
    const broker = createExecutorBroker({
      rateLimitEpisode: createRateLimitEpisode({ now: () => 1_000 }),
      providerAvailability: createProviderAvailability({ now: () => 1_000 }),
      liveBoundaryCoordinator: coordinator,
      worktreeLifecycle: new WorktreeLifecycleQueue(), rootEvents: new ConductorEventEmitter(), featureLogFor: () => () => {},
    });
    const proxy = createLiveBoundaryProxy(createExecutorRequestClient(channel.child));
    broker.attach('feature', channel.supervisor);

    const first = proxy!.openWindow({ contained: false, reason: 'test' });
    const second = proxy!.openWindow({ contained: false, reason: 'test' });
    await flushAsync(channel);
    await Promise.all([first, second]);

    let mutationStarted = false;
    const mutation = coordinator.runMutation(async () => { mutationStarted = true; });
    await Promise.resolve();
    expect(mutationStarted).toBe(false);

    channel.supervisor.emit('disconnect');
    await mutation;
    expect(mutationStarted).toBe(true);
  });

  it('keeps a child dispatch reservation open without the synchronous admission throw', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    const channel = pair();
    const broker = createExecutorBroker({
      rateLimitEpisode: createRateLimitEpisode({ now: () => 1_000 }),
      providerAvailability: createProviderAvailability({ now: () => 1_000 }),
      liveBoundaryCoordinator: coordinator,
      worktreeLifecycle: new WorktreeLifecycleQueue(), rootEvents: new ConductorEventEmitter(), featureLogFor: () => () => {},
    });
    const proxy = createLiveBoundaryProxy(createExecutorRequestClient(channel.child));
    broker.attach('feature', channel.supervisor);

    const dispatch = proxy!.runDispatch(async (openWindow) => {
      const candidate = openWindow({ contained: false, reason: 'test' });
      candidate.close();
      return 'completed';
    });
    await flushAsync(channel);

    await expect(dispatch).resolves.toBe('completed');
  });

  it('uses no live-boundary IPC in non-self-host mode', () => {
    const channel = pair();
    const proxy = createLiveBoundaryProxy(createExecutorRequestClient(channel.child), false);

    expect(proxy).toBeUndefined();
    expect(channel.child.deliver()).toBe(false);
    expect(channel.supervisor.deliver()).toBe(false);
  });

  it('serializes child worktree lifecycle sections behind a supervisor sweep', async () => {
    const lifecycle = new WorktreeLifecycleQueue();
    const broker = createExecutorBroker({
      rateLimitEpisode: createRateLimitEpisode({ now: () => 1_000 }),
      providerAvailability: createProviderAvailability({ now: () => 1_000 }),
      worktreeLifecycle: lifecycle, rootEvents: new ConductorEventEmitter(), featureLogFor: () => () => {},
    });
    const a = pair();
    const b = pair();
    const proxyA = createWorktreeLifecycleProxy(createExecutorRequestClient(a.child));
    const proxyB = createWorktreeLifecycleProxy(createExecutorRequestClient(b.child));
    broker.attach('a', a.supervisor);
    broker.attach('b', b.supervisor);

    let releaseSweep!: () => void;
    const sweep = lifecycle.run(() => new Promise<void>((resolve) => { releaseSweep = resolve; }));
    await Promise.resolve();
    const entered: string[] = [];
    let releaseA!: () => void;
    let releaseB!: () => void;
    const runA = proxyA.run(async () => {
      entered.push('a');
      await new Promise<void>((resolve) => { releaseA = resolve; });
    });
    const runB = proxyB.run(async () => {
      entered.push('b');
      await new Promise<void>((resolve) => { releaseB = resolve; });
    });

    await flushAsync(a);
    await flushAsync(b);
    expect(entered).toEqual([]);

    releaseSweep();
    await sweep;
    await flushAsync(a);
    await flushAsync(b);
    expect(entered).toEqual(['a']);

    releaseA();
    await flushAsync(a);
    await runA;
    await flushAsync(b);
    expect(entered).toEqual(['a', 'b']);

    releaseB();
    await flushAsync(b);
    await runB;
  });

  it('releases a held worktree lifecycle lock when its child disconnects', async () => {
    const lifecycle = new WorktreeLifecycleQueue();
    const broker = createExecutorBroker({
      rateLimitEpisode: createRateLimitEpisode({ now: () => 1_000 }),
      providerAvailability: createProviderAvailability({ now: () => 1_000 }),
      worktreeLifecycle: lifecycle, rootEvents: new ConductorEventEmitter(), featureLogFor: () => () => {},
    });
    const a = pair();
    const b = pair();
    const proxyA = createWorktreeLifecycleProxy(createExecutorRequestClient(a.child));
    const proxyB = createWorktreeLifecycleProxy(createExecutorRequestClient(b.child));
    broker.attach('a', a.supervisor);
    broker.attach('b', b.supervisor);

    const entered: string[] = [];
    let releaseA!: () => void;
    let releaseB!: () => void;
    const runA = proxyA.run(async () => {
      entered.push('a');
      await new Promise<void>((resolve) => { releaseA = resolve; });
    });
    await flushAsync(a);
    const runB = proxyB.run(async () => {
      entered.push('b');
      await new Promise<void>((resolve) => { releaseB = resolve; });
    });
    await flushAsync(b);
    expect(entered).toEqual(['a']);

    a.supervisor.emit('disconnect');
    await flushAsync(b);
    expect(entered).toEqual(['a', 'b']);

    releaseA();
    await flushAsync(a);
    await runA;
    releaseB();
    await flushAsync(b);
    await runB;
  });

  it('rejects a queued worktree lifecycle request when the supervisor shuts down', async () => {
    const lifecycle = new WorktreeLifecycleQueue();
    const broker = createExecutorBroker({
      rateLimitEpisode: createRateLimitEpisode({ now: () => 1_000 }),
      providerAvailability: createProviderAvailability({ now: () => 1_000 }),
      worktreeLifecycle: lifecycle, rootEvents: new ConductorEventEmitter(), featureLogFor: () => () => {},
    });
    const channel = pair();
    const proxy = createWorktreeLifecycleProxy(createExecutorRequestClient(channel.child));
    broker.attach('feature', channel.supervisor);

    let releaseSweep!: () => void;
    const sweep = lifecycle.run(() => new Promise<void>((resolve) => { releaseSweep = resolve; }));
    await Promise.resolve();
    const pending = proxy.run(async () => undefined);
    await flushAsync(channel);

    broker.abortAll();
    await flushAsync(channel);
    releaseSweep();
    await sweep;
    await flushAsync(channel);
    await expect(pending).rejects.toThrow(/aborted/);
  });
});
