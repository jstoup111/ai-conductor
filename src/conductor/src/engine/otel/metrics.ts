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

/** Explicit duration histogram boundaries, from 10 ms through 30 minutes. */
export const DURATION_BUCKET_BOUNDARIES_MS = [
  10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
  30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
];

export class MetricsRecorder {
  private readonly durationHistogram: Histogram;
  private readonly retriesCounter: Counter;
  private readonly dispatchesCounter: Counter;
  private readonly featureCostGauge: Gauge;
  private readonly featureStepCostGauge: Gauge;
  private readonly featureStepTokensGauge: Gauge;
  private readonly closeoutDurationHistogram: Histogram;
  private readonly runOutcomesCounter: Counter;

  constructor(
    meter: Meter,
    private readonly identityAttrs: { project: string; feature: string } = {
      project: 'unknown',
      feature: 'unknown',
    },
  ) {
    this.durationHistogram = meter.createHistogram('conductor.step.duration', {
      description: 'Duration of conductor steps in milliseconds; quantiles saturate above 30 min (largest finite bucket boundary)',
      unit: 'ms',
      advice: { explicitBucketBoundaries: DURATION_BUCKET_BOUNDARIES_MS },
    });
    this.retriesCounter = meter.createCounter('conductor.step.retries', {
      description: 'Number of retries per conductor step',
    });
    this.dispatchesCounter = meter.createCounter('conductor.step.dispatches', {
      description: 'Number of conductor step dispatches classified by metering status',
    });
    this.featureCostGauge = meter.createGauge('conductor.feature.cost', {
      description: 'Authoritative shipped-record cost for a conductor feature',
      unit: 'usd',
    });
    this.featureStepCostGauge = meter.createGauge('conductor.feature.step.cost', {
      description: 'Authoritative cumulative feature cost by step, model, and source',
      unit: 'usd',
    });
    this.featureStepTokensGauge = meter.createGauge('conductor.feature.step.tokens', {
      description: 'Authoritative cumulative feature tokens by step and model',
    });
    this.closeoutDurationHistogram = meter.createHistogram('conductor.pipeline.closeout.duration', {
      description: 'Duration of pipeline closeout obligations in milliseconds; quantiles saturate above 30 min (largest finite bucket boundary)',
      unit: 'ms',
      advice: { explicitBucketBoundaries: DURATION_BUCKET_BOUNDARIES_MS },
    });
    this.runOutcomesCounter = meter.createCounter('conductor.run.outcomes', {
      description: 'Number of conductor runs by terminal outcome',
    });
  }

  /**
   * Record metrics when a step closes (completed or failed).
   *
   * @param step       - Step name (for metric attributes).
   * @param durationMs - Wall-clock duration from step_started to close (milliseconds).
   * @param retryCount - Number of retries for this step execution.
   * @param tokenUsage - Optional token usage from step_completed; absent → skip.
   * @param model      - Optional model name from step_completed; when present,
   *                     tagged onto each token data point's attributes.
   */
  onStepClose(
    step: string,
    durationMs: number,
    retryCount: number,
    tokenUsage?: TokenUsage,
    model?: string,
    recordDispatch = true,
  ): void {
    // Duration: always record (even 0 ms is a valid observation).
    this.durationHistogram.record(durationMs, this.withIdentity({ step }));

    // Retries: skip when zero to avoid meaningless zero data points.
    if (retryCount > 0) {
      this.retriesCounter.add(retryCount, this.withIdentity({ step }));
    }

    if (recordDispatch) this.onDispatch(step, tokenUsage, model);
  }

  /** Record one dispatch selected by the shared shipped-record metering projection. */
  onDispatch(step: string, tokenUsage?: TokenUsage, _model?: string): void {
    this.dispatchesCounter.add(1, this.withIdentity({ step, metering: classifyMetering(tokenUsage) }));
  }

  /** Record cumulative ledger dimensions emitted after each step terminal. */
  onFeatureCostSnapshot(event: Extract<ConductorEvent, { type: 'feature_cost_snapshot' }>): void {
    if (!Number.isFinite(event.costUsd)) return;

    this.featureCostGauge.record(event.costUsd, this.withIdentity({ cost_complete: event.costComplete }));
    for (const bucket of event.byDimension) {
      if (!Number.isFinite(bucket.costUsd)) continue;
      const attributes: Record<string, string> = { step: bucket.step };
      if (bucket.model !== undefined) attributes.model = bucket.model;
      if (bucket.source !== undefined) attributes.source = bucket.source;
      this.featureStepCostGauge.record(bucket.costUsd, this.withIdentity(attributes));
    }
    for (const bucket of event.tokensByDimension) {
      for (const kind of MetricsRecorder.TOKEN_KINDS) {
        const value = bucket.tokens[kind];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const attributes: Record<string, string> = { step: bucket.step, kind };
        if (bucket.model !== undefined) attributes.model = bucket.model;
        this.featureStepTokensGauge.record(value, this.withIdentity(attributes));
      }
    }
  }

  /** Record the exact whole-feature cost computed from the shipped-record ledger. */
  onFeatureUsageTotal(event: Extract<ConductorEvent, { type: 'feature_usage_total' }>): void {
    if (!Number.isFinite(event.costUsd)) return;
    this.featureCostGauge.record(event.costUsd, this.withIdentity({
      cost_complete:
        event.unmeteredDispatches === 0
        && (event.costUnmeteredDispatches ?? 0) === 0,
    }));
  }

  /** Record a pipeline-owned closeout obligation as it is re-emitted on the bus. */
  onPipelineCloseout(event: Extract<ConductorEvent, { type: 'pipeline_closeout' }>): void {
    this.closeoutDurationHistogram.record(event.endedAt - event.startedAt, this.withIdentity({
      obligation: event.obligation,
    }));
  }

  /** Record the terminal outcome of an opened run exactly once. */
  onRunClose(outcome: RunOutcome): void {
    this.runOutcomesCounter.add(1, this.withIdentity({ outcome }));
  }

  /**
   * Only the four true token-count fields are recorded as "kind" data points.
   * costUsd/numTurns/durationMs (added to TokenUsage for cost rollup, Task 1)
   * are NOT token counts and must not be double-counted as counter kinds here.
   */
  private static readonly TOKEN_KINDS = [
    'input',
    'output',
    'cacheRead',
    'cacheCreation',
  ] as const;

  private withIdentity(attrs: Attributes): Attributes {
    return { ...attrs, ...this.identityAttrs };
  }
}
