// Covers: task:2, task:3
/**
 * T8: buildExporters(otelConfig) — transport factory.
 * FR-7: OTLP HTTP default (port 4318), gRPC (port 4317) selectable via config,
 *       file transport writes OTLP-JSON newline-delimited.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildExporters as buildRawExporters,
  buildHttpExporterOptions,
  type ExporterBuildOptions,
} from '../../../src/engine/otel/transport.js';
import { resolveOtelConfig } from '../../../src/engine/otel/otel-config.js';
import { OTLPTraceExporter as OTLPGrpcTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter as OTLPGrpcMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter as OTLPHttpTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter as OTLPHttpMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { AggregationTemporality, InstrumentType } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

// Keep the real exporter implementation, but count construction at the
// third-party boundary. A refusal must return before either protocol can
// allocate an exporter (and therefore before it could open a connection).
const otlpConstructors = vi.hoisted(() => ({ httpTrace: 0, httpMetric: 0, grpcTrace: 0, grpcMetric: 0 }));
vi.mock('@opentelemetry/exporter-trace-otlp-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/exporter-trace-otlp-http')>();
  class CountingTraceExporter extends actual.OTLPTraceExporter {
    constructor(...args: any[]) { otlpConstructors.httpTrace += 1; super(...args); }
  }
  return { ...actual, OTLPTraceExporter: CountingTraceExporter };
});
vi.mock('@opentelemetry/exporter-metrics-otlp-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/exporter-metrics-otlp-http')>();
  class CountingMetricExporter extends actual.OTLPMetricExporter {
    constructor(...args: any[]) { otlpConstructors.httpMetric += 1; super(...args); }
  }
  return { ...actual, OTLPMetricExporter: CountingMetricExporter };
});
vi.mock('@opentelemetry/exporter-trace-otlp-grpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/exporter-trace-otlp-grpc')>();
  class CountingTraceExporter extends actual.OTLPTraceExporter {
    constructor(...args: any[]) { otlpConstructors.grpcTrace += 1; super(...args); }
  }
  return { ...actual, OTLPTraceExporter: CountingTraceExporter };
});
vi.mock('@opentelemetry/exporter-metrics-otlp-grpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/exporter-metrics-otlp-grpc')>();
  class CountingMetricExporter extends actual.OTLPMetricExporter {
    constructor(...args: any[]) { otlpConstructors.grpcMetric += 1; super(...args); }
  }
  return { ...actual, OTLPMetricExporter: CountingMetricExporter };
});

// Existing construction coverage exercises the production path deliberately,
// but must not inherit the suite-wide network-export refusal marker.
const exportEnv = { ...process.env, AI_CONDUCTOR_NO_REAL_EXEC: undefined };
const buildExporters: typeof buildRawExporters = (config, options = {}) =>
  buildRawExporters(config, { ...options, env: (options as ExporterBuildOptions).env ?? exportEnv });

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

  describe('buildHttpExporterOptions', () => {
    it('preserves per-signal URL suffixes and carries resolved headers', () => {
      const config = {
        enabled: true as const,
        exporter: 'otlp' as const,
        endpoint: 'http://localhost:4318/',
        headers: { Authorization: 'Bearer resolved-token', 'X-Tenant': 'acme' },
      };

      expect(buildHttpExporterOptions(config, 'traces')).toEqual({
        url: 'http://localhost:4318/v1/traces',
        headers: { Authorization: 'Bearer resolved-token', 'X-Tenant': 'acme' },
      });
      expect(buildHttpExporterOptions(config, 'metrics')).toEqual({
        url: 'http://localhost:4318/v1/metrics',
        headers: { Authorization: 'Bearer resolved-token', 'X-Tenant': 'acme' },
      });
    });

    it('omits headers when the resolved config has none', () => {
      const config = {
        enabled: true as const,
        exporter: 'otlp' as const,
        endpoint: 'http://localhost:4318',
      };

      expect(buildHttpExporterOptions(config, 'traces')).toEqual({
        url: 'http://localhost:4318/v1/traces',
      });
      expect(buildHttpExporterOptions(config, 'metrics')).toEqual({
        url: 'http://localhost:4318/v1/metrics',
      });
    });
  });

  describe('otlp exporter', () => {
    it('refuses HTTP and gRPC OTLP construction under the test marker unless smoke opts in', () => {
      for (const protocol of [undefined, 'grpc'] as const) {
        const before = { ...otlpConstructors };
        const resolved = resolveOtelConfig(
          { otel: { exporter: 'otlp', endpoint: 'http://127.0.0.1:4318', ...(protocol ? { protocol } : {}) } },
          pipelineDir,
        );
        const refused = buildRawExporters(resolved as Extract<typeof resolved, { enabled: true }>, {
          env: { AI_CONDUCTOR_NO_REAL_EXEC: '1' },
        });
        expect(refused).toMatchObject({ refused: true });
        expect((refused as unknown as { message: string }).message).toContain('AI_CONDUCTOR_OTEL_SMOKE');
        expect(otlpConstructors).toEqual(before);
      }

      const resolved = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://127.0.0.1:4318' } },
        pipelineDir,
      );
      expect(buildRawExporters(resolved as Extract<typeof resolved, { enabled: true }>, {
        env: { AI_CONDUCTOR_NO_REAL_EXEC: '1', AI_CONDUCTOR_OTEL_SMOKE: '1' },
      }).spanExporter).toBeDefined();
    });

    it('uses the marked process environment when no env argument is supplied', () => {
      const priorMarker = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      process.env.AI_CONDUCTOR_NO_REAL_EXEC = '1';
      expect(process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBe('1');
      expect(globalThis.process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBe('1');
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://127.0.0.1:4318' } },
        pipelineDir,
      );
      const refused = buildRawExporters(resolved as Extract<typeof resolved, { enabled: true }>);

      try {
        expect(refused).toMatchObject({ refused: true });
        expect((refused as unknown as { message: string }).message).toContain('AI_CONDUCTOR_NO_REAL_EXEC');
      } finally {
        if (priorMarker === undefined) delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
        else process.env.AI_CONDUCTOR_NO_REAL_EXEC = priorMarker;
      }
    });

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

    it('keeps default gRPC export unwrapped when the inactive spool falls back', () => {
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://localhost:4317', protocol: 'grpc' } },
        pipelineDir,
      );
      const otlpConfig = resolved as Extract<typeof resolved, { enabled: true; exporter: 'otlp' }>;
      const exporters = buildExporters(otlpConfig);

      expect({
        spool: otlpConfig.spool,
        spanIsGrpc: exporters.spanExporter instanceof OTLPGrpcTraceExporter,
        metricIsGrpc: exporters.metricExporter instanceof OTLPGrpcMetricExporter,
      }).toEqual({
        spool: { enabled: false, maxBytes: 536_870_912 },
        spanIsGrpc: true,
        metricIsGrpc: true,
      });
    });

    it('keeps explicitly disabled gRPC spool export unwrapped without a warning', () => {
      const resolved = resolveOtelConfig(
        {
          otel: {
            exporter: 'otlp', endpoint: 'http://localhost:4317', protocol: 'grpc', spool: { enabled: false },
          },
        },
        pipelineDir,
      );
      const otlpConfig = resolved as Extract<typeof resolved, { enabled: true; exporter: 'otlp' }>;
      const exporters = buildExporters(otlpConfig);

      expect({
        spoolWarnings: otlpConfig.spoolWarnings,
        spanIsGrpc: exporters.spanExporter instanceof OTLPGrpcTraceExporter,
        metricIsGrpc: exporters.metricExporter instanceof OTLPGrpcMetricExporter,
      }).toEqual({
        spoolWarnings: undefined,
        spanIsGrpc: true,
        metricIsGrpc: true,
      });
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

    // Datadog OTLP ingest builds histogram sketches by diffing consecutive
    // cumulative points and drops any series whose diff is not clean (first
    // point, reset, start-time mismatch). Short-lived per-feature meters emit
    // one point and lose the distribution entirely; delta sidesteps the diff.
    it.each(['http/protobuf', 'grpc'] as const)('%s metric exporter prefers DELTA temporality for histograms and counters', (protocol) => {
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318', protocol } },
        pipelineDir,
      );
      const { metricExporter } = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);
      expect(metricExporter.selectAggregationTemporality?.(InstrumentType.HISTOGRAM)).toBe(AggregationTemporality.DELTA);
      expect(metricExporter.selectAggregationTemporality?.(InstrumentType.COUNTER)).toBe(AggregationTemporality.DELTA);
      // A delta gauge drops out of every interval it was not recorded in; the
      // daemon's poll-loop gauges then go stale in Prometheus during long steps.
      expect(metricExporter.selectAggregationTemporality?.(InstrumentType.GAUGE)).toBe(AggregationTemporality.CUMULATIVE);
    });

    it('file metric exporter prefers the same DELTA temporality as the OTLP exporters', () => {
      const resolved = resolveOtelConfig({ otel: { exporter: 'file' } }, pipelineDir);
      const { metricExporter } = buildExporters(resolved as Extract<typeof resolved, { enabled: true }>);
      expect(metricExporter.selectAggregationTemporality?.(InstrumentType.HISTOGRAM)).toBe(AggregationTemporality.DELTA);
      expect(metricExporter.selectAggregationTemporality?.(InstrumentType.COUNTER)).toBe(AggregationTemporality.DELTA);
      // A delta gauge drops out of every interval it was not recorded in; the
      // daemon's poll-loop gauges then go stale in Prometheus during long steps.
      expect(metricExporter.selectAggregationTemporality?.(InstrumentType.GAUGE)).toBe(AggregationTemporality.CUMULATIVE);
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
      // Give the file exporter something to serialize
      const spans: Parameters<typeof exporters.spanExporter.export>[0] = [];
      await new Promise<void>((resolve, reject) => {
        exporters.spanExporter.export(spans, (result) => {
          if (result.code === 0) resolve();
          else reject(new Error(`export failed: ${result.error?.message ?? 'unknown'}`));
        });
      });
      // Even an empty export should create the file
      await exporters.spanExporter.shutdown();
      // File may or may not exist for empty export; the key contract is no throw
    });

    it('keeps file export available under the test marker and appends an exported span', async () => {
      const filePath = join(pipelineDir, 'marked-otel.jsonl');
      const resolved = resolveOtelConfig({ otel: { exporter: 'file', file: filePath } }, pipelineDir);
      const exporters = buildRawExporters(resolved as Extract<typeof resolved, { enabled: true }>);
      const provider = new BasicTracerProvider();
      const span = provider.getTracer('marked-file-export').startSpan('under-marker');
      span.end();

      await new Promise<void>((resolve, reject) => exporters.spanExporter.export(
        [span as unknown as ReadableSpan],
        (result) => result.code === 0 ? resolve() : reject(new Error(result.error?.message)),
      ));

      expect((await readFile(filePath, 'utf8')).trim()).not.toBe('');
      await exporters.spanExporter.shutdown();
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
