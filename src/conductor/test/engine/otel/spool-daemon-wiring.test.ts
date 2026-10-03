// Covers: task:16
import { execFile as execFileCallback } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { wireDaemonOtel, wireInteractiveOtelMetrics, wireOtelVisualizer } from '../../../src/engine/otel/wire.js';
import { startDaemonEventPersistence } from '../../../src/engine/event-persister.js';
import { SpoolDrainer } from '../../../src/engine/otel/spool-drainer.js';
import { SpoolStore } from '../../../src/engine/otel/spool-store.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const leaseUnlinkFailures = vi.hoisted(() => new Set<string>());

vi.mock('node:fs/promises', async (importOriginal) => {
  const filesystem = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...filesystem,
    rm: async (path: Parameters<typeof filesystem.rm>[0], options?: Parameters<typeof filesystem.rm>[1]) => {
      if (leaseUnlinkFailures.has(String(path))) {
        throw Object.assign(new Error('lease unlink denied'), { code: 'EACCES' });
      }
      return filesystem.rm(path, options);
    },
  };
});

const directories: string[] = [];
const servers: Server[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'spool-daemon-wiring-'));
  directories.push(directory);
  return directory;
}

async function temporaryProject(): Promise<string> {
  const directory = await temporaryDirectory();
  await execFile('git', ['init', '--initial-branch=main', directory]);
  return directory;
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

async function listeningEndpoint(onRequest: (path: string) => void): Promise<{ endpoint: string; request: Promise<void> }> {
  let received!: () => void;
  const requestReceived = new Promise<void>((resolve) => { received = resolve; });
  const server = createServer((request, response) => {
    onRequest(request.url ?? '');
    received();
    request.resume();
    response.writeHead(200).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected TCP address');
  return { endpoint: `http://127.0.0.1:${address.port}`, request: requestReceived };
}

async function eventually(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let turn = 0; turn < 1_000 && !(await predicate()); turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

afterEach(async () => {
  leaseUnlinkFailures.clear();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('daemon OTel spool wiring', () => {
  it('reports a rejected lease acquisition once and still stops cleanly', async () => {
    const directory = await temporaryDirectory();
    const blockedRoot = join(directory, 'not-a-directory');
    await writeFile(blockedRoot, 'file');
    const events = new ConductorEventEmitter();
    const errors: string[] = [];
    events.on('renderer_error', (event) => {
      if (event.type === 'renderer_error') errors.push(event.error);
    });
    const daemon = wireDaemonOtel({ otel: { exporter: 'otlp', endpoint: 'http://127.0.0.1:1', spool: { enabled: true } } }, {
      mainRoot: blockedRoot, project: blockedRoot, projectName: 'test', rootEvents: events,
    });

    await eventually(() => errors.length === 1);
    await expect(daemon?.stop()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('spool lease or drainer failed');
  });

  it('contains an EACCES lease unlink during daemon shutdown', async () => {
    const mainRoot = await temporaryDirectory();
    const rootEvents = new ConductorEventEmitter();
    const failures: Array<{ rendererName: string; error: string }> = [];
    rootEvents.on('renderer_error', (event) => {
      if (event.type === 'renderer_error') failures.push(event);
    });
    const daemon = wireDaemonOtel({ otel: { exporter: 'otlp', endpoint: 'http://127.0.0.1:1', spool: { enabled: true } } }, {
      mainRoot, project: mainRoot, projectName: 'test', rootEvents,
    });
    const leasePath = join(mainRoot, '.daemon', 'otel-spool', 'lease.json');
    await daemon?.spoolRuntime?.lease.acquire();
    leaseUnlinkFailures.add(leasePath);

    await expect(daemon?.stop()).resolves.toBeUndefined();

    expect(failures).toEqual([expect.objectContaining({
      rendererName: 'otel', error: expect.stringContaining('lease unlink denied'),
    })]);
  });

  it('contains an EACCES lease unlink during interactive visualizer and metrics shutdown', async () => {
    const project = await temporaryProject();
    const events = new ConductorEventEmitter();
    const failures: Array<{ rendererName: string; error: string }> = [];
    events.on('renderer_error', (event) => {
      if (event.type === 'renderer_error') failures.push(event);
    });
    const config = { otel: { exporter: 'otlp' as const, endpoint: 'http://127.0.0.1:1', spool: { enabled: true } } };
    const context = {
      pipelineDir: join(project, '.pipeline'), runId: 'run', feature: 'feature', project,
      branch: 'feature', engineVersion: 'test', harnessVersion: 'test', metrics: false,
    };
    const visualizer = wireOtelVisualizer(config, context, events);
    const metrics = wireInteractiveOtelMetrics(config, context, events);
    const leasePath = join(project, '.daemon', 'otel-spool', 'lease.json');
    await eventually(async () => access(leasePath).then(() => true, () => false));
    leaseUnlinkFailures.add(leasePath);

    await expect(Promise.all([visualizer?.stop(), metrics?.stop()])).resolves.toEqual([undefined, undefined]);

    expect(failures).toEqual([expect.objectContaining({
      rendererName: 'otel', error: expect.stringContaining('lease unlink denied'),
    })]);
  });

  it('leaves flushed dispatch spans and daemon metrics in the spool when the endpoint is closed', async () => {
    const mainRoot = await temporaryDirectory();
    const endpoint = await closedEndpoint();
    const rootEvents = new ConductorEventEmitter();
    const dispatchEvents = new ConductorEventEmitter();
    const config = { otel: { exporter: 'otlp' as const, endpoint, spool: { enabled: true, maxBytes: 1024 * 1024 } } };
    const daemon = wireDaemonOtel(config, { mainRoot, project: mainRoot, projectName: 'test', rootEvents });
    const visualizer = wireOtelVisualizer(config, {
      pipelineDir: join(mainRoot, '.pipeline'), runId: 'run', feature: 'feature', project: mainRoot,
      branch: 'feature', engineVersion: 'test', harnessVersion: 'test',
    }, dispatchEvents, daemon?.spoolRuntime);

    await dispatchEvents.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await dispatchEvents.emit({ type: 'feature_complete', featureDesc: 'feature' });
    await rootEvents.emit({ type: 'memory_setup', before: 'absent', canonical: true });
    await visualizer?.stop();
    await daemon?.stop();

    const store = new SpoolStore(join(mainRoot, '.daemon', 'otel-spool'));
    expect(await Promise.all([store.list('traces'), store.list('metrics')])).toSatisfy(
      ([traces, metrics]) => traces.length > 0 && metrics.length > 0,
    );
  });

  it('releases the first daemon lease so a successor delivers its spooled batches', async () => {
    const mainRoot = await temporaryDirectory();
    const closed = await closedEndpoint();
    const config = { otel: { exporter: 'otlp' as const, endpoint: closed, spool: { enabled: true, maxBytes: 1024 * 1024 } } };
    const firstEvents = new ConductorEventEmitter();
    const first = wireDaemonOtel(config, { mainRoot, project: mainRoot, projectName: 'test', rootEvents: firstEvents });
    await firstEvents.emit({ type: 'memory_setup', before: 'absent', canonical: true });
    await first?.stop();

    const received: string[] = [];
    const listener = await listeningEndpoint((path) => received.push(path));
    const second = wireDaemonOtel({ otel: { ...config.otel, endpoint: listener.endpoint } }, {
      mainRoot, project: mainRoot, projectName: 'test', rootEvents: new ConductorEventEmitter(),
    });
    await listener.request;
    await second?.stop();

    expect(received).toContain('/v1/metrics');
  });

  it('keeps the daemon drainer lease while a dispatch visualizer shuts down', async () => {
    const mainRoot = await temporaryDirectory();
    const rootEvents = new ConductorEventEmitter();
    const daemon = wireDaemonOtel({ otel: { exporter: 'otlp', endpoint: await closedEndpoint(), spool: { enabled: true } } }, {
      mainRoot, project: mainRoot, projectName: 'test', rootEvents,
    });
    const leasePath = join(mainRoot, '.daemon', 'otel-spool', 'lease.json');
    await daemon?.spoolRuntime?.lease.acquire();
    const visualizer = wireOtelVisualizer({ otel: { exporter: 'otlp', endpoint: 'http://127.0.0.1:1', spool: { enabled: true } } }, {
      pipelineDir: join(mainRoot, '.pipeline'), runId: 'run', feature: 'feature', project: mainRoot,
      branch: 'feature', engineVersion: 'test', harnessVersion: 'test',
    }, new ConductorEventEmitter(), daemon?.spoolRuntime);
    await visualizer?.stop();

    expect(JSON.parse(await readFile(leasePath, 'utf8'))).toMatchObject({ pid: process.pid, uuid: expect.any(String) });
    await daemon?.stop();
  });

  it('persists drop and backlog telemetry emitted by the daemon-owned drainer on the root event bus', async () => {
    const mainRoot = await temporaryDirectory();
    const events = new ConductorEventEmitter();
    const persistence = startDaemonEventPersistence(mainRoot, events);
    let dropped = false;
    events.on('otel_spool_drop', () => { dropped = true; });
    const store = new SpoolStore(join(mainRoot, '.daemon', 'otel-spool'));
    await store.write('traces', Buffer.from('drop'));
    const drainer = new SpoolDrainer(store, {
      endpoint: 'http://127.0.0.1:1', headers: () => ({}), events,
      fetch: async () => new Response(undefined, { status: 400 }),
    });
    const draining = drainer.drainUntilStopped();
    for (let turn = 0; turn < 1_000 && !dropped; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await drainer.stop();
    await draining;
    await events.emit({ type: 'otel_spool_backlog', signal: 'metrics', files: 1, bytes: 1, oldestAgeMs: 0, lastFailureClass: 'server' });
    persistence.stop();

    expect((await readFile(join(mainRoot, '.daemon', 'events.jsonl'), 'utf8')).split('\n')).toSatisfy((lines: string[]) =>
      lines.some((line) => line.includes('otel_spool_drop')) && lines.some((line) => line.includes('otel_spool_backlog')),
    );
  });

  it('reclaims an expired dead-owner lease and delivers its spooled batch', async () => {
    const mainRoot = await temporaryDirectory();
    const spoolDirectory = join(mainRoot, '.daemon', 'otel-spool');
    const store = new SpoolStore(spoolDirectory);
    await store.write('traces', Buffer.from('reclaim'));
    await writeFile(join(spoolDirectory, 'lease.json'), JSON.stringify({ pid: 999_999, uuid: 'dead', heartbeatAt: 0 }));
    const received: string[] = [];
    const listener = await listeningEndpoint((path) => received.push(path));
    const daemon = wireDaemonOtel({ otel: { exporter: 'otlp', endpoint: listener.endpoint, spool: { enabled: true } } }, {
      mainRoot, project: mainRoot, projectName: 'test', rootEvents: new ConductorEventEmitter(),
    });
    await listener.request;
    await daemon?.stop();

    expect(received).toContain('/v1/traces');
  });
});
