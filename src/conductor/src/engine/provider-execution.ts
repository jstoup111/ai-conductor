import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type {
  InvokeOptions,
  InvokeResult,
  SelfHostInvocation,
  TokenUsage,
} from '../execution/llm-provider.js';
import type { ObservedInterval } from '../execution/observed-interval.js';
import type { ComplexityTier, ExecutionContext, StepName } from '../types/index.js';
import type {
  EffortLevel,
  HarnessConfig,
  ProviderSelection,
  ProviderSubstitutionPolicy,
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
import type { PrepareModelFallbackOptions } from './model-availability.js';
import type { ProviderAvailability } from './provider-availability.js';
import {
  validateTaskAttribution,
  type TaskAttributionDiagnosticCode,
  type TaskAttributionInput,
} from './task-attribution.js';
import { evaluateSafetyBoundary, type SafetyDiagnosticGap, type SafetyProtection } from './safety-boundary.js';
import { redactSafetyText } from './safety-diagnostics.js';
import { ModelAvailability } from './model-availability.js';
import type { ResolvedBuildReviewRubricPolicy } from './resolved-config.js';
import type { HaltMarkerWriteResult } from './halt-marker.js';
import {
  normalizeProviderSetupUnavailable,
  type ProviderSetupUnavailable,
  type ProviderSetupExhaustion,
} from './provider-setup-failure.js';
import { acquireScratchHome, releaseScratchHome } from './self-host/provider-scratch.js';

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
  /** Logical execution identity carried by the caller-owned invocation scope. */
  executionContext?: ExecutionContext;
  /** Auxiliary member that selected this candidate; never a lifecycle step. */
  auxiliaryMember?: string;
  /** Validated task-local telemetry; never an authorization input. */
  taskId?: string;
  /** Sanitized invalid-attribution classification; diagnostics only. */
  taskAttributionDiagnostic?: TaskAttributionDiagnosticCode;
  /** Sanitized source selected by the Codex provider, when it reported one. */
  authenticationSource?: 'api-key' | 'cached-login';
  preferredProvider?: string;
  model?: string;
  effort?: EffortLevel;
  tier?: ComplexityTier;
  tokenUsage?: TokenUsage;
  observedIntervals?: readonly ObservedInterval[];
  outcome: 'success' | 'failure' | 'unavailable';
  reason?: string;
  fallbackReason?: string;
  /** Why an uninvoked unavailable candidate was skipped. */
  skipReason?: 'setup-unavailable' | 'cached-unavailable' | 'policy-refused' | 'suppression-refused';
  /** Structured, redacted setup diagnostic for an explicitly skipped candidate. */
  setupCapability?: string;
  setupRecoveryAction?: string;
  /** Visible diagnostic-only boundary notices; never controls fallback. */
  safetyDiagnostics?: readonly string[];
  invoked: boolean;
}

export interface ProviderAttributionMetadata {
  preferredProvider?: string;
  actualProvider?: string;
  attempts?: ProviderAttemptMetadata[];
  /** Every candidate was unavailable during setup before an invocation began. */
  providerSetupExhaustion?: ProviderSetupExhaustion;
}

export interface ProviderExecutionResult extends InvokeResult, ProviderAttributionMetadata {
  preferredProvider: string;
  resolvedModel?: string;
  resolvedEffort?: EffortLevel;
  attempts: ProviderAttemptMetadata[];
  /** Lifecycle-supervisor marker outcome, when preparation recovery was exhausted. */
  haltMarkerWrite?: HaltMarkerWriteResult;
}

export type ProviderTransitionWarning =
  | {
      type: 'provider_fallback';
      step: StepName;
      failedProvider: string;
      reason: string;
      recoveryAction?: string;
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

/** Identity of one actual model ladder rung; step ownership remains unchanged. */
export type ProviderCandidateRung = Omit<ProviderCandidate, 'step'>;

/**
 * The sole pre-dispatch admission seam. Availability is intentionally an
 * optional in-memory dependency so interactive callers retain current
 * behavior until a daemon injects the process-scoped store.
 */
export function admitProviderCandidate(
  candidate: ProviderCandidate,
  {
    providerAvailability,
    substitutionPolicy,
    selectedProviders,
  }: {
    providerAvailability?: ProviderAvailability;
    substitutionPolicy?: ProviderSubstitutionPolicy;
    selectedProviders: readonly string[];
  },
): 'policy-refused' | 'suppression-refused' | undefined {
  if (substitutionPolicy === 'disallow' && selectedProviders.length > 0 &&
    !selectedProviders.includes(candidate.providerKey)) {
    return 'policy-refused';
  }
  return providerAvailability?.isAvailable(candidate.providerKey) === false
    ? 'suppression-refused'
    : undefined;
}

/**
 * The only extension point that runs after a real provider candidate has
 * prepared. It intentionally exposes the existing invocation callback rather
 * than a provider adapter, so policy work cannot bypass fresh sessions,
 * lifecycle permits, model fallback, or attempt metering.
 */
export interface PreparedCandidateOperationContext {
  readonly candidate: ProviderCandidate;
  readonly prepared: SelfHostInvocation | undefined;
  readonly abortSignal?: AbortSignal;
  readonly deadlineAt?: number;
  /** Candidate-local review policy may tighten prompt, cwd, or access after preparation. */
  invoke(
    overrides?: Partial<Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>>,
    onModelRung?: (candidate: ProviderCandidateRung, invoke: () => Promise<InvokeResult>) => Promise<InvokeResult>,
  ): Promise<InvokeResult>;
  /** Candidate-owned cleanup, always run from the provider execution finally. */
  onTeardown(teardown: () => Promise<void>): void;
  /** The model that actually answered the candidate invocation, if it ran. */
  invokedModel(): string | undefined;
}

/** A candidate operation either reuses evidence, judges through `invoke`, or returns a classified failure. */
export type PreparedCandidateOperationResult =
  | { readonly kind: 'hit'; readonly result: InvokeResult }
  | { readonly kind: 'judged'; readonly result: InvokeResult }
  | { readonly kind: 'failure'; readonly result: InvokeResult };

export type PreparedCandidateOperation = (
  context: PreparedCandidateOperationContext,
) => Promise<PreparedCandidateOperationResult>;

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
        executionDisposition: 'not-started',
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
  identity?: { readonly runId: string | undefined; readonly attempt: number },
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
  /** Run identity held by the enclosing step runner for self-host scratch homes. */
  runId?: string;
  /** Feature-owned worktree identity for schema-only Codex scratch. */
  nativeSchemaScratch?: {
    readonly worktreeRoot: string;
    readonly repository: string;
    readonly featureSlug: string;
  };
  /** Logical execution identity for this invocation's existing event-spine metadata. */
  executionContext?: ExecutionContext;
  escalate?: boolean;
  modelOverride?: string;
  effortOverride?: EffortLevel;
  /** A caller-owned native model ladder, used by isolated auxiliary branches. */
  modelFallbackLadder?: readonly string[];
  /** Candidate-bound work may refuse judgment once this signal is aborted. */
  abortSignal?: AbortSignal;
  /** Candidate-bound work may refuse judgment after this absolute deadline. */
  deadlineAt?: number;
  /** Optional policy/cache operation that runs only after candidate preparation. */
  preparedCandidateOperation?: PreparedCandidateOperation;
  /** Captures candidate-local immutable inputs for every eligible fallback
   * before the first candidate is allowed to invoke. */
  prepareCandidateBaseline?: (context: Pick<PreparedCandidateOperationContext, 'candidate' | 'prepared'>) => Promise<void>;
  /** Attribution label for an auxiliary branch; does not manufacture a StepName. */
  auxiliaryMember?: string;
  /** Task-local telemetry to validate before any candidate/session invocation. */
  taskAttribution?: TaskAttributionInput;
  /** Optional daemon-scoped pre-dispatch admission store. */
  providerAvailability?: ProviderAvailability;
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
  providerAvailability?: ProviderAvailability;
  /** Daemon-origin durable projection of a newly opened suppression window. */
  onProviderSuppressed?: (provider: string, deadline: number) => void | Promise<void>;
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

function unsupportedLifecycleProviderResult(providerKey: string): InvokeResult {
  const reason = `Provider ${providerKey} cannot run under daemon lifecycle supervision: missing synchronous spawn-permit capability. Recovery action: update the provider to declare lifecycleCapability.synchronousSpawnPermit and synchronously validate InvokeOptions.spawnPermit before process creation.`;
  return {
    success: false,
    output: reason,
    exitCode: 1,
    providerUnavailable: true,
    providerUnavailableScope: 'run',
    providerUnavailableReason: reason,
    providerInvocationSkipped: true,
    executionDisposition: 'not-started',
  };
}

function skippedCandidateSetupUnavailable(provider: string, result: InvokeResult, cached: boolean): ProviderSetupUnavailable | undefined {
  if (result.providerInvocationSkipped !== true) return undefined;
  if (cached) return {
    provider, capability: 'cached-provider-availability',
    reason: result.providerUnavailableReason ?? result.output ?? 'Provider is cached as unavailable.',
    recoveryAction: 'Restore the provider availability, then re-queue this feature.',
  };
  if (result.readOnlyReviewUnavailable === true) return {
    provider, capability: 'read-only-review-mode',
    reason: result.providerUnavailableReason ?? result.output ?? 'Provider read-only review mode is unavailable.',
    recoveryAction: 'Install or update the provider so its read-only review mode is available, then re-queue this feature.',
  };
  if (result.providerUnavailable === true) return {
    provider, capability: 'synchronous-spawn-permit',
    reason: result.providerUnavailableReason ?? result.output ?? 'Provider lifecycle capability is unavailable.',
    recoveryAction: 'Update the provider to declare and synchronously consume lifecycleCapability.synchronousSpawnPermit.',
  };
  return undefined;
}

/** Fail closed before dispatch rather than requesting an unconstrained answer. */
function unsupportedNativeSchemaProviderResult(providerKey: string): InvokeResult {
  return {
    success: false,
    output: `Provider ${providerKey} cannot enforce the requested native output schema: missing native output schema capability. Recovery action: select or update a provider that declares nativeSchemaCapability.nativeOutputSchema and returns InvokeResult.finalStructuredResult from its terminal result envelope.`,
    exitCode: 1,
    nativeSchemaUnsupported: true,
    providerInvocationSkipped: true,
  };
}

function cancelledPreparedCandidateResult(): InvokeResult {
  return {
    success: false,
    output: 'Prepared candidate operation cancelled before judgment.',
    exitCode: 1,
    providerInvocationSkipped: true,
  };
}

function timedOutPreparedCandidateResult(): InvokeResult {
  return {
    success: false,
    output: 'Prepared candidate operation timed out before judgment.',
    exitCode: 1,
    providerInvocationSkipped: true,
  };
}

function preparedCandidateDeadlineExpired(deadlineAt: number | undefined): boolean {
  return deadlineAt !== undefined && Date.now() >= deadlineAt;
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
  prepareFallbackOptions?: PrepareModelFallbackOptions,
  invokeModel?: (options: InvokeOptions) => Promise<InvokeResult>,
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
        executionDisposition: 'not-started',
      },
    };
  }

  const invocation = await runtime.availability.invokeWithLadderResolved(
    runtime.provider,
    options,
    prepareFallbackOptions,
    invokeModel,
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
  /**
   * Retained for caller API stability and step-scoped diagnostics keying, but
   * its ids are deliberately NEVER threaded into invocations. Provider session
   * reuse was removed by design (fresh session per invocation): on 2026-08-14
   * store-derived ids resurrected a ~1.28M-token resumed conversation shared
   * across all four build_review rubric branches. Every invocation attempt —
   * including each model-fallback-ladder attempt — mints its own randomUUID().
   */
  sessions: Pick<ProviderSessionScope, 'prepare'>;
  resolved: ResolvedProviderNativeStepConfig;
  options: Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>;
  modelFallbackLadder?: readonly string[];
  /** Allocate invocation-only resources after any per-model cache lookup. */
  prepareInvocationOptions?: (options: InvokeOptions) => Promise<InvokeOptions>;
  onModelRung?: (candidate: ProviderCandidateRung, invoke: () => Promise<InvokeResult>) => Promise<InvokeResult>;
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
  resolved,
  options,
  modelFallbackLadder,
  onModelRung,
  prepareInvocationOptions,
}: InvokeProviderCandidateInput): Promise<{
  result: InvokeResult;
  invokedModel?: string;
  sessionPolicySuppression?: SessionPolicySuppression;
}> {
  const suppressForUnsupportedCapability =
    runtime.provider.supportsSessionResume !== true;
  // Fresh session per invocation, never a store-derived id. Session reuse was
  // removed by design; the 2026-08-14 incident (rubric branches appending to a
  // shared ~1.28M-token conversation) proved a reused id resumes the prior
  // conversation regardless of `resume: false`. The adapter boundary enforces
  // the same invariant (enforceFreshSessionOptions); minting here keeps this
  // caller honest too.
  const invocationOptions = {
    ...options,
    sessionId: randomUUID(),
    resume: false,
    model: resolved.model,
    effort: resolved.effort,
  };
  // Each model-fallback-ladder attempt also gets its own fresh session.
  const prepareFallback = async () => ({ sessionId: randomUUID(), resume: false });
  const invokeModel = async (rungOptions: InvokeOptions): Promise<InvokeResult> =>
    runtime.provider.invoke(prepareInvocationOptions ? await prepareInvocationOptions(rungOptions) : rungOptions);
  const invocation = modelFallbackLadder
    ? await new ModelAvailability(modelFallbackLadder).invokeWithLadderResolved(
        runtime.provider,
        invocationOptions,
        prepareFallback,
        (rungOptions) => onModelRung
          ? onModelRung({ providerKey, ...resolved, model: rungOptions.model ?? resolved.model }, () => invokeModel(rungOptions))
          : invokeModel(rungOptions),
      )
    : onModelRung
      ? { result: await onModelRung({ providerKey, ...resolved }, () => invokeModel(invocationOptions)), model: resolved.model }
      : await invokeRuntimeResolved(runtime, invocationOptions, prepareFallback, invokeModel);
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
  executionContext?: ExecutionContext;
  taskId?: string;
  taskAttributionDiagnostic?: TaskAttributionDiagnosticCode;
  result: InvokeResult;
  preferredProvider?: string;
  resolvedModel: string;
  resolvedEffort?: EffortLevel;
  tier?: ComplexityTier;
  invokedModel?: string;
  unavailable?: ProviderCandidateFailureClassification;
  nextProvider?: string;
  auxiliaryMember?: string;
  setupUnavailable?: ProviderSetupUnavailable;
  cachedUnavailable?: boolean;
}

/** Construct event-boundary metadata for exactly one candidate result. */
export function buildProviderAttemptMetadata({
  providerKey,
  executionContext,
  taskId,
  taskAttributionDiagnostic,
  result,
  preferredProvider,
  resolvedModel,
  resolvedEffort,
  tier,
  invokedModel,
  unavailable,
  nextProvider,
  auxiliaryMember,
  setupUnavailable,
  cachedUnavailable,
}: BuildProviderAttemptMetadataInput): ProviderAttemptMetadata {
  const invoked = result.providerInvocationSkipped !== true;
  const failureReason = redactSafetyText(unavailable?.reason ?? result.output ?? 'Provider attempt failed.');
  return {
    provider: providerKey,
    ...(executionContext ? { executionContext } : {}),
    ...(auxiliaryMember ? { auxiliaryMember } : {}),
    ...(taskId ? { taskId } : {}),
    ...(taskAttributionDiagnostic ? { taskAttributionDiagnostic } : {}),
    ...(result.authentication ? { authenticationSource: result.authentication.source } : {}),
    ...(invoked && preferredProvider?.trim() ? { preferredProvider } : {}),
    ...(invoked ? { model: invokedModel ?? resolvedModel } : {}),
    ...(invoked && resolvedEffort ? { effort: resolvedEffort } : {}),
    ...(invoked && tier ? { tier } : {}),
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
    // A cached run-wide unavailability is still a setup-only skip, but it is
    // materially different from a capability discovered during this pass.
    // Keep that provenance at the event boundary; otherwise an exhausted
    // cached candidate is misleadingly reported as a newly observed setup
    // failure.
    ...(!invoked && unavailable && cachedUnavailable
      ? { skipReason: 'cached-unavailable' as const }
      : {}),
    ...(!invoked && unavailable && setupUnavailable && !cachedUnavailable
      ? { skipReason: 'setup-unavailable' as const }
      : {}),
    ...(!invoked && setupUnavailable?.capability
      ? { setupCapability: redactSafetyText(setupUnavailable.capability) }
      : {}),
    ...(!invoked && setupUnavailable
      ? { setupRecoveryAction: redactSafetyText(setupUnavailable.recoveryAction) }
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
  runId,
  nativeSchemaScratch,
  executionContext,
  escalate = true,
  modelOverride,
  effortOverride,
  modelFallbackLadder,
  abortSignal,
  deadlineAt,
  preparedCandidateOperation,
  prepareCandidateBaseline,
  auxiliaryMember,
  taskAttribution: attributionInput,
  providerAvailability,
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
    substitutionPolicy: config?.steps?.[step]?.provider_substitution ?? config?.provider_substitution,
  });
  const substitutionPolicy = config?.steps?.[step]?.provider_substitution ?? config?.provider_substitution;
  const selectedProviders = stepSelection === undefined
    ? []
    : Array.isArray(stepSelection) ? stepSelection : [stepSelection];
  const preferredProvider = candidates[0];
  const attempts: ProviderAttemptMetadata[] = [];
  let everyUnavailableCandidateWasNotStarted = true;
  const attribution = attributionInput
    ? validateTaskAttribution(attributionInput)
    : undefined;
  // Invalid attribution is diagnostic telemetry, never an execution veto.
  const taskId = attribution && 'taskId' in attribution ? attribution.taskId : undefined;
  const taskAttributionDiagnostic =
    attribution && 'diagnostic' in attribution ? attribution.diagnostic.code : undefined;
  const setupUnavailableCandidates: ProviderSetupUnavailable[] = [];
  let anyCandidateInvoked = false;
  let lastUnavailableResult: InvokeResult | undefined;

  // A fallback may become the actual candidate only after another provider has
  // failed.  Capture every candidate-local policy baseline before that can
  // start any reviewer, using the same prepared environment D6 assigns to the
  // candidate at invocation time.
  if (prepareCandidateBaseline) {
    for (const [index, providerKey] of candidates.entries()) {
      const runtime = runtimes.get(providerKey);
      const resolved = resolveProviderCandidateNativeConfig({
        step, candidateIndex: index, preferredProvider, inheritedProvider: configuredProviders[0],
        runtime, config, tier, attempt, escalate, modelOverride, effortOverride,
      });
      const candidate: ProviderCandidate = { step, providerKey, model: resolved.model, effort: resolved.effort };
      let prepared: SelfHostInvocation | undefined;
      try {
        prepared = await prepareCandidateSelfHost?.(candidate, runtime, { runId, attempt: index });
        await prepareCandidateBaseline({ candidate, prepared });
      } catch (error) {
        // Normal setup-unavailable candidates will be represented by the real
        // fallback loop.  Other baseline failures remain authoritative.
        if (!normalizeProviderSetupUnavailable(error, providerKey)) throw error;
      } finally {
        await prepared?.teardown();
      }
    }
  }

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
    const candidateOverrides = optionsForCandidate?.(providerKey);
    const candidateOptions = candidateOverrides
      ? {
          ...options,
          ...candidateOverrides,
          // Candidate-local prompts/options may vary, but lifecycle authority
          // belongs to the enclosing logical attempt and cannot be replaced.
          ...(options.spawnPermit !== undefined
            ? { spawnPermit: options.spawnPermit }
            : {}),
          // The output contract belongs to the engine-owned logical request,
          // not candidate-local prompt rendering. A candidate cannot clear or
          // replace it and thereby dispatch an unconstrained invocation.
          ...(options.nativeSchema !== undefined
            ? { nativeSchema: options.nativeSchema }
            : {}),
        }
      : options;
    const candidate: ProviderCandidate = {
      step,
      providerKey,
      model: resolved.model,
      effort: resolved.effort,
    };
    let candidateObserver: ReturnType<NonNullable<typeof candidateOptions.providerStreamObserverForCandidate>> | undefined;
    let invocation: Awaited<ReturnType<typeof invokeProviderCandidate>> | undefined;
    let selfHost: SelfHostInvocation | undefined;
    let setupUnavailable: ProviderSetupUnavailable | undefined;
    const cachedUnavailable = runtime.runWideUnavailable !== undefined;
    let schemaScratchHome: string | undefined;
    let schemaScratchRunId: string | undefined;
    let nativeSchemaScratchFailure: unknown;
    let invocationResult: Promise<InvokeResult> | undefined;
    const teardownCallbacks: Array<() => Promise<void>> = [];
    const invokeProvider = (
      overrides?: Partial<Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>>,
      onModelRung?: (candidate: ProviderCandidateRung, invoke: () => Promise<InvokeResult>) => Promise<InvokeResult>,
    ): Promise<InvokeResult> => {
      invocationResult ??= (async () => {
        const candidateInvocationOptions = candidateObserver
          ? {
              ...candidateOptions,
              ...overrides,
              streamConsumer: candidateObserver,
              onProviderStream: candidateObserver.onProviderStream,
              ...(selfHost ? { selfHost } : {}),
            }
          : selfHost
            ? { ...candidateOptions, ...overrides, selfHost }
            : { ...candidateOptions, ...overrides };
        invocation = await invokeProviderCandidate({
          providerKey,
          runtime,
          sessions,
          resolved,
          options: candidateInvocationOptions,
          prepareInvocationOptions: async (rungOptions) => {
            if (selfHost === undefined && providerKey === 'codex' && rungOptions.nativeSchema !== undefined && nativeSchemaScratch !== undefined) {
              if (schemaScratchHome === undefined) {
                schemaScratchRunId = runId ?? randomUUID();
                try {
                  schemaScratchHome = await acquireScratchHome({
                    worktreeRoot: nativeSchemaScratch.worktreeRoot,
                    repository: nativeSchemaScratch.repository,
                    featureSlug: nativeSchemaScratch.featureSlug || basename(nativeSchemaScratch.worktreeRoot),
                    runId: schemaScratchRunId, attempt, provider: 'codex',
                  });
                } catch (error) {
                  nativeSchemaScratchFailure = error;
                  throw error;
                }
              }
              return { ...rungOptions, nativeSchemaScratchHome: schemaScratchHome };
            }
            return rungOptions;
          },
          modelFallbackLadder,
          onModelRung,
        });
        return invocation.result;
      })();
      return invocationResult;
    };
    const invoke = async (): Promise<InvokeResult> => {
      try {
        // The REPL path supplies no stream consumer
        // (adr-2026-08-24-one-dispatch-member-on-the-provider-contract, and the
        // machine-envelope ADR repeats it). An interactive dispatch renders to
        // the operator's own terminal; an observer there watches a stream that
        // structurally cannot carry machine envelopes, so it is not merely
        // inert — it must never be created or attached. Create it before
        // preparation so its close boundary survives preparation failures.
        candidateObserver = candidateOptions.interactive
          ? undefined
          : candidateOptions.providerStreamObserverForCandidate?.(providerKey);
        try {
          selfHost = await prepareCandidateSelfHost?.(candidate, runtime, { runId, attempt: index });
        } catch (error) {
          setupUnavailable = normalizeProviderSetupUnavailable(error, providerKey);
          if (!setupUnavailable) throw error;
          return { success: false, output: setupUnavailable.reason, exitCode: 1, providerInvocationSkipped: true };
        }
        if (abortSignal?.aborted) return cancelledPreparedCandidateResult();
        if (preparedCandidateDeadlineExpired(deadlineAt)) {
          return timedOutPreparedCandidateResult();
        }
        if (preparedCandidateOperation) {
          const operation = await preparedCandidateOperation({
            candidate,
            prepared: selfHost,
            abortSignal,
            deadlineAt,
            invoke: invokeProvider,
            invokedModel: () => invocation?.invokedModel,
            onTeardown: (teardown) => { teardownCallbacks.push(teardown); },
          });
          // An operation may observe cancellation while resolving a policy or
          // checking a cache. It cannot publish that stale work as a judgment
          // or cache hit after the candidate's authority has ended.
          if (abortSignal?.aborted) return cancelledPreparedCandidateResult();
          if (preparedCandidateDeadlineExpired(deadlineAt)) {
            return timedOutPreparedCandidateResult();
          }
          return operation.kind === 'hit'
            ? { ...operation.result, providerInvocationSkipped: true }
            : operation.result;
        }
        return await invokeProvider();
      } finally {
        try {
          for (const teardown of teardownCallbacks.reverse()) await teardown();
        } finally {
          try {
            await selfHost?.teardown();
          } finally {
            try {
              if (schemaScratchHome !== undefined) {
                const released = await releaseScratchHome({
                  worktreeRoot: nativeSchemaScratch!.worktreeRoot,
                  runId: schemaScratchRunId!, attempt, provider: 'codex',
                });
                if (released.kind === 'failed') {
                  nativeSchemaScratchFailure = new Error(`native schema scratch teardown failed: ${released.error}`);
                  throw nativeSchemaScratchFailure;
                }
              }
            } finally {
              try { candidateObserver?.close(); } catch {
                // Observation close/flush is best effort and cannot affect fallback.
              }
            }
          }
        }
      }
    };
    const requiresLifecycleCapability = candidateOptions.spawnPermit !== undefined;
    const supportsLifecycleCapability =
      runtimes.lifecycleCapabilityFor(providerKey)?.synchronousSpawnPermit === true;
    const requiresNativeSchemaCapability = candidateOptions.nativeSchema !== undefined;
    const supportsNativeSchemaCapability =
      runtimes.nativeSchemaCapabilityFor(providerKey)?.nativeOutputSchema === true;
    const refusalReason = admitProviderCandidate(candidate, {
      providerAvailability,
      substitutionPolicy,
      selectedProviders,
    });
    if (refusalReason !== undefined) {
      const refusal: ProviderAttemptMetadata = {
        provider: providerKey,
        ...(executionContext ? { executionContext } : {}),
        outcome: 'unavailable',
        reason: refusalReason === 'policy-refused' ? 'provider-forbidden' : 'provider-suppressed',
        skipReason: refusalReason,
        invoked: false,
      };
      attempts.push(refusal);
      try {
        await onAttempt?.(step, refusal);
      } catch (error) {
        try { await onTelemetryError?.(error, refusal); } catch { /* best effort */ }
      }
      if (candidates[index + 1] !== undefined) continue;
      if (attempts.every(({ skipReason }) => skipReason === 'suppression-refused')) {
        return {
          success: false,
          output: `All configured providers are suppressed for step ${step}.`,
          exitCode: 1,
          rateLimited: true,
          preferredProvider,
          attempts,
        };
      }
      const diagnostic = attempts
        .map(({ provider, reason, invoked, skipReason }) =>
          `${provider} (${reason}${invoked ? '' : `, ${skipReason ?? 'not invoked'}`})`)
        .join('; ');
      const priorResult = lastUnavailableResult;
      const { executionDisposition: _executionDisposition, ...lastResult } = priorResult ?? {
        success: false,
        exitCode: 1,
      };
      return {
        ...lastResult,
        success: false,
        output: `All configured providers are unavailable for step ${step}: ${diagnostic}.`,
        exitCode: lastResult.exitCode ?? 1,
        preferredProvider,
        attempts,
      };
    }
    let result: InvokeResult;
    try {
      result = requiresLifecycleCapability && !supportsLifecycleCapability
        ? unsupportedLifecycleProviderResult(providerKey)
        : requiresNativeSchemaCapability && !supportsNativeSchemaCapability
          ? unsupportedNativeSchemaProviderResult(providerKey)
          : withCandidateSafety
            ? await withCandidateSafety(candidate, invoke)
            : await invoke();
    } catch (error) {
      if (nativeSchemaScratchFailure === undefined) throw error;
      result = {
        success: false,
        exitCode: 1,
        output: `Codex native schema scratch home failed: ${nativeSchemaScratchFailure instanceof Error
          ? nativeSchemaScratchFailure.message
          : String(nativeSchemaScratchFailure)}`,
      };
    }
    // A prepared cache hit or cancellation did not consult provider availability.
    if (result.providerUnavailable === true) {
      setupUnavailable ??= skippedCandidateSetupUnavailable(providerKey, result, cachedUnavailable);
    }
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
    const candidateUnavailable = setupUnavailable
      ? { scope: 'step' as const, reason: setupUnavailable.reason }
      : unavailable;
    const safeResult = result.output === undefined
      ? result
      : { ...result, output: redactSafetyText(result.output) };
    everyUnavailableCandidateWasNotStarted &&=
      !safeResult.success && safeResult.executionDisposition === 'not-started';
    const nextProvider = candidates[index + 1];
    const attemptMetadata = buildProviderAttemptMetadata({
      providerKey,
      executionContext,
      taskId,
      taskAttributionDiagnostic,
      result: safeResult,
      preferredProvider,
      resolvedModel: resolved.model,
      resolvedEffort: resolved.effort,
      tier,
      invokedModel,
      unavailable: candidateUnavailable,
      nextProvider,
      auxiliaryMember,
      setupUnavailable,
      cachedUnavailable,
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
    if (!candidateUnavailable) {
      const resultForReturn = safeResult.success
        ? (() => {
            const { executionDisposition: _executionDisposition, ...successfulResult } = safeResult;
            return successfulResult;
          })()
        : safeResult;
      return {
        ...resultForReturn,
        preferredProvider,
        actualProvider: providerKey,
        resolvedModel: invokedModel ?? resolved.model,
        resolvedEffort: resolved.effort,
        attempts,
        ...(observedIntervals.length ? { observedIntervals } : {}),
      };
    }

    lastUnavailableResult = safeResult;

    if (setupUnavailable) {
      setupUnavailableCandidates.push({
        ...setupUnavailable,
        reason: redactSafetyText(setupUnavailable.reason),
        recoveryAction: redactSafetyText(setupUnavailable.recoveryAction),
        ...(setupUnavailable.capability ? { capability: redactSafetyText(setupUnavailable.capability) } : {}),
      });
    }
    if (attemptMetadata.invoked) anyCandidateInvoked = true;

    // Setup has not created a process. Preserve the enclosing lifecycle
    // authority before considering another candidate.
    if (setupUnavailable && candidateOptions.spawnPermit) {
      const permit = candidateOptions.spawnPermit();
      if (!permit.permitted) {
        return {
          ...safeResult,
          preferredProvider,
          attempts,
          ...(observedIntervals.length ? { observedIntervals } : {}),
        };
      }
    }

    if (!nextProvider) {
      const diagnostic = attempts
        .map(({ provider, reason, invoked, skipReason }) =>
          `${provider} (${reason}${invoked ? '' : `, ${skipReason === 'setup-unavailable' ? 'setup unavailable' : skipReason === 'cached-unavailable' ? 'cached unavailable' : 'not invoked'}`})`,
        )
        .join('; ');
      const { executionDisposition: _executionDisposition, ...lastResult } = result;
      return {
        success: false,
        output: `All configured providers are unavailable for step ${step}: ${diagnostic}.`,
        exitCode: lastResult.exitCode,
        ...(everyUnavailableCandidateWasNotStarted
          ? { executionDisposition: 'not-started' as const }
          : {}),
        preferredProvider,
        attempts,
        ...(!anyCandidateInvoked && setupUnavailableCandidates.length === candidates.length
          ? {
              providerSetupExhaustion: {
                candidates: setupUnavailableCandidates as [ProviderSetupUnavailable, ...ProviderSetupUnavailable[]],
              },
            }
          : {}),
        ...(observedIntervals.length ? { observedIntervals } : {}),
      };
    }

    const transition: ProviderTransitionWarning = {
      type: 'provider_fallback',
      step,
      failedProvider: providerKey,
      reason: redactSafetyText(candidateUnavailable.reason),
      ...(setupUnavailable ? { recoveryAction: redactSafetyText(setupUnavailable.recoveryAction) } : {}),
      nextProvider,
    };
    await warn?.(
      `Step ${step}: provider ${providerKey} unavailable (${redactSafetyText(candidateUnavailable.reason)}); falling back to ${nextProvider}.`,
      transition,
    );
  }

  throw new Error('Provider candidate resolution produced no candidates');
}

/**
 * Provider-aware executor for a non-lifecycle auxiliary member. It retains
 * the enclosing lifecycle step only for supervision/telemetry while the
 * member label carries the actual rubric attribution.
 */
export interface ExecuteAuxiliaryProviderCandidatesInput<MemberId extends string>
  extends Omit<ExecuteProviderCandidatesInput,
    'configuredProviders' | 'preferredProvider' | 'attempt' | 'escalate' |
    'modelOverride' | 'effortOverride' | 'modelFallbackLadder' | 'auxiliaryMember'> {
  memberId: MemberId;
  policy: ResolvedBuildReviewRubricPolicy;
}

export async function executeAuxiliaryProviderCandidates<MemberId extends string>(
  input: ExecuteAuxiliaryProviderCandidatesInput<MemberId>,
): Promise<ProviderExecutionResult> {
  const configuredProviders = Array.isArray(input.policy.llm_provider)
    ? input.policy.llm_provider
    : [input.policy.llm_provider];
  let last: ProviderExecutionResult | undefined;
  for (let attempt = 1; attempt <= input.policy.max_retries; attempt += 1) {
    const result = await executeProviderCandidates({
      ...input,
      configuredProviders,
      preferredProvider: input.policy.llm_provider,
      attempt,
      escalate: input.policy.escalate,
      modelOverride: input.policy.model,
      effortOverride: input.policy.effort,
      modelFallbackLadder: input.policy.model_fallback_ladder,
      auxiliaryMember: input.memberId,
    });
    // A setup-only exhaustion is terminal for this logical dispatch: retrying
    // repeats the same verified capability checks without ever invoking a
    // provider.
    if (result.success || result.commandUnresolved || result.providerSetupExhaustion ||
      input.abortSignal?.aborted || preparedCandidateDeadlineExpired(input.deadlineAt)) return result;
    last = result;
  }
  return last ?? {
    success: false,
    output: `Auxiliary member ${input.memberId} had no provider attempts.`,
    exitCode: 1,
    preferredProvider: configuredProviders[0] ?? 'unknown',
    attempts: [],
  };
}
