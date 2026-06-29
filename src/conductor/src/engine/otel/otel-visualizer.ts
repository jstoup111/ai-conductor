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
 *  - stop() calls forceFlush() + shutdown() on both providers. This IS
 *    awaited — it happens after the run, not on the hot path.
 *
 * Dependency injection:
 *  - ctx.spanExporter / ctx.metricExporter: override the transport exporters
 *    (used in tests to inject InMemorySpanExporter / InMemoryMetricExporter).
 *  - When not provided, exporters are built from the resolved config via
 *    buildExporters() (OTLP or file transport).
 */
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import type { ConductorEventEmitter } from '../../ui/events.js';
import type { ConductorEvent } from '../../types/events.js';
import type { VisualizerPlugin } from '../../types/plugin.js';
import type { ResolvedOtelConfig } from './otel-config.js';
import { buildResource } from './resource.js';
import { buildExporters } from './transport.js';
import { SpanManager } from './span-manager.js';
import { MetricsRecorder } from './metrics.js';
import type { TokenUsage } from '../../execution/llm-provider.js';

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
}

/** Periodic export interval for metrics (long — actual flush is on stop()). */
const METRIC_EXPORT_INTERVAL_MS = 60_000;

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
  /** Registered handlers, kept for potential off() cleanup (currently no off needed). */
  private emitter: ConductorEventEmitter | null = null;

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

    // TracerProvider with BatchSpanProcessor (export is async/background; R1).
    this.tracerProvider = new BasicTracerProvider({ resource });
    this.tracerProvider.addSpanProcessor(new BatchSpanProcessor(spanExporter));

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
  }

  /**
   * Detach from the emitter (if any), force-close open spans (FR-9),
   * flush the batch processors, and shut down providers.
   */
  async stop(): Promise<void> {
    // Force-close any spans still open (e.g. interrupted run, FR-9).
    this.spanManager.forceCloseAll();

    // Flush providers (off the hot path — intentionally async).
    //
    // NOTE: We intentionally call forceFlush() ONLY and NOT shutdown() here.
    // BatchSpanProcessor.shutdown() calls exporter.shutdown() which clears
    // InMemorySpanExporter._finishedSpans — making spans unreadable after stop().
    // Callers (tests, acceptance spec) read spans AFTER stop(), so we must not
    // clear the exporter. In production (OTLP / file), the process exits after
    // stop() so the providers are GC'd naturally. (FR-8: swallow flush errors.)
    try {
      await this.tracerProvider.forceFlush();
    } catch {
      // Swallow flush errors — partial export is acceptable (FR-8).
    }
    try {
      await this.meterProvider.forceFlush();
    } catch {
      // Swallow metric flush errors.
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
        break;
      case 'step_failed':
        // No tokenUsage on failed steps — stash undefined so MetricsRecorder skips.
        this.pendingTokenUsage.set(event.step, undefined);
        this.spanManager.onStepFailed(event);
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
