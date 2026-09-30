import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { ProtobufMetricsSerializer, ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { ConductorEventEmitter } from '../../ui/events.js';
import { SpoolStore } from './spool-store.js';

/**
 * Acknowledges spans to the SDK only after their exact OTLP/HTTP protobuf
 * request body has been durably published by the spool store.
 */
export class SpoolingSpanExporter implements SpanExporter {
  private warned = false;

  constructor(
    private readonly store: SpoolStore,
    private readonly inner: SpanExporter,
    private readonly events?: ConductorEventEmitter,
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
      this.warn(error);
      this.inner.export(spans, resultCallback);
    }
  }

  private warn(error: unknown): void {
    if (this.warned) return;
    this.warned = true;
    const detail = error instanceof Error ? error.message : String(error);
    void this.events?.emit({
      type: 'renderer_error',
      rendererName: 'otel',
      error: `[otel] spool write failed; sending directly: ${detail}`,
    });
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
  private warned = false;

  constructor(
    private readonly store: SpoolStore,
    private readonly inner: PushMetricExporter,
    private readonly events?: ConductorEventEmitter,
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
      this.warn(error);
      this.inner.export(metrics, resultCallback);
    }
  }

  private warn(error: unknown): void {
    if (this.warned) return;
    this.warned = true;
    const detail = error instanceof Error ? error.message : String(error);
    void this.events?.emit({
      type: 'renderer_error',
      rendererName: 'otel',
      error: `[otel] spool write failed; sending directly: ${detail}`,
    });
  }
}
