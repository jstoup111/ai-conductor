import type { TokenUsage } from '../execution/llm-provider.js';
import { resolveExecutionIdentity, type ExecutionScope } from './execution-identity.js';

const dispatchMeteringScope: ExecutionScope = {
  featureId: 'dispatch-metering',
  runId: 'event-stream',
};

/** One dispatch selected from the shared provider-attempt / legacy-step event stream. */
export interface DispatchMeteringObservation {
  step?: string;
  provider?: string;
  preferredProvider?: string;
  fallbackReason?: string;
  model?: string;
  effort?: string;
  tier?: string;
  tokenUsage?: TokenUsage;
  unmetered?: boolean;
}

/**
 * Select each invoked provider dispatch exactly once.
 *
 * `provider_attempt` is authoritative. A successful attempt suppresses the
 * matching `step_completed` compatibility record; an unmatched completion is
 * retained only when it carries provider evidence, for ledgers produced before
 * provider-attempt metering existed.
 */
export class DispatchMeteringTracker {
  private readonly unmatchedSuccessfulAttempts = new Map<string, number>();

  observe(event: unknown): DispatchMeteringObservation | undefined {
    if (typeof event !== 'object' || event === null) return undefined;
    const record = event as Record<string, unknown>;

    if (record.type === 'provider_attempt') {
      if (record.invoked !== true) return undefined;

      const rawStep = typeof record.step === 'string' ? record.step : undefined;
      const provider = typeof record.provider === 'string' ? record.provider : undefined;
      const identity = DispatchMeteringTracker.identity(record, rawStep);
      if (record.executionContext !== undefined && identity === undefined) return undefined;
      const step = identity?.metricLabel ?? rawStep;
      if (record.outcome === 'success' && rawStep && provider && identity) {
        const key = DispatchMeteringTracker.keyFor(record, rawStep, provider, identity.correlationKey);
        this.unmatchedSuccessfulAttempts.set(
          key,
          (this.unmatchedSuccessfulAttempts.get(key) ?? 0) + 1,
        );
      }

      return DispatchMeteringTracker.toObservation(record, step, provider, true);
    }

    if (record.type === 'step_completed') {
      const rawStep = typeof record.step === 'string' ? record.step : undefined;
      const provider = typeof record.actualProvider === 'string'
        ? record.actualProvider
        : undefined;
      const identity = DispatchMeteringTracker.identity(record, rawStep);
      if (record.executionContext !== undefined && identity === undefined) return undefined;
      const step = identity?.metricLabel ?? rawStep;
      if (rawStep && provider && identity) {
        const key = DispatchMeteringTracker.keyFor(record, rawStep, provider, identity.correlationKey);
        const matchingAttempts = this.unmatchedSuccessfulAttempts.get(key) ?? 0;
        if (matchingAttempts > 0) {
          this.unmatchedSuccessfulAttempts.set(key, matchingAttempts - 1);
          return undefined;
        }
      }

      if (!DispatchMeteringTracker.hasProviderEvidence(record)) return undefined;
      return DispatchMeteringTracker.toObservation(record, step, provider);
    }

    return undefined;
  }

  private static key(step: string, provider: string): string {
    return `${step}\0${provider}`;
  }

  private static keyFor(
    record: Record<string, unknown>,
    legacyStep: string,
    provider: string,
    correlationKey: string,
  ): string {
    return record.executionContext === undefined
      ? DispatchMeteringTracker.key(legacyStep, provider)
      : DispatchMeteringTracker.key(correlationKey, provider);
  }

  private static identity(
    record: Record<string, unknown>,
    legacyStep: string | undefined,
  ) {
    return legacyStep === undefined
      ? undefined
      : resolveExecutionIdentity({
          scope: dispatchMeteringScope,
          legacyStep,
          executionContext: record.executionContext,
        });
  }

  private static hasProviderEvidence(record: Record<string, unknown>): boolean {
    return DispatchMeteringTracker.isTokenUsage(record.tokenUsage)
      || (typeof record.actualProvider === 'string' && record.actualProvider.length > 0)
      || (typeof record.preferredProvider === 'string' && record.preferredProvider.length > 0)
      || (typeof record.model === 'string' && record.model.length > 0);
  }

  private static isTokenUsage(value: unknown): value is TokenUsage {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return typeof record.input === 'number' && typeof record.output === 'number';
  }

  private static toObservation(
    record: Record<string, unknown>,
    step?: string,
    provider?: string,
    includeAttemptFallbackDetails = false,
  ): DispatchMeteringObservation {
    const tokenUsage = typeof record.tokenUsage === 'object' && record.tokenUsage !== null
      ? record.tokenUsage as TokenUsage
      : undefined;
    return {
      ...(step ? { step } : {}),
      ...(provider ? { provider } : {}),
      ...(includeAttemptFallbackDetails
        && typeof record.preferredProvider === 'string'
        && record.preferredProvider.length > 0
        ? { preferredProvider: record.preferredProvider }
        : {}),
      ...(includeAttemptFallbackDetails
        && typeof record.fallbackReason === 'string'
        && record.fallbackReason.length > 0
        ? { fallbackReason: record.fallbackReason }
        : {}),
      ...(typeof record.model === 'string' ? { model: record.model } : {}),
      ...(typeof record.effort === 'string' ? { effort: record.effort } : {}),
      ...(typeof record.tier === 'string' ? { tier: record.tier } : {}),
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(record.unmetered === true ? { unmetered: true } : {}),
    };
  }
}
