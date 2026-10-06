// Covers: task:6
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wireDaemonOtel, wireInteractiveOtelMetrics } from '../../../src/engine/otel/wire.js';
import { OTEL_SMOKE_ENV } from '../../../src/engine/otel/export-refusal.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

// The production transport remains in use; these wrappers only count whether
// the OTLP constructors are reached before refusal.
const constructors = vi.hoisted(() => ({ httpTrace: 0, httpMetric: 0, grpcTrace: 0, grpcMetric: 0 }));
vi.mock('@opentelemetry/exporter-trace-otlp-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/exporter-trace-otlp-http')>();
  class Counting extends actual.OTLPTraceExporter { constructor(...args: any[]) { constructors.httpTrace += 1; super(...args); } }
  return { ...actual, OTLPTraceExporter: Counting };
});
vi.mock('@opentelemetry/exporter-metrics-otlp-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/exporter-metrics-otlp-http')>();
  class Counting extends actual.OTLPMetricExporter { constructor(...args: any[]) { constructors.httpMetric += 1; super(...args); } }
  return { ...actual, OTLPMetricExporter: Counting };
});
vi.mock('@opentelemetry/exporter-trace-otlp-grpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/exporter-trace-otlp-grpc')>();
  class Counting extends actual.OTLPTraceExporter { constructor(...args: any[]) { constructors.grpcTrace += 1; super(...args); } }
  return { ...actual, OTLPTraceExporter: Counting };
});
vi.mock('@opentelemetry/exporter-metrics-otlp-grpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/exporter-metrics-otlp-grpc')>();
  class Counting extends actual.OTLPMetricExporter { constructor(...args: any[]) { constructors.grpcMetric += 1; super(...args); } }
  return { ...actual, OTLPMetricExporter: Counting };
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

describe('OTLP metric wiring refusal', () => {
  it.each([
    ['daemon', 'http/protobuf'],
    ['interactive', 'http/protobuf'],
    ['daemon', 'grpc'],
    ['interactive', 'grpc'],
  ] as const)('%s %s refuses before constructing a live metric pipeline and emits one visible error', async (kind, protocol) => {
    const root = await mkdtemp(join(tmpdir(), 'otel-wire-refusal-'));
    const planted = await receiver();
    const events = new ConductorEventEmitter();
    const errors: string[] = [];
    events.on('renderer_error', (event) => { if ('error' in event) errors.push(event.error); });
    const config = { otel: { exporter: 'otlp' as const, protocol, endpoint: planted.endpoint, spool: { enabled: false } } };
    const before = { ...constructors };
    try {
      const value = kind === 'daemon'
        ? wireDaemonOtel(config, { mainRoot: root, project: root, projectName: 'test', rootEvents: events, env: { AI_CONDUCTOR_NO_REAL_EXEC: '1' } })
        : wireInteractiveOtelMetrics(config, { pipelineDir: join(root, '.pipeline'), runId: 'run', feature: 'feature', project: root, branch: 'feature', engineVersion: 'test', harnessVersion: 'test', env: { AI_CONDUCTOR_NO_REAL_EXEC: '1' } }, events);
      await Promise.resolve();
      await events.emit({ type: 'step_started', step: 'build', index: 1 });
      expect(value).toBeNull();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('AI_CONDUCTOR_NO_REAL_EXEC');
      expect(errors[0]).toContain(OTEL_SMOKE_ENV);
      expect(constructors).toEqual(before);
      expect(planted.connections()).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
