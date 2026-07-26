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
  type ResolvedProviderNativeStepConfig,
} from './resolved-config.js';
import {
  validateTaskAttribution,
  type TaskAttributionDiagnosticCode,
  type TaskAttributionInput,
} from './task-attribution.js';

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
  /** Validated task-local telemetry; never an authorization input. */
  taskId?: string;
  /** Sanitized invalid-attribution classification; diagnostics only. */
  taskAttributionDiagnostic?: TaskAttributionDiagnosticCode;
  /** Sanitized source selected by the Codex provider, when it reported one. */
  authenticationSource?: 'api-key' | 'cached-login';
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
  /** Task-local telemetry to validate before any candidate/session invocation. */
  taskAttribution?: TaskAttributionInput;
  onAttempt?: (
    step: StepName,
    attempt: ProviderAttemptMetadata,
  ) => void | Promise<void>;
  warn?: (
    message: string,
    transition: ProviderTransitionWarning,
  ) => void | Promise<void>;
  options: Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>;
  optionsForCandidate?: (
    candidateKey: string,
  ) => Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>;
}

/** Provider-aware execution state owned by one conductor/daemon feature run. */
export interface ProviderExecutionContext {
  configuredProviders: readonly string[];
  runtimes: ProviderRuntimeSet;
  sessions: ProviderSessionStore;
  config?: HarnessConfig;
  modelOverride?: string;
  effortOverride?: EffortLevel;
  /** Task-local telemetry passed through the provider-dispatch boundary. */
  taskAttribution?: TaskAttributionInput;
  executor?: typeof executeProviderCandidates;
  onAttempt?: ExecuteProviderCandidatesInput['onAttempt'];
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

export interface ResolveProviderCandidateNativeConfigInput {
  step: StepName;
  candidateIndex: number;
  preferredProvider: string;
  inheritedProvider: string;
  runtime: ProviderRuntime;
  config?: HarnessConfig;
  tier?: ComplexityTier;
  attempt: number;
  escalate: boolean;
  modelOverride?: string;
  effortOverride?: EffortLevel;
}

/** Resolve provider-native settings for exactly one selected candidate. */
export function resolveProviderCandidateNativeConfig({
  step,
  candidateIndex,
  preferredProvider,
  inheritedProvider,
  runtime,
  config,
  tier,
  attempt,
  escalate,
  modelOverride,
  effortOverride,
}: ResolveProviderCandidateNativeConfigInput): ResolvedProviderNativeStepConfig {
  return candidateIndex === 0
    ? resolvePreferredProviderNativeStepConfig({
        step,
        phase: phaseForStep(step),
        preferredProvider,
        inheritedProvider,
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
}

export interface InvokeProviderCandidateInput {
  providerKey: string;
  runtime: ProviderRuntime;
  sessions: Pick<ProviderSessionScope, 'prepare' | 'markCreated'>;
  resolved: ResolvedProviderNativeStepConfig;
  options: Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>;
}

/** Invoke one candidate while preserving its provider-scoped session state. */
export async function invokeProviderCandidate({
  providerKey,
  runtime,
  sessions,
  resolved,
  options,
}: InvokeProviderCandidateInput): Promise<{
  result: InvokeResult;
  invokedModel?: string;
}> {
  const session = await sessions.prepare(providerKey);
  let invocation: Awaited<ReturnType<typeof invokeRuntimeResolved>>;
  try {
    invocation = await invokeRuntimeResolved(runtime, {
      ...options,
      sessionId: session.id,
      resume: session.resume,
      model: resolved.model,
      effort: resolved.effort,
    });
  } catch (error) {
    // A runtime rejection occurs only after a live dispatch was attempted.
    // Preserve same-step retry continuity without marking cached skips.
    await sessions.markCreated(providerKey);
    throw error;
  }
  if (!invocation.result.providerInvocationSkipped) {
    await sessions.markCreated(providerKey);
  }
  return {
    result: invocation.result,
    invokedModel: invocation.model,
  };
}

export interface BuildProviderAttemptMetadataInput {
  providerKey: string;
  taskId?: string;
  taskAttributionDiagnostic?: TaskAttributionDiagnosticCode;
  result: InvokeResult;
  resolvedModel: string;
  invokedModel?: string;
  unavailable?: ProviderCandidateFailureClassification;
  nextProvider?: string;
}

/** Construct event-boundary metadata for exactly one candidate result. */
export function buildProviderAttemptMetadata({
  providerKey,
  taskId,
  taskAttributionDiagnostic,
  result,
  resolvedModel,
  invokedModel,
  unavailable,
  nextProvider,
}: BuildProviderAttemptMetadataInput): ProviderAttemptMetadata {
  const invoked = result.providerInvocationSkipped !== true;
  return {
    provider: providerKey,
    ...(taskId ? { taskId } : {}),
    ...(taskAttributionDiagnostic ? { taskAttributionDiagnostic } : {}),
    ...(result.authentication ? { authenticationSource: result.authentication.source } : {}),
    ...(invoked ? { model: invokedModel ?? resolvedModel } : {}),
    ...(invoked && result.tokenUsage ? { tokenUsage: result.tokenUsage } : {}),
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
  };
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
  taskAttribution: attributionInput,
  onAttempt,
  warn,
  options,
  optionsForCandidate,
}: ExecuteProviderCandidatesInput): Promise<ProviderExecutionResult> {
  const candidates = resolveProviderCandidates({
    configuredProviders,
    stepSelection,
  });
  const preferredProvider = candidates[0];
  const attempts: ProviderAttemptMetadata[] = [];
  const attribution = attributionInput
    ? validateTaskAttribution(attributionInput)
    : undefined;
  // Invalid attribution is diagnostic telemetry, never an execution veto.
  const taskId = attribution && 'taskId' in attribution ? attribution.taskId : undefined;
  const taskAttributionDiagnostic =
    attribution && 'diagnostic' in attribution ? attribution.diagnostic.code : undefined;

  for (const [index, providerKey] of candidates.entries()) {
    const runtime = runtimes.get(providerKey);
    const resolved = resolveProviderCandidateNativeConfig({
      step,
      candidateIndex: index,
      preferredProvider,
      inheritedProvider: configuredProviders[0],
      runtime,
      config,
      tier,
      attempt,
      escalate,
      modelOverride,
      effortOverride,
    });
    const candidateOptions = optionsForCandidate?.(providerKey) ?? options;
    const { result, invokedModel } = await invokeProviderCandidate({
      providerKey,
      runtime,
      sessions,
      resolved,
      options: candidateOptions,
    });

    const unavailable = classifyProviderCandidateFailure(result);
    const nextProvider = candidates[index + 1];
    const attemptMetadata = buildProviderAttemptMetadata({
      providerKey,
      taskId,
      taskAttributionDiagnostic,
      result,
      resolvedModel: resolved.model,
      invokedModel,
      unavailable,
      nextProvider,
    });
    attempts.push(attemptMetadata);
    await onAttempt?.(step, attemptMetadata);
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
    await warn?.(
      `Step ${step}: provider ${providerKey} unavailable (${unavailable.reason}); falling back to ${nextProvider}.`,
      transition,
    );
  }

  throw new Error('Provider candidate resolution produced no candidates');
}
