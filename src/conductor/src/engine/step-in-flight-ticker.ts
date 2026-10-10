import { resolveBuildProgressConfig } from './config.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import type { HarnessConfig, StepName } from '../types/index.js';

export interface StepInFlightTickerOptions {
  events: ConductorEventEmitter;
  step: StepName;
  startedAtMs: number;
  featureSlug?: string;
  config?: Pick<HarnessConfig, 'build_progress'>;
  now?: () => number;
}

/**
 * Emits a periodic heartbeat for a running non-build lifecycle step.
 *
 * The ticker is deliberately separate from BuildProgressWatcher: non-build
 * steps have no task-status progress to poll, but the shared event spine
 * still needs a bounded indication that the step remains in flight.
 */
export class StepInFlightTicker {
  private readonly events: ConductorEventEmitter;
  private readonly step: StepName;
  private readonly startedAtMs: number;
  private readonly featureSlug?: string;
  private readonly heartbeatMs: number;
  private readonly enabled: boolean;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: StepInFlightTickerOptions) {
    const config = resolveBuildProgressConfig(opts.config ?? {});
    this.events = opts.events;
    this.step = opts.step;
    this.startedAtMs = opts.startedAtMs;
    this.featureSlug = opts.featureSlug;
    this.heartbeatMs = config.heartbeat_minutes * 60_000;
    this.enabled = config.enabled;
    this.now = opts.now ?? Date.now;
  }

  /** No-op when disabled or while an interval is already active. */
  start(): void {
    if (!this.enabled || this.timer) return;

    const timer = setInterval(() => {
      void this.events.emit({
        type: 'step_in_flight',
        step: this.step,
        elapsedMs: this.now() - this.startedAtMs,
        featureSlug: this.featureSlug,
      });
    }, this.heartbeatMs);
    const maybeUnref = timer as unknown as { unref?: () => void };
    if (typeof maybeUnref.unref === 'function') {
      maybeUnref.unref(); // portability-ok: guarded timer detachment cannot affect ticker lifecycle
    }
    this.timer = timer;
  }

  /** Idempotent — safe before start, after start, and after a prior stop. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
