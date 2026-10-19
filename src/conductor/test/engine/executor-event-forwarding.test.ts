// Covers: task:12
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createExecutorBroker } from '../../src/engine/executor-broker.js';
import { createFeatureDaemonLogger } from '../../src/engine/daemon-log.js';
import { startDaemonEventPersistence, forwardedFeatureOf, isForwardedFromFeature } from '../../src/engine/event-persister.js';
import { createProviderAvailability } from '../../src/engine/provider-availability.js';
import { create as createRateLimitEpisode } from '../../src/engine/rate-limit-episode.js';
import type { ExecutorIpcPort } from '../../src/engine/executor-proxies.js';
import { WorktreeLifecycleQueue } from '../../src/engine/worktree.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';

class Port implements ExecutorIpcPort {
  readonly sent: unknown[] = [];
  private readonly handlers = new Map<'message' | 'disconnect', Set<(message?: unknown) => void>>();

  send(message: unknown): boolean { this.sent.push(message); return true; }

  on(event: 'message' | 'disconnect', listener: (message?: unknown) => void): void {
    const listeners = this.handlers.get(event) ?? new Set();
    listeners.add(listener);
    this.handlers.set(event, listeners);
  }

  receive(message: unknown): void {
    for (const listener of this.handlers.get('message') ?? []) listener(message);
  }
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function settleForwarding(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('executor event forwarding', () => {
  it('renders feature events on the proxy bus, forwards marked copies to root, and never writes the feature ledger', async () => {
    const root = await mkdtemp(join(tmpdir(), 'executor-event-forwarding-'));
    temporaryRoots.push(root);
    const featureLedger = join(root, 'worktree', '.pipeline', 'events.jsonl');
    await mkdir(join(root, 'worktree', '.pipeline'), { recursive: true });
    await writeFile(featureLedger, '{"child":"only"}\n', { encoding: 'utf8' });

    const rootEvents = new ConductorEventEmitter();
    const daemonPersistence = startDaemonEventPersistence(root, rootEvents);
    const rendered: string[] = [];
    const forwarded: unknown[] = [];
    rootEvents.on('executor_started', (event) => { forwarded.push(event); });
    const broker = createExecutorBroker({
      rateLimitEpisode: createRateLimitEpisode(),
      providerAvailability: createProviderAvailability({ now: () => Date.now() }),
      worktreeLifecycle: new WorktreeLifecycleQueue(),
      rootEvents,
      featureLogFor: () => () => {},
      attachFeatureEventRenderer: (slug, events) => {
        const featureLog = createFeatureDaemonLogger(slug, (line) => rendered.push(line));
        const render = (event: Parameters<typeof renderDaemonEvent>[0]) => renderDaemonEvent(event, featureLog);
        events.on('executor_started', render);
        return () => events.off('executor_started', render);
      },
    });
    const port = new Port();
    broker.attach('feature-a', port);

    port.receive({
      kind: 'event', scope: 'feature', payload: {
        type: 'executor_started', slug: 'feature-a', engineVersionId: 'v2', protocolVersion: 1, supervisorEngineVersionId: 'v1',
      },
    });
    await settleForwarding();

    expect(rendered).toEqual([expect.stringContaining('[feature-a]')]);
    expect(rendered[0]).toContain('executor feature-a started on v2');
    expect(forwarded).toHaveLength(1);
    expect(isForwardedFromFeature(forwarded[0] as never)).toBe(true);
    expect(forwardedFeatureOf(forwarded[0] as never)).toBe('feature-a');
    expect(await readFile(featureLedger, 'utf8')).toBe('{"child":"only"}\n');
    await expect(readFile(join(root, '.daemon', 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    daemonPersistence.stop();
  });

  it('persists root events but drops unknown, malformed, and child-owned lifecycle messages without stopping later forwarding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'executor-event-forwarding-'));
    temporaryRoots.push(root);
    const rootEvents = new ConductorEventEmitter();
    const daemonPersistence = startDaemonEventPersistence(root, rootEvents);
    const logs: string[] = [];
    const rendered: string[] = [];
    const broker = createExecutorBroker({
      rateLimitEpisode: createRateLimitEpisode(),
      providerAvailability: createProviderAvailability({ now: () => Date.now() }),
      worktreeLifecycle: new WorktreeLifecycleQueue(),
      rootEvents,
      featureLogFor: () => () => {},
      log: (line) => logs.push(line),
      attachFeatureEventRenderer: (_slug, events) => {
        const render = () => { rendered.push('rendered'); };
        events.on('executor_started', render);
        return () => events.off('executor_started', render);
      },
    });
    const port = new Port();
    broker.attach('feature-a', port);

    expect(() => port.receive({ kind: 'event', scope: 'feature', payload: { type: 'future_executor_event' } })).not.toThrow();
    port.receive({ kind: 'event', scope: 'feature', payload: '{not valid json}' });
    port.receive({ kind: 'event', scope: 'root', payload: { type: 'feature_dispatch_started', slug: 'feature-a', kind: 'initial' } });
    port.receive({ kind: 'event', scope: 'root', payload: { type: 'feature_shipped', slug: 'feature-a', active: { state: 'unavailable' } } });
    port.receive({
      kind: 'event', scope: 'feature', payload: {
        type: 'executor_started', slug: 'feature-a', engineVersionId: 'v2', protocolVersion: 1, supervisorEngineVersionId: 'v1',
      },
    });
    await settleForwarding();

    expect(logs).toEqual([expect.stringContaining('[executor feature-a] malformed message: event payload must be a JSON object with a type')]);
    expect(rendered).toEqual(['rendered']);
    const ledger = await readFile(join(root, '.daemon', 'events.jsonl'), 'utf8');
    const types = ledger.trim().split('\n').map((line) => (JSON.parse(line) as { type: string }).type);
    expect(types).toEqual(['feature_shipped']);

    daemonPersistence.stop();
  });
});
