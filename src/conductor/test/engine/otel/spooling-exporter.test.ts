// Covers: task:5, task:6, task:12
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BasicTracerProvider, type ReadableSpan, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ExportResultCode } from '@opentelemetry/core';
import { AggregationTemporality, DataPointType, InstrumentType, type Histogram, type PushMetricExporter, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { ValueType } from '@opentelemetry/api';
import { resolveOtelConfig } from '../../../src/engine/otel/otel-config.js';
import { SpoolStore, type SpoolFilesystem } from '../../../src/engine/otel/spool-store.js';
import { buildExporters } from '../../../src/engine/otel/transport.js';
import { SpoolingMetricExporter, SpoolingSpanExporter } from '../../../src/engine/otel/spooling-exporter.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

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

function rejectedStore(error: Error): SpoolStore {
  return {
    write: async () => Promise.reject(error),
  } as unknown as SpoolStore;
}

function deletingAfterSecondPublishFilesystem(): SpoolFilesystem {
  let publicationCount = 0;
  let publishedPath: string | undefined;
  let deleted = false;
  return {
    mkdir,
    open,
    readFile,
    stat,
    rm,
    async rename(source, destination): Promise<void> {
      await rename(source, destination);
      publicationCount += 1;
      publishedPath = destination;
    },
    async readdir(directory): Promise<string[]> {
      const names = await readdir(directory);
      // The first write fills the cap. A drainer that lists after the second
      // publish reaches a microtask barrier, then deletes that exact batch
      // before the old post-publication bookkeeping can invoke its callback.
      const publishedName = publishedPath === undefined ? undefined : publishedPath.slice(publishedPath.lastIndexOf('/') + 1);
      if (publicationCount === 2 && !deleted && publishedName !== undefined && names.includes(publishedName)) {
        await Promise.resolve();
        deleted = true;
        await rm(join(directory, publishedName), { force: true });
      }
      return names;
    },
  };
}

interface ProtoField { wireType: number; value: number | Uint8Array; }

/** Decode just the OTLP fields asserted below, without reusing the serializer under test. */
function decodeFields(body: Uint8Array): Map<number, ProtoField[]> {
  const fields = new Map<number, ProtoField[]>();
  let offset = 0;
  const readVarint = (): number => {
    let value = 0;
    let shift = 0;
    while (true) {
      const byte = body[offset++];
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
  };
  while (offset < body.length) {
    const tag = readVarint();
    const wireType = tag & 7;
    let value: number | Uint8Array;
    if (wireType === 0) value = readVarint();
    else if (wireType === 1) {
      value = body.slice(offset, offset + 8);
      offset += 8;
    } else if (wireType === 2) {
      const length = readVarint();
      value = body.slice(offset, offset + length);
      offset += length;
    } else throw new Error(`unsupported OTLP wire type ${wireType}`);
    const field = tag >>> 3;
    fields.set(field, [...(fields.get(field) ?? []), { wireType, value }]);
  }
  return fields;
}

function embedded(fields: Map<number, ProtoField[]>, number: number): Uint8Array[] {
  return (fields.get(number) ?? []).map((field) => {
    if (!(field.value instanceof Uint8Array)) throw new Error(`OTLP field ${number} is not length-delimited`);
    return field.value;
  });
}

function requiredEmbedded(fields: Map<number, ProtoField[]>, number: number): Uint8Array {
  const [value] = embedded(fields, number);
  if (value === undefined) throw new Error(`OTLP field ${number} is missing`);
  return value;
}

function fixed64(value: number | Uint8Array): bigint {
  if (!(value instanceof Uint8Array) || value.byteLength !== 8) throw new Error('expected fixed64 OTLP field');
  return new DataView(value.buffer, value.byteOffset, value.byteLength).getBigUint64(0, true);
}

function signedFixed64(value: number | Uint8Array): number {
  if (!(value instanceof Uint8Array) || value.byteLength !== 8) throw new Error('expected sfixed64 OTLP field');
  return Number(new DataView(value.buffer, value.byteOffset, value.byteLength).getBigInt64(0, true));
}

function double(value: number | Uint8Array): number {
  if (!(value instanceof Uint8Array) || value.byteLength !== 8) throw new Error('expected double OTLP field');
  return new DataView(value.buffer, value.byteOffset, value.byteLength).getFloat64(0, true);
}

function attributeValues(fields: Map<number, ProtoField[]>, field = 1): Record<string, string> {
  return Object.fromEntries(embedded(fields, field).map((keyValue) => {
    const decoded = decodeFields(keyValue);
    const value = decodeFields(requiredEmbedded(decoded, 2));
    return [new TextDecoder().decode(requiredEmbedded(decoded, 1)), new TextDecoder().decode(requiredEmbedded(value, 1))];
  }));
}

function unixNanos([seconds, nanos]: [number, number]): bigint {
  return BigInt(seconds) * 1_000_000_000n + BigInt(nanos);
}

function otlpAggregationTemporality(temporality: AggregationTemporality): number {
  if (temporality === AggregationTemporality.DELTA) return 1;
  if (temporality === AggregationTemporality.CUMULATIVE) return 2;
  return 0;
}

/** An independent decoder for the OTLP ExportMetricsServiceRequest spool body. */
function decodeExportMetricsServiceRequest(body: Uint8Array): {
  resource: { attributes: Record<string, string>; schemaUrl: string };
  scopeMetrics: Array<{ scope: { name: string; version: string }; metrics: Array<Record<string, unknown>> }>;
} {
  const request = decodeFields(body);
  const resourceMetrics = decodeFields(requiredEmbedded(request, 1));
  const resource = decodeFields(requiredEmbedded(resourceMetrics, 1));
  const scopeMetrics = embedded(resourceMetrics, 2).map((scopeMetricsBody) => {
    const scopeMetrics = decodeFields(scopeMetricsBody);
    const scope = decodeFields(requiredEmbedded(scopeMetrics, 1));
    return {
      scope: {
        name: new TextDecoder().decode(requiredEmbedded(scope, 1)),
        version: new TextDecoder().decode(requiredEmbedded(scope, 2)),
      },
      metrics: embedded(scopeMetrics, 2).map((metricBody) => {
    const metric = decodeFields(metricBody);
    const name = new TextDecoder().decode(requiredEmbedded(metric, 1));
    const description = new TextDecoder().decode(requiredEmbedded(metric, 2));
    const unit = new TextDecoder().decode(requiredEmbedded(metric, 3));
    const sum = embedded(metric, 7)[0];
    if (sum !== undefined) {
      const sumFields = decodeFields(sum);
      const points = embedded(sumFields, 1).map((point) => {
        const fields = decodeFields(point);
        return {
          startTimeUnixNano: fixed64(fields.get(2)?.[0].value ?? 0),
          timeUnixNano: fixed64(fields.get(3)?.[0].value ?? 0),
          attributes: attributeValues(fields, 7),
          ...(fields.has(6) ? { asInt: signedFixed64(fields.get(6)?.[0].value ?? 0) } : { asDouble: double(fields.get(4)?.[0].value ?? 0) }),
        };
      });
      return {
        name,
        description,
        unit,
        sum: {
          aggregationTemporality: sumFields.get(2)?.[0].value,
          isMonotonic: sumFields.get(3)?.[0].value === 1,
          dataPoints: points,
        },
      };
    }
    const histogram = requiredEmbedded(metric, 9);
    const histogramFields = decodeFields(histogram);
    const [point] = embedded(histogramFields, 1).map(decodeFields);
    if (point === undefined) throw new Error('histogram point is missing');
    const packedCounts = requiredEmbedded(point, 6);
    const packedBounds = requiredEmbedded(point, 7);
    const counts = Array.from({ length: packedCounts.byteLength / 8 }, (_, index) =>
      Number(fixed64(packedCounts.slice(index * 8, index * 8 + 8))),
    );
    const boundaries = Array.from({ length: packedBounds.byteLength / 8 }, (_, index) =>
      double(packedBounds.slice(index * 8, index * 8 + 8)),
    );
    return {
      name,
      description,
      unit,
      histogram: {
        aggregationTemporality: histogramFields.get(2)?.[0].value,
        dataPoints: [{
          startTimeUnixNano: fixed64(point.get(2)?.[0].value ?? 0),
          timeUnixNano: fixed64(point.get(3)?.[0].value ?? 0),
          attributes: attributeValues(point, 9),
        count: Number(fixed64(point.get(4)?.[0].value ?? 0)),
        sum: double(point.get(5)?.[0].value ?? 0),
          min: double(point.get(11)?.[0].value ?? 0),
          max: double(point.get(12)?.[0].value ?? 0),
        counts,
        boundaries,
        }],
      },
    };
      }),
    };
  });
  return {
    resource: {
      attributes: attributeValues(resource),
      schemaUrl: new TextDecoder().decode(requiredEmbedded(resourceMetrics, 3)),
    },
    scopeMetrics,
  };
}

function expectedMetricsRequest(metrics: ResourceMetrics): ReturnType<typeof decodeExportMetricsServiceRequest> {
  return {
    resource: { attributes: metrics.resource.attributes as Record<string, string>, schemaUrl: metrics.resource.schemaUrl ?? '' },
    scopeMetrics: metrics.scopeMetrics.map((scopeMetrics) => ({
      scope: { name: scopeMetrics.scope.name, version: scopeMetrics.scope.version ?? '' },
      metrics: scopeMetrics.metrics.map((metric) => {
        const descriptor = { name: metric.descriptor.name, description: metric.descriptor.description, unit: metric.descriptor.unit };
        if (metric.dataPointType === DataPointType.SUM) {
          return {
            ...descriptor,
            sum: {
              aggregationTemporality: otlpAggregationTemporality(metric.aggregationTemporality),
              isMonotonic: metric.isMonotonic,
              dataPoints: metric.dataPoints.map((point) => ({
                startTimeUnixNano: unixNanos(point.startTime),
                timeUnixNano: unixNanos(point.endTime),
                attributes: point.attributes,
                ...(metric.descriptor.valueType === ValueType.INT ? { asInt: point.value } : { asDouble: point.value }),
              })),
            },
          };
        }
        return {
          ...descriptor,
          histogram: {
            aggregationTemporality: otlpAggregationTemporality(metric.aggregationTemporality),
            dataPoints: metric.dataPoints.map((point) => {
              const value = point.value as Histogram;
              return {
              startTimeUnixNano: unixNanos(point.startTime),
              timeUnixNano: unixNanos(point.endTime),
              attributes: point.attributes,
              count: value.count,
              sum: value.sum,
              min: value.min,
              max: value.max,
              counts: value.buckets.counts,
              boundaries: value.buckets.boundaries,
              };
            }),
          },
        };
      }),
    })),
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

  it('keeps capped trace and metrics batches visible through their SDK success callbacks', async () => {
    const traceDirectory = await temporaryDirectory();
    const metricDirectory = await temporaryDirectory();
    const provider = new BasicTracerProvider();
    const span = provider.getTracer('spooling-exporter-test').startSpan('capped-durable-before-success');
    span.end();
    const traceStore = new SpoolStore(traceDirectory, { maxBytes: 1_024, filesystem: deletingAfterSecondPublishFilesystem() });
    const metricStore = new SpoolStore(metricDirectory, { maxBytes: 1_024, filesystem: deletingAfterSecondPublishFilesystem() });
    const metricPayload = {
      resource: { attributes: {} } as ResourceMetrics['resource'],
      scopeMetrics: [{
        scope: { name: 'capped-callback' },
        metrics: [{
          descriptor: { name: 'capped.metric', description: '', unit: '1', valueType: ValueType.INT },
          aggregationTemporality: AggregationTemporality.CUMULATIVE,
          dataPointType: DataPointType.SUM,
          isMonotonic: true,
          dataPoints: [{ startTime: [1, 0], endTime: [2, 0], attributes: {}, value: 1 }],
        }],
      }],
    } satisfies ResourceMetrics;

    // Each new batch must evict a full-cap predecessor before publication.
    // The filesystem fake deletes only if capped bookkeeping runs after that
    // publication, reproducing the drainer/callback race deterministically.
    await traceStore.write('traces', Buffer.alloc(1_024));
    await metricStore.write('metrics', Buffer.alloc(1_024));

    await new Promise<void>((resolve, reject) => new SpoolingSpanExporter(traceStore, directSpanExporter()).export(
      [span as unknown as ReadableSpan],
      (result) => { void (async () => {
        try {
          expect(result.code).toBe(ExportResultCode.SUCCESS);
          expect((await readdir(join(traceDirectory, 'traces'))).filter((name) => name.endsWith('.pb'))).toHaveLength(1);
          resolve();
        } catch (error) { reject(error); }
      })(); },
    ));
    await new Promise<void>((resolve, reject) => new SpoolingMetricExporter(metricStore, directMetricExporter()).export(
      metricPayload,
      (result) => { void (async () => {
        try {
          expect(result.code).toBe(ExportResultCode.SUCCESS);
          expect((await readdir(join(metricDirectory, 'metrics'))).filter((name) => name.endsWith('.pb'))).toHaveLength(1);
          resolve();
        } catch (error) { reject(error); }
      })(); },
    ));
  });

  it('publishes a decodable OTLP protobuf metrics request with counter and histogram points before SDK success', async () => {
    const store = new SpoolStore(await temporaryDirectory());
    const metrics = {
      resource: { attributes: { 'service.name': 'spool-test' }, schemaUrl: 'https://example.test/resource-schema' } as unknown as ResourceMetrics['resource'],
      scopeMetrics: [{
        scope: { name: 'spooling-exporter-test', version: '1.2.3' },
        metrics: [
          {
            descriptor: { name: 'spooled.counter', description: 'counter description', unit: '1', valueType: ValueType.INT },
            aggregationTemporality: AggregationTemporality.CUMULATIVE,
            dataPointType: DataPointType.SUM,
            isMonotonic: true,
            dataPoints: [
              { startTime: [1, 100], endTime: [2, 200], attributes: {}, value: 7 },
              { startTime: [3, 300], endTime: [4, 400], attributes: { replica: 'two' }, value: 8 },
            ],
          },
          {
            descriptor: { name: 'spooled.histogram', description: 'histogram description', unit: 'ms', valueType: ValueType.DOUBLE },
            aggregationTemporality: AggregationTemporality.CUMULATIVE,
            dataPointType: DataPointType.HISTOGRAM,
            dataPoints: [{
              startTime: [5, 500], endTime: [6, 600], attributes: { replica: 'one' },
              value: { min: 2, max: 8, sum: 10, count: 2, buckets: { boundaries: [5], counts: [1, 1] } },
            }],
          },
        ],
      }],
    } satisfies ResourceMetrics;
    const exporter = new SpoolingMetricExporter(store, directMetricExporter());

    let decoded: ReturnType<typeof decodeExportMetricsServiceRequest> | undefined;
    const result = await new Promise<{ code: number }>((resolve, reject) => {
      exporter.export(metrics, (exportResult) => { void (async () => {
        try {
          const [batch] = await store.list('metrics');
          expect(batch).toBeDefined();
          expect(batch.items).toBe(3);
          const spooledBody = await readFile(batch.path);
          decoded = decodeExportMetricsServiceRequest(spooledBody);
          resolve(exportResult);
        } catch (error) { reject(error); }
      })(); });
    });

    expect(result.code).toBe(ExportResultCode.SUCCESS);
    expect(decoded).toEqual(expectedMetricsRequest(metrics));
  });

  it('decodes a floating-point sum value as OTLP as_double', async () => {
    const store = new SpoolStore(await temporaryDirectory());
    const metrics = {
      resource: { attributes: { 'service.name': 'spool-double-test' }, schemaUrl: 'https://example.test/double-resource-schema' } as unknown as ResourceMetrics['resource'],
      scopeMetrics: [{
        scope: { name: 'spooling-double-test', version: '2.0.0' },
        metrics: [{
          descriptor: { name: 'spooled.double', description: 'double description', unit: 'ms', valueType: ValueType.DOUBLE },
          aggregationTemporality: AggregationTemporality.DELTA,
          dataPointType: DataPointType.SUM,
          isMonotonic: false,
          dataPoints: [{ startTime: [7, 700], endTime: [8, 800], attributes: { replica: 'double' }, value: 1.5 }],
        }],
      }],
    } satisfies ResourceMetrics;
    const exporter = new SpoolingMetricExporter(store, directMetricExporter());
    let decoded: ReturnType<typeof decodeExportMetricsServiceRequest> | undefined;

    await new Promise<void>((resolve, reject) => exporter.export(metrics, () => { void (async () => {
      try {
        const [batch] = await store.list('metrics');
        decoded = decodeExportMetricsServiceRequest(await readFile(batch.path));
        resolve();
      } catch (error) { reject(error); }
    })(); }));

    expect(decoded).toEqual(expectedMetricsRequest(metrics));
  });

  it('delegates LOWMEMORY aggregation selectors unchanged to the direct HTTP exporter', async () => {
    const directory = await temporaryDirectory();
    const resolved = resolveOtelConfig({ otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } }, directory);
    if (!resolved.enabled || resolved.exporter !== 'otlp') throw new Error('expected OTLP configuration to be enabled');
    const direct = buildExporters(resolved, { env: {} }).metricExporter;
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

  it.each(['ENOSPC', 'EACCES'])('falls back to direct export after a %s spool write failure without throwing', async (code) => {
    const error = Object.assign(new Error(`spool write failed: ${code}`), { code });
    const events = new ConductorEventEmitter();
    const warnings: string[] = [];
    const directBatches: ReadableSpan[][] = [];
    events.on('renderer_error', (event) => {
      if (event.type === 'renderer_error') warnings.push(event.error);
    });
    const exporter = new SpoolingSpanExporter(rejectedStore(error), {
      export(spans, callback): void {
        directBatches.push(spans);
        callback({ code: ExportResultCode.SUCCESS });
      },
      async shutdown(): Promise<void> {},
      async forceFlush(): Promise<void> {},
    }, events);
    const provider = new BasicTracerProvider();
    const span = provider.getTracer('spooling-exporter-test').startSpan('direct-send-fallback');
    span.end();
    const spans = [span as unknown as ReadableSpan];

    const results = await Promise.all(Array.from({ length: 3 }, () => new Promise<{ code: number }>((resolve) => {
      expect(() => exporter.export(spans, resolve)).not.toThrow();
    })));

    expect(directBatches).toEqual([spans, spans, spans]);
    expect(results).toEqual([
      { code: ExportResultCode.SUCCESS },
      { code: ExportResultCode.SUCCESS },
      { code: ExportResultCode.SUCCESS },
    ]);
    expect(warnings).toEqual([`[otel] spool write failed; sending directly: spool write failed: ${code}`]);
  });

  it.each([
    [{ evictedBatches: 2, evictedItems: 4 }, { batches: 2, items: 4 }],
    [{ rejectedOversize: true, rejectedItems: 7 }, { batches: 1, items: 7 }],
  ] as const)('emits an evicted spool-drop event for a write result of %o', async (writeResult, counts) => {
    const events = new ConductorEventEmitter();
    const drops: unknown[] = [];
    events.on('otel_spool_drop', (event) => { drops.push(event); });
    const store = {
      write: async () => writeResult,
    } as unknown as SpoolStore;
    const provider = new BasicTracerProvider();
    const span = provider.getTracer('spooling-exporter-test').startSpan('eviction-is-visible');
    span.end();
    const exporter = new SpoolingSpanExporter(store, directSpanExporter(), events);

    await new Promise<void>((resolve) => exporter.export([span as unknown as ReadableSpan], () => resolve()));

    expect(drops).toEqual([
      { type: 'otel_spool_drop', signal: 'traces', reason: 'evicted', ...counts },
    ]);
  });

  it('emits a metric spool-drop event with the actual data-point count', async () => {
    const events = new ConductorEventEmitter();
    const drops: unknown[] = [];
    events.on('otel_spool_drop', (event) => { drops.push(event); });
    const store = {
      write: async (_signal: string, _body: Uint8Array, items: number) =>
        ({ rejectedOversize: true, rejectedItems: items, evictedBatches: 0, evictedItems: 0 }),
    } as unknown as SpoolStore;
    const metrics = {
      resource: { attributes: {} } as ResourceMetrics['resource'],
      scopeMetrics: [{
        scope: { name: 'metric-count' },
        metrics: [{
          descriptor: { name: 'metric.count', description: '', unit: '1', valueType: ValueType.INT },
          aggregationTemporality: AggregationTemporality.CUMULATIVE,
          dataPointType: DataPointType.SUM,
          isMonotonic: true,
          dataPoints: [
            { startTime: [1, 0], endTime: [2, 0], attributes: {}, value: 1 },
            { startTime: [1, 0], endTime: [2, 0], attributes: { replica: 'two' }, value: 2 },
            { startTime: [1, 0], endTime: [2, 0], attributes: { replica: 'three' }, value: 3 },
          ],
        }],
      }],
    } satisfies ResourceMetrics;
    const exporter = new SpoolingMetricExporter(store, directMetricExporter(), events);

    await new Promise<void>((resolve) => exporter.export(metrics, () => resolve()));

    expect(drops).toEqual([
      { type: 'otel_spool_drop', signal: 'metrics', reason: 'evicted', batches: 1, items: 3 },
    ]);
  });
});
