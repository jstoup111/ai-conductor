import type { ConductorEvent } from '../../types/events.js';
import type { ConductorEventEmitter, EventHandler } from '../../ui/events.js';
import { otelEventTypes } from '../event-sinks.js';
import { forwardedFeatureOf } from '../event-persister.js';
import { MetricsRecorder } from './metrics.js';

/** The single event-fed metrics projection used by daemon and interactive runs. */
export class MetricsListener {
  private readonly handlers: Array<[ConductorEvent['type'], EventHandler]> = [];
  private readonly starts = new Map<string, number>();
  private readonly retries = new Map<string, number>();
  private readonly terminal = new Set<string>();
  private emitter: ConductorEventEmitter | undefined;

  constructor(private readonly recorder: MetricsRecorder, private readonly now: () => number = () => Date.now()) {}

  start(emitter: ConductorEventEmitter): void {
    this.emitter = emitter;
    for (const type of otelEventTypes()) {
      const handler: EventHandler = (event) => { try { this.handle(event); } catch { /* metrics are best effort */ } };
      this.handlers.push([type, handler]);
      emitter.on(type, handler);
    }
  }
  stop(): void {
    if (this.emitter) for (const [type, handler] of this.handlers) this.emitter.off(type, handler);
    this.handlers.length = 0;
    this.emitter = undefined;
    this.starts.clear(); this.retries.clear(); this.terminal.clear();
  }

  private feature(event: ConductorEvent): MetricsRecorder | undefined {
    const slug = forwardedFeatureOf(event) ?? (('slug' in event && typeof event.slug === 'string') ? event.slug : undefined);
    return slug ? this.recorder.forFeature(slug) : undefined;
  }
  private key(event: ConductorEvent, step: string): string | undefined {
    const slug = forwardedFeatureOf(event); return slug ? `${slug}:${step}` : undefined;
  }
  private handle(event: ConductorEvent): void {
    switch (event.type) {
      case 'daemon_backlog_snapshot': this.recorder.onDaemonBacklog(event); break;
      case 'feature_dispatch_started': this.recorder.forFeature(event.slug).onFeatureDispatch(event.kind); this.terminal.delete(event.slug); break;
      case 'feature_dispatch_ended': {
        if (!this.terminal.has(event.slug)) this.recorder.forFeature(event.slug).onRunClose(event.outcome);
        this.terminal.delete(event.slug);
        for (const key of this.starts.keys()) if (key.startsWith(`${event.slug}:`)) { this.starts.delete(key); this.retries.delete(key); }
        break;
      }
      case 'feature_shipped': {
        const metric = this.recorder.forFeature(event.slug); metric.onFeatureShipped();
        metric.onFeatureDuration(typeof event.runStartedAt === 'number' ? Math.max(0, this.now() - event.runStartedAt) : undefined, event.active.state === 'exact' ? event.active.activeMs : undefined);
        break;
      }
      case 'step_started': { const key = this.key(event, event.step); if (key) { this.starts.set(key, this.now()); this.retries.set(key, 0); } break; }
      case 'step_retry': { const key = this.key(event, event.step); const metric = this.feature(event); if (key) this.retries.set(key, (this.retries.get(key) ?? 0) + 1); metric?.onRetry(event.step); break; }
      case 'step_completed': case 'step_failed': {
        const key = this.key(event, event.step); const metric = this.feature(event);
        if (key && metric) { const start = this.starts.get(key); if (start !== undefined) metric.onStepClose(event.step, Math.max(0, this.now() - start), 0, event.type === 'step_completed' ? event.tokenUsage : undefined, event.type === 'step_completed' ? event.model : undefined); this.starts.delete(key); this.retries.delete(key); }
        break;
      }
      case 'feature_cost_snapshot': this.feature(event)?.onFeatureCostSnapshot(event); break;
      case 'feature_usage_total': this.feature(event)?.onFeatureUsageTotal(event); break;
      case 'pipeline_closeout': this.feature(event)?.onPipelineCloseout(event); break;
      case 'gate_verdict': this.feature(event)?.onGateVerdict(event.step, event.satisfied ? 'pass' : 'fail'); break;
      case 'kickback': this.feature(event)?.onKickback(event.from, event.to); break;
      case 'build_stall': this.feature(event)?.onStall(event.reason); break;
      case 'feature_complete': { const metric = this.feature(event); if (metric) { metric.onRunClose('complete'); const slug = forwardedFeatureOf(event); if (slug) this.terminal.add(slug); } break; }
      case 'loop_halt': { const metric = this.feature(event); if (metric) { metric.onRunClose('halted'); const slug = forwardedFeatureOf(event); if (slug) this.terminal.add(slug); } break; }
      default: break;
    }
  }
}
