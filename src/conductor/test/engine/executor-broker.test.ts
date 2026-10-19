// Covers: task:8
import { describe, expect, it } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { create as createRateLimitEpisode } from '../../src/engine/rate-limit-episode.js';
import { createProviderAvailability } from '../../src/engine/provider-availability.js';
import { WorktreeLifecycleQueue } from '../../src/engine/worktree.js';
import { createExecutorBroker } from '../../src/engine/executor-broker.js';
import {
  createExecutorRequestClient,
  createProviderAvailabilityProxy,
  createRateLimitEpisodeProxy,
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
    const broker = createExecutorBroker({
      rateLimitEpisode: createRateLimitEpisode({ now: () => now }),
      providerAvailability: createProviderAvailability({ now: () => now }),
      worktreeLifecycle: new WorktreeLifecycleQueue(), rootEvents: new ConductorEventEmitter(), featureLogFor: () => () => {}, now: () => now,
    });
    const channel = pair();
    const proxy = createProviderAvailabilityProxy(createExecutorRequestClient(channel.child), () => now);
    broker.attach('a', channel.supervisor);
    channel.flush();
    proxy.suppress('codex', 2_000);
    channel.flush();
    expect(proxy.isAvailable('codex')).toBe(false);
    now = 2_001;
    expect(proxy.isAvailable('codex')).toBe(true);
  });
});
