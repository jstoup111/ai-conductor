// Covers: task:10, task:17
import { execFile as execFileCallback } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { access, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { wireInteractiveOtelMetrics, wireOtelVisualizer } from '../../../src/engine/otel/wire.js';
import { PluginRegistry } from '../../../src/engine/plugin-registry.js';
import { SpoolLease } from '../../../src/engine/otel/spool-lease.js';
import { SpoolStore } from '../../../src/engine/otel/spool-store.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const directories: string[] = [];
const servers: Server[] = [];
// These tests own their loopback receivers. Drive the OTel boundary through an
// explicit marker-free environment instead of weakening the test process's
// global export refusal.
const loopbackOtelEnv: NodeJS.ProcessEnv = {};

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'spool-interactive-wiring-'));
  directories.push(directory);
  await execFile('git', ['init', '--initial-branch=main', directory]);
  return directory;
}

async function temporaryLinkedWorktree(): Promise<{ mainRoot: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'spool-interactive-main-'));
  const mainRoot = join(root, 'main');
  const worktree = join(root, 'linked');
  directories.push(root);
  await mkdir(mainRoot, { recursive: true });
  await execFile('git', ['init', '--initial-branch=main', mainRoot]);
  await execFile('git', ['-C', mainRoot, 'config', 'user.email', 'test@example.com']);
  await execFile('git', ['-C', mainRoot, 'config', 'user.name', 'Test User']);
  await execFile('git', ['-C', mainRoot, 'commit', '--allow-empty', '-m', 'initial']);
  await execFile('git', ['-C', mainRoot, 'worktree', 'add', '-b', 'interactive-linked', worktree]);
  return { mainRoot, worktree };
}

async function endpoint(onRequest: () => void): Promise<string> {
  const server = createServer((request, response) => {
    onRequest();
    request.resume();
    response.writeHead(200).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected TCP address');
  return `http://127.0.0.1:${address.port}`;
}

async function closedEndpoint(): Promise<string> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected TCP address');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return `http://127.0.0.1:${address.port}`;
}

async function eventually(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let turn = 0; turn < 1_000 && !(await predicate()); turn += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function start(config: { otel: { exporter: 'otlp'; endpoint: string; spool: { enabled: true } } }, project: string, events: ConductorEventEmitter) {
  const context = {
    pipelineDir: join(project, '.pipeline'), runId: 'run', feature: 'feature', project,
    branch: 'feature', engineVersion: 'test', harnessVersion: 'test', metrics: false, env: loopbackOtelEnv,
  };
  return {
    visualizer: wireOtelVisualizer(config, context, events),
    metrics: wireInteractiveOtelMetrics(config, context, events),
  };
}

async function emitSpan(events: ConductorEventEmitter): Promise<void> {
  await events.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
  await events.emit({ type: 'feature_complete', featureDesc: 'feature' });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('interactive OTel spool wiring', () => {
  it('anchors an interactive worktree run to the main checkout spool', async () => {
    const { mainRoot, worktree } = await temporaryLinkedWorktree();
    const mainStore = new SpoolStore(join(mainRoot, '.daemon', 'otel-spool'));
    await mainStore.write('traces', Buffer.from('from-main-spool'));
    let received = 0;
    const wiring = start({
      otel: { exporter: 'otlp', endpoint: await endpoint(() => { received += 1; }), spool: { enabled: true } },
    }, worktree, new ConductorEventEmitter());

    await eventually(async () => {
      try {
        return (await mainStore.list('traces')).length === 0;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    });
    await Promise.all([wiring.visualizer?.stop(), wiring.metrics?.stop()]);

    expect({
      received,
      mainRemaining: await mainStore.list('traces'),
      worktreeSpool: join(worktree, '.daemon', 'otel-spool'),
    }).toEqual({ received: 1, mainRemaining: [], worktreeSpool: join(worktree, '.daemon', 'otel-spool') });
    await expect(access(join(worktree, '.daemon', 'otel-spool'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('acquires a lease and drains pre-existing spool files during an interactive run', async () => {
    const project = await temporaryProject();
    const store = new SpoolStore(join(project, '.daemon', 'otel-spool'));
    await store.write('traces', Buffer.from('pre-existing'));
    let received = 0;
    const wiring = start({ otel: { exporter: 'otlp', endpoint: await endpoint(() => { received += 1; }), spool: { enabled: true } } }, project, new ConductorEventEmitter());

    await eventually(() => received > 0);
    expect(received).toBeGreaterThan(0);
    await expect(access(join(project, '.daemon', 'otel-spool', 'lease.json'))).resolves.toBeUndefined();
    await wiring.visualizer?.stop();
    await wiring.metrics?.stop();
    await expect(store.list('traces')).resolves.toEqual([]);
    await expect(access(join(project, '.daemon', 'otel-spool', 'lease.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('spools pending interactive batches and releases its lease when stopped with a closed endpoint', async () => {
    const project = await temporaryProject();
    const events = new ConductorEventEmitter();
    const wiring = start({ otel: { exporter: 'otlp', endpoint: await closedEndpoint(), spool: { enabled: true } } }, project, events);

    await emitSpan(events);
    await Promise.all([wiring.visualizer?.stop(), wiring.metrics?.stop()]);

    const store = new SpoolStore(join(project, '.daemon', 'otel-spool'));
    expect(await store.list('traces')).not.toHaveLength(0);
    await expect(access(join(project, '.daemon', 'otel-spool', 'lease.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('spools without sending when another live holder owns the lease', async () => {
    const project = await temporaryProject();
    const lease = new SpoolLease(join(project, '.daemon', 'otel-spool'));
    await expect(lease.acquire()).resolves.toEqual({ acquired: true });
    let received = 0;
    const events = new ConductorEventEmitter();
    const wiring = start({ otel: { exporter: 'otlp', endpoint: await endpoint(() => { received += 1; }), spool: { enabled: true } } }, project, events);

    try {
      await emitSpan(events);
      await wiring.visualizer?.stop();
      await wiring.metrics?.stop();

      const store = new SpoolStore(join(project, '.daemon', 'otel-spool'));
      expect(received).toBe(0);
      expect(await store.list('traces')).not.toHaveLength(0);
    } finally {
      await lease.release();
    }
  });

  it('replaces a failed visualizer lifecycle before metrics acquires and drains the spool', async () => {
    const project = await temporaryProject();
    const store = new SpoolStore(join(project, '.daemon', 'otel-spool'));
    await store.write('traces', Buffer.from('pre-existing'));
    const events = new ConductorEventEmitter();
    const errors: string[] = [];
    events.on('renderer_error', (event) => {
      if (event.type === 'renderer_error') errors.push(event.error);
    });
    let received = 0;
    const config = { otel: { exporter: 'otlp' as const, endpoint: await endpoint(() => { received += 1; }), spool: { enabled: true } } };
    const context = {
      pipelineDir: join(project, '.pipeline'), runId: 'run', feature: 'feature', project,
      branch: 'feature', engineVersion: 'test', harnessVersion: 'test', metrics: false, env: loopbackOtelEnv,
    };
    const failedRegistry = (): PluginRegistry => {
      const registry = new PluginRegistry();
      registry.register('visualizer', 'otel', () => ({
        name: 'otel', start: () => { throw new Error('visualizer failed'); }, stop: async () => {},
      }));
      registry.markInitialized();
      return registry;
    };

    expect(wireOtelVisualizer(config, context, events, undefined, failedRegistry)).toBeNull();
    const metrics = wireInteractiveOtelMetrics(config, context, events);
    await eventually(() => received === 1);

    expect(errors).toHaveLength(1);
    expect(received).toBe(1);
    expect(metrics).not.toBeNull();
    await expect(access(join(project, '.daemon', 'otel-spool', 'lease.json'))).resolves.toBeUndefined();
    await metrics?.stop();
    await expect(access(join(project, '.daemon', 'otel-spool', 'lease.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
