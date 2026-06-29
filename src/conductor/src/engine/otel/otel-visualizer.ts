/**
 * OtelVisualizer — visualizer plugin that exports conductor events as OTel
 * traces and metrics.
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
 *  - stop() calls forceFlush() on both providers. This IS awaited — it
 *    happens after the run, not on the hot path. shutdown() is intentionally
 *    NOT called so that InMemorySpanExporter retains spans for test assertions.
 *
 * Dependency injection:
 *  - ctx.spanExporter / ctx.metricExporter: override the transport exporters
 *    (used in tests to inject InMemorySpanExporter / InMemoryMetricExporter).
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
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { ConductorEventEmitter } from '../../ui/events.js';
import type { ConductorEvent } from '../../types/events.js';
import type { VisualizerPlugin } from '../../types/plugin.js';
import type { ResolvedOtelConfig } from './otel-config.js';
import { buildResource } from './resource.js';
import { buildExporters } from './transport.js';
import { SpanManager } from './span-manager.js';
import { MetricsRecorder } from './metrics.js';
import type { TokenUsage } from '../../execution/llm-provider.js';

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
          `[otel] span export failed: ${result.error?.message ?? result.message ?? 'unknown error'}`,
        );
      }
      resultCallback(result);
    });
  }

  async shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

/**
 * Wraps a PushMetricExporter to intercept export failures and call warnOnce
 * exactly once. Never throws; forwards the original result to the caller.
 * Optional delegation methods (selectAggregationTemporality, selectAggregation)
 * are forwarded to the inner exporter when present.
 */
class WarnOnceMetricExporter implements PushMetricExporter {
  private readonly inner: PushMetricExporter;
  private readonly warnOnce: (msg: string) => void;
  selectAggregationTemporality?: PushMetricExporter['selectAggregationTemporality'];
  selectAggregation?: PushMetricExporter['selectAggregation'];

  constructor(inner: PushMetricExporter, warnOnce: (msg: string) => void) {
    this.inner = inner;
    this.warnOnce = warnOnce;
    // Delegate optional protocol methods from the inner exporter when present.
    if (inner.selectAggregationTemporality) {
      this.selectAggregationTemporality = inner.selectAggregationTemporality.bind(inner);
    }
    if (inner.selectAggregation) {
      this.selectAggregation = inner.selectAggregation.bind(inner);
    }
  }

  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    this.inner.export(metrics, (result) => {
      if (result.code !== ExportResultCode.SUCCESS) {
        this.warnOnce(
          `[otel] metric export failed: ${result.error?.message ?? result.message ?? 'unknown error'}`,
        );
      }
      resultCallback(result);
    });
  }

  async forceFlush(): Promise<void> {
    const inner = this.inner as { forceFlush?: () => Promise<void> };
    if (typeof inner.forceFlush === 'function') {
      return inner.forceFlush();
    }
  }

  async shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

export interface OtelVisualizerContext {
  /** Deterministic run ID. When absent, buildResource() resolves from the session file. */
  runId?: string;
  /** Path to the .pipeline directory (for session-id file when runId absent). */
  pipelineDir?: string;
  /** Feature name for resource attributes. */
  feature: string;
  /** Project name for resource attributes. */
  project: string;
  /** Inject a span exporter (replaces transport; used in tests). */
  spanExporter?: SpanExporter;
  /** Inject a metric exporter (replaces transport; used in tests). */
  metricExporter?: PushMetricExporter;
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

/** Periodic export interval for metrics (long — actual flush is on stop()). */
const METRIC_EXPORT_INTERVAL_MS = 60_000;
/** Default export timeout (ms). An endpoint that does not respond within this
 * bound is considered failed; the export is abandoned and warnOnce fires. */
const EXPORT_TIMEOUT_MS = 5_000;

/**
 * The OTel visualizer plugin. Attach to the event bus via start(); detach and
 * flush via stop(). Only construct when resolveOtelConfig().enabled (FR-1).
 */
export class OtelVisualizer implements VisualizerPlugin {
  readonly name = 'otel';

  private readonly tracerProvider: BasicTracerProvider;
  private readonly meterProvider: MeterProvider;
  private readonly spanManager: SpanManager;
  private readonly metricsRecorder: MetricsRecorder;
  /**
   * Bounded warning emitter (FR-8). When ctx.onWarning is provided, this is a
   * once-wrapper shared by both the exporter callback path AND the stop() flush
   * catch path — so exactly ONE warning fires regardless of how the failure
   * manifests.
   */
  private readonly warnOnce?: (msg: string) => void;
  /** Registered handlers, kept for potential off() cleanup (currently no off needed). */
  private emitter: ConductorEventEmitter | null = null;

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

    // Build the OTel resource from injected context (FR-6).
    const resource = buildResource({
      pipelineDir: ctx.pipelineDir ?? '',
      runId: ctx.runId,
      feature: ctx.feature,
      project: ctx.project,
    });

    // Resolve exporters: injected (tests) > transport (production).
    let spanExporter: SpanExporter;
    let metricExporter: PushMetricExporter;

    if (ctx.spanExporter && ctx.metricExporter) {
      // Both injected — use them directly (test path).
      spanExporter = ctx.spanExporter;
      metricExporter = ctx.metricExporter;
    } else if (config.enabled) {
      // Build from transport config (production path).
      const built = buildExporters(config as Extract<ResolvedOtelConfig, { enabled: true }>);
      spanExporter = ctx.spanExporter ?? built.spanExporter;
      metricExporter = ctx.metricExporter ?? built.metricExporter;
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
      metricExporter = new WarnOnceMetricExporter(metricExporter, this.warnOnce);
    }

    // TracerProvider with BatchSpanProcessor (export is async/background; R1).
    // exportTimeoutMillis bounds how long a single export call may run before
    // being abandoned (T19). Default: EXPORT_TIMEOUT_MS (5 s).
    const exportTimeoutMillis = ctx.exportTimeoutMillis ?? EXPORT_TIMEOUT_MS;
    this.tracerProvider = new BasicTracerProvider({ resource });
    this.tracerProvider.addSpanProcessor(
      new BatchSpanProcessor(spanExporter, { exportTimeoutMillis }),
    );

    // MeterProvider with PeriodicExportingMetricReader (export is async; R1).
    const reader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
    });
    this.meterProvider = new MeterProvider({ resource, readers: [reader] });

    const tracer = this.tracerProvider.getTracer('conductor', '1.0.0');
    const meter = this.meterProvider.getMeter('conductor', '1.0.0');

    // MetricsRecorder is wired to SpanManager via a callback.
    this.metricsRecorder = new MetricsRecorder(meter);

    this.spanManager = new SpanManager(tracer, ctx.onWarning, {
      onStepClose: (step, durationMs, retryCount) => {
        // tokenUsage is passed below via handleEvent; stashed per-step.
        // We retrieve it here from the pending map.
        const tokenUsage = this.pendingTokenUsage.get(step);
        this.pendingTokenUsage.delete(step);
        this.metricsRecorder.onStepClose(step, durationMs, retryCount, tokenUsage);
      },
    });
  }

  /**
   * Stash tokenUsage from step_completed events so the SpanManager's onStepClose
   * callback can pass it to MetricsRecorder. Keyed by step name.
   */
  private readonly pendingTokenUsage = new Map<string, TokenUsage | undefined>();

  // ── VisualizerPlugin contract ──────────────────────────────────────────────

  /**
   * Attach to the emitter. Called once at run start.
   * All handlers return void (synchronous) to keep emit() non-blocking (R1).
   *
   * Also registers SIGINT/SIGTERM handlers that call stop() on process termination
   * (T21). Handlers are unregistered in stop() to prevent leaks across instances.
   */
  start(emitter: ConductorEventEmitter): void {
    this.emitter = emitter;
    const eventTypes: ConductorEvent['type'][] = [
      'step_started',
      'step_completed',
      'step_failed',
      'step_retry',
      'gate_verdict',
      'kickback',
      'feature_complete',
    ];
    for (const type of eventTypes) {
      emitter.on(type, (event) => {
        // Synchronous, O(1): span/metric APIs enqueue to batch processors.
        this.handleEvent(event);
      });
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
   * Force-close open spans (FR-9), flush the batch processors, and optionally
   * shut down providers. Idempotent — safe to call from signal handlers or
   * directly; subsequent calls return the same promise from the first invocation
   * (not a new wrapper — callers can use reference equality to detect re-entry).
   *
   * NOTE: We intentionally call forceFlush() ONLY and NOT shutdown() here.
   * BatchSpanProcessor.shutdown() calls exporter.shutdown() which clears
   * InMemorySpanExporter._finishedSpans — making spans unreadable after stop().
   * Callers (tests, acceptance spec) read spans AFTER stop(), so we must not
   * clear the exporter. In production (OTLP / file), the process exits after
   * stop() so the providers are GC'd naturally.
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

    this.stopPromise = this._doStop();
    return this.stopPromise;
  }

  /** Internal flush implementation. Only ever called once (guarded by stopPromise). */
  private async _doStop(): Promise<void> {
    // Force-close any spans still open (e.g. interrupted run, FR-9).
    this.spanManager.forceCloseAll();

    // Flush providers (off the hot path — intentionally async).
    //
    // FR-8: export/flush errors are already intercepted at the exporter level
    // (WarnOnceSpanExporter / WarnOnceMetricExporter). We additionally wrap here
    // in case forceFlush() itself throws (rare but possible on SDK internals).
    // T21: a dead transport still resolves within exportTimeoutMillis (T19 bound).
    try {
      await this.tracerProvider.forceFlush();
    } catch (err) {
      // Exporter-wrapper callback path already calls warnOnce on FAILED results.
      // This catch handles the rare case where forceFlush() itself throws; the
      // shared warnOnce flag ensures total warning count stays bounded to ONE.
      this.warnOnce?.(
        `[otel] tracer flush error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await this.meterProvider.forceFlush();
    } catch (err) {
      this.warnOnce?.(
        `[otel] meter flush error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Internal event dispatch (synchronous, O(1)) ────────────────────────────

  private handleEvent(event: ConductorEvent): void {
    switch (event.type) {
      case 'step_started':
        this.spanManager.onStepStarted(event);
        break;
      case 'step_completed':
        // Stash tokenUsage before onStepCompleted closes the span and fires onStepClose.
        this.pendingTokenUsage.set(event.step, event.tokenUsage);
        this.spanManager.onStepCompleted(event);
        // Cleanup: on the orphan path (no open span), onStepClose never fires and
        // the entry would leak. onStepClose deletes the entry synchronously when it
        // runs; if it did, this is a no-op. If it didn't (orphan), we clean up here.
        this.pendingTokenUsage.delete(event.step);
        break;
      case 'step_failed':
        // No tokenUsage on failed steps — stash undefined so MetricsRecorder skips.
        this.pendingTokenUsage.set(event.step, undefined);
        this.spanManager.onStepFailed(event);
        // Same orphan-path cleanup as step_completed above.
        this.pendingTokenUsage.delete(event.step);
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
    }
  }
}
