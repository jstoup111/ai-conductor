import { createHash } from "node:crypto";

import type { BuildReviewRubricId } from "../types/config.js";

/** Test-quality analysis facts that determine whether a prior lap is reusable. */
export interface BuildReviewTestScopePolicyIdentity {
  readonly analysisVersion: string;
  readonly bindingIdentity: string;
}

/**
 * The resolved policy facts that determine one rubric's review scope.
 *
 * `engineStamp` is deliberately accepted but excluded: an engine rebuild does
 * not change what the policy asks the rubric to review.
 */
export interface BuildReviewPolicyIdentityInputs {
  readonly contractVersion: string;
  readonly projectionVersion: string;
  readonly declarationFingerprint: string;
  readonly effectiveBundleDigest: string;
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
  readonly engineStamp: string;
  readonly testScope?: BuildReviewTestScopePolicyIdentity;
}

/**
 * Canonical, path-free identity for the policy governing one rubric's lap.
 *
 * This is intentionally narrower than a semantic cache key: per-lap review
 * scope must survive a source-diff change and an engine-only rebuild.
 */
export function buildReviewPolicyIdentity(
  rubric: BuildReviewRubricId | string,
  inputs: BuildReviewPolicyIdentityInputs,
): string {
  const canonical = {
    version: 1,
    rubric,
    contractVersion: inputs.contractVersion,
    projectionVersion: inputs.projectionVersion,
    declarationFingerprint: inputs.declarationFingerprint,
    effectiveBundleDigest: inputs.effectiveBundleDigest,
    provider: inputs.provider,
    model: inputs.model,
    effort: inputs.effort,
    ...(rubric === "testQuality" ? {
      testScopeAnalysisVersion: inputs.testScope?.analysisVersion ?? null,
      testScopeBindingIdentity: inputs.testScope?.bindingIdentity ?? null,
    } : {}),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}
