import { registerBuiltins } from '../plugin-loader.js';
import { PluginRegistry } from '../plugin-registry.js';
import type { HarnessConfig } from '../../types/config.js';
import type {
  VisualizerFactory,
  VisualizerPlugin,
  VisualizerStartContext,
} from '../../types/plugin.js';
import type { ConductorEventEmitter } from '../../ui/events.js';
import { resolveOtelConfig } from './otel-config.js';
import { resolveWorkerName } from './otel-config.js';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { basename, join } from 'node:path';
import { buildResource } from './resource.js';
import { buildExporters } from './transport.js';
import { MetricsRecorder } from './metrics.js';
import { MetricsListener } from './metrics-listener.js';

/**
 * Identity resolution results required at supported OTel start boundaries.
 * Explicit `undefined` records an attempted resolution that did not succeed.
 */
export interface OtelVisualizerStartContext extends VisualizerStartContext {
  pipelineDir: string;
  branch: string | undefined;
  engineVersion: string | undefined;
}

/**
 * Create and start the OTel visualizer for one event stream.
 *
 * The built-in registry factory owns visualizer construction; this helper owns
 * only the per-stream lifecycle wiring so each entry point follows the same
 * configuration gate and start seam.
 */
export function wireOtelVisualizer(
  config: HarnessConfig,
  context: OtelVisualizerStartContext,
  events: ConductorEventEmitter,
): VisualizerPlugin | null {
  if (!resolveOtelConfig(config, context.pipelineDir).enabled) return null;

  const registry = new PluginRegistry();
  registerBuiltins(registry, events, () => {});
  registry.markInitialized();
  const factory = registry.get<VisualizerFactory>('visualizer', 'otel');
  const visualizer = factory({
    config,
    pipelineDir: context.pipelineDir,
    startContext: context,
    emitter: events,
  });

  if (!visualizer) return null;
  visualizer.start(events, context);
  return visualizer;
}

/** Daemon-lifetime meter: one recorder/listener survives feature process exits. */
export function wireDaemonOtel(
  config: HarnessConfig,
  context: { mainRoot: string; projectName: string; workerName?: string; rootEvents: ConductorEventEmitter },
): { stop: () => Promise<void> } | null {
  const resolved = resolveOtelConfig(config, join(context.mainRoot, '.pipeline'));
  if (!resolved.enabled) return null;
  const exporters = buildExporters(resolved);
  const workerName = context.workerName ?? resolveWorkerName(resolved);
  const reader = new PeriodicExportingMetricReader({
    exporter: warnOnceMetricExporter(exporters.metricExporter, context.rootEvents),
    exportIntervalMillis: 60_000,
  });
  const provider = new MeterProvider({ resource: buildResource({
    pipelineDir: join(context.mainRoot, '.pipeline'), project: context.projectName,
    projectName: resolved.projectName ?? context.projectName ?? basename(context.mainRoot), workerName,
  }, 'metrics'), readers: [reader] });
  const listener = new MetricsListener(new MetricsRecorder(provider.getMeter('conductor', '1.0.0'), {
    project: resolved.projectName ?? context.projectName ?? 'unknown', worker: workerName,
  }));
  listener.start(context.rootEvents);
  let stopped: Promise<void> | undefined;
  return { stop: () => stopped ??= (async () => { listener.stop(); await provider.forceFlush(); await provider.shutdown(); })() };
}

/** Interactive meter: the same event-fed projection as the daemon, scoped to one feature. */
export function wireInteractiveOtelMetrics(
  config: HarnessConfig,
  context: OtelVisualizerStartContext,
  events: ConductorEventEmitter,
): { name: string; start: () => void; stop: () => Promise<void> } | null {
  const resolved = resolveOtelConfig(config, context.pipelineDir);
  if (!resolved.enabled) return null;
  const exporters = buildExporters(resolved);
  const workerName = resolveWorkerName(resolved);
  const projectName = resolved.projectName ?? (context.project ? basename(context.project) : 'unknown');
  const provider = new MeterProvider({
    resource: buildResource({
      pipelineDir: context.pipelineDir,
      project: context.project,
      projectName,
      workerName,
    }, 'metrics'),
    readers: [new PeriodicExportingMetricReader({
      exporter: warnOnceMetricExporter(exporters.metricExporter, events),
      exportIntervalMillis: 60_000,
    })],
  });
  const listener = new MetricsListener(
    new MetricsRecorder(provider.getMeter('conductor', '1.0.0'), { project: projectName, worker: workerName }),
    () => Date.now(),
    context.feature,
  );
  listener.start(events);
  let stopped: Promise<void> | undefined;
  return {
    name: 'otel-metrics',
    start: () => {},
    stop: () => stopped ??= (async () => { listener.stop(); await provider.forceFlush(); await provider.shutdown(); })(),
  };
}

/** Route one metric-export failure through the shared renderer-error spine. */
function warnOnceMetricExporter(
  exporter: PushMetricExporter,
  events: ConductorEventEmitter,
): PushMetricExporter {
  let warned = false;
  return {
    export(metrics: ResourceMetrics, callback: (result: ExportResult) => void): void {
      exporter.export(metrics, (result) => {
        if (!warned && result.code !== ExportResultCode.SUCCESS) {
          warned = true;
          const detail = result.error instanceof Error ? result.error.message : String(result.error ?? 'unknown export failure');
          void events.emit({ type: 'renderer_error', rendererName: 'otel', error: `[otel] metric export failed: ${detail}` });
        }
        callback(result);
      });
    },
    forceFlush: () => exporter.forceFlush(),
    shutdown: () => exporter.shutdown(),
  };
}
