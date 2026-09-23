import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportResultCode } from '@opentelemetry/core';
import { AggregationTemporality, type PushMetricExporter, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { CapturingSpanExporter } from '../../fixtures/capturing-span-exporter.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import type { HarnessConfig } from '../../../src/types/config.js';

type BuildExporters = typeof import('../../../src/engine/otel/transport.js').buildExporters;
const buildExporters = vi.hoisted(() => vi.fn<BuildExporters>());
vi.mock('../../../src/engine/otel/transport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/otel/transport.js')>();
  return { ...actual, buildExporters };
});

const { wireDaemonOtel, wireInteractiveOtelMetrics } = await import('../../../src/engine/otel/wire.js');

/** Records every export and declares DELTA, like the OTLP exporters buildExporters returns. */
function deltaRecordingExporter(): PushMetricExporter & { exports: ResourceMetrics[] } {
  const exports: ResourceMetrics[] = [];
  return {
    exports,
    export(metrics, callback) {
      exports.push(metrics);
      callback({ code: ExportResultCode.SUCCESS });
    },
    selectAggregationTemporality: () => AggregationTemporality.DELTA,
    async forceFlush() {},
    async shutdown() {},
  };
}

function shippedPoints(exports: ResourceMetrics[]): Array<{ temporality: AggregationTemporality; points: number }> {
  return exports.flatMap((rm) => rm.scopeMetrics.flatMap((scope) => scope.metrics))
    .filter((metric) => metric.descriptor.name === 'conductor.feature.shipped')
    .map((metric) => ({
      temporality: metric.aggregationTemporality,
      points: metric.dataPoints.length,
    }));
}

const shipped = {
  type: 'feature_shipped',
  slug: 'feature-a',
  active: { state: 'unavailable' },
} as const;

const config = {
  otel: { exporter: 'otlp', endpoint: 'http://fake-collector.invalid:4318' },
} as unknown as HarnessConfig;

describe('metric exporter temporality through the wired reader', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wire-temporality-'));
    buildExporters.mockReset();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('daemon meter exports a shipment once, as DELTA, not on every later interval', async () => {
    const exporter = deltaRecordingExporter();
    buildExporters.mockReturnValue({ spanExporter: new CapturingSpanExporter(), metricExporter: exporter });
    const rootEvents = new ConductorEventEmitter();
    const daemonOtel = wireDaemonOtel(config, {
      mainRoot: dir, project: dir, projectName: 'wire-temporality', rootEvents,
    });
    try {
      await rootEvents.emit(shipped as never);
      await daemonOtel?.flush();
      await daemonOtel?.flush();
      await daemonOtel?.flush();
    } finally {
      await daemonOtel?.stop();
    }

    expect(shippedPoints(exporter.exports)).toEqual([{ temporality: AggregationTemporality.DELTA, points: 1 }]);
  });

  it('interactive meter exports a shipment once, as DELTA', async () => {
    const exporter = deltaRecordingExporter();
    buildExporters.mockReturnValue({ spanExporter: new CapturingSpanExporter(), metricExporter: exporter });
    const events = new ConductorEventEmitter();
    const meter = wireInteractiveOtelMetrics(config, {
      feature: 'feature-a', project: dir, pipelineDir: join(dir, '.pipeline'),
      branch: undefined, engineVersion: undefined, harnessVersion: undefined,
    }, events);
    try {
      await events.emit(shipped as never);
    } finally {
      await meter?.stop();
    }

    expect(shippedPoints(exporter.exports)).toEqual([{ temporality: AggregationTemporality.DELTA, points: 1 }]);
  });
});
