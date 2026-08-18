import { createHash } from 'node:crypto';

import type { BuildReviewRubricId } from '../types/config.js';
import {
  CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION,
} from './build-review-domain.js';
import type { ResolvedBuildReviewRubricPolicy } from './resolved-config.js';

export type BuildReviewRubricCachePolicy = 'content-addressed';
export type BuildReviewRubricPrerequisite = 'none';

export interface BuildReviewRubricDescriptor {
  readonly skillName: string;
  readonly contractVersion: typeof CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION;
  readonly projectionVersion: 'v2';
  readonly cachePolicy: BuildReviewRubricCachePolicy;
  readonly prerequisite: BuildReviewRubricPrerequisite;
}

/**
 * The closed, auxiliary rubric catalog for the public build_review gate.
 *
 * Rubrics are explicitly not lifecycle steps: their identifiers remain
 * `BuildReviewRubricId`s throughout this auxiliary catalog.
 */
export const BUILD_REVIEW_RUBRIC_REGISTRY: Readonly<
  Record<BuildReviewRubricId, BuildReviewRubricDescriptor>
> = Object.freeze({
  tautology: Object.freeze({
    skillName: 'build-review-tautology',
    contractVersion: CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION,
    projectionVersion: 'v2',
    cachePolicy: 'content-addressed',
    prerequisite: 'none',
  }),
  scope: Object.freeze({
    skillName: 'build-review-scope',
    contractVersion: CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION,
    projectionVersion: 'v2',
    cachePolicy: 'content-addressed',
    prerequisite: 'none',
  }),
  rootCause: Object.freeze({
    skillName: 'build-review-root-cause',
    contractVersion: CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION,
    projectionVersion: 'v2',
    cachePolicy: 'content-addressed',
    prerequisite: 'none',
  }),
  completeness: Object.freeze({
    skillName: 'build-review-completeness',
    contractVersion: CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION,
    projectionVersion: 'v2',
    cachePolicy: 'content-addressed',
    prerequisite: 'none',
  }),
});

export function getBuildReviewRubricDescriptor(
  rubric: BuildReviewRubricId,
): BuildReviewRubricDescriptor {
  return BUILD_REVIEW_RUBRIC_REGISTRY[rubric];
}

/**
 * Content-addressed policy identity for a judged rubric result.
 *
 * `enabled` is deliberately excluded: disabled rubrics short-circuit to a
 * deterministic skip before cache lookup, so it cannot alter a judged result.
 * Ordered provider and model fallback arrays retain their order because that
 * order changes execution semantics.
 */
export function fingerprintBuildReviewRubricPolicy(
  policy: ResolvedBuildReviewRubricPolicy,
): string {
  const canonical = JSON.stringify({
    llm_provider: policy.llm_provider,
    model: policy.model,
    effort: policy.effort,
    model_fallback_ladder: policy.model_fallback_ladder,
    max_retries: policy.max_retries,
    escalate: policy.escalate,
  });

  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}
