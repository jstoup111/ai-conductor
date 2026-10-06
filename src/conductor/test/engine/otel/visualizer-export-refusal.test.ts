// Covers: task:7
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wireOtelVisualizer } from '../../../src/engine/otel/wire.js';
import { OTEL_SMOKE_ENV } from '../../../src/engine/otel/export-refusal.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const constructors = vi.hoisted(() => ({ http: 0, grpc: 0 }));
vi.mock('@opentelemetry/exporter-trace-otlp-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/exporter-trace-otlp-http')>();
  class Counting extends actual.OTLPTraceExporter { constructor(...args: any[]) { constructors.http += 1; super(...args); } }
  return { ...actual, OTLPTraceExporter: Counting };
});
vi.mock('@opentelemetry/exporter-trace-otlp-grpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/exporter-trace-otlp-grpc')>();
  class Counting extends actual.OTLPTraceExporter { constructor(...args: any[]) { constructors.grpc += 1; super(...args); } }
  return { ...actual, OTLPTraceExporter: Counting };
});

const servers: Server[] = [];
async function receiver(): Promise<{ endpoint: string; connections: () => number }> {
  let connections = 0;
  const server = createServer((request, response) => { request.resume(); response.writeHead(200).end(); });
  server.on('connection', () => { connections += 1; });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing loopback address');
  return { endpoint: `http://127.0.0.1:${address.port}`, connections: () => connections };
}
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

describe('OTel visualizer export refusal', () => {
  it.each(['http/protobuf', 'grpc'] as const)('refuses %s before constructing an exporter and leaves later events usable', async (protocol) => {
    const root = await mkdtemp(join(tmpdir(), 'otel-visualizer-refusal-'));
    const planted = await receiver();
    const events = new ConductorEventEmitter();
    const errors: string[] = [];
    events.on('renderer_error', (event) => { if ('error' in event) errors.push(event.error); });
    try {
      const before = { ...constructors };
      const visualizer = wireOtelVisualizer({ otel: { exporter: 'otlp', protocol, endpoint: planted.endpoint, spool: { enabled: false } } }, {
        pipelineDir: join(root, '.pipeline'), runId: 'run', feature: 'feature', project: root,
        branch: 'feature', engineVersion: 'test', harnessVersion: 'test', env: { AI_CONDUCTOR_NO_REAL_EXEC: '1' },
      }, events);
      await Promise.resolve();
      await expect(events.emit({ type: 'feature_dispatch_started', slug: 'feature', kind: 'initial' })).resolves.toBeUndefined();
      await expect(events.emit({ type: 'step_started', step: 'build', index: 1 })).resolves.toBeUndefined();
      await expect(events.emit({ type: 'step_completed', step: 'build', status: 'done' })).resolves.toBeUndefined();
      expect(visualizer).toBeNull();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('AI_CONDUCTOR_NO_REAL_EXEC');
      expect(errors[0]).toContain(OTEL_SMOKE_ENV);
      expect(constructors).toEqual(before);
      expect(planted.connections()).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('returns a started visualizer when its start context omits the test marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'otel-visualizer-started-'));
    const planted = await receiver();
    const events = new ConductorEventEmitter();
    try {
      const visualizer = wireOtelVisualizer({ otel: { exporter: 'otlp', endpoint: planted.endpoint, spool: { enabled: false } } }, {
        pipelineDir: join(root, '.pipeline'), runId: 'run', feature: 'feature', project: root,
        branch: 'feature', engineVersion: 'test', harnessVersion: 'test', env: {},
      }, events);
      expect(visualizer).not.toBeNull();
      await visualizer?.stop();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
