import type { ConductorEvent } from '../../types/events.js';
import type { ConductorEventEmitter, EventHandler } from '../../ui/events.js';
import { otelEventTypes, type OtelEventType } from '../event-sinks.js';
import { DispatchMeteringTracker } from '../dispatch-metering.js';
import { forwardedFeatureOf } from '../event-persister.js';
import { MetricsRecorder, type DispatchDimensions } from './metrics.js';

type OtelEvent = Extract<ConductorEvent, { type: OtelEventType }>;
type MetricsHandler = (listener: MetricsListener, event: OtelEvent) => void;

/** The single event-fed metrics projection used by daemon and interactive runs. */
export class MetricsListener {
  private readonly handlers: Array<[ConductorEvent['type'], EventHandler]> = [];
  private readonly starts = new Map<string, Map<string, number>>();
  private readonly dispatchMetering = new Map<string, DispatchMeteringTracker>();
  private readonly terminal = new Set<string>();
  private emitter: ConductorEventEmitter | undefined;

  constructor(
    private readonly recorder: MetricsRecorder,
    private readonly now: () => number = () => Date.now(),
    private readonly featureName?: string,
  ) {}

  /** The handler table is the source of truth for both subscription and projection. */
  static readonly METRICS_HANDLERS: Record<OtelEventType, MetricsHandler> = {
    memory_setup: (listener, event) => (listener.feature(event) ?? listener.recorder).onMemorySetup(event as Extract<OtelEvent, { type: 'memory_setup' }>),
    daemon_backlog_snapshot: (listener, event) => listener.recorder.onDaemonBacklog(event as Extract<OtelEvent, { type: 'daemon_backlog_snapshot' }>),
    feature_dispatch_started: (listener, event) => {
      const dispatch = event as Extract<OtelEvent, { type: 'feature_dispatch_started' }>;
      listener.recorder.forFeature(dispatch.slug).onFeatureDispatch(dispatch.kind);
      listener.dispatchMetering.set(dispatch.slug, new DispatchMeteringTracker());
      listener.terminal.delete(dispatch.slug);
    },
    feature_dispatch_ended: (listener, event) => {
      const dispatch = event as Extract<OtelEvent, { type: 'feature_dispatch_ended' }>;
      const metric = listener.recorder.forFeature(dispatch.slug);
      if (!listener.terminal.has(dispatch.slug)) metric.onRunClose(dispatch.outcome);
      if (dispatch.outcome === 'halted' && dispatch.haltClass && dispatch.step) metric.onFeatureHalt(dispatch.haltClass, dispatch.step);
      listener.terminal.delete(dispatch.slug);
      listener.starts.delete(dispatch.slug);
      listener.dispatchMetering.delete(dispatch.slug);
    },
    feature_shipped: (listener, event) => {
      const shipped = event as Extract<OtelEvent, { type: 'feature_shipped' }>;
      const metric = listener.recorder.forFeature(shipped.slug);
      metric.onFeatureShipped();
      metric.onFeatureDuration(typeof shipped.runStartedAt === 'number' ? Math.max(0, listener.now() - shipped.runStartedAt) : undefined, shipped.active.state === 'exact' ? shipped.active.activeMs : undefined);
    },
    step_started: (listener, event) => {
      const step = event as Extract<OtelEvent, { type: 'step_started' }>;
      const slug = listener.featureOf(step);
      if (slug) {
        const featureStarts = listener.starts.get(slug) ?? new Map<string, number>();
        featureStarts.set(step.step, listener.now());
        listener.starts.set(slug, featureStarts);
      }
    },
    step_completed: (listener, event) => listener.onStepClose(event as Extract<OtelEvent, { type: 'step_completed' }>),
    step_failed: (listener, event) => listener.onStepClose(event as Extract<OtelEvent, { type: 'step_failed' }>),
    provider_attempt: (listener, event) => listener.observeDispatch(event as Extract<OtelEvent, { type: 'provider_attempt' }>),
    feature_usage_total: (listener, event) => listener.feature(event)?.onFeatureUsageTotal(event as Extract<OtelEvent, { type: 'feature_usage_total' }>),
    feature_cost_snapshot: (listener, event) => listener.feature(event)?.onFeatureCostSnapshot(event as Extract<OtelEvent, { type: 'feature_cost_snapshot' }>),
    step_retry: (listener, event) => {
      const retry = event as Extract<OtelEvent, { type: 'step_retry' }>;
      listener.feature(retry)?.onRetry(retry.step, MetricsListener.dimensionsOf(retry));
    },
    feature_complete: (listener, event) => listener.closeFeature(event, 'complete'),
    build_stall: (listener, event) => listener.recorder.onStall((event as Extract<OtelEvent, { type: 'build_stall' }>).reason),
    build_progress: () => {},
    build_no_progress: () => {},
    pipeline_closeout: (listener, event) => listener.feature(event)?.onPipelineCloseout(event as Extract<OtelEvent, { type: 'pipeline_closeout' }>),
    gate_verdict: (listener, event) => {
      const verdict = event as Extract<OtelEvent, { type: 'gate_verdict' }>;
      listener.feature(verdict)?.onGateVerdict(verdict.step, verdict.satisfied ? 'pass' : 'fail');
    },
    kickback: (listener, event) => {
      const kickback = event as Extract<OtelEvent, { type: 'kickback' }>;
      listener.feature(kickback)?.onKickback(kickback.from, kickback.to);
    },
    loop_halt: (listener, event) => listener.closeFeature(event, 'halted'),
  };

  start(emitter: ConductorEventEmitter): void {
    this.emitter = emitter;
    const missing = missingMetricsHandlerTypes();
    if (missing.length > 0) throw new Error(`MetricsListener lacks handlers for OTel event type(s): ${missing.join(', ')}`);
    for (const type of otelEventTypes()) {
      const projection = MetricsListener.METRICS_HANDLERS[type];
      const handler: EventHandler = (event) => { try { projection(this, event as OtelEvent); } catch { /* metrics are best effort */ } };
      this.handlers.push([type, handler]);
      emitter.on(type, handler);
    }
  }
  stop(): void {
    if (this.emitter) for (const [type, handler] of this.handlers) this.emitter.off(type, handler);
    this.handlers.length = 0;
    this.emitter = undefined;
    this.starts.clear(); this.dispatchMetering.clear(); this.terminal.clear();
  }

  private feature(event: ConductorEvent): MetricsRecorder | undefined {
    const slug = this.featureOf(event);
    return slug ? this.recorder.forFeature(slug) : undefined;
  }
  private featureOf(event: ConductorEvent): string | undefined {
    return forwardedFeatureOf(event)
      ?? (('slug' in event && typeof event.slug === 'string') ? event.slug : undefined)
      ?? this.featureName;
  }
  private closeFeature(event: OtelEvent, outcome: 'complete' | 'halted'): void {
    const metric = this.feature(event);
    const slug = this.featureOf(event);
    if (metric) {
      metric.onRunClose(outcome);
      if (slug) this.terminal.add(slug);
    }
  }
  private onStepClose(event: Extract<OtelEvent, { type: 'step_completed' | 'step_failed' }>): void {
    const slug = this.featureOf(event);
    const metric = this.feature(event);
    if (!slug || !metric) return;
    const featureStarts = this.starts.get(slug);
    const start = featureStarts?.get(event.step);
    this.observeDispatch(event);
    if (start !== undefined) metric.onStepClose(event.step, Math.max(0, this.now() - start), 0, event.type === 'step_completed' ? event.tokenUsage : undefined, event.type === 'step_completed' ? event.model : undefined, true, MetricsListener.dimensionsOf(event));
    featureStarts?.delete(event.step);
    if (featureStarts?.size === 0) this.starts.delete(slug);
  }

  private observeDispatch(event: Extract<OtelEvent, { type: 'provider_attempt' | 'step_completed' | 'step_failed' }>): void {
    const slug = this.featureOf(event);
    if (!slug) return;
    const tracker = this.dispatchMetering.get(slug) ?? new DispatchMeteringTracker();
    this.dispatchMetering.set(slug, tracker);
    tracker.observe(event);
  }

  private static dimensionsOf(event: Extract<OtelEvent, { type: 'step_completed' | 'step_failed' | 'step_retry' }>): DispatchDimensions {
    return {
      ...('model' in event && typeof event.model === 'string' ? { model: event.model } : {}),
      ...(event.effort !== undefined ? { effort: event.effort } : {}),
      ...('actualProvider' in event && typeof event.actualProvider === 'string' ? { provider: event.actualProvider } : {}),
      ...('provider' in event && typeof event.provider === 'string' ? { provider: event.provider } : {}),
      ...(event.tier !== undefined ? { tier: event.tier } : {}),
    };
  }
}

/** Lists OTel sink rows that lack a real listener projection. */
export function missingMetricsHandlerTypes(
  types: readonly OtelEventType[] = otelEventTypes(),
  handlers: Partial<Record<OtelEventType, MetricsHandler>> = MetricsListener.METRICS_HANDLERS,
): OtelEventType[] {
  return types.filter((type) => typeof handlers[type] !== 'function');
}
