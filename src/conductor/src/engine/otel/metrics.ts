/**
 * MetricsRecorder — run, dispatch, step, and feature metrics for the OTel visualizer.
 *
 * Instruments (FR-5):
 *  - conductor.step.duration  — Histogram (ms, per step)
 *  - conductor.step.retries   — Counter (per step, only when retryCount > 0)
 *  - conductor.step.tokens    — Counter (per step × kind, only when tokenUsage present)
 *  - conductor.step.cost      — Counter (per authoritative dispatch with finite cost)
 *  - conductor.step.dispatches — Counter (per authoritative dispatch)
 *  - conductor.feature.cost   — Gauge (authoritative shipped-record feature total)
 *  - conductor.run.outcomes   — Counter (once per opened run, by terminal outcome)
 *
 * All record/add calls are synchronous (enqueue to PeriodicExportingMetricReader).
 * TokenUsage absent → no data points (no NaN / zero-fill). Partial kinds
 * (input/output only) → only present kinds recorded.
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
  private readonly tokensCounter: Counter;
  private readonly costCounter: Counter;
  private readonly dispatchesCounter: Counter;
  private readonly featureCostGauge: Gauge;
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
    this.tokensCounter = meter.createCounter('conductor.step.tokens', {
      description: 'Token usage per conductor step',
    });
    this.costCounter = meter.createCounter('conductor.step.cost', {
      description: 'Cost per conductor step',
      unit: 'usd',
    });
    this.dispatchesCounter = meter.createCounter('conductor.step.dispatches', {
      description: 'Number of conductor step dispatches classified by metering status',
    });
    this.featureCostGauge = meter.createGauge('conductor.feature.cost', {
      description: 'Authoritative shipped-record cost for a conductor feature',
      unit: 'usd',
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
  onDispatch(step: string, tokenUsage?: TokenUsage, model?: string): void {
    this.dispatchesCounter.add(1, this.withIdentity({ step, metering: classifyMetering(tokenUsage) }));
    if (tokenUsage === undefined || tokenUsage === null) return;
    this.recordTokens(step, tokenUsage, model);
    this.recordCost(step, tokenUsage, model);
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

  private recordTokens(step: string, usage: TokenUsage, model?: string): void {
    for (const kind of MetricsRecorder.TOKEN_KINDS) {
      const value = usage[kind];
      if (typeof value === 'number' && !Number.isNaN(value)) {
        this.tokensCounter.add(
          value,
          this.withIdentity(model ? { step, kind, model } : { step, kind }),
        );
      }
    }
  }

  private withIdentity(attrs: Attributes): Attributes {
    return { ...attrs, ...this.identityAttrs };
  }

  private recordCost(step: string, usage: TokenUsage, model?: string): void {
    const { costUsd } = usage;
    if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) {
      return;
    }

    const attributes: Record<string, string> = { step };
    if (model !== undefined) {
      attributes.model = model;
    }
    if (usage.costSource !== undefined) {
      attributes.source = usage.costSource;
    }
    this.costCounter.add(costUsd, this.withIdentity(attributes));
  }
}
