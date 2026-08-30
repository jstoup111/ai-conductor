import type { TokenUsage } from '../execution/llm-provider.js';

/** One dispatch selected from the shared provider-attempt / legacy-step event stream. */
export interface DispatchMeteringObservation {
  step?: string;
  provider?: string;
  model?: string;
  tokenUsage?: TokenUsage;
  unmetered?: boolean;
}

/**
 * Select each invoked provider dispatch exactly once.
 *
 * `provider_attempt` is authoritative. A successful attempt suppresses the
 * matching `step_completed` compatibility record; an unmatched completion is
 * retained for ledgers produced before provider-attempt metering existed.
 */
export class DispatchMeteringTracker {
  private readonly unmatchedSuccessfulAttempts = new Map<string, number>();

  observe(event: unknown): DispatchMeteringObservation | undefined {
    if (typeof event !== 'object' || event === null) return undefined;
    const record = event as Record<string, unknown>;

    if (record.type === 'provider_attempt') {
      if (record.invoked !== true) return undefined;

      const step = typeof record.step === 'string' ? record.step : undefined;
      const provider = typeof record.provider === 'string' ? record.provider : undefined;
      if (record.outcome === 'success' && step && provider) {
        const key = DispatchMeteringTracker.key(step, provider);
        this.unmatchedSuccessfulAttempts.set(
          key,
          (this.unmatchedSuccessfulAttempts.get(key) ?? 0) + 1,
        );
      }

      return DispatchMeteringTracker.toObservation(record, step, provider);
    }

    if (record.type === 'step_completed') {
      const step = typeof record.step === 'string' ? record.step : undefined;
      const provider = typeof record.actualProvider === 'string'
        ? record.actualProvider
        : undefined;
      if (step && provider) {
        const key = DispatchMeteringTracker.key(step, provider);
        const matchingAttempts = this.unmatchedSuccessfulAttempts.get(key) ?? 0;
        if (matchingAttempts > 0) {
          this.unmatchedSuccessfulAttempts.set(key, matchingAttempts - 1);
          return undefined;
        }
      }

      return DispatchMeteringTracker.toObservation(record, step, provider);
    }

    return undefined;
  }

  private static key(step: string, provider: string): string {
    return `${step}\0${provider}`;
  }

  private static toObservation(
    record: Record<string, unknown>,
    step?: string,
    provider?: string,
  ): DispatchMeteringObservation {
    const tokenUsage = typeof record.tokenUsage === 'object' && record.tokenUsage !== null
      ? record.tokenUsage as TokenUsage
      : undefined;
    return {
      ...(step ? { step } : {}),
      ...(provider ? { provider } : {}),
      ...(typeof record.model === 'string' ? { model: record.model } : {}),
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(record.unmetered === true ? { unmetered: true } : {}),
    };
  }
}
