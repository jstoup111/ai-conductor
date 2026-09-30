import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { ProtobufMetricsSerializer, ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { SpoolStore } from './spool-store.js';

/**
 * Acknowledges spans to the SDK only after their exact OTLP/HTTP protobuf
 * request body has been durably published by the spool store.
 */
export class SpoolingSpanExporter implements SpanExporter {
  constructor(
    private readonly store: SpoolStore,
    private readonly inner: SpanExporter,
  ) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    void this.write(spans, resultCallback);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  private async write(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): Promise<void> {
    try {
      await this.store.write('traces', ProtobufTraceSerializer.serializeRequest(spans) ?? new Uint8Array(), spans.length);
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}

/**
 * Acknowledges metrics to the SDK only after their exact OTLP/HTTP protobuf
 * request body has been durably published. The direct exporter's aggregation
 * selectors remain authoritative so the SDK retains LOWMEMORY temporality.
 */
export class SpoolingMetricExporter implements PushMetricExporter {
  readonly selectAggregationTemporality: PushMetricExporter['selectAggregationTemporality'];
  readonly selectAggregation: PushMetricExporter['selectAggregation'];

  constructor(
    private readonly store: SpoolStore,
    private readonly inner: PushMetricExporter,
  ) {
    this.selectAggregationTemporality = inner.selectAggregationTemporality?.bind(inner);
    this.selectAggregation = inner.selectAggregation?.bind(inner);
  }

  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    void this.write(metrics, resultCallback);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  private async write(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): Promise<void> {
    try {
      await this.store.write('metrics', ProtobufMetricsSerializer.serializeRequest(metrics) ?? new Uint8Array());
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}
