/**
 * MetricsRecorder — run, dispatch, step, and feature metrics for the OTel visualizer.
 *
 * Instruments (FR-5):
 *  - conductor.step.duration  — Histogram (ms, per step)
 *  - conductor.step.retries   — Counter (per step, only when retryCount > 0)
 *  - conductor.step.dispatches — Counter (per authoritative dispatch)
 *  - conductor.feature.cost   — Gauge (authoritative cumulative feature total)
 *  - conductor.feature.step.cost — Gauge (cumulative feature cost per dimension)
 *  - conductor.feature.step.tokens — Gauge (cumulative feature tokens per dimension)
 *  - conductor.run.outcomes   — Counter (once per opened run, by terminal outcome)
 *
 * All record/add calls are synchronous (enqueue to PeriodicExportingMetricReader).
 * Snapshot token buckets with absent kinds → no data points (no NaN / zero-fill).
 */
import type { Attributes, Meter, Counter, Gauge, Histogram } from '@opentelemetry/api';
import type { TokenUsage } from '../../execution/llm-provider.js';
import type { ConductorEvent } from '../../types/events.js';
import type { RunOutcome } from './span-manager.js';
import { classifyMetering } from '../metering.js';

/** Explicit duration histogram boundaries, from 10 ms through 8 hours. */
export const DURATION_BUCKET_BOUNDARIES_MS = [
  10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
  30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
  3_600_000, 7_200_000, 14_400_000, 28_800_000,
];

export class MetricsRecorder {
  private readonly instruments: MetricInstruments;

  constructor(
    meter: Meter,
    private readonly identityAttrs: { project: string; worker: string; feature?: string } = {
      project: 'unknown',
      worker: 'unknown',
    },
    instruments?: MetricInstruments,
  ) {
    this.instruments = instruments ?? createInstruments(meter);
  }

  /** Bind a feature without creating a second set of OTel instruments. */
  forFeature(feature: string): MetricsRecorder {
    return new MetricsRecorder({} as Meter, { ...this.identityAttrs, feature }, this.instruments);
  }

  onStepClose(
    step: string, durationMs: number, retryCount: number, tokenUsage?: TokenUsage, model?: string, recordDispatch = true,
  ): void {
    this.instruments.durationHistogram.record(durationMs, this.withIdentity({ step }));
    if (retryCount > 0) this.instruments.retriesCounter.add(retryCount, this.withIdentity({ step }));
    if (recordDispatch) this.onDispatch(step, tokenUsage, model);
  }

  onDispatch(step: string, tokenUsage?: TokenUsage, _model?: string): void {
    this.instruments.dispatchesCounter.add(1, this.withIdentity({ step, metering: classifyMetering(tokenUsage) }));
  }
  onRetry(step: string): void { this.instruments.retriesCounter.add(1, this.withIdentity({ step })); }

  onFeatureCostSnapshot(event: Extract<ConductorEvent, { type: 'feature_cost_snapshot' }>): void {
    if (!Number.isFinite(event.costUsd)) return;
    this.instruments.featureCostGauge.record(event.costUsd, this.withIdentity({ cost_complete: event.costComplete }));
    for (const bucket of event.byDimension) {
      if (!Number.isFinite(bucket.costUsd)) continue;
      const attributes: Record<string, string> = { step: bucket.step };
      if (bucket.model !== undefined) attributes.model = bucket.model;
      if (bucket.source !== undefined) attributes.source = bucket.source;
      this.instruments.featureStepCostGauge.record(bucket.costUsd, this.withIdentity(attributes));
    }
    for (const bucket of event.tokensByDimension) {
      for (const kind of MetricsRecorder.TOKEN_KINDS) {
        const value = bucket.tokens[kind];
        if (typeof value === 'number' && Number.isFinite(value)) {
          const attributes: Record<string, string> = { step: bucket.step, kind };
          if (bucket.model !== undefined) attributes.model = bucket.model;
          this.instruments.featureStepTokensGauge.record(value, this.withIdentity(attributes));
        }
      }
    }
  }

  onFeatureUsageTotal(event: Extract<ConductorEvent, { type: 'feature_usage_total' }>): void {
    if (Number.isFinite(event.costUsd)) this.instruments.featureCostGauge.record(event.costUsd, this.withIdentity({
      cost_complete: event.unmeteredDispatches === 0 && (event.costUnmeteredDispatches ?? 0) === 0,
    }));
  }

  onPipelineCloseout(event: Extract<ConductorEvent, { type: 'pipeline_closeout' }>): void {
    this.instruments.closeoutDurationHistogram.record(event.endedAt - event.startedAt, this.withIdentity({ obligation: event.obligation }));
  }

  onRunClose(outcome: RunOutcome): void { this.instruments.runOutcomesCounter.add(1, this.withIdentity({ outcome })); }

  onDaemonBacklog(snapshot: Extract<ConductorEvent, { type: 'daemon_backlog_snapshot' }>): void {
    for (const state of BACKLOG_STATES) {
      this.instruments.daemonBacklogGauge.record(snapshot.counts[state], this.withIdentity({ state }));
      const age = snapshot.oldestAgeSeconds[state];
      if (typeof age === 'number' && Number.isFinite(age)) this.instruments.daemonOldestAgeGauge.record(age, this.withIdentity({ state }));
    }
    this.instruments.daemonSlotsGauge.record(snapshot.slots.busy, this.withIdentity({ state: 'busy' }));
    this.instruments.daemonSlotsGauge.record(snapshot.slots.free, this.withIdentity({ state: 'free' }));
    for (const feature of snapshot.inFlight) this.instruments.daemonInflightGauge.record(1, this.withIdentity({ feature }));
    for (const reason of BLOCK_REASONS) this.instruments.daemonBlockedGauge.record(snapshot.blocked[reason] ? 1 : 0, this.withIdentity({ reason }));
    this.instruments.daemonPollHistogram.record(snapshot.pollDurationMs, this.withIdentity({}));
    this.instruments.daemonUpGauge.record(1, this.withIdentity({}));
  }

  onFeatureDispatch(kind: string): void { this.instruments.featureDispatchesCounter.add(1, this.withIdentity({ kind })); }
  onFeatureHalt(haltClass: string, step: string): void { this.instruments.featureHaltsCounter.add(1, this.withIdentity({ haltClass, step })); }
  onFeatureShipped(): void { this.instruments.featureShippedCounter.add(1, this.withIdentity({})); }
  onFeatureDuration(wallMs?: number, activeMs?: number): void {
    if (typeof wallMs === 'number' && Number.isFinite(wallMs)) this.instruments.featureWallHistogram.record(wallMs, this.withIdentity({}));
    if (typeof activeMs === 'number' && Number.isFinite(activeMs)) this.instruments.featureActiveHistogram.record(activeMs, this.withIdentity({}));
  }
  onGateVerdict(step: string, outcome: 'pass' | 'fail'): void { this.instruments.gateVerdictsCounter.add(1, this.withIdentity({ step, outcome })); }
  onKickback(from: string, to: string): void { this.instruments.gateKickbacksCounter.add(1, this.withIdentity({ from, to })); }
  onStall(reason: string): void { this.instruments.daemonStallsCounter.add(1, this.withIdentity({ reason })); }

  private static readonly TOKEN_KINDS = ['input', 'output', 'cacheRead', 'cacheCreation'] as const;
  private withIdentity(attrs: Attributes): Attributes { return { ...attrs, ...this.identityAttrs }; }
}

const BACKLOG_STATES = ['eligible', 'waiting', 'blocked', 'gated', 'parked'] as const;
const BLOCK_REASONS = ['paused', 'build_auth_missing', 'gh_version', 'episode_active'] as const;

interface MetricInstruments {
  durationHistogram: Histogram; retriesCounter: Counter; dispatchesCounter: Counter;
  featureCostGauge: Gauge; featureStepCostGauge: Gauge; featureStepTokensGauge: Gauge;
  closeoutDurationHistogram: Histogram; runOutcomesCounter: Counter;
  daemonBacklogGauge: Gauge; daemonOldestAgeGauge: Gauge; daemonSlotsGauge: Gauge; daemonInflightGauge: Gauge;
  daemonUpGauge: Gauge; daemonBlockedGauge: Gauge; daemonPollHistogram: Histogram; daemonStallsCounter: Counter;
  featureDispatchesCounter: Counter; featureHaltsCounter: Counter; featureShippedCounter: Counter;
  featureWallHistogram: Histogram; featureActiveHistogram: Histogram; gateVerdictsCounter: Counter; gateKickbacksCounter: Counter;
}

function createInstruments(meter: Meter): MetricInstruments {
  const histogram = (name: string, description: string, unit = 'ms') => meter.createHistogram(name, { description, unit, advice: { explicitBucketBoundaries: DURATION_BUCKET_BOUNDARIES_MS } });
  const counter = (name: string, description: string) => meter.createCounter(name, { description });
  const gauge = (name: string, description: string, unit?: string) => meter.createGauge(name, { description, ...(unit ? { unit } : {}) });
  return {
    durationHistogram: histogram('conductor.step.duration', 'Duration of conductor steps in milliseconds'),
    retriesCounter: counter('conductor.step.retries', 'Number of retries per conductor step'),
    dispatchesCounter: counter('conductor.step.dispatches', 'Number of conductor step dispatches classified by metering status'),
    featureCostGauge: gauge('conductor.feature.cost', 'Authoritative shipped-record cost for a conductor feature', 'usd'),
    featureStepCostGauge: gauge('conductor.feature.step.cost', 'Authoritative cumulative feature cost by dimension', 'usd'),
    featureStepTokensGauge: gauge('conductor.feature.step.tokens', 'Authoritative cumulative feature tokens by dimension'),
    closeoutDurationHistogram: histogram('conductor.pipeline.closeout.duration', 'Duration of pipeline closeout obligations in milliseconds'),
    runOutcomesCounter: counter('conductor.run.outcomes', 'Number of conductor runs by terminal outcome'),
    daemonBacklogGauge: gauge('conductor.daemon.backlog', 'Backlog entries by state'),
    daemonOldestAgeGauge: gauge('conductor.daemon.backlog.oldest_age', 'Oldest backlog age by state', 's'),
    daemonSlotsGauge: gauge('conductor.daemon.slots', 'Daemon worker slots by state'),
    daemonInflightGauge: gauge('conductor.daemon.inflight', 'Daemon features in flight'),
    daemonUpGauge: gauge('conductor.daemon.up', 'Daemon liveness'),
    daemonBlockedGauge: gauge('conductor.daemon.blocked_reason', 'Daemon dispatch blockers by reason'),
    daemonPollHistogram: histogram('conductor.daemon.poll.duration', 'Daemon discovery duration in milliseconds'),
    daemonStallsCounter: counter('conductor.daemon.stalls', 'Daemon build stalls'),
    featureDispatchesCounter: counter('conductor.feature.dispatches', 'Feature dispatches'),
    featureHaltsCounter: counter('conductor.feature.halts', 'Feature halts'),
    featureShippedCounter: counter('conductor.feature.shipped', 'Feature shipments'),
    featureWallHistogram: histogram('conductor.feature.duration.wall', 'Feature wall duration in milliseconds'),
    featureActiveHistogram: histogram('conductor.feature.duration.active', 'Feature active duration in milliseconds'),
    gateVerdictsCounter: counter('conductor.gate.verdicts', 'Gate verdicts'),
    gateKickbacksCounter: counter('conductor.gate.kickbacks', 'Gate kickbacks'),
  };
}
