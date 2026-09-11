import type { ConductorEvent } from '../../types/events.js';
import type { ConductorEventEmitter, EventHandler } from '../../ui/events.js';
import { otelEventTypes, type OtelEventType } from '../event-sinks.js';
import { DispatchMeteringTracker } from '../dispatch-metering.js';
import { forwardedFeatureOf } from '../event-persister.js';
import { resolveExecutionIdentity, type ResolvedExecutionIdentity } from '../execution-identity.js';
import { dispatchDimensionsFrom, stepDimensionsFrom, type DispatchDimensions, MetricsRecorder } from './metrics.js';

type OtelEvent = Extract<ConductorEvent, { type: OtelEventType }>;
type MetricsEventType = OtelEventType | 'group_member_step';
type MetricsEvent = Extract<ConductorEvent, { type: MetricsEventType }>;
type MetricsHandler = (listener: MetricsListener, event: MetricsEvent) => void;

interface StartedExecution {
  identity: ResolvedExecutionIdentity;
  startedAt: number;
  settledAt?: number;
}

/** The single event-fed metrics projection used by daemon and interactive runs. */
export class MetricsListener {
  private readonly handlers: Array<[ConductorEvent['type'], EventHandler]> = [];
  private readonly starts = new Map<string, Map<string, StartedExecution>>();
  private readonly dispatchMetering = new Map<string, DispatchMeteringTracker>();
  private readonly latestDispatchDimensions = new Map<string, Map<string, DispatchDimensions>>();
  private readonly terminal = new Set<string>();
  private emitter: ConductorEventEmitter | undefined;

  constructor(
    private readonly recorder: MetricsRecorder,
    private readonly now: () => number = () => Date.now(),
    private readonly featureName?: string,
  ) {}

  /** The handler table is the source of truth for both subscription and projection. */
  static readonly METRICS_HANDLERS: Record<MetricsEventType, MetricsHandler> = {
    memory_setup: (listener, event) => (listener.feature(event) ?? listener.recorder).onMemorySetup(event as Extract<OtelEvent, { type: 'memory_setup' }>),
    daemon_backlog_snapshot: (listener, event) => listener.recorder.onDaemonBacklog(event as Extract<OtelEvent, { type: 'daemon_backlog_snapshot' }>),
    feature_dispatch_started: (listener, event) => {
      const dispatch = event as Extract<OtelEvent, { type: 'feature_dispatch_started' }>;
      listener.recorder.forFeature(dispatch.slug).onFeatureDispatch(dispatch.kind);
      listener.dispatchMetering.set(dispatch.slug, new DispatchMeteringTracker());
      listener.latestDispatchDimensions.delete(dispatch.slug);
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
      listener.latestDispatchDimensions.delete(dispatch.slug);
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
      const identity = listener.identityFor(step, step.step);
      if (slug && identity) {
        const featureStarts = listener.starts.get(slug) ?? new Map<string, StartedExecution>();
        featureStarts.set(identity.correlationKey, { identity, startedAt: listener.now() });
        listener.starts.set(slug, featureStarts);
      }
    },
    step_completed: (listener, event) => listener.onStepClose(event as Extract<OtelEvent, { type: 'step_completed' }>),
    step_failed: (listener, event) => listener.onStepClose(event as Extract<OtelEvent, { type: 'step_failed' }>),
    group_member_step: (listener, event) => listener.onMemberSettlement(event as Extract<MetricsEvent, { type: 'group_member_step' }>),
    provider_attempt: (listener, event) => listener.onProviderAttempt(event as Extract<OtelEvent, { type: 'provider_attempt' }>),
    feature_usage_total: (listener, event) => listener.feature(event)?.onFeatureUsageTotal(event as Extract<OtelEvent, { type: 'feature_usage_total' }>),
    feature_cost_snapshot: (listener, event) => listener.feature(event)?.onFeatureCostSnapshot(event as Extract<OtelEvent, { type: 'feature_cost_snapshot' }>),
    step_retry: (listener, event) => {
      const retry = event as Extract<OtelEvent, { type: 'step_retry' }>;
      listener.feature(retry)?.onRetry(retry.step, dispatchDimensionsFrom(retry));
    },
    feature_complete: (listener, event) => listener.closeFeature(event as OtelEvent, 'complete'),
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
    loop_halt: (listener, event) => listener.closeFeature(event as OtelEvent, 'halted'),
  };

  start(emitter: ConductorEventEmitter): void {
    this.emitter = emitter;
    const missing = missingMetricsHandlerTypes();
    if (missing.length > 0) throw new Error(`MetricsListener lacks handlers for OTel event type(s): ${missing.join(', ')}`);
    // Settlement is a metrics-only lifecycle boundary until Task 8 promotes
    // its sink declaration. Keeping it in this same handler table avoids a
    // second projection path and automatically deduplicates that later sink
    // change.
    for (const type of new Set<MetricsEventType>([...otelEventTypes(), 'group_member_step'])) {
      const projection = MetricsListener.METRICS_HANDLERS[type];
      const handler: EventHandler = (event) => { try { projection(this, event as MetricsEvent); } catch { /* metrics are best effort */ } };
      this.handlers.push([type, handler]);
      emitter.on(type, handler);
    }
  }
  stop(): void {
    if (this.emitter) for (const [type, handler] of this.handlers) this.emitter.off(type, handler);
    this.handlers.length = 0;
    this.emitter = undefined;
    this.starts.clear(); this.dispatchMetering.clear(); this.latestDispatchDimensions.clear(); this.terminal.clear();
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
    if (metric && (!slug || !this.terminal.has(slug))) {
      metric.onRunClose(outcome);
      if (slug) this.terminal.add(slug);
    }
  }
  private onStepClose(event: Extract<OtelEvent, { type: 'step_completed' | 'step_failed' }>): void {
    const slug = this.featureOf(event);
    const metric = this.feature(event);
    if (!slug || !metric) return;
    const identity = this.identityFor(event, event.step);
    if (!identity) return;
    const featureStarts = this.starts.get(slug);
    const start = featureStarts?.get(identity.correlationKey);
    const compatibilityDispatch = this.observeDispatch(event);
    const dimensions = this.dispatchDimensionsForClose(slug, identity.correlationKey, event, compatibilityDispatch);
    if (start !== undefined) {
      const endedAt = start.settledAt ?? this.now();
      metric.onStepClose(identity.metricLabel, Math.max(0, endedAt - start.startedAt), 0, event.type === 'step_completed' ? event.tokenUsage : undefined, event.type === 'step_completed' ? event.model : undefined, compatibilityDispatch !== undefined, dimensions);
    }
    this.latestDispatchDimensions.get(slug)?.delete(identity.correlationKey);
    featureStarts?.delete(identity.correlationKey);
    if (featureStarts?.size === 0) this.starts.delete(slug);
  }

  private onMemberSettlement(event: Extract<MetricsEvent, { type: 'group_member_step' }>): void {
    if (event.phase !== 'result') return;
    const slug = this.featureOf(event);
    const identity = this.identityFor(event, event.member);
    const started = slug === undefined || identity === undefined
      ? undefined
      : this.starts.get(slug)?.get(identity.correlationKey);
    if (started !== undefined && started.settledAt === undefined) started.settledAt = this.now();
  }

  private onProviderAttempt(event: Extract<OtelEvent, { type: 'provider_attempt' }>): void {
    const observation = this.observeDispatch(event);
    const metric = this.feature(event);
    if (!observation || !metric) return;
    const dimensions = dispatchDimensionsFrom(event, observation);
    const slug = this.featureOf(event);
    const identity = this.identityFor(event, event.step);
    if (!identity) return;
    if (slug) this.rememberDispatchDimensions(slug, identity.correlationKey, dimensions);
    metric.onDispatch(identity.metricLabel, observation.tokenUsage, dimensions);
  }

  private observeDispatch(event: Extract<OtelEvent, { type: 'provider_attempt' | 'step_completed' | 'step_failed' }>) {
    const slug = this.featureOf(event);
    if (!slug) return undefined;
    const tracker = this.dispatchMetering.get(slug) ?? new DispatchMeteringTracker();
    this.dispatchMetering.set(slug, tracker);
    return tracker.observe(event);
  }

  private rememberDispatchDimensions(slug: string, key: string, dimensions: DispatchDimensions): void {
    if (dimensions.model === undefined || dimensions.effort === undefined
      || dimensions.provider === undefined || dimensions.tier === undefined) return;
    const feature = this.latestDispatchDimensions.get(slug) ?? new Map<string, DispatchDimensions>();
    feature.set(key, dimensions);
    this.latestDispatchDimensions.set(slug, feature);
  }

  private dispatchDimensionsForClose(
    slug: string,
    key: string,
    event: Extract<OtelEvent, { type: 'step_completed' | 'step_failed' }>,
    observation: ReturnType<DispatchMeteringTracker['observe']>,
  ): DispatchDimensions {
    return { ...this.latestDispatchDimensions.get(slug)?.get(key), ...stepDimensionsFrom(event, observation) };
  }

  private identityFor(event: ConductorEvent, legacyStep: string): ResolvedExecutionIdentity | undefined {
    const feature = this.featureOf(event);
    if (feature === undefined) return undefined;
    return resolveExecutionIdentity({
      scope: { featureId: feature, runId: 'metrics-listener' },
      legacyStep,
      executionContext: 'executionContext' in event ? event.executionContext : undefined,
    });
  }

}

/** Lists OTel sink rows that lack a real listener projection. */
export function missingMetricsHandlerTypes(
  types: readonly OtelEventType[] = otelEventTypes(),
  handlers: Partial<Record<OtelEventType, MetricsHandler>> = MetricsListener.METRICS_HANDLERS,
): OtelEventType[] {
  return types.filter((type) => typeof handlers[type] !== 'function');
}
