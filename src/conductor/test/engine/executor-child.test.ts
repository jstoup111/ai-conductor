// Covers: task:14
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runExecutorChild, withExecutorBrokerProxies } from '../../src/engine/executor-child.js';
import { EXECUTOR_PROTOCOL_VERSION } from '../../src/engine/executor-protocol.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

const VERSION = '20261019T120000Z-aaaaaaaaaaaa' as WorkOrder['engineVersionId'];
const order: WorkOrder = {
  schemaVersion: 1,
  repository: 'repo',
  slug: 'feature',
  baseSha: 'a'.repeat(40),
  engineVersionId: VERSION,
  supervisorEngineVersionId: '20261019T120001Z-bbbbbbbbbbbb' as WorkOrder['engineVersionId'],
  manifest: [],
};

class FakePort {
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Array<(value?: unknown) => void>>();
  send(value: unknown): boolean { this.sent.push(value); return true; }
  on(event: 'message' | 'disconnect', listener: (value?: unknown) => void): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }
  dispatch(value: unknown): void { for (const listener of this.listeners.get('message') ?? []) listener(value); }
}

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

describe('executor child entrypoint', () => {
  it('waits for the order, then persists its own started event and one outcome through broker proxies', async () => {
    root = await mkdtemp(join(tmpdir(), 'executor-child-'));
    const port = new FakePort();
    const calls: string[] = [];
    const done = runExecutorChild(port, withExecutorBrokerProxies(port, {
      engineVersionId: VERSION,
      createWorktree: async (received, lifecycle) => {
        calls.push(`create:${received.slug}`);
        expect(lifecycle).toBeDefined();
        const path = join(root!, '.worktrees', received.slug);
        await import('node:fs/promises').then(({ mkdir }) => mkdir(path, { recursive: true }));
        return { path };
      },
      run: async ({ order: received, rateLimitEpisode, providerAvailability, liveBoundaryCoordinator, worktreeLifecycle }) => {
        calls.push(`run:${received.slug}`);
        expect(rateLimitEpisode).toBeDefined();
        expect(providerAvailability).toBeDefined();
        expect(liveBoundaryCoordinator).toBeDefined();
        expect(worktreeLifecycle).toBeDefined();
        return { slug: received.slug, status: 'done' };
      },
      liveBoundaryEnabled: true,
    }));

    expect(port.sent).toEqual([{ kind: 'hello', protocolVersion: EXECUTOR_PROTOCOL_VERSION, engineVersionId: VERSION }]);
    expect(calls).toEqual([]);
    port.dispatch({ kind: 'work-order', order });
    await done;

    expect(calls).toEqual(['create:feature', 'run:feature']);
    await expect(readFile(join(root, '.worktrees', 'feature', '.pipeline', 'work-order.json'), 'utf8'))
      .resolves.toBe(`${JSON.stringify(order)}\n`);
    const ledger = (await readFile(join(root, '.worktrees', 'feature', '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    expect(ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'executor_started', slug: 'feature', engineVersionId: VERSION,
        protocolVersion: EXECUTOR_PROTOCOL_VERSION,
        supervisorEngineVersionId: order.supervisorEngineVersionId,
      }),
    ]));
    expect(port.sent.filter((message) => (message as { kind?: string }).kind === 'outcome')).toEqual([
      { kind: 'outcome', outcome: { slug: 'feature', status: 'done' } },
    ]);
  });
});
