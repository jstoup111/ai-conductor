/**
 * OtelVisualizer — visualizer plugin that exports conductor events as OTel
 * traces.
 *
 * Packaging: implements VisualizerPlugin (types/plugin.ts). Constructed and
 * started only when resolveOtelConfig().enabled (FR-1 gate in index.ts).
 *
 * Architecture (ADR-014 / R1):
 *  - Subscribes to the ConductorEventEmitter via .on(). Handlers are
 *    synchronous — they call OTel span/metric APIs that enqueue to the
 *    BatchSpanProcessor / PeriodicExportingMetricReader. No await, no
 *    network call happens inline (emit() awaits handlers; blocking here
 *    stalls the bus).
 *  - stop() force-flushes the tracer so finished spans remain readable after
 *    stop(). Metrics are projected only by MetricsListener (ADR-014 D7).
 *
 * Dependency injection:
 *  - ctx.spanExporter overrides the transport span exporter (used in tests).
 *  - When not provided, exporters are built from the resolved config via
 *    buildExporters() (OTLP or file transport).
 *
 * Error isolation (FR-8):
 *  - All export / flush errors are caught and surfaced via ctx.onWarning at
 *    most ONCE (bounded). The run is never affected by transport failures.
 */
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { basename } from 'node:path';
import type { ConductorEventEmitter, EventHandler } from '../../ui/events.js';
import type { ConductorEvent } from '../../types/events.js';
import { otelTracedEventTypes } from '../event-sinks.js';
import type { VisualizerPlugin, VisualizerStartContext } from '../../types/plugin.js';
import type { ResolvedOtelConfig } from './otel-config.js';
import { buildResource } from './resource.js';
import { buildExporters } from './transport.js';
import { SpanManager } from './span-manager.js';

// ── Bounded-warning exporter wrappers (FR-8) ────────────────────────────────

/**
 * Wraps a SpanExporter to intercept export failures and call warnOnce exactly
 * once across all failures (shared flag via closure). Never throws; always
 * forwards the original result to the caller.
 */
class WarnOnceSpanExporter implements SpanExporter {
  constructor(
    private readonly inner: SpanExporter,
    private readonly warnOnce: (msg: string) => void,
  ) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.inner.export(spans, (result) => {
      if (result.code !== ExportResultCode.SUCCESS) {
        this.warnOnce(
          `[otel] span export failed: ${result.error?.message ?? 'unknown error'}`,
        );
      }
      resultCallback(result);
    });
  }

  async shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

export interface OtelVisualizerContext {
  /** @deprecated Identity is consumed only from VisualizerPlugin.start(). */
  runId?: string;
  /** @deprecated Identity is consumed only from VisualizerPlugin.start(). */
  pipelineDir?: string;
  /** @deprecated Identity is consumed only from VisualizerPlugin.start(). */
  feature?: string;
  /** @deprecated Identity is consumed only from VisualizerPlugin.start(). */
  project?: string;
  /** @deprecated Visualizers are always spans-only; metrics belong to MetricsListener. */
  metrics?: boolean;
  /** Inject a span exporter (replaces transport; used in tests). */
  spanExporter?: SpanExporter;
  /** @deprecated Accepted for compatibility; visualizers never export metrics. */
  metricExporter?: unknown;
  /** Optional warning callback. Receives O(1) warning strings; never throws. */
  onWarning?: (msg: string) => void;
  /**
   * Timeout (ms) for a single export call. If an endpoint does not respond
   * within this bound the export is abandoned and a warning is emitted.
   * Defaults to EXPORT_TIMEOUT_MS (5 000 ms). Override in tests to keep
   * test suite fast even with a hung/refused transport.
   */
  exportTimeoutMillis?: number;
}

/** Default export timeout (ms). An endpoint that does not respond within this
 * bound is considered failed; the export is abandoned and warnOnce fires. */
const EXPORT_TIMEOUT_MS = 5_000;

/**
 * The OTel visualizer plugin. Attach to the event bus via start(); detach and
 * flush via stop(). Only construct when resolveOtelConfig().enabled (FR-1).
 */
export class OtelVisualizer implements VisualizerPlugin {
  readonly name = 'otel';

  private readonly spanExporter: SpanExporter;
  private readonly onWarning?: (msg: string) => void;
  private readonly exportTimeoutMillis: number;
  /** Compatibility only for legacy direct callers that omit start context. */
  private readonly legacyStartContext: VisualizerStartContext;
  /** Configured `otel.project_name` overrides the trace Resource project name. */
  private readonly projectNameOverride?: string;
  private tracerProvider: BasicTracerProvider | null = null;
  private spanManager: SpanManager | null = null;
  /**
   * Bounded warning emitter (FR-8). When ctx.onWarning is provided, this is a
   * once-wrapper shared by both the exporter callback path AND the stop() flush
   * catch path — so exactly ONE warning fires regardless of how the failure
   * manifests.
   */
  private readonly warnOnce?: (msg: string) => void;
  /** Emitter that owns this visualizer's event subscriptions. */
  private emitter: ConductorEventEmitter | null = null;
  /** Event subscriptions owned by this run; removed before a sequential run starts. */
  private readonly eventHandlers: Array<[ConductorEvent['type'], EventHandler]> = [];

  // ── T21: idempotent stop + SIGINT/SIGTERM flush handlers ──────────────────

  /**
   * Promise from the first stop() call. Set on first invocation; all subsequent
   * calls return the same promise (idempotent — no double-flush, no deadlock).
   */
  private stopPromise: Promise<void> | null = null;

  /**
   * Bound signal handler. Stored so it can be unregistered in stop() without
   * leaking across OtelVisualizer instances or test runs.
   */
  private sigHandler: (() => void) | null = null;

  constructor(config: ResolvedOtelConfig, ctx: OtelVisualizerContext) {

    // Resolve exporters: injected (tests) > transport (production).
    let spanExporter: SpanExporter;
    if (ctx.spanExporter) {
      spanExporter = ctx.spanExporter;
    } else if (config.enabled) {
      // Build from transport config (production path).
      const built = buildExporters(config as Extract<ResolvedOtelConfig, { enabled: true }>);
      spanExporter = built.spanExporter;
    } else {
      // Disabled config: should not be constructed. Throw to surface the bug.
      throw new Error(
        '[OtelVisualizer] constructed with disabled config — ' +
          'only construct when resolveOtelConfig().enabled is true (FR-1 gate in index.ts)',
      );
    }

    // FR-8: build the bounded warning emitter and wrap exporters.
    // The shared once-flag (warnEmitted) is used by BOTH the exporter-callback
    // path (WarnOnce* wrappers) and the stop() flush-catch path (this.warnOnce).
    // This guarantees exactly ONE warning regardless of failure source.
    if (ctx.onWarning) {
      let warnEmitted = false;
      this.warnOnce = (msg: string): void => {
        if (!warnEmitted) {
          warnEmitted = true;
          ctx.onWarning!(msg);
        }
      };
      spanExporter = new WarnOnceSpanExporter(spanExporter, this.warnOnce);
    }

    this.spanExporter = spanExporter;
    this.onWarning = ctx.onWarning;
    this.exportTimeoutMillis = ctx.exportTimeoutMillis ?? EXPORT_TIMEOUT_MS;
    this.legacyStartContext = {
      runId: ctx.runId,
      pipelineDir: ctx.pipelineDir,
      feature: ctx.feature,
      project: ctx.project,
    };
    if (config.enabled && config.projectName) this.projectNameOverride = config.projectName;
  }

  // ── VisualizerPlugin contract ──────────────────────────────────────────────

  /**
   * Attach to the emitter. Called once at run start.
   * All handlers return void (synchronous) to keep emit() non-blocking (R1).
   *
   * Also registers SIGINT/SIGTERM handlers that call stop() on process termination
   * (T21). Handlers are unregistered in stop() to prevent leaks across instances.
   */
  start(emitter: ConductorEventEmitter, context?: VisualizerStartContext): void {
    this.initializeProviders(context ?? this.legacyStartContext);
    this.emitter = emitter;
    for (const type of otelTracedEventTypes()) {
      const handler: EventHandler = (event) => {
        // Synchronous, O(1): span/metric APIs enqueue to batch processors.
        this.handleEvent(event);
      };
      this.eventHandlers.push([type, handler]);
      emitter.on(type, handler);
    }

    // T21: register SIGINT/SIGTERM handlers so an abrupt process termination
    // still triggers a best-effort flush. Both signals are handled by the same
    // function. stop() is idempotent — a second signal during flush returns the
    // existing stopPromise rather than starting a second flush.
    this.sigHandler = (): void => {
      void this.stop();
    };
    process.on('SIGINT', this.sigHandler);
    process.on('SIGTERM', this.sigHandler);
  }

  /**
   * Force-close open spans, then shut down both providers after their final
   * exports. Idempotent — safe to call from signal handlers or
   * directly; subsequent calls return the same promise from the first invocation
   * (not a new wrapper — callers can use reference equality to detect re-entry).
   *
   * Provider shutdown includes the effects of forceFlush under the OTel SDK
   * contract. Both shutdowns are bounded because exporter implementations may
   * return arbitrary promises.
   */
  stop(): Promise<void> {
    // Idempotent: if already stopping/stopped, return the existing promise.
    // Not async so the returned Promise is the raw stored promise, not a wrapper.
    if (this.stopPromise !== null) return this.stopPromise;

    // Unregister signal handlers immediately so they don't fire again during flush
    // and don't leak across OtelVisualizer instances (T21 no-leak contract).
    if (this.sigHandler !== null) {
      process.off('SIGINT', this.sigHandler);
      process.off('SIGTERM', this.sigHandler);
      this.sigHandler = null;
    }
    this.detachEventHandlers();

    this.stopPromise = this._doStop();
    return this.stopPromise;
  }

  /** Internal flush implementation. Only ever called once (guarded by stopPromise). */
  private async _doStop(): Promise<void> {
    if (!this.spanManager || !this.tracerProvider) return;
    // Force-close any spans still open (e.g. interrupted run, FR-9).
    this.spanManager.forceCloseAll();

    // Shut down the trace provider off the hot path.
    //
    // FR-8: export/flush errors are already intercepted at the exporter level
    // (WarnOnceSpanExporter). We additionally wrap here
    // in case provider shutdown itself throws.
    // T21: a dead transport still resolves within exportTimeoutMillis (T19 bound).
    try {
      const shutdownCompleted = await this.awaitTracerShutdown();
      if (!shutdownCompleted) {
        this.warnOnce?.(
          `[otel] tracer shutdown timed out after ${this.exportTimeoutMillis}ms`,
        );
      }
    } catch (err) {
      // Exporter-wrapper callback path already calls warnOnce on FAILED results.
      // This catch handles the rare case where shutdown itself throws; the
      // shared warnOnce flag ensures total warning count stays bounded to ONE.
      this.warnOnce?.(
        `[otel] tracer shutdown error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Bound terminal trace cleanup without weakening the provider-owned lifecycle. */
  private async awaitTracerShutdown(): Promise<boolean> {
    const shutdown = this.tracerProvider!.shutdown().then(() => true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        shutdown,
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), this.exportTimeoutMillis);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private detachEventHandlers(): void {
    if (this.emitter !== null) {
      for (const [type, handler] of this.eventHandlers) this.emitter.off(type, handler);
    }
    this.eventHandlers.length = 0;
    this.emitter = null;
  }

  // ── Internal event dispatch (synchronous, O(1)) ────────────────────────────

  private handleEvent(event: ConductorEvent): void {
    if (!this.spanManager) return;
    switch (event.type) {
      case 'step_started':
        this.spanManager.onStepStarted(event);
        break;
      case 'step_completed':
        this.spanManager.onStepCompleted(event);
        break;
      case 'step_failed':
        this.spanManager.onStepFailed(event);
        break;
      case 'provider_attempt':
        this.spanManager.onProviderAttempt(event.step, {
          step: event.step,
          provider: event.provider,
          ...(event.preferredProvider !== undefined ? { preferredProvider: event.preferredProvider } : {}),
          ...(event.model !== undefined ? { model: event.model } : {}),
          ...(event.effort !== undefined ? { effort: event.effort } : {}),
          ...(event.tier !== undefined ? { tier: event.tier } : {}),
          ...(event.tokenUsage !== undefined ? { tokenUsage: event.tokenUsage } : {}),
          ...(event.fallbackReason !== undefined ? { fallbackReason: event.fallbackReason } : {}),
        });
        break;
      case 'step_retry':
        this.spanManager.onStepRetry(event);
        break;
      case 'gate_verdict':
        this.spanManager.onGateVerdict(event);
        break;
      case 'kickback':
        this.spanManager.onKickback(event);
        break;
      case 'feature_complete':
        this.spanManager.onFeatureComplete(event);
        break;
      case 'loop_halt':
        this.spanManager.onLoopHalt(event);
        break;
      case 'build_progress':
        this.spanManager.onBuildProgress(event);
        break;
      case 'unattributed_progress':
        // Routine telemetry is intentionally tolerated without a span event.
        break;
      case 'build_no_progress':
        this.spanManager.onBuildNoProgress(event);
        break;
      case 'build_stall':
        this.spanManager.onBuildStall(event);
        break;
      case 'pipeline_closeout':
        this.spanManager.onPipelineCloseout(event);
        break;
    }
  }

  private initializeProviders(context: VisualizerStartContext): void {
    if (this.tracerProvider || this.spanManager) return;

    const resourceContext = {
      pipelineDir: context.pipelineDir ?? '',
      runId: context.runId,
      feature: context.feature,
      project: context.project,
      projectName: this.projectNameOverride ?? (context.project ? basename(context.project) : undefined),
      ...(Object.prototype.hasOwnProperty.call(context, 'branch') ? { branch: context.branch } : {}),
      ...(Object.prototype.hasOwnProperty.call(context, 'engineVersion')
        ? { engineVersion: context.engineVersion }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(context, 'harnessVersion')
        ? { harnessVersion: context.harnessVersion }
        : {}),
    };
    const traceResource = buildResource(resourceContext, 'traces');
    this.tracerProvider = new BasicTracerProvider({
      resource: traceResource,
      spanProcessors: [new BatchSpanProcessor(this.spanExporter, { exportTimeoutMillis: this.exportTimeoutMillis })],
    });
    const tracer = this.tracerProvider.getTracer('conductor', '1.0.0');
    this.spanManager = new SpanManager(tracer, this.onWarning);
  }
}
