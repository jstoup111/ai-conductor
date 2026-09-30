// Covers: task:5
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BasicTracerProvider, type ReadableSpan, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ExportResultCode } from '@opentelemetry/core';
import { InstrumentType, type PushMetricExporter, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { ProtobufMetricsSerializer } from '@opentelemetry/otlp-transformer';
import { resolveOtelConfig } from '../../../src/engine/otel/otel-config.js';
import { SpoolStore } from '../../../src/engine/otel/spool-store.js';
import { buildExporters } from '../../../src/engine/otel/transport.js';
import { SpoolingMetricExporter, SpoolingSpanExporter } from '../../../src/engine/otel/spooling-exporter.js';

const directories: string[] = [];
const headerEnvironment = 'OTEL_SPOOLING_EXPORTER_TEST_HEADER';
const originalHeaderValue = process.env[headerEnvironment];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'otel-spooling-exporter-'));
  directories.push(directory);
  return directory;
}

function directSpanExporter(): SpanExporter {
  return {
    export(_spans, callback): void { callback({ code: ExportResultCode.SUCCESS }); },
    async shutdown(): Promise<void> {},
    async forceFlush(): Promise<void> {},
  };
}

function directMetricExporter(): PushMetricExporter {
  return {
    export(_metrics, callback): void { callback({ code: ExportResultCode.SUCCESS }); },
    async forceFlush(): Promise<void> {},
    async shutdown(): Promise<void> {},
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  if (originalHeaderValue === undefined) delete process.env[headerEnvironment];
  else process.env[headerEnvironment] = originalHeaderValue;
});

describe('spooling exporters', () => {
  it('publishes a traces batch before reporting SDK success', async () => {
    const store = new SpoolStore(await temporaryDirectory());
    const provider = new BasicTracerProvider();
    const span = provider.getTracer('spooling-exporter-test').startSpan('durable-before-success');
    span.end();
    const exporter = new SpoolingSpanExporter(store, directSpanExporter());

    const result = await new Promise<{ code: number }>((resolve) => {
      exporter.export([span as unknown as ReadableSpan], async (exportResult) => {
        expect(await store.list('traces')).toHaveLength(1);
        resolve(exportResult);
      });
    });

    expect(result.code).toBe(ExportResultCode.SUCCESS);
  });

  it('publishes the exact OTLP protobuf metrics request body before reporting SDK success', async () => {
    const store = new SpoolStore(await temporaryDirectory());
    const metrics = {
      resource: { attributes: {} } as ResourceMetrics['resource'],
      scopeMetrics: [],
    } satisfies ResourceMetrics;
    const expectedBody = ProtobufMetricsSerializer.serializeRequest(metrics);
    if (!expectedBody) throw new Error('expected metrics serializer to produce an OTLP request body');
    const exporter = new SpoolingMetricExporter(store, directMetricExporter());

    const result = await new Promise<{ code: number }>((resolve) => {
      exporter.export(metrics, async (exportResult) => {
        const [batch] = await store.list('metrics');
        expect(batch).toBeDefined();
        expect(await readFile(batch.path)).toEqual(Buffer.from(expectedBody));
        resolve(exportResult);
      });
    });

    expect(result.code).toBe(ExportResultCode.SUCCESS);
  });

  it('delegates LOWMEMORY aggregation selectors unchanged to the direct HTTP exporter', async () => {
    const directory = await temporaryDirectory();
    const resolved = resolveOtelConfig({ otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } }, directory);
    if (!resolved.enabled || resolved.exporter !== 'otlp') throw new Error('expected OTLP configuration to be enabled');
    const direct = buildExporters(resolved).metricExporter;
    const exporter = new SpoolingMetricExporter(new SpoolStore(directory), direct);
    const instruments = [InstrumentType.COUNTER, InstrumentType.HISTOGRAM, InstrumentType.GAUGE, InstrumentType.UP_DOWN_COUNTER];

    expect(instruments.map((instrument) => ({
      temporality: exporter.selectAggregationTemporality?.(instrument),
      aggregation: exporter.selectAggregation?.(instrument),
    }))).toEqual(instruments.map((instrument) => ({
      temporality: direct.selectAggregationTemporality?.(instrument),
      aggregation: direct.selectAggregation?.(instrument),
    })));
    await direct.shutdown();
  });

  it('does not persist a resolved OTLP header value in any spool file', async () => {
    const secret = 'secret-value';
    process.env[headerEnvironment] = secret;
    const resolved = resolveOtelConfig({
      otel: {
        exporter: 'otlp',
        endpoint: 'http://localhost:4318',
        headers: { 'DD-API-KEY': { env: headerEnvironment } },
      },
    }, '/tmp/otel-spooling-exporter-header');
    if (!resolved.enabled || resolved.exporter !== 'otlp') throw new Error('expected OTLP configuration to be enabled');
    expect(resolved.headers?.['DD-API-KEY']).toBe(secret);
    const store = new SpoolStore(await temporaryDirectory());
    const provider = new BasicTracerProvider();
    const span = provider.getTracer('spooling-exporter-test').startSpan('header-is-not-body');
    span.end();
    const exporter = new SpoolingSpanExporter(store, directSpanExporter());

    await new Promise<void>((resolve) => exporter.export([span as unknown as ReadableSpan], () => resolve()));
    const bodies = await Promise.all((await store.list('traces')).map((batch) => readFile(batch.path, 'utf8')));

    expect(bodies.join('')).not.toContain(secret);
  });
});
