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
import { LoggerProvider } from '@opentelemetry/sdk-logs';
import { basename, dirname, join } from 'node:path';
import { buildResource } from './resource.js';
import { buildExporters, isExportRefused } from './transport.js';
import { MetricsRecorder } from './metrics.js';
import { MetricsListener } from './metrics-listener.js';
import { createSpoolRuntime, resolveSpoolDirSync, type SpoolRuntime, warnDisabledLogSpoolBacklog, warnDisabledSpoolBacklog, warnSpoolUnavailable } from './spool-wiring.js';
import { LogListener } from './log-listener.js';
import { BoundedLogProcessor, type LogBatchExporter } from './log-processor.js';
import { sendLogBatch } from './log-transport.js';
import { readLogPolicy } from './log-policy.js';
import { resolveLogConfig } from './log-config.js';
import { SpoolingLogExporter } from './spooling-exporter.js';
import { LogHealth } from './log-health.js';

const METRIC_LIFECYCLE_TIMEOUT_MS = 250;
const LOG_STOP_BUDGET_MS = 2_000;

interface InteractiveSpoolLifecycle {
  runtime: SpoolRuntime;
  events: ConductorEventEmitter;
  visualizerOpen: boolean;
  metricsOpen: boolean;
  leaseStart?: Promise<{ acquired: boolean }>;
  stopping?: boolean;
  stopped?: Promise<void>;
}

function logDrainEnabled(config: HarnessConfig): boolean {
  const logs = resolveLogConfig(config);
  return logs.enabled && logs.spool.enabled;
}

function logSpoolMaxBytes(config: HarnessConfig): number | undefined {
  const logs = resolveLogConfig(config);
  return logs.enabled ? logs.spool.maxBytes : undefined;
}

const interactiveSpoolLifecycles = new Map<string, InteractiveSpoolLifecycle>();
const interactiveSpoolStops = new Map<string, Promise<void>>();
const emittedSpoolWarnings = new Set<string>();

function emitResolvedWarnings(resolved: Extract<ReturnType<typeof resolveOtelConfig>, { enabled: true }>, events: ConductorEventEmitter): void {
  const warnings = [
    ...(resolved.attributeWarnings ?? []),
    ...('spoolWarnings' in resolved ? resolved.spoolWarnings ?? [] : []),
  ];
  for (const warning of warnings) {
    if (emittedSpoolWarnings.has(warning)) continue;
    emittedSpoolWarnings.add(warning);
    void events.emit({ type: 'renderer_error', rendererName: 'otel', error: `[otel] ${warning}` }).catch(() => {});
  }
}

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
  env?: NodeJS.ProcessEnv;
}

export interface OtelLogOwner { stop(): Promise<void>; flush(): Promise<void>; }

/** Creates the explicit opt-in log path beside, never inside, trace/metric wiring. */
export async function wireOtelLogs(
  _config: HarnessConfig,
  context: OtelVisualizerStartContext,
  events: ConductorEventEmitter,
  spoolRuntime?: SpoolRuntime,
): Promise<OtelLogOwner | null> {
  const requested = resolveLogConfig(_config);
  // Default-off is intentionally silent. Invalid explicitly-requested logs
  // get a named local diagnostic, while traces and metrics remain independent.
  if (!requested.enabled) {
    if (requested.error) {
      void events.emit({ type: 'renderer_error', rendererName: 'otel', error: `[otel] ${requested.error}; logs remain local` }).catch(() => undefined);
    }
    return null;
  }
  let policy: Awaited<ReturnType<typeof readLogPolicy>>;
  try {
    policy = await readLogPolicy(context.project ?? dirname(context.pipelineDir), {
      warn: (message) => { void events.emit({ type: 'renderer_error', rendererName: 'otel', error: `[otel] ${message}` }); },
    });
  } catch {
    // Policy is logs-only authorization. An unexpected reader failure must
    // never block otherwise independent trace, metric, or local diagnostics.
    void events.emit({ type: 'renderer_error', rendererName: 'otel', error: '[otel] log policy setup failed; logs remain local' }).catch(() => undefined);
    return null;
  }
  if (!policy.sendable) {
    void events.emit({ type: 'renderer_error', rendererName: 'otel', error: `[otel] ${policy.reason}; logs remain local` }).catch(() => undefined);
    return null;
  }
  try {
    const resolved = resolveOtelConfig(_config, context.pipelineDir);
    const worker = resolveWorkerName(resolved);
    const health = new LogHealth(events);
    const direct: LogBatchExporter = {
      export(records, done) { void sendLogBatch(records, { startDir: policy.root, destinationId: policy.destinationId })
        .then((result) => {
          if (result.ok) health.recovered(); else health.failure(result.reason);
          done({ code: result.ok ? ExportResultCode.SUCCESS : ExportResultCode.FAILED });
        }); },
    };
    const exporter = policy.config.spool.enabled && spoolRuntime
      ? new SpoolingLogExporter(
        spoolRuntime.store,
        policy.destinationId,
        direct,
        events,
        (count) => health.failure('storage', count),
      ) : direct;
    const processor = new BoundedLogProcessor(exporter, { onDrop: (count) => health.failure('dropped', count) });
    const provider = new LoggerProvider({ resource: buildResource({ pipelineDir: context.pipelineDir,
      project: policy.root, projectName: basename(policy.root), workerName: worker,
      ...(resolved.enabled && resolved.attributes ? { attributes: resolved.attributes } : {}),
      ...(context.harnessVersion === undefined ? {} : { harnessVersion: context.harnessVersion }),
    }, 'logs'), processors: [processor] });
    const listener = new LogListener(provider.getLogger('conductor', '1.0.0'), policy.root, worker, () => health.failure('dropped'));
    listener.start(events);
    let stopped: Promise<void> | undefined;
    return {
      flush: () => withinLogStopBudget(() => provider.forceFlush()),
      stop: () => stopped ??= (async () => {
        listener.stop();
        // Each phase consumes the same deadline.  In particular, a slow
        // flush must not grant shutdown a second two-second allowance.
        const deadline = Date.now() + LOG_STOP_BUDGET_MS;
        await withinLogStopBudget(() => provider.forceFlush(), deadline);
        await withinLogStopBudget(() => provider.shutdown(), deadline);
      })(),
    };
  } catch {
    void events.emit({ type: 'renderer_error', rendererName: 'otel', error: '[otel] log export setup failed; logs remain local' });
    return null;
  }
}

/** A single deadline bounds all shutdown work, including a stalled durable write. */
async function withinLogStopBudget(
  operation: () => Promise<void>,
  deadline = Date.now() + LOG_STOP_BUDGET_MS,
): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, remaining); timer.unref?.(); }),
    ]);
  } catch {
    // Logging must not alter the calling lifecycle result.
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  sourceConfig: HarnessConfig,
  resolved: Extract<ReturnType<typeof resolveOtelConfig>, { enabled: true; exporter: 'otlp' }>,
  context: OtelVisualizerStartContext,
  events: ConductorEventEmitter,
): InteractiveSpoolLifecycle | undefined {
  if (!resolved.spool?.enabled) return undefined;
  const directory = resolveSpoolDirSync(dirname(context.pipelineDir));
  if (directory === null) return undefined;
  const existing = interactiveSpoolLifecycles.get(directory);
  if (existing) return existing;
  const lifecycle: InteractiveSpoolLifecycle = {
    runtime: createSpoolRuntime(
      directory,
      resolved,
      events,
      logSpoolMaxBytes(sourceConfig),
      logDrainEnabled(sourceConfig),
    ), events, visualizerOpen: false, metricsOpen: false,
  };
  const priorStop = interactiveSpoolStops.get(directory);
  if (priorStop) lifecycle.leaseStart = priorStop.then(() => lifecycle.runtime.lease.acquire());
  interactiveSpoolLifecycles.set(directory, lifecycle);
  return lifecycle;
}

function stopInteractiveSpoolIfUnused(directory: string, lifecycle: InteractiveSpoolLifecycle): Promise<void> {
  if (lifecycle.visualizerOpen || lifecycle.metricsOpen) return Promise.resolve();
  if (lifecycle.stopping) return lifecycle.stopped ?? Promise.resolve();
  // Remove this lifecycle synchronously: a following interactive connector
  // must never attach to a lease that is already being released.
  lifecycle.stopping = true;
  if (interactiveSpoolLifecycles.get(directory) === lifecycle) interactiveSpoolLifecycles.delete(directory);
  lifecycle.stopped = (async () => {
    await lifecycle.leaseStart?.catch(() => undefined);
    await lifecycle.runtime.drainer.stop().catch((error) => reportSpoolFailure(lifecycle.events, error));
    await lifecycle.runtime.lease.release().catch((error) => reportSpoolFailure(lifecycle.events, error));
  })();
  interactiveSpoolStops.set(directory, lifecycle.stopped);
  void lifecycle.stopped.finally(() => {
    if (interactiveSpoolStops.get(directory) === lifecycle.stopped) interactiveSpoolStops.delete(directory);
  });
  return lifecycle.stopped;
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
  registryFactory: (events: ConductorEventEmitter) => PluginRegistry = createOtelVisualizerRegistry,
): VisualizerPlugin | null {
  const resolved = resolveOtelConfig(config, context.pipelineDir);
  if (!resolved.enabled) return null;
  emitResolvedWarnings(resolved, events);
  void warnDisabledSpoolBacklog(resolved, context.project ?? dirname(context.pipelineDir), events);

  const interactiveLifecycle = !spoolRuntime && resolved.exporter === 'otlp'
    ? interactiveSpoolLifecycle(config, resolved, context, events)
    : undefined;
  if (!spoolRuntime && resolved.exporter === 'otlp' && resolved.spool?.enabled && !interactiveLifecycle) {
    warnSpoolUnavailable(context.project ?? dirname(context.pipelineDir), events);
  }
  const activeSpoolRuntime = spoolRuntime ?? interactiveLifecycle?.runtime;
  if (activeSpoolRuntime) void warnDisabledLogSpoolBacklog(logDrainEnabled(config), context.project ?? dirname(context.pipelineDir), events);
  const registry = registryFactory(events);
  const factory = registry.get<VisualizerFactory>('visualizer', 'otel');
  let visualizer: VisualizerPlugin | null;
  try {
    visualizer = factory({
      config,
      pipelineDir: context.pipelineDir,
      startContext: context,
      emitter: events,
      resolvedWarningsHandled: true,
      ...(activeSpoolRuntime && resolved.exporter === 'otlp' && resolved.spool?.enabled
        ? (() => {
          const built = buildExporters(resolved, { spoolStore: activeSpoolRuntime.store, events, env: context.env });
          if (isExportRefused(built)) throw new Error(built.message);
          return { otelSpanExporter: built.spanExporter };
        })()
        : {}),
    });
    if (!visualizer) return null;
    if (interactiveLifecycle) interactiveLifecycle.visualizerOpen = true;
    visualizer.start(events, context);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    void events.emit({ type: 'renderer_error', rendererName: 'otel', error: `[otel] visualizer start failed: ${detail}` }).catch(() => {});
    if (interactiveLifecycle) {
      interactiveLifecycle.visualizerOpen = false;
      const directory = resolveSpoolDirSync(dirname(context.pipelineDir));
      if (directory !== null) void stopInteractiveSpoolIfUnused(directory, interactiveLifecycle);
    }
    return null;
  }
  if (!interactiveLifecycle) return visualizer;
  const directory = resolveSpoolDirSync(dirname(context.pipelineDir));
  if (directory === null) return visualizer;
  return {
    name: visualizer.name,
    start: visualizer.start.bind(visualizer),
    stop: async () => {
      try {
        await visualizer.stop();
      } finally {
        interactiveLifecycle.visualizerOpen = false;
        await stopInteractiveSpoolIfUnused(directory, interactiveLifecycle);
      }
    },
  };
}

/** Daemon-lifetime meter: one recorder/listener survives feature process exits. */
export function wireDaemonOtel(
  config: HarnessConfig,
  context: { mainRoot: string; project: string; projectName: string; workerName?: string; harnessVersion?: string; rootEvents: ConductorEventEmitter; env?: NodeJS.ProcessEnv },
): { flush: () => Promise<void>; stop: () => Promise<void>; spoolRuntime?: SpoolRuntime } | null {
  const resolved = resolveOtelConfig(config, join(context.mainRoot, '.pipeline'));
  if (!resolved.enabled) return null;
  emitResolvedWarnings(resolved, context.rootEvents);
  void warnDisabledSpoolBacklog(resolved, context.mainRoot, context.rootEvents);
  const spoolRuntime = resolved.exporter === 'otlp' && resolved.spool?.enabled
    ? createSpoolRuntime(
      join(context.mainRoot, '.daemon', 'otel-spool'),
      resolved,
      context.rootEvents,
      logSpoolMaxBytes(config),
      logDrainEnabled(config),
    )
    : undefined;
  const exporters = spoolRuntime
    ? buildExporters(resolved, { spoolStore: spoolRuntime.store, events: context.rootEvents, env: context.env })
    : buildExporters(resolved, { env: context.env });
  if (isExportRefused(exporters)) {
    void context.rootEvents.emit({ type: 'renderer_error', rendererName: 'otel', error: exporters.message }).catch(() => {});
    return null;
  }
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
  listener.start(context.rootEvents);
  const activeSpoolRuntime = spoolRuntime;
  if (activeSpoolRuntime) void warnDisabledLogSpoolBacklog(logDrainEnabled(config), context.mainRoot, context.rootEvents);
  const leaseStart = activeSpoolRuntime?.lease.acquire();
  if (leaseStart) {
    void leaseStart.then((result) => {
      if (result.acquired) return activeSpoolRuntime!.drainer.drainUntilStopped();
      return undefined;
    }).catch((error) => reportSpoolRuntimeFailure(activeSpoolRuntime!, context.rootEvents, error));
  }
  const settleMetricLifecycle = guardMetricLifecycle(context.rootEvents);
  let stopped: Promise<void> | undefined;
  return {
    // A feature dispatch can finish long before the daemon.  Flush the shared
    // meter at that boundary, but keep it alive for every other dispatch.
    flush: async () => {
      await settleMetricLifecycle(() => provider.forceFlush());
    },
    stop: () => stopped ??= (async () => {
      listener.stop();
      await settleMetricLifecycle(() => provider.forceFlush());
      await settleMetricLifecycle(() => provider.shutdown());
      await leaseStart?.catch(() => undefined);
      await spoolRuntime?.drainer.stop().catch((error) => reportSpoolFailure(context.rootEvents, error));
      await spoolRuntime?.lease.release().catch((error) => reportSpoolFailure(context.rootEvents, error));
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
  emitResolvedWarnings(resolved, events);
  void warnDisabledSpoolBacklog(resolved, context.project ?? dirname(context.pipelineDir), events);
  const spoolLifecycle = resolved.exporter === 'otlp'
    ? interactiveSpoolLifecycle(config, resolved, context, events)
    : undefined;
  if (resolved.exporter === 'otlp' && resolved.spool?.enabled && !spoolLifecycle) {
    warnSpoolUnavailable(context.project ?? dirname(context.pipelineDir), events);
  }
  if (spoolLifecycle) spoolLifecycle.metricsOpen = true;
  const spoolRuntime = spoolLifecycle?.runtime;
  if (spoolRuntime) void warnDisabledLogSpoolBacklog(logDrainEnabled(config), context.project ?? dirname(context.pipelineDir), events);
  const exporters = spoolRuntime
    ? buildExporters(resolved, { spoolStore: spoolRuntime.store, events, env: context.env })
    : buildExporters(resolved, { env: context.env });
  if (isExportRefused(exporters)) {
    void events.emit({ type: 'renderer_error', rendererName: 'otel', error: exporters.message }).catch(() => {});
    if (spoolLifecycle) spoolLifecycle.metricsOpen = false;
    return null;
  }
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
  try {
    listener.start(events);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    void events.emit({ type: 'renderer_error', rendererName: 'otel', error: `[otel] metrics listener start failed: ${detail}` }).catch(() => {});
    if (spoolLifecycle) {
      spoolLifecycle.metricsOpen = false;
      const directory = resolveSpoolDirSync(dirname(context.pipelineDir));
      if (directory !== null) void stopInteractiveSpoolIfUnused(directory, spoolLifecycle);
    }
    return null;
  }
  const leaseStart = spoolRuntime ? (spoolLifecycle!.leaseStart ??= spoolRuntime.lease.acquire()) : undefined;
  if (leaseStart) {
    const activeSpoolRuntime = spoolRuntime;
    void leaseStart.then((result) => {
      if (result.acquired) return activeSpoolRuntime!.drainer.drainUntilStopped();
      return undefined;
    }).catch((error) => reportSpoolRuntimeFailure(activeSpoolRuntime!, events, error));
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
        const directory = resolveSpoolDirSync(dirname(context.pipelineDir));
        if (directory !== null) await stopInteractiveSpoolIfUnused(directory, spoolLifecycle);
      }
    })(),
  };
}

async function reportSpoolFailure(events: ConductorEventEmitter, error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  await events.emit({
    type: 'renderer_error', rendererName: 'otel', error: `[otel] spool lease or drainer failed: ${detail}`,
  }).catch(() => undefined);
}

async function reportSpoolRuntimeFailure(runtime: SpoolRuntime, events: ConductorEventEmitter, error: unknown): Promise<void> {
  await reportSpoolFailure(events, error);
  await runtime.lease.release().catch(() => undefined);
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
