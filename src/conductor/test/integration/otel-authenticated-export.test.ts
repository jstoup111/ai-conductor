import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { ExportResultCode } from '@opentelemetry/core';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { buildExporters } from '../../src/engine/otel/transport.js';

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
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);

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
});
