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
import { basename, dirname, join } from 'node:path';
import { buildResource } from './resource.js';
import { buildExporters } from './transport.js';
import { MetricsRecorder } from './metrics.js';
import { MetricsListener } from './metrics-listener.js';
import { createSpoolRuntime, type SpoolRuntime } from './spool-wiring.js';
import { OtelVisualizer } from './otel-visualizer.js';

const METRIC_LIFECYCLE_TIMEOUT_MS = 250;

interface InteractiveSpoolLifecycle {
  runtime: SpoolRuntime;
  visualizerOpen: boolean;
  metricsOpen: boolean;
  leaseStart?: Promise<{ acquired: boolean }>;
  stopped?: Promise<void>;
}

const interactiveSpoolLifecycles = new Map<string, InteractiveSpoolLifecycle>();

/** Keeps metric lifecycle I/O from turning a collector failure into a run failure. */
function guardMetricLifecycle(events: ConductorEventEmitter): (operation: () => Promise<void>) => Promise<void> {
  let warned = false;
  return async (operation) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('metric lifecycle timed out')), METRIC_LIFECYCLE_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      if (!warned) {
        warned = true;
        const detail = error instanceof Error ? error.message : String(error);
        await events.emit({ type: 'renderer_error', rendererName: 'otel', error: `[otel] metric export failed: ${detail}` }).catch(() => {});
      }
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}

/**
 * Identity resolution results required at supported OTel start boundaries.
 * Explicit `undefined` records an attempted resolution that did not succeed.
 */
export interface OtelVisualizerStartContext extends VisualizerStartContext {
  pipelineDir: string;
  branch: string | undefined;
  engineVersion: string | undefined;
  harnessVersion: string | undefined;
}

export function createOtelVisualizerRegistry(events: ConductorEventEmitter): PluginRegistry {
  const registry = new PluginRegistry();
  registerBuiltins(registry, events, () => {}, undefined, 10, new Set());
  registry.markInitialized();
  return registry;
}

/**
 * Interactive runs are rooted at their checkout's `.pipeline` directory, so
 * their spool shares the durable checkout location used by daemon runs.
 */
function interactiveSpoolLifecycle(
  resolved: Extract<ReturnType<typeof resolveOtelConfig>, { enabled: true; exporter: 'otlp' }>,
  context: OtelVisualizerStartContext,
  events: ConductorEventEmitter,
): InteractiveSpoolLifecycle | undefined {
  if (!resolved.spool?.enabled) return undefined;
  const directory = join(dirname(context.pipelineDir), '.daemon', 'otel-spool');
  const existing = interactiveSpoolLifecycles.get(directory);
  if (existing) return existing;
  const lifecycle = { runtime: createSpoolRuntime(directory, resolved, events), visualizerOpen: false, metricsOpen: false };
  interactiveSpoolLifecycles.set(directory, lifecycle);
  return lifecycle;
}

async function stopInteractiveSpoolIfUnused(directory: string, lifecycle: InteractiveSpoolLifecycle): Promise<void> {
  if (lifecycle.visualizerOpen || lifecycle.metricsOpen) return;
  lifecycle.stopped ??= (async () => {
    await lifecycle.leaseStart?.catch(() => undefined);
    await lifecycle.runtime.drainer.stop();
    await lifecycle.runtime.lease.release();
    interactiveSpoolLifecycles.delete(directory);
  })();
  await lifecycle.stopped;
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
  spoolRuntime?: SpoolRuntime,
): VisualizerPlugin | null {
  const resolved = resolveOtelConfig(config, context.pipelineDir);
  if (!resolved.enabled) return null;

  const interactiveLifecycle = !spoolRuntime && resolved.exporter === 'otlp'
    ? interactiveSpoolLifecycle(resolved, context, events)
    : undefined;
  if (interactiveLifecycle) interactiveLifecycle.visualizerOpen = true;
  const activeSpoolRuntime = spoolRuntime ?? interactiveLifecycle?.runtime;
  if (activeSpoolRuntime && resolved.exporter === 'otlp' && resolved.spool?.enabled) {
    const exporters = buildExporters(resolved, { spoolStore: activeSpoolRuntime.store, events });
    const visualizer = new OtelVisualizer(resolved, { spanExporter: exporters.spanExporter, onWarning: (error) => {
      void events.emit({ type: 'renderer_error', rendererName: 'otel', error });
    } });
    visualizer.start(events, context);
    if (!interactiveLifecycle) return visualizer;
    const directory = join(dirname(context.pipelineDir), '.daemon', 'otel-spool');
    return {
      name: visualizer.name,
      start: visualizer.start.bind(visualizer),
      stop: async () => {
        await visualizer.stop();
        interactiveLifecycle.visualizerOpen = false;
        await stopInteractiveSpoolIfUnused(directory, interactiveLifecycle);
      },
    };
  }

  const registry = createOtelVisualizerRegistry(events);
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
  context: { mainRoot: string; project: string; projectName: string; workerName?: string; harnessVersion?: string; rootEvents: ConductorEventEmitter },
): { flush: () => Promise<void>; stop: () => Promise<void>; spoolRuntime?: SpoolRuntime } | null {
  const resolved = resolveOtelConfig(config, join(context.mainRoot, '.pipeline'));
  if (!resolved.enabled) return null;
  const spoolRuntime = resolved.exporter === 'otlp' && resolved.spool?.enabled
    ? createSpoolRuntime(join(context.mainRoot, '.daemon', 'otel-spool'), resolved, context.rootEvents)
    : undefined;
  const exporters = spoolRuntime
    ? buildExporters(resolved, { spoolStore: spoolRuntime.store, events: context.rootEvents })
    : buildExporters(resolved);
  const workerName = context.workerName ?? resolveWorkerName(resolved);
  const reader = new PeriodicExportingMetricReader({
    exporter: warnOnceMetricExporter(exporters.metricExporter, context.rootEvents),
    exportIntervalMillis: 60_000,
  });
  const provider = new MeterProvider({ resource: buildResource({
    attributes: resolved.attributes,
    pipelineDir: join(context.mainRoot, '.pipeline'), project: context.project,
    projectName: resolved.projectName ?? context.projectName ?? basename(context.mainRoot), workerName,
    ...(Object.prototype.hasOwnProperty.call(context, 'harnessVersion') ? { harnessVersion: context.harnessVersion } : {}),
  }, 'metrics'), readers: [reader] });
  const listener = new MetricsListener(new MetricsRecorder(provider.getMeter('conductor', '1.0.0'), {
    project: resolved.projectName ?? context.projectName ?? 'unknown', worker: workerName,
  }, resolved.attributes));
  if (resolved.attributeWarnings?.length) {
    void context.rootEvents.emit({
      type: 'renderer_error',
      rendererName: 'otel',
      error: `[otel] ${resolved.attributeWarnings.join(' ')}`,
    }).catch(() => {});
  }
  listener.start(context.rootEvents);
  const leaseStart = spoolRuntime?.lease.acquire();
  if (leaseStart) {
    void leaseStart.then((result) => {
      if (result.acquired) return spoolRuntime.drainer.drain();
      return undefined;
    }).catch(() => undefined);
  }
  const settleMetricLifecycle = guardMetricLifecycle(context.rootEvents);
  let stopped: Promise<void> | undefined;
  return {
    // A feature dispatch can finish long before the daemon.  Flush the shared
    // meter at that boundary, but keep it alive for every other dispatch.
    flush: async () => {
      await settleMetricLifecycle(() => provider.forceFlush());
      if (spoolRuntime) void spoolRuntime.drainer.drain();
    },
    stop: () => stopped ??= (async () => {
      listener.stop();
      await settleMetricLifecycle(() => provider.forceFlush());
      await settleMetricLifecycle(() => provider.shutdown());
      await leaseStart?.catch(() => undefined);
      await spoolRuntime?.drainer.stop();
      await spoolRuntime?.lease.release();
    })(),
    ...(spoolRuntime ? { spoolRuntime } : {}),
  };
}

/** Interactive meter: the same event-fed projection as the daemon, scoped to one feature. */
export function wireInteractiveOtelMetrics(
  config: HarnessConfig,
  context: OtelVisualizerStartContext,
  events: ConductorEventEmitter,
): { name: string; start: () => void; stop: () => Promise<void> } | null {
  const resolved = resolveOtelConfig(config, context.pipelineDir);
  if (!resolved.enabled) return null;
  const spoolLifecycle = resolved.exporter === 'otlp'
    ? interactiveSpoolLifecycle(resolved, context, events)
    : undefined;
  if (spoolLifecycle) spoolLifecycle.metricsOpen = true;
  const spoolRuntime = spoolLifecycle?.runtime;
  const exporters = spoolRuntime
    ? buildExporters(resolved, { spoolStore: spoolRuntime.store, events })
    : buildExporters(resolved);
  const workerName = resolveWorkerName(resolved);
  const projectName = resolved.projectName ?? (context.project ? basename(context.project) : 'unknown');
  const provider = new MeterProvider({
    resource: buildResource({
      attributes: resolved.attributes,
      pipelineDir: context.pipelineDir,
      project: context.project,
      projectName,
      workerName,
      harnessVersion: context.harnessVersion,
    }, 'metrics'),
    readers: [new PeriodicExportingMetricReader({
      exporter: warnOnceMetricExporter(exporters.metricExporter, events),
      exportIntervalMillis: 60_000,
    })],
  });
  const listener = new MetricsListener(
    new MetricsRecorder(
      provider.getMeter('conductor', '1.0.0'),
      { project: projectName, worker: workerName },
      resolved.attributes,
    ),
    () => Date.now(),
    context.feature,
  );
  listener.start(events);
  const leaseStart = spoolRuntime ? (spoolLifecycle!.leaseStart ??= spoolRuntime.lease.acquire()) : undefined;
  if (leaseStart) {
    void leaseStart.then((result) => {
      if (result.acquired) return spoolRuntime.drainer.drain();
      return undefined;
    }).catch(() => undefined);
  }
  const settleMetricLifecycle = guardMetricLifecycle(events);
  let stopped: Promise<void> | undefined;
  return {
    name: 'otel-metrics',
    start: () => {},
    stop: () => stopped ??= (async () => {
      listener.stop();
      await settleMetricLifecycle(() => provider.forceFlush());
      await settleMetricLifecycle(() => provider.shutdown());
      if (spoolLifecycle) {
        spoolLifecycle.metricsOpen = false;
        await stopInteractiveSpoolIfUnused(join(dirname(context.pipelineDir), '.daemon', 'otel-spool'), spoolLifecycle);
      }
    })(),
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
    // The reader asks its exporter for temporality and aggregation; a wrapper
    // that drops these selectors silently reverts the reader to CUMULATIVE and
    // re-exports every series ever recorded on every interval.
    ...(exporter.selectAggregationTemporality
      ? { selectAggregationTemporality: exporter.selectAggregationTemporality.bind(exporter) }
      : {}),
    ...(exporter.selectAggregation ? { selectAggregation: exporter.selectAggregation.bind(exporter) } : {}),
    forceFlush: () => exporter.forceFlush(),
    shutdown: () => exporter.shutdown(),
  };
}
