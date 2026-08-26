import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_RUBRIC_IDS,
  BUILD_REVIEW_RUBRIC_REGISTRY,
  fingerprintBuildReviewRubricPolicy,
  getBuildReviewRubricDescriptor,
  isRegisteredRubric,
} from '../../src/engine/build-review-registry.js';
import type { ResolvedBuildReviewRubricPolicy } from '../../src/engine/resolved-config.js';

describe('engine/build-review-registry', () => {
  it('registers only the test-quality rubric with its versioned execution descriptor', () => {
    expect(BUILD_REVIEW_RUBRIC_IDS).toEqual(['testQuality']);
    expect(BUILD_REVIEW_RUBRIC_REGISTRY).toEqual({
      testQuality: {
        skillName: 'build-review-test-quality',
        contractVersion: 'v3',
        projectionVersion: 'v2',
        cachePolicy: 'content-addressed',
        prerequisite: 'none',
      },
    });
    expect(Object.isFrozen(BUILD_REVIEW_RUBRIC_REGISTRY)).toBe(true);
    expect(Object.values(BUILD_REVIEW_RUBRIC_REGISTRY).every(Object.isFrozen)).toBe(true);
  });

  it('recognizes only registered rubrics', () => {
    expect(isRegisteredRubric('testQuality')).toBe(true);
    expect(isRegisteredRubric('completeness')).toBe(false);
    expect(getBuildReviewRubricDescriptor('testQuality')).toBe(
      BUILD_REVIEW_RUBRIC_REGISTRY.testQuality,
    );
  });

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
