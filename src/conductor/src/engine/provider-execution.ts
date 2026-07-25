import type {
  InvokeOptions,
  InvokeResult,
} from '../execution/llm-provider.js';
import type { ComplexityTier, StepName } from '../types/index.js';
import type { EffortLevel, HarnessConfig } from '../types/config.js';
import { resolveProviderCandidates } from './provider-selection.js';
import type {
  ProviderRuntime,
  ProviderRuntimeSet,
} from './provider-runtime.js';
import type { ProviderSessionScope } from './provider-session.js';
import {
  phaseForStep,
  resolveFallbackProviderNativeStepConfig,
  resolvePreferredProviderNativeStepConfig,
} from './resolved-config.js';

export interface ProviderUnavailableClassification {
  scope: 'run';
  reason: string;
}

export interface ProviderExecutionResult extends InvokeResult {
  preferredProvider: string;
  actualProvider: string;
  resolvedModel: string;
  resolvedEffort: EffortLevel;
}

export interface ProviderTransitionWarning {
  type: 'provider_fallback';
  step: StepName;
  failedProvider: string;
  reason: string;
  nextProvider: string;
}

export interface ExecuteProviderCandidatesInput {
  step: StepName;
  configuredProviders: readonly string[];
  preferredProvider?: string;
  runtimes: ProviderRuntimeSet;
  sessions: ProviderSessionScope;
  config?: HarnessConfig;
  tier?: ComplexityTier;
  attempt?: number;
  escalate?: boolean;
  modelOverride?: string;
  effortOverride?: EffortLevel;
  warn?: (
    message: string,
    transition: ProviderTransitionWarning,
  ) => void;
  options: Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>;
}

export function classifyProviderAttempt(
  result: InvokeResult,
): ProviderUnavailableClassification | undefined {
  if (
    result.providerUnavailable !== true ||
    result.providerUnavailableScope !== 'run'
  ) {
    return undefined;
  }
  return {
    scope: 'run',
    reason: result.providerUnavailableReason ?? result.output,
  };
}

/**
 * Invoke exactly one provider runtime through its provider-local availability
 * cache and native model ladder. Candidate selection lives outside this seam.
 */
export async function invokeRuntime(
  runtime: ProviderRuntime,
  options: InvokeOptions,
): Promise<InvokeResult> {
  if (runtime.runWideUnavailable) {
    const reason = runtime.runWideUnavailable.reason;
    return {
      success: false,
      output: reason,
      exitCode: 127,
      providerUnavailable: true,
      providerUnavailableReason: reason,
      providerUnavailableScope: 'run',
      providerInvocationSkipped: true,
    };
  }

  const result = await runtime.availability.invokeWithLadder(
    runtime.provider,
    options,
  );
  const unavailable = classifyProviderAttempt(result);
  if (unavailable) {
    runtime.runWideUnavailable = { reason: unavailable.reason };
  }
  return result;
}

/**
 * Execute selected-first configured providers in one caller-owned step scope.
 * Only explicit run-wide provider unavailability authorizes advancement.
 */
export async function executeProviderCandidates({
  step,
  configuredProviders,
  preferredProvider: stepSelection,
  runtimes,
  sessions,
  config,
  tier,
  attempt = 1,
  escalate = true,
  modelOverride,
  effortOverride,
  warn,
  options,
}: ExecuteProviderCandidatesInput): Promise<ProviderExecutionResult> {
  const candidates = resolveProviderCandidates({
    configuredProviders,
    stepSelection,
  });
  const preferredProvider = candidates[0];

  for (const [index, providerKey] of candidates.entries()) {
    const runtime = runtimes.get(providerKey);
    const resolved =
      index === 0
        ? resolvePreferredProviderNativeStepConfig({
            step,
            phase: phaseForStep(step),
            preferredProvider,
            inheritedProvider: configuredProviders[0],
            policy: runtime.policy,
            config,
            options: {
              tier,
              modelCliOverride: modelOverride,
              effortCliOverride: effortOverride,
            },
          })
        : resolveFallbackProviderNativeStepConfig({
            step,
            tier,
            policy: runtime.policy,
            attempt,
            escalate,
          });
    const session = await sessions.prepare(providerKey);
    const result = await invokeRuntime(runtime, {
      ...options,
      sessionId: session.id,
      resume: session.resume,
      model: resolved.model,
      effort: resolved.effort,
    });
    if (!result.providerInvocationSkipped) {
      await sessions.markCreated(providerKey);
    }

    const unavailable = classifyProviderAttempt(result);
    const nextProvider = candidates[index + 1];
    if (!unavailable || !nextProvider) {
      return {
        ...result,
        preferredProvider,
        actualProvider: providerKey,
        resolvedModel: resolved.model,
        resolvedEffort: resolved.effort,
      };
    }

    const transition: ProviderTransitionWarning = {
      type: 'provider_fallback',
      step,
      failedProvider: providerKey,
      reason: unavailable.reason,
      nextProvider,
    };
    warn?.(
      `Step ${step}: provider ${providerKey} unavailable (${unavailable.reason}); falling back to ${nextProvider}.`,
      transition,
    );
  }

  throw new Error('Provider candidate resolution produced no candidates');
}
