/**
 * MetricsRecorder — step duration/retry/token metrics for the OTel visualizer.
 *
 * Instruments (FR-5):
 *  - conductor.step.duration  — Histogram (ms, per step)
 *  - conductor.step.retries   — Counter (per step, only when retryCount > 0)
 *  - conductor.step.tokens    — Counter (per step × kind, only when tokenUsage present)
 *
 * All record/add calls are synchronous (enqueue to PeriodicExportingMetricReader).
 * TokenUsage absent → no data points (no NaN / zero-fill). Partial kinds
 * (input/output only) → only present kinds recorded.
 */
import type { Meter, Counter, Histogram } from '@opentelemetry/api';
import type { TokenUsage } from '../../execution/llm-provider.js';

export class MetricsRecorder {
  private readonly durationHistogram: Histogram;
  private readonly retriesCounter: Counter;
  private readonly tokensCounter: Counter;

  constructor(meter: Meter) {
    this.durationHistogram = meter.createHistogram('conductor.step.duration', {
      description: 'Duration of conductor steps in milliseconds',
      unit: 'ms',
    });
    this.retriesCounter = meter.createCounter('conductor.step.retries', {
      description: 'Number of retries per conductor step',
    });
    this.tokensCounter = meter.createCounter('conductor.step.tokens', {
      description: 'Token usage per conductor step',
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
  ): void {
    // Duration: always record (even 0 ms is a valid observation).
    this.durationHistogram.record(durationMs, { step });

    // Retries: skip when zero to avoid meaningless zero data points.
    if (retryCount > 0) {
      this.retriesCounter.add(retryCount, { step });
    }

    // Tokens: only when tokenUsage is present; only present kinds recorded.
    if (tokenUsage !== undefined && tokenUsage !== null) {
      this.recordTokens(step, tokenUsage, model);
    }
    // tokenUsage absent → no token points (no NaN / zero-fill).
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
        this.tokensCounter.add(value, model ? { step, kind, model } : { step, kind });
      }
    }
  }
}
