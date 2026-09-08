import type { ConductorEvent } from '../../types/events.js';
import type { ConductorEventEmitter, EventHandler } from '../../ui/events.js';
import { otelEventTypes, type OtelEventType } from '../event-sinks.js';
import { forwardedFeatureOf } from '../event-persister.js';
import { MetricsRecorder } from './metrics.js';

type OtelEvent = Extract<ConductorEvent, { type: OtelEventType }>;

/** Kept as a closed map so a new OTel sink cannot silently lack a projection. */
const METRICS_HANDLERS: Record<OtelEventType, true> = {
  daemon_backlog_snapshot: true,
  feature_dispatch_started: true,
  feature_dispatch_ended: true,
  feature_shipped: true,
  step_started: true,
  step_completed: true,
  step_failed: true,
  provider_attempt: true,
  feature_usage_total: true,
  feature_cost_snapshot: true,
  step_retry: true,
  feature_complete: true,
  build_stall: true,
  build_progress: true,
  build_no_progress: true,
  pipeline_closeout: true,
  gate_verdict: true,
  kickback: true,
  loop_halt: true,
  unattributed_progress: true,
};

function metricsHandledEventTypes(): OtelEventType[] {
  return Object.keys(METRICS_HANDLERS) as OtelEventType[];
}

function assertNeverEvent(event: never): never {
  throw new Error(`unhandled OTel event: ${(event as { type?: string }).type ?? 'unknown'}`);
}

/** The single event-fed metrics projection used by daemon and interactive runs. */
export class MetricsListener {
  private readonly handlers: Array<[ConductorEvent['type'], EventHandler]> = [];
  private readonly starts = new Map<string, Map<string, number>>();
  private readonly terminal = new Set<string>();
  private emitter: ConductorEventEmitter | undefined;

  constructor(
    private readonly recorder: MetricsRecorder,
    private readonly now: () => number = () => Date.now(),
    private readonly featureName?: string,
  ) {}

  start(emitter: ConductorEventEmitter): void {
    this.emitter = emitter;
    for (const type of metricsHandledEventTypes()) {
      const handler: EventHandler = (event) => { try { this.handle(event as OtelEvent); } catch { /* metrics are best effort */ } };
      this.handlers.push([type, handler]);
      emitter.on(type, handler);
    }
  }
  stop(): void {
    if (this.emitter) for (const [type, handler] of this.handlers) this.emitter.off(type, handler);
    this.handlers.length = 0;
    this.emitter = undefined;
    this.starts.clear(); this.terminal.clear();
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
  private handle(event: ConductorEvent): void {
    switch (event.type) {
      case 'daemon_backlog_snapshot': this.recorder.onDaemonBacklog(event); break;
      case 'feature_dispatch_started': this.recorder.forFeature(event.slug).onFeatureDispatch(event.kind); this.terminal.delete(event.slug); break;
      case 'feature_dispatch_ended': {
        const metric = this.recorder.forFeature(event.slug);
        if (!this.terminal.has(event.slug)) metric.onRunClose(event.outcome);
        if (event.outcome === 'halted' && event.haltClass && event.step) metric.onFeatureHalt(event.haltClass, event.step);
        this.terminal.delete(event.slug);
        this.starts.delete(event.slug);
        break;
      }
      case 'feature_shipped': {
        const metric = this.recorder.forFeature(event.slug); metric.onFeatureShipped();
        metric.onFeatureDuration(typeof event.runStartedAt === 'number' ? Math.max(0, this.now() - event.runStartedAt) : undefined, event.active.state === 'exact' ? event.active.activeMs : undefined);
        break;
      }
      case 'step_started': {
        const slug = this.featureOf(event);
        if (slug) {
          const featureStarts = this.starts.get(slug) ?? new Map<string, number>();
          featureStarts.set(event.step, this.now());
          this.starts.set(slug, featureStarts);
        }
        break;
      }
      case 'step_retry': this.feature(event)?.onRetry(event.step); break;
      case 'step_completed': case 'step_failed': {
        const slug = this.featureOf(event); const metric = this.feature(event);
        if (slug && metric) {
          const featureStarts = this.starts.get(slug);
          const start = featureStarts?.get(event.step);
          if (start !== undefined) metric.onStepClose(event.step, Math.max(0, this.now() - start), 0, event.type === 'step_completed' ? event.tokenUsage : undefined, event.type === 'step_completed' ? event.model : undefined);
          featureStarts?.delete(event.step);
          if (featureStarts?.size === 0) this.starts.delete(slug);
        }
        break;
      }
      case 'feature_cost_snapshot': this.feature(event)?.onFeatureCostSnapshot(event); break;
      case 'feature_usage_total': this.feature(event)?.onFeatureUsageTotal(event); break;
      case 'pipeline_closeout': this.feature(event)?.onPipelineCloseout(event); break;
      case 'gate_verdict': this.feature(event)?.onGateVerdict(event.step, event.satisfied ? 'pass' : 'fail'); break;
      case 'kickback': this.feature(event)?.onKickback(event.from, event.to); break;
      case 'build_stall': this.recorder.onStall(event.reason); break;
      case 'feature_complete': { const metric = this.feature(event); const slug = this.featureOf(event); if (metric) { metric.onRunClose('complete'); if (slug) this.terminal.add(slug); } break; }
      case 'loop_halt': { const metric = this.feature(event); const slug = this.featureOf(event); if (metric) { metric.onRunClose('halted'); if (slug) this.terminal.add(slug); } break; }
      case 'provider_attempt': case 'build_progress': case 'build_no_progress': case 'unattributed_progress': break;
      // The event union has an extension-shaped member, so TypeScript cannot
      // narrow this switch to `never` by itself.  The closed map used by
      // start() above proves every OTel sink reaches one of these cases.
      default: return assertNeverEvent(event as never);
    }
  }
}
