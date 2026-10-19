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
  send(message: unknown): boolean { queueMicrotask(() => this.peer?.emit('message', message)); return true; }
  on(event: 'message' | 'disconnect', listener: (value?: unknown) => void): void {
    const set = this.handlers.get(event) ?? new Set(); set.add(listener); this.handlers.set(event, set);
  }
  emit(event: 'message' | 'disconnect', value?: unknown): void { for (const handler of this.handlers.get(event) ?? []) handler(value); }
}

function pair(): [Port, Port] { const left = new Port(); const right = new Port(); left.peer = right; right.peer = left; return [left, right]; }

describe('executor broker', () => {
  it('replicates the one supervisor rate-limit episode to child synchronous views', async () => {
    let now = 1_000;
    const episode = createRateLimitEpisode({ now: () => now });
    const broker = createExecutorBroker({
      rateLimitEpisode: episode,
      providerAvailability: createProviderAvailability({ now: () => now }),
      worktreeLifecycle: new WorktreeLifecycleQueue(), rootEvents: new ConductorEventEmitter(), featureLogFor: () => () => {}, now: () => now,
    });
    const [supervisor, child] = pair(); broker.attach('a', supervisor);
    const proxy = createRateLimitEpisodeProxy(createExecutorRequestClient(child), () => now);
    proxy.enter(2_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(episode.active()).toBe(true);
    expect(proxy.active()).toBe(true);
    now = 2_001;
    expect(proxy.active()).toBe(false);
  });

  it('replicates provider suppression without making isAvailable asynchronous', async () => {
    let now = 1_000;
    const broker = createExecutorBroker({
      rateLimitEpisode: createRateLimitEpisode({ now: () => now }),
      providerAvailability: createProviderAvailability({ now: () => now }),
      worktreeLifecycle: new WorktreeLifecycleQueue(), rootEvents: new ConductorEventEmitter(), featureLogFor: () => () => {}, now: () => now,
    });
    const [supervisor, child] = pair(); broker.attach('a', supervisor);
    const proxy = createProviderAvailabilityProxy(createExecutorRequestClient(child), () => now);
    proxy.suppress('codex', 2_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(proxy.isAvailable('codex')).toBe(false);
    now = 2_001;
    expect(proxy.isAvailable('codex')).toBe(true);
  });
});
