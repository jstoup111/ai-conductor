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
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
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
  const reader = new PeriodicExportingMetricReader({ exporter: exporters.metricExporter, exportIntervalMillis: 60_000 });
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
