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

export interface ExecuteProviderCandidatesInput {
  step: StepName;
  configuredProviders: readonly string[];
  preferredProvider?: string;
  runtimes: ProviderRuntimeSet;
  sessions: ProviderSessionScope;
  config?: HarnessConfig;
  tier?: ComplexityTier;
  modelOverride?: string;
  effortOverride?: EffortLevel;
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
 * Execute the preferred provider for one caller-owned step/session scope.
 * Candidate advancement and cross-provider diagnostics are added separately.
 */
export async function executeProviderCandidates({
  step,
  configuredProviders,
  preferredProvider: stepSelection,
  runtimes,
  sessions,
  config,
  tier,
  modelOverride,
  effortOverride,
  options,
}: ExecuteProviderCandidatesInput): Promise<ProviderExecutionResult> {
  const [preferredProvider] = resolveProviderCandidates({
    configuredProviders,
    stepSelection,
  });
  const runtime = runtimes.get(preferredProvider);
  const resolved = resolvePreferredProviderNativeStepConfig({
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
  });
  const session = await sessions.prepare(preferredProvider);
  const result = await invokeRuntime(runtime, {
    ...options,
    sessionId: session.id,
    resume: session.resume,
    model: resolved.model,
    effort: resolved.effort,
  });
  await sessions.markCreated(preferredProvider);

  return {
    ...result,
    preferredProvider,
    actualProvider: preferredProvider,
    resolvedModel: resolved.model,
    resolvedEffort: resolved.effort,
  };
}
