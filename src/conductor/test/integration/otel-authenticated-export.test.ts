// Covers: task:3, task:9
import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { ExportResultCode } from '@opentelemetry/core';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { buildExporters } from '../../src/engine/otel/transport.js';
import { vi } from 'vitest';

const HEADER_ENV = 'OTEL_AUTHENTICATED_EXPORT_TEST_TOKEN';
const previousHeaderValue = process.env[HEADER_ENV];

afterEach(() => {
  if (previousHeaderValue === undefined) delete process.env[HEADER_ENV];
  else process.env[HEADER_ENV] = previousHeaderValue;
});

describe('authenticated OTLP HTTP export', () => {
  it('sends resolved headers to the traces endpoint', async () => {
    let receivedHeaders: IncomingHttpHeaders | undefined;
    let receivedPath: string | undefined;
    let resolveRequest: (() => void) | undefined;
    const requestReceived = new Promise<void>((resolve) => { resolveRequest = resolve; });
    const server = createServer((request, response) => {
      receivedHeaders = request.headers;
      receivedPath = request.url;
      response.writeHead(200).end();
      resolveRequest?.();
    });

    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('loopback listener has no TCP address');

      process.env[HEADER_ENV] = 'Bearer integration-token';
      const resolved = resolveOtelConfig(
        {
          otel: {
            exporter: 'otlp',
            endpoint: `http://127.0.0.1:${address.port}`,
            headers: { Authorization: { env: HEADER_ENV } },
          },
        },
        '/tmp/otel-authenticated-export',
      );
      expect(resolved.enabled).toBe(true);
      expect(resolved).toMatchObject({ enabled: true, headers: { Authorization: 'Bearer integration-token' } });
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>, {
        env: { ...process.env, AI_CONDUCTOR_NO_REAL_EXEC: undefined },
      });

      const provider = new BasicTracerProvider();
      const span = provider.getTracer('otel-authenticated-export-test').startSpan('authenticated-export');
      span.end();

      await new Promise<void>((resolve, reject) => {
        exporters.spanExporter.export([span as unknown as ReadableSpan], (result) => {
          if (result.code === ExportResultCode.SUCCESS) resolve();
          else reject(new Error(result.error?.message ?? 'OTLP export failed'));
        });
      });
      await requestReceived;

      expect(receivedPath).toBe('/v1/traces');
      expect(receivedHeaders?.authorization).toBe('Bearer integration-token');
      await exporters.spanExporter.shutdown();
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('resolves a command header at export time without exposing a failed command to the receiver', async () => {
    const received: IncomingHttpHeaders[] = [];
    const server = createServer((request, response) => {
      received.push(request.headers);
      request.resume();
      response.writeHead(200).end();
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('loopback listener has no TCP address');
      const resolved = resolveOtelConfig({ otel: {
        exporter: 'otlp', endpoint: `http://127.0.0.1:${address.port}`,
        headers: { authorization: { command: ['credential-command'], prefix: 'Bearer ' } }, spool: { enabled: false },
      } }, '/tmp/otel-authenticated-export');
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>, {
        env: { ...process.env, AI_CONDUCTOR_NO_REAL_EXEC: undefined },
        commandRunner: vi.fn().mockResolvedValue({ stdout: 'tok-123\n' }),
      });
      const provider = new BasicTracerProvider();
      const span = provider.getTracer('otel-authenticated-export-test').startSpan('command-authenticated-export');
      span.end();
      await new Promise<void>((resolve, reject) => exporters.spanExporter.export([span as unknown as ReadableSpan], (result) => {
        if (result.code === ExportResultCode.SUCCESS) resolve();
        else reject(new Error(result.error?.message ?? 'OTLP export failed'));
      }));
      expect(received).toHaveLength(1);
      expect(received[0]?.authorization).toBe('Bearer tok-123');
      await exporters.spanExporter.shutdown();
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('sends an unprefixed command header and returns FAILED without a receiver request on command failure', async () => {
    const received: IncomingHttpHeaders[] = [];
    const server = createServer((request, response) => {
      received.push(request.headers);
      request.resume();
      response.writeHead(200).end();
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('loopback listener has no TCP address');
      const config = (runner: ReturnType<typeof vi.fn>) => resolveOtelConfig({ otel: {
        exporter: 'otlp', endpoint: `http://127.0.0.1:${address.port}`,
        headers: { authorization: { command: ['credential-command'] } }, spool: { enabled: false },
      } }, '/tmp/otel-authenticated-export');
      const exportOne = async (runner: ReturnType<typeof vi.fn>) => {
        const resolved = config(runner);
        const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>, {
          env: { ...process.env, AI_CONDUCTOR_NO_REAL_EXEC: undefined }, commandRunner: runner,
        });
        const span = new BasicTracerProvider().getTracer('otel-authenticated-export-test').startSpan('command-export');
        span.end();
        const result = await new Promise<{ code: number }>((resolve) => exporters.spanExporter.export([span as unknown as ReadableSpan], resolve));
        await exporters.spanExporter.shutdown();
        return result;
      };
      await expect(exportOne(vi.fn().mockResolvedValue({ stdout: 'tok-123\n' }))).resolves.toMatchObject({ code: ExportResultCode.SUCCESS });
      expect(received).toHaveLength(1);
      expect(received[0]?.authorization).toBe('tok-123');

      const unhandled: unknown[] = [];
      const listener = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', listener);
      try {
        await expect(exportOne(vi.fn().mockRejectedValue(Object.assign(new Error('failed'), { code: 3 })))).resolves.toMatchObject({ code: ExportResultCode.FAILED });
        await expect(exportOne(vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })))).resolves.toMatchObject({ code: ExportResultCode.FAILED });
      } finally { process.off('unhandledRejection', listener); }
      expect({ received: received.length, unhandled }).toEqual({ received: 1, unhandled: [] });
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('reuses a direct-export command credential until its injected cache expiry', async () => {
    const received: string[] = [];
    const server = createServer((request, response) => {
      received.push(String(request.headers.authorization));
      request.resume();
      response.writeHead(200).end();
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('loopback listener has no TCP address');
      const resolved = resolveOtelConfig({ otel: {
        exporter: 'otlp', endpoint: `http://127.0.0.1:${address.port}`,
        headers: { authorization: { command: ['credential-command'], prefix: 'Bearer ' } }, spool: { enabled: false },
      } }, '/tmp/otel-authenticated-export');
      let now = 0;
      const runner = vi.fn().mockResolvedValueOnce({ stdout: 'tok-1\n' }).mockResolvedValueOnce({ stdout: 'tok-2\n' });
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>, {
        env: { ...process.env, AI_CONDUCTOR_NO_REAL_EXEC: undefined }, commandRunner: runner, now: () => now,
      });
      const exportOne = () => new Promise<{ code: number }>((resolve) => {
        const span = new BasicTracerProvider().getTracer('otel-authenticated-export-test').startSpan('cached-command-export');
        span.end();
        exporters.spanExporter.export([span as unknown as ReadableSpan], resolve);
      });
      await expect(exportOne()).resolves.toMatchObject({ code: ExportResultCode.SUCCESS });
      now = 299_000;
      await expect(exportOne()).resolves.toMatchObject({ code: ExportResultCode.SUCCESS });
      now = 300_000;
      await expect(exportOne()).resolves.toMatchObject({ code: ExportResultCode.SUCCESS });
      await exporters.spanExporter.shutdown();
      expect({ received, calls: runner.mock.calls.length }).toEqual({ received: ['Bearer tok-1', 'Bearer tok-1', 'Bearer tok-2'], calls: 2 });
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('shares an expired direct-export refresh and retries an uncached failed credential', async () => {
    const received: string[] = [];
    const server = createServer((request, response) => {
      received.push(String(request.headers.authorization));
      request.resume();
      response.writeHead(200).end();
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('loopback listener has no TCP address');
      const resolved = resolveOtelConfig({ otel: {
        exporter: 'otlp', endpoint: `http://127.0.0.1:${address.port}`,
        headers: { authorization: { command: ['credential-command'], prefix: 'Bearer ' } }, spool: { enabled: false },
      } }, '/tmp/otel-authenticated-export') as Extract<ReturnType<typeof resolveOtelConfig>, { enabled: true }>;
      let now = 0;
      let releaseRefresh!: (result: { stdout: string }) => void;
      const refresh = new Promise<{ stdout: string }>((resolve) => { releaseRefresh = resolve; });
      const runner = vi.fn().mockResolvedValueOnce({ stdout: 'tok-1\n' }).mockImplementationOnce(() => refresh);
      const exporters = buildExporters(resolved, { env: { ...process.env, AI_CONDUCTOR_NO_REAL_EXEC: undefined }, commandRunner: runner, now: () => now });
      const exportOne = () => new Promise<{ code: number }>((resolve) => {
        const span = new BasicTracerProvider().getTracer('otel-authenticated-export-test').startSpan('concurrent-command-export');
        span.end();
        exporters.spanExporter.export([span as unknown as ReadableSpan], resolve);
      });
      await expect(exportOne()).resolves.toMatchObject({ code: ExportResultCode.SUCCESS });
      now = 300_000;
      const exports = Array.from({ length: 5 }, exportOne);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(runner).toHaveBeenCalledTimes(2);
      releaseRefresh({ stdout: 'tok-2\n' });
      await expect(Promise.all(exports)).resolves.toEqual(Array.from({ length: 5 }, () => expect.objectContaining({ code: ExportResultCode.SUCCESS })));
      await exporters.spanExporter.shutdown();

      const retryRunner = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('failed'), { code: 3 }))
        .mockResolvedValueOnce({ stdout: 'recovered\n' });
      const retryExporters = buildExporters(resolved, { env: { ...process.env, AI_CONDUCTOR_NO_REAL_EXEC: undefined }, commandRunner: retryRunner, now: () => now });
      const retryOne = () => new Promise<{ code: number }>((resolve) => {
        const span = new BasicTracerProvider().getTracer('otel-authenticated-export-test').startSpan('retry-command-export');
        span.end();
        retryExporters.spanExporter.export([span as unknown as ReadableSpan], resolve);
      });
      await expect(retryOne()).resolves.toMatchObject({ code: ExportResultCode.FAILED });
      await expect(retryOne()).resolves.toMatchObject({ code: ExportResultCode.SUCCESS });
      await retryExporters.spanExporter.shutdown();
      expect({ runnerCalls: runner.mock.calls.length, retryCalls: retryRunner.mock.calls.length, received }).toEqual({
        runnerCalls: 2,
        retryCalls: 2,
        received: ['Bearer tok-1', 'Bearer tok-2', 'Bearer tok-2', 'Bearer tok-2', 'Bearer tok-2', 'Bearer tok-2', 'Bearer recovered'],
      });
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
