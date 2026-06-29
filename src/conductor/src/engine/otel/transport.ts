import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ExportResultCode } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { JsonTraceSerializer } from '@opentelemetry/otlp-transformer';
import { JsonMetricsSerializer } from '@opentelemetry/otlp-transformer';
import type { ResolvedOtelConfig } from './otel-config.js';

export interface Exporters {
  spanExporter: SpanExporter;
  metricExporter: PushMetricExporter;
}

/**
 * Build OTel span + metric exporters for a resolved (enabled) config.
 *
 * - `exporter: 'otlp'` → OTLPTraceExporter + OTLPMetricExporter (HTTP/protobuf default)
 * - `exporter: 'file'` → FileSpanExporter + FileMetricExporter (OTLP-JSON newline-delimited)
 *
 * Never throws.
 */
export function buildExporters(
  config: Extract<ResolvedOtelConfig, { enabled: true }>,
): Exporters {
  if (config.exporter === 'otlp') {
    const url = config.endpoint;
    return {
      spanExporter: new OTLPTraceExporter({ url: `${url.replace(/\/$/, '')}/v1/traces` }),
      metricExporter: new OTLPMetricExporter({ url: `${url.replace(/\/$/, '')}/v1/metrics` }),
    };
  }

  // exporter === 'file'
  const filePath = config.file;
  return {
    spanExporter: new FileSpanExporter(filePath),
    metricExporter: new FileMetricExporter(filePath),
  };
}

// ── File-transport exporters ───────────────────────────────────────────────────

/**
 * Writes OTLP-JSON (one JSON object per export batch) as newline-delimited
 * lines to a `.jsonl` file. Parent directory is created on first write.
 *
 * Each line is a complete OTLP ExportTraceServiceRequest JSON object, making
 * the file decodable by any OTLP-aware tool and matching the events.jsonl ergonomics.
 */
class FileSpanExporter implements SpanExporter {
  private dirEnsured = false;

  constructor(private readonly filePath: string) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: number; message?: string }) => void,
  ): void {
    try {
      if (spans.length === 0) {
        resultCallback({ code: ExportResultCode.SUCCESS });
        return;
      }
      this.ensureDir();
      const bytes = JsonTraceSerializer.serializeRequest(spans);
      if (bytes) {
        appendFileSync(this.filePath, Buffer.from(bytes).toString('utf-8') + '\n', 'utf-8');
      }
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (err) {
      resultCallback({
        code: ExportResultCode.FAILED,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async shutdown(): Promise<void> {
    // Nothing to close for a file stream (appendFileSync is stateless).
  }

  async forceFlush(): Promise<void> {
    // Writes are synchronous; nothing to flush.
  }

  private ensureDir(): void {
    if (!this.dirEnsured) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.dirEnsured = true;
    }
  }
}

/**
 * Writes OTLP-JSON metric batches as newline-delimited lines to the same file
 * as the span exporter (or a separate path if configured). Each line is a
 * complete OTLP ExportMetricsServiceRequest JSON object.
 */
class FileMetricExporter implements PushMetricExporter {
  private dirEnsured = false;

  constructor(private readonly filePath: string) {}

  export(
    metrics: ResourceMetrics,
    resultCallback: (result: { code: number; message?: string }) => void,
  ): void {
    try {
      this.ensureDir();
      const bytes = JsonMetricsSerializer.serializeRequest(metrics);
      if (bytes) {
        appendFileSync(this.filePath, Buffer.from(bytes).toString('utf-8') + '\n', 'utf-8');
      }
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (err) {
      resultCallback({
        code: ExportResultCode.FAILED,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async forceFlush(): Promise<void> {
    // Writes are synchronous.
  }

  async shutdown(): Promise<void> {
    // Stateless.
  }

  private ensureDir(): void {
    if (!this.dirEnsured) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.dirEnsured = true;
    }
  }
}
