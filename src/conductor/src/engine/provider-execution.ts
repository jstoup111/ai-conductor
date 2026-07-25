import type {
  InvokeOptions,
  InvokeResult,
  TokenUsage,
} from '../execution/llm-provider.js';
import type { ComplexityTier, StepName } from '../types/index.js';
import type {
  EffortLevel,
  HarnessConfig,
  ProviderSelection,
} from '../types/config.js';
import { resolveProviderCandidates } from './provider-selection.js';
import type {
  ProviderRuntime,
  ProviderRuntimeSet,
} from './provider-runtime.js';
import type {
  ProviderSessionScope,
  ProviderSessionStore,
} from './provider-session.js';
import {
  phaseForStep,
  resolveFallbackProviderNativeStepConfig,
  resolvePreferredProviderNativeStepConfig,
} from './resolved-config.js';

export interface ProviderUnavailableClassification {
  scope: 'run';
  reason: string;
}

export interface ProviderCandidateFailureClassification {
  scope: 'run' | 'step';
  reason: string;
}

export interface ProviderAttemptMetadata {
  provider: string;
  model?: string;
  tokenUsage?: TokenUsage;
  outcome: 'success' | 'failure' | 'unavailable';
  reason?: string;
  fallbackReason?: string;
  invoked: boolean;
}

export interface ProviderAttributionMetadata {
  preferredProvider?: string;
  actualProvider?: string;
  attempts?: ProviderAttemptMetadata[];
}

export interface ProviderExecutionResult extends InvokeResult, ProviderAttributionMetadata {
  preferredProvider: string;
  resolvedModel?: string;
  resolvedEffort?: EffortLevel;
  attempts: ProviderAttemptMetadata[];
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
  preferredProvider?: ProviderSelection;
  runtimes: ProviderRuntimeSet;
  sessions: Pick<ProviderSessionScope, 'prepare' | 'markCreated'>;
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

/** Provider-aware execution state owned by one conductor/daemon feature run. */
export interface ProviderExecutionContext {
  configuredProviders: readonly string[];
  runtimes: ProviderRuntimeSet;
  sessions: ProviderSessionStore;
  config?: HarnessConfig;
  modelOverride?: string;
  effortOverride?: EffortLevel;
  executor?: typeof executeProviderCandidates;
  warn?: ExecuteProviderCandidatesInput['warn'];
}

function hasRecoveryPrecedence(result: InvokeResult): boolean {
  return (
    result.authFailure === true ||
    result.rateLimited === true ||
    result.sessionExpired === true
  );
}

export function classifyProviderAttempt(
  result: InvokeResult,
): ProviderUnavailableClassification | undefined {
  if (
    hasRecoveryPrecedence(result) ||
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
 * Classify only failures that may advance the current provider candidate list.
 * Model unavailability reaches this boundary only after the native ladder has
 * been exhausted; unlike run-wide unavailability, it is scoped to this step.
 */
export function classifyProviderCandidateFailure(
  result: InvokeResult,
): ProviderCandidateFailureClassification | undefined {
  if (hasRecoveryPrecedence(result)) {
    return undefined;
  }

  return (
    classifyProviderAttempt(result) ??
    (result.modelUnavailable
      ? { scope: 'step', reason: result.output }
      : undefined)
  );
}

/**
 * Invoke exactly one provider runtime through its provider-local availability
 * cache and native model ladder. Candidate selection lives outside this seam.
 */
export async function invokeRuntime(
  runtime: ProviderRuntime,
  options: InvokeOptions,
): Promise<InvokeResult> {
  return (await invokeRuntimeResolved(runtime, options)).result;
}

async function invokeRuntimeResolved(
  runtime: ProviderRuntime,
  options: InvokeOptions,
): Promise<{ result: InvokeResult; model?: string }> {
  if (runtime.runWideUnavailable) {
    const reason = runtime.runWideUnavailable.reason;
    return {
      result: {
        success: false,
        output: reason,
        exitCode: 127,
        providerUnavailable: true,
        providerUnavailableReason: reason,
        providerUnavailableScope: 'run',
        providerInvocationSkipped: true,
      },
    };
  }

  const invocation = await runtime.availability.invokeWithLadderResolved(
    runtime.provider,
    options,
  );
  const { result } = invocation;
  const unavailable = classifyProviderAttempt(result);
  if (unavailable) {
    runtime.runWideUnavailable = { reason: unavailable.reason };
  }
  return invocation;
}

/**
 * Execute selected-first configured providers in one caller-owned step scope.
 * Advancement requires explicit run-wide provider unavailability or completed
 * provider-native model exhaustion.
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
  const attempts: ProviderAttemptMetadata[] = [];

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
    let result: InvokeResult;
    let invokedModel: string | undefined;
    try {
      const invocation = await invokeRuntimeResolved(runtime, {
        ...options,
        sessionId: session.id,
        resume: session.resume,
        model: resolved.model,
        effort: resolved.effort,
      });
      result = invocation.result;
      invokedModel = invocation.model;
    } catch (error) {
      // A runtime rejection occurs only after a live dispatch was attempted.
      // Preserve same-step retry continuity without marking cached skips.
      await sessions.markCreated(providerKey);
      throw error;
    }
    if (!result.providerInvocationSkipped) {
      await sessions.markCreated(providerKey);
    }

    const unavailable = classifyProviderCandidateFailure(result);
    const nextProvider = candidates[index + 1];
    const invoked = result.providerInvocationSkipped !== true;
    attempts.push({
      provider: providerKey,
      ...(invoked ? { model: invokedModel ?? resolved.model } : {}),
      ...(invoked && result.tokenUsage
        ? { tokenUsage: result.tokenUsage }
        : {}),
      outcome: unavailable
        ? 'unavailable'
        : result.success
          ? 'success'
          : 'failure',
      ...(!result.success
        ? { reason: unavailable?.reason ?? result.output }
        : {}),
      ...(unavailable && nextProvider
        ? { fallbackReason: unavailable.reason }
        : {}),
      invoked,
    });
    if (!unavailable) {
      return {
        ...result,
        preferredProvider,
        actualProvider: providerKey,
        resolvedModel: invokedModel ?? resolved.model,
        resolvedEffort: resolved.effort,
        attempts,
      };
    }

    if (!nextProvider) {
      const diagnostic = attempts
        .map(({ provider, reason, invoked }) =>
          `${provider} (${reason}${invoked ? '' : ', cached skip'})`,
        )
        .join('; ');
      return {
        success: false,
        output: `All configured providers are unavailable for step ${step}: ${diagnostic}.`,
        exitCode: result.exitCode,
        preferredProvider,
        attempts,
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
