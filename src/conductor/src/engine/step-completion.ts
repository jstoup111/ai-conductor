import type { StepName } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';
import { findBuiltInProviderDescriptor, supportsProviderCapability } from '../execution/provider-catalog.js';
import {
  CUSTOM_COMPLETION_PREDICATES,
  extraArtifactGlobs,
  STEP_ARTIFACT_GLOBS,
  stepArtifactContracts,
} from './artifacts.js';
import { STEP_SKILL_INVOCATIONS } from './skill-invocation.js';

/**
 * Engine-native steps that additionally dispatch a one-shot LLM rather than
 * computing their verdict in-process (`runBuildReview` / `dispatchVerifier` in
 * step-runners.ts). Their output can legitimately differ between attempts — a
 * transient grader-dispatch failure is exactly what the #814 backoff ladder
 * retries — so they keep the normal per-step retry budget.
 */
const AGENT_DISPATCHING_ENGINE_NATIVE_STEPS: ReadonlySet<StepName> = new Set<StepName>([
  'build_review',
  'attribution_verify',
]);

/**
 * True for a step the engine computes ENTIRELY in-process: declared
 * `kind: 'engine-native'` in STEP_SKILL_INVOCATIONS (so `renderSkillInvocation`
 * throws for it and no agent is ever dispatched) and not one of the
 * LLM-dispatching engine-native steps above. Today: `test_suite`.
 *
 * Such a step is a deterministic function of the tree it runs against, so
 * re-running it over an unchanged tree cannot produce a different answer — every
 * retry is guaranteed waste. These steps get a retry budget of ONE: they run,
 * they are judged, and they are done. A genuine failure still routes exactly as
 * before (kickback / recovery menu) — just immediately, instead of after two
 * redundant recomputations.
 */
export function isEngineComputedStep(step: StepName): boolean {
  return (
    Object.prototype.hasOwnProperty.call(STEP_SKILL_INVOCATIONS, step) &&
    STEP_SKILL_INVOCATIONS[step]?.kind === 'engine-native' &&
    !AGENT_DISPATCHING_ENGINE_NATIVE_STEPS.has(step)
  );
}

export function hasCompletionContract(step: StepName, config: HarnessConfig): boolean {
  if (config.steps?.[step]?.completion_artifact) return true;
  if (CUSTOM_COMPLETION_PREDICATES[step]) return true;
  return (STEP_ARTIFACT_GLOBS[step] ?? []).length > 0;
}

export function stepDeclaresReviewableArtifacts(step: StepName, config: HarnessConfig): boolean {
  return stepArtifactContracts(step).length > 0 || extraArtifactGlobs(step, config).length > 0;
}

export function stepHasCompletionCheck(step: StepName, config: HarnessConfig): boolean {
  return hasCompletionContract(step, config);
}

export function writeFenceInstalledForProvider(providerKey: string): boolean {
  const descriptor = findBuiltInProviderDescriptor(providerKey);
  return descriptor !== undefined && supportsProviderCapability(descriptor, 'writeFence');
}
