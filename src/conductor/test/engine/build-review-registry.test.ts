import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_RUBRIC_REGISTRY,
  fingerprintBuildReviewRubricPolicy,
  getBuildReviewRubricDescriptor,
} from '../../src/engine/build-review-registry.js';
import type { ResolvedBuildReviewRubricPolicy } from '../../src/engine/resolved-config.js';

describe('engine/build-review-registry', () => {
  it('registers each of the four closed rubrics with its versioned execution descriptor', () => {
    expect(BUILD_REVIEW_RUBRIC_REGISTRY).toEqual({
      tautology: {
        skillName: 'build-review-tautology',
        contractVersion: 'v1',
        projectionVersion: 'v2',
        cachePolicy: 'content-addressed',
        prerequisite: 'none',
      },
      scope: {
        skillName: 'build-review-scope',
        contractVersion: 'v1',
        projectionVersion: 'v2',
        cachePolicy: 'content-addressed',
        prerequisite: 'none',
      },
      rootCause: {
        skillName: 'build-review-root-cause',
        contractVersion: 'v1',
        projectionVersion: 'v2',
        cachePolicy: 'content-addressed',
        prerequisite: 'none',
      },
      completeness: {
        skillName: 'build-review-completeness',
        contractVersion: 'v1',
        projectionVersion: 'v2',
        cachePolicy: 'content-addressed',
        prerequisite: 'none',
      },
    });
    expect(Object.isFrozen(BUILD_REVIEW_RUBRIC_REGISTRY)).toBe(true);
    expect(Object.values(BUILD_REVIEW_RUBRIC_REGISTRY).every(Object.isFrozen)).toBe(true);
  });

  it.each(['tautology', 'scope', 'rootCause', 'completeness'] as const)(
    'looks up the %s descriptor exhaustively and independently of registry ordering',
    (rubric) => {
      expect(getBuildReviewRubricDescriptor(rubric)).toBe(BUILD_REVIEW_RUBRIC_REGISTRY[rubric]);
    },
  );

  it('fingerprints resolved execution policy canonically while preserving ordered fallback semantics', () => {
    const policy: ResolvedBuildReviewRubricPolicy = {
      enabled: true,
      llm_provider: ['codex', 'claude'],
      model: 'gpt-5.6-sol',
      effort: 'high',
      model_fallback_ladder: ['gpt-5.6-sol', 'gpt-5.6-terra'],
      max_retries: 3,
      escalate: true,
    };
    const reorderedObject: ResolvedBuildReviewRubricPolicy = {
      escalate: true,
      max_retries: 3,
      model_fallback_ladder: ['gpt-5.6-sol', 'gpt-5.6-terra'],
      effort: 'high',
      model: 'gpt-5.6-sol',
      llm_provider: ['codex', 'claude'],
      enabled: false,
    };

    expect(fingerprintBuildReviewRubricPolicy(policy)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fingerprintBuildReviewRubricPolicy(reorderedObject)).toBe(
      fingerprintBuildReviewRubricPolicy(policy),
    );
    expect(fingerprintBuildReviewRubricPolicy({
      ...policy,
      model_fallback_ladder: ['gpt-5.6-terra', 'gpt-5.6-sol'],
    })).not.toBe(fingerprintBuildReviewRubricPolicy(policy));
  });
});
