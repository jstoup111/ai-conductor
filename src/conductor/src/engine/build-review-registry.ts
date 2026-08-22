import { createHash } from 'node:crypto';

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

export const BUILD_REVIEW_RUBRIC_IDS = ['testQuality'] as const;

type RegisteredBuildReviewRubricId = (typeof BUILD_REVIEW_RUBRIC_IDS)[number];

/**
 * The closed, auxiliary rubric catalog for the public build_review gate.
 *
 * Rubrics are explicitly not lifecycle steps: their identifiers remain
 * registry identifiers throughout this auxiliary catalog.
 */
export const BUILD_REVIEW_RUBRIC_REGISTRY: Readonly<
  Record<RegisteredBuildReviewRubricId, BuildReviewRubricDescriptor>
> = Object.freeze({
  testQuality: Object.freeze({
    skillName: 'build-review-test-quality',
    contractVersion: CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION,
    projectionVersion: 'v2',
    cachePolicy: 'content-addressed',
    prerequisite: 'none',
  }),
});

export function isRegisteredRubric(rubric: string): rubric is RegisteredBuildReviewRubricId {
  return Object.hasOwn(BUILD_REVIEW_RUBRIC_REGISTRY, rubric);
}

export function getBuildReviewRubricDescriptor(
  rubric: RegisteredBuildReviewRubricId,
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
