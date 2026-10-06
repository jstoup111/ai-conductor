// Covers: task:8
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMergedConfig } from '../../src/engine/config.js';
import { wireDaemonOtel, wireOtelVisualizer } from '../../src/engine/otel/wire.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const servers: Server[] = [];
async function plantedReceiver(): Promise<{ endpoint: string; requests: () => number }> {
  let requests = 0;
  const server = createServer((request, response) => { requests += 1; request.resume(); response.writeHead(200).end(); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no loopback address');
  return { endpoint: `http://127.0.0.1:${address.port}`, requests: () => requests };
}
async function fixtureConfig(root: string, endpoint: string): Promise<void> {
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), `otel:\n  exporter: otlp\n  endpoint: ${endpoint}\n  spool:\n    enabled: false\n`, 'utf8');
}
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

describe.sequential('OTel test-run isolation', () => {
  it('refuses the live-root OTLP configuration before it can contact a planted receiver', async () => {
    const root = await mkdtemp(join(tmpdir(), 'otel-live-root-'));
    const receiver = await plantedReceiver();
    const loaded = await loadMergedConfig(fileURLToPath(new URL('../../../../', import.meta.url)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(loaded.config.otel?.exporter).toBe('otlp');
    const config = { ...loaded.config, otel: { ...loaded.config.otel!, endpoint: receiver.endpoint } };
    const events = new ConductorEventEmitter();
    const errors: string[] = [];
    events.on('renderer_error', (event) => { if ('error' in event) errors.push(event.error); });
    try {
      const daemon = wireDaemonOtel(config, { mainRoot: root, project: root, projectName: 'fixture', rootEvents: events, env: { AI_CONDUCTOR_NO_REAL_EXEC: '1' } });
      await Promise.resolve();
      expect(daemon).toBeNull();
      expect(errors).toHaveLength(1);
      expect(receiver.requests()).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('flushes and stops fixture OTLP wiring without requests under the marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'otel-fixture-project-'));
    const receiver = await plantedReceiver();
    await fixtureConfig(root, receiver.endpoint);
    const loaded = await loadMergedConfig(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.error.message);
    const events = new ConductorEventEmitter();
    try {
      const daemon = wireDaemonOtel(loaded.config, { mainRoot: root, project: root, projectName: 'fixture', rootEvents: events, env: { AI_CONDUCTOR_NO_REAL_EXEC: '1' } });
      await daemon?.flush();
      await daemon?.stop();
      expect(daemon).toBeNull();
      expect(receiver.requests()).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('does not export planted HOME configuration through daemon or visualizer wiring', async () => {
    const root = await mkdtemp(join(tmpdir(), 'otel-planted-home-project-'));
    const home = await mkdtemp(join(tmpdir(), 'otel-planted-home-'));
    const receiver = await plantedReceiver();
    const previousHome = process.env.HOME;
    await fixtureConfig(root, receiver.endpoint);
    await mkdir(join(home, '.ai-conductor'), { recursive: true });
    await writeFile(join(home, '.ai-conductor', 'config.yml'), `otel:\n  exporter: otlp\n  endpoint: ${receiver.endpoint}\n`, 'utf8');
    process.env.HOME = home;
    try {
      const loaded = await loadMergedConfig(root);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) throw new Error(loaded.error.message);
      const daemonEvents = new ConductorEventEmitter();
      const visualizerEvents = new ConductorEventEmitter();
      const daemon = wireDaemonOtel(loaded.config, { mainRoot: root, project: root, projectName: 'fixture', rootEvents: daemonEvents, env: { AI_CONDUCTOR_NO_REAL_EXEC: '1' } });
      const visualizer = wireOtelVisualizer(loaded.config, { pipelineDir: join(root, '.pipeline'), runId: 'run', feature: 'feature', project: root, branch: 'feature', engineVersion: 'test', harnessVersion: 'test', env: { AI_CONDUCTOR_NO_REAL_EXEC: '1' } }, visualizerEvents);
      await daemon?.flush(); await daemon?.stop(); await visualizer?.stop();
      expect(daemon).toBeNull();
      expect(visualizer).toBeNull();
      expect(receiver.requests()).toBe(0);
    } finally {
      if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
      await Promise.all([rm(root, { recursive: true, force: true }), rm(home, { recursive: true, force: true })]);
    }
  });
});
