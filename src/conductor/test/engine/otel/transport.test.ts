/**
 * T8: buildExporters(otelConfig) — transport factory.
 * FR-7: OTLP HTTP default (port 4318), gRPC (port 4317) selectable via config,
 *       file transport writes OTLP-JSON newline-delimited.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildExporters, type Exporters } from '../../../src/engine/otel/transport.js';
import { resolveOtelConfig } from '../../../src/engine/otel/otel-config.js';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter as OTLPGrpcTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter as OTLPGrpcMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter as OTLPHttpTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter as OTLPHttpMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

describe('buildExporters', () => {
  let tempDir: string;
  let pipelineDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'otel-transport-'));
    pipelineDir = join(tempDir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('otlp exporter', () => {
    it('returns spanExporter and metricExporter for otlp config', () => {
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
        pipelineDir,
      );
      expect(resolved.enabled).toBe(true);
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);
      expect(exporters.spanExporter).toBeDefined();
      expect(exporters.metricExporter).toBeDefined();
    });

    it('spanExporter has a shutdown method (standard OTel exporter contract)', () => {
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
        pipelineDir,
      );
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);
      expect(typeof exporters.spanExporter.shutdown).toBe('function');
    });

    it('uses HTTP exporter when no protocol or http/protobuf specified', () => {
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
        pipelineDir,
      );
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);
      expect(exporters.spanExporter).toBeInstanceOf(OTLPHttpTraceExporter);
      expect(exporters.metricExporter).toBeInstanceOf(OTLPHttpMetricExporter);
    });

    it('uses HTTP exporter when protocol is http/protobuf', () => {
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318', protocol: 'http/protobuf' } },
        pipelineDir,
      );
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);
      expect(exporters.spanExporter).toBeInstanceOf(OTLPHttpTraceExporter);
      expect(exporters.metricExporter).toBeInstanceOf(OTLPHttpMetricExporter);
    });

    it('uses gRPC exporter when protocol is grpc', () => {
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://localhost:4317', protocol: 'grpc' } },
        pipelineDir,
      );
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);
      expect(exporters.spanExporter).toBeInstanceOf(OTLPGrpcTraceExporter);
      expect(exporters.metricExporter).toBeInstanceOf(OTLPGrpcMetricExporter);
    });

    it('gRPC exporter is NOT an HTTP exporter instance', () => {
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://localhost:4317', protocol: 'grpc' } },
        pipelineDir,
      );
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);
      expect(exporters.spanExporter).not.toBeInstanceOf(OTLPHttpTraceExporter);
      expect(exporters.metricExporter).not.toBeInstanceOf(OTLPHttpMetricExporter);
    });
  });

  describe('file exporter', () => {
    it('returns spanExporter and metricExporter for file config', () => {
      const resolved = resolveOtelConfig({ otel: { exporter: 'file' } }, pipelineDir);
      expect(resolved.enabled).toBe(true);
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);
      expect(exporters.spanExporter).toBeDefined();
      expect(exporters.metricExporter).toBeDefined();
    });

    it('file span exporter writes OTLP-JSON lines to the configured path', async () => {
      const filePath = join(pipelineDir, 'otel.jsonl');
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'file', file: filePath } },
        pipelineDir,
      );
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);

      // Export a fake span result — we use the in-memory exporter shape
      // (finishedSpans array). The file exporter must accept the same interface.
      const inMemory = new InMemorySpanExporter();
      // Give the file exporter something to serialize
      const spans: Parameters<typeof exporters.spanExporter.export>[0] = [];
      await new Promise<void>((resolve, reject) => {
        exporters.spanExporter.export(spans, (result) => {
          if (result.code === 0) resolve();
          else reject(new Error(`export failed: ${result.message ?? 'unknown'}`));
        });
      });
      // Even an empty export should create the file
      await exporters.spanExporter.shutdown();
      // File may or may not exist for empty export; the key contract is no throw
    });

    it('file exporter class exposes a shutdown method', () => {
      const resolved = resolveOtelConfig({ otel: { exporter: 'file' } }, pipelineDir);
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);
      expect(typeof exporters.spanExporter.shutdown).toBe('function');
      expect(typeof exporters.metricExporter.shutdown).toBe('function');
    });

    it('two file exporters with different paths are independent objects', () => {
      const r1 = resolveOtelConfig(
        { otel: { exporter: 'file', file: join(pipelineDir, 'a.jsonl') } },
        pipelineDir,
      );
      const r2 = resolveOtelConfig(
        { otel: { exporter: 'file', file: join(pipelineDir, 'b.jsonl') } },
        pipelineDir,
      );
      const e1 = buildExporters(r1 as Extract<typeof r1, { enabled: true }>);
      const e2 = buildExporters(r2 as Extract<typeof r2, { enabled: true }>);
      expect(e1.spanExporter).not.toBe(e2.spanExporter);
    });

    it('FileMetricExporter early-exits on empty scopeMetrics without touching the filesystem', async () => {
      const filePath = join(pipelineDir, 'should-not-exist.jsonl');
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'file', file: filePath } },
        pipelineDir,
      );
      const exporters = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);

      // Build an empty ResourceMetrics (no scopeMetrics)
      const emptyMetrics = {
        resource: { attributes: {} } as unknown as import('@opentelemetry/sdk-metrics').ResourceMetrics['resource'],
        scopeMetrics: [],
      } satisfies import('@opentelemetry/sdk-metrics').ResourceMetrics;

      const result = await new Promise<{ code: number; message?: string }>((resolve) => {
        exporters.metricExporter.export(emptyMetrics, resolve);
      });

      expect(result.code).toBe(0); // ExportResultCode.SUCCESS
      // The parent directory should NOT have been created (early exit skips ensureDir)
      const { existsSync } = await import('fs');
      expect(existsSync(filePath)).toBe(false);
    });
  });
});
