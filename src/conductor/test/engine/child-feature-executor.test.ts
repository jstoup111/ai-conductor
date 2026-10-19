import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { createChildProcessFeatureExecutor, type ForkedExecutor } from '../../src/engine/child-feature-executor.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

const VERSION = '20261019T120000Z-aaaaaaaaaaaa' as WorkOrder['engineVersionId'];
const order: WorkOrder = {
  schemaVersion: 1,
  repository: 'repo',
  slug: 'feature',
  baseSha: 'a'.repeat(40),
  engineVersionId: VERSION,
  pinFallbackReason: 'publish-incomplete',
  manifest: [],
};

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

describe('child feature executor dispatch lifecycle', () => {
  it('uses the immutable version entrypoint and emits one pin-aware dispatch pair', async () => {
    root = await mkdtemp(join(tmpdir(), 'child-executor-'));
    const messages = new Map<string, Array<(value?: unknown) => void>>();
    let exit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
    const child: ForkedExecutor = {
      pid: 42,
      send(value) {
        if ((value as { kind?: string }).kind === 'work-order') {
          for (const listener of messages.get('message') ?? []) listener({ kind: 'outcome', outcome: { slug: 'feature', status: 'done' } });
          exit?.(0, null);
        }
        return true;
      },
      on(event, listener) { (messages.get(event) ?? messages.set(event, []).get(event)!).push(listener); return this; },
      once(_event, listener) { exit = listener; return this; },
      kill() { return true; },
    };
    const events = new ConductorEventEmitter();
    const emitted: Array<Record<string, unknown>> = [];
    events.on('feature_dispatch_started', (event) => { emitted.push(event as Record<string, unknown>); });
    events.on('feature_dispatch_ended', (event) => { emitted.push(event as Record<string, unknown>); });
    let modulePath = '';
    const executor = createChildProcessFeatureExecutor({
      projectRoot: root,
      engineDirForOrder: () => `/store/dist-versions/${VERSION}`,
      supervisorEngineVersionId: VERSION,
      rootEvents: events,
      attachBroker: () => ({ events, close() {} }),
      fork: (path) => { modulePath = path; queueMicrotask(() => { for (const listener of messages.get('message') ?? []) listener({ kind: 'hello', protocolVersion: 1, engineVersionId: VERSION }); }); return child; },
    });

    await expect(executor.execute(order)).resolves.toMatchObject({ slug: 'feature', status: 'done' });
    expect(modulePath).toBe(`/store/dist-versions/${VERSION}/index.js`);
    expect(emitted).toEqual([
      expect.objectContaining({ type: 'feature_dispatch_started', engineVersionId: VERSION, pinFallbackReason: 'publish-incomplete' }),
      expect.objectContaining({ type: 'feature_dispatch_ended', outcome: 'complete' }),
    ]);
  });
});
