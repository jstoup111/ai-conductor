import type {
  InvokeOptions,
  InvokeResult,
  SelfHostInvocation,
  TokenUsage,
} from '../execution/llm-provider.js';
import type { ObservedInterval } from '../execution/observed-interval.js';
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
import { evaluateSafetyBoundary, type SafetyDiagnosticGap, type SafetyProtection } from './safety-boundary.js';
import { redactSafetyText } from './safety-diagnostics.js';

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
  observedIntervals?: readonly ObservedInterval[];
  outcome: 'success' | 'failure' | 'unavailable';
  reason?: string;
  fallbackReason?: string;
  /** Visible diagnostic-only boundary notices; never controls fallback. */
  safetyDiagnostics?: readonly string[];
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

export type ProviderTransitionWarning =
  | {
      type: 'provider_fallback';
      step: StepName;
      failedProvider: string;
      reason: string;
      nextProvider: string;
    }
  | {
      /** Resume was intentionally suppressed by the provider capability contract. */
      type: 'session_policy';
      step: StepName;
      provider: string;
      reason: string;
    };

/**
 * Resolved provider identity exposed to the per-candidate safety boundary.
 * It deliberately excludes prompts, session IDs, and authentication material.
 */
export interface ProviderCandidate {
  step: StepName;
  providerKey: string;
  model: string;
  effort: EffortLevel;
}

/** Render safe provider capability-gap notices without affecting execution. */
export function formatProviderCapabilityGapMessages(
  provider: string,
  gaps: readonly SafetyDiagnosticGap[],
): readonly string[] {
  return gaps
    .filter(
      (gap) =>
        gap.provider === provider && gap.classification === 'diagnostic-only',
    )
    .slice()
    .sort((left, right) =>
      `${left.name}\u0000${left.applicability}\u0000${left.state}`.localeCompare(
        `${right.name}\u0000${right.applicability}\u0000${right.state}`,
      ),
    )
    .map(
      (gap) =>
        `Provider ${provider}: diagnostic-only capability gap ${gap.name} (${gap.state}).`,
    );
}

/**
 * Surrounds one resolved provider invocation with preflight and terminal
 * verification. The executor awaits it before it may accept or fall back.
 */
export type WithCandidateSafety = (
  candidate: ProviderCandidate,
  invoke: () => Promise<InvokeResult>,
) => Promise<InvokeResult>;

/**
 * The production candidate boundary. It evaluates a provider-labelled verdict
 * even when no provider-independent protection applies, so BUILD/SHIP never
 * degrade to a direct executor call. Callers may supply required protections;
 * diagnostic-only gaps are carried into both result and attempt metadata.
 */
export function createCandidateSafetyBoundary(options: {
  protections?: (candidate: ProviderCandidate) => readonly SafetyProtection[];
  selfHost?: boolean;
} = {}): WithCandidateSafety {
  return async (candidate, invoke) => {
    const verdict = evaluateSafetyBoundary({
      provider: candidate.providerKey,
      context: { selfHost: options.selfHost ?? false },
      protections: options.protections?.(candidate) ?? [],
    });
    const notices = formatProviderCapabilityGapMessages(candidate.providerKey, verdict.diagnosticGaps);
    if (!verdict.passed) {
      return {
        success: false,
        exitCode: 1,
        permissionDenied: true,
        output: `Required safety protection unavailable: ${verdict.requiredFailures.map((p) => p.name).join(', ')}`,
        ...(notices.length ? { safetyDiagnostics: notices } : {}),
      };
    }
    const result = await invoke();
    return notices.length === 0
      ? result
      : {
          ...result,
          output: [...notices, result.output].filter(Boolean).join('\n'),
          safetyDiagnostics: notices,
        };
  };
}

/** Creates a child-only invocation context after the actual candidate resolves. */
export type PrepareCandidateSelfHost = (
  candidate: ProviderCandidate,
  runtime: ProviderRuntime,
) => Promise<SelfHostInvocation | undefined>;

export interface ExecuteProviderCandidatesInput {
  step: StepName;
  configuredProviders: readonly string[];
  preferredProvider?: ProviderSelection;
  runtimes: ProviderRuntimeSet;
  sessions: Pick<ProviderSessionScope, 'prepare'>;
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
  /** Best-effort error reporting for attempt telemetry; never affects execution. */
  onTelemetryError?: (
    error: unknown,
    attempt: ProviderAttemptMetadata,
  ) => void | Promise<void>;
  /** Safety boundary for each resolved candidate, after resolution and before fallback. */
  withCandidateSafety?: WithCandidateSafety;
  prepareCandidateSelfHost?: PrepareCandidateSelfHost;
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
  /** Candidate-level safety wrapper retained for every provider-aware dispatch. */
  withCandidateSafety?: WithCandidateSafety;
  prepareCandidateSelfHost?: PrepareCandidateSelfHost;
  executor?: typeof executeProviderCandidates;
  onAttempt?: ExecuteProviderCandidatesInput['onAttempt'];
  warn?: ExecuteProviderCandidatesInput['warn'];
  /** Feature-owned persisted sink for provider subprocess diagnostics. */
  diagnosticLog?: (message: string) => void;
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
  sessions: Pick<ProviderSessionScope, 'prepare'>;
  resolved: ResolvedProviderNativeStepConfig;
  options: Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>;
}

interface SessionPolicySuppression {
  provider: string;
  reason: string;
}

/** A session scope owns one step's deduplicated capability diagnostics. */
const sessionPolicyDiagnostics = new WeakMap<object, Set<string>>();

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
  sessionPolicySuppression?: SessionPolicySuppression;
}> {
  const session = await sessions.prepare(providerKey);
  const suppressForUnsupportedCapability =
    runtime.provider.supportsSessionResume !== true;
  const invocation = await invokeRuntimeResolved(runtime, {
    ...options,
    sessionId: session.id,
    resume: false,
    model: resolved.model,
    effort: resolved.effort,
  });
  return {
    result: invocation.result,
    invokedModel: invocation.model,
    ...(suppressForUnsupportedCapability
      ? {
          sessionPolicySuppression: {
            provider: providerKey,
            reason: 'Session resume suppressed: provider does not support session resume.',
          },
        }
      : {}),
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
  const failureReason = redactSafetyText(unavailable?.reason ?? result.output ?? 'Provider attempt failed.');
  return {
    provider: providerKey,
    ...(taskId ? { taskId } : {}),
    ...(taskAttributionDiagnostic ? { taskAttributionDiagnostic } : {}),
    ...(result.authentication ? { authenticationSource: result.authentication.source } : {}),
    ...(invoked ? { model: invokedModel ?? resolvedModel } : {}),
    ...(invoked && result.tokenUsage ? { tokenUsage: result.tokenUsage } : {}),
    ...(invoked && result.observedIntervals
      ? { observedIntervals: result.observedIntervals }
      : {}),
    outcome: unavailable
      ? 'unavailable'
      : result.success
        ? 'success'
        : 'failure',
    ...(!result.success
      ? { reason: failureReason }
      : {}),
    ...(unavailable && nextProvider
      ? { fallbackReason: redactSafetyText(unavailable.reason) }
      : {}),
    ...(result.safetyDiagnostics ? { safetyDiagnostics: result.safetyDiagnostics } : {}),
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
  onTelemetryError,
  withCandidateSafety,
  prepareCandidateSelfHost,
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
    // Candidate-specific options are a LAYER over the shared options, never a
    // replacement. Callers attach run-scoped fields to `options` (e.g. a
    // daemon feature's `diagnosticLog` sink) and express only the per-candidate
    // delta — usually a re-rendered prompt — in `optionsForCandidate`. Merging
    // instead of replacing keeps every scoped field alive for any future
    // candidate-options provider that does not know to re-thread it.
    const candidateOptions = optionsForCandidate
      ? { ...options, ...optionsForCandidate(providerKey) }
      : options;
    let invocation: Awaited<ReturnType<typeof invokeProviderCandidate>> | undefined;
    const invoke = async (): Promise<InvokeResult> => {
      const candidate = {
        step,
        providerKey,
        model: resolved.model,
        effort: resolved.effort,
      };
      const selfHost = await prepareCandidateSelfHost?.(candidate, runtime);
      try {
        invocation = await invokeProviderCandidate({
          providerKey,
          runtime,
          sessions,
          resolved,
          options: selfHost ? { ...candidateOptions, selfHost } : candidateOptions,
        });
        return invocation.result;
      } finally {
        await selfHost?.teardown();
      }
    };
    const result = withCandidateSafety
      ? await withCandidateSafety(
          {
            step,
            providerKey,
            model: resolved.model,
            effort: resolved.effort,
          },
          invoke,
        )
      : await invoke();
    const invokedModel = invocation?.invokedModel;
    const suppression = invocation?.sessionPolicySuppression;
    const emittedProviders = sessionPolicyDiagnostics.get(sessions) ?? new Set<string>();
    if (suppression && !emittedProviders.has(suppression.provider)) {
      emittedProviders.add(suppression.provider);
      sessionPolicyDiagnostics.set(sessions, emittedProviders);
      await warn?.(
        `Step ${step}: provider ${suppression.provider} does not support session resume; using a fresh session.`,
        {
          type: 'session_policy',
          step,
          provider: suppression.provider,
          reason: suppression.reason,
        },
      );
    }

    const unavailable = classifyProviderCandidateFailure(result);
    const safeResult = result.output === undefined
      ? result
      : { ...result, output: redactSafetyText(result.output) };
    const nextProvider = candidates[index + 1];
    const attemptMetadata = buildProviderAttemptMetadata({
      providerKey,
      taskId,
      taskAttributionDiagnostic,
      result: safeResult,
      resolvedModel: resolved.model,
      invokedModel,
      unavailable,
      nextProvider,
    });
    attempts.push(attemptMetadata);
    const observedIntervals = attempts.flatMap(
      (providerAttempt) => providerAttempt.observedIntervals ?? [],
    );
    try {
      await onAttempt?.(step, attemptMetadata);
    } catch (error) {
      // Attempt metadata is observational only. A failed telemetry sink must
      // not alter dispatch, fallback, mutation, or completion authority.
      try {
        await onTelemetryError?.(error, attemptMetadata);
      } catch {
        // Reporting the telemetry failure is itself best effort.
      }
    }
    if (!unavailable) {
      return {
        ...safeResult,
        preferredProvider,
        actualProvider: providerKey,
        resolvedModel: invokedModel ?? resolved.model,
        resolvedEffort: resolved.effort,
        attempts,
        ...(observedIntervals.length ? { observedIntervals } : {}),
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
        ...(observedIntervals.length ? { observedIntervals } : {}),
      };
    }

    const transition: ProviderTransitionWarning = {
      type: 'provider_fallback',
      step,
      failedProvider: providerKey,
      reason: redactSafetyText(unavailable.reason),
      nextProvider,
    };
    await warn?.(
      `Step ${step}: provider ${providerKey} unavailable (${redactSafetyText(unavailable.reason)}); falling back to ${nextProvider}.`,
      transition,
    );
  }

  throw new Error('Provider candidate resolution produced no candidates');
}
