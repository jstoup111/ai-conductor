// Covers: task:1
// Covers: task:10
import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_RUBRIC_IDS,
  BUILD_REVIEW_RUBRIC_REGISTRY,
  fingerprintBuildReviewRubricPolicy,
  getBuildReviewRubricDescriptor,
  isRegisteredRubric,
} from '../../src/engine/build-review-registry.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { validateConfig } from '../../src/engine/config.js';
import type { ResolvedBuildReviewRubricPolicy } from '../../src/engine/resolved-config.js';
import type { HarnessConfig } from '../../src/types/config.js';

describe('engine/build-review-registry', () => {
  it('registers the test-quality and security rubrics with their versioned execution descriptors', () => {
    expect(BUILD_REVIEW_RUBRIC_IDS).toEqual(['testQuality', 'security']);
    expect(BUILD_REVIEW_RUBRIC_REGISTRY).toMatchObject({
      testQuality: {
        skillName: 'build-review-test-quality',
        contractVersion: 'v3',
        projectionVersion: 'v3',
        cachePolicy: 'content-addressed',
        prerequisite: 'none',
      },
      security: {
        skillName: 'build-review-security',
        contractVersion: 'v3',
        projectionVersion: 'v3',
        cachePolicy: 'content-addressed',
        prerequisite: 'none',
      },
    });
    expect(Object.isFrozen(BUILD_REVIEW_RUBRIC_REGISTRY)).toBe(true);
    expect(Object.values(BUILD_REVIEW_RUBRIC_REGISTRY).every(Object.isFrozen)).toBe(true);
  });

  it('recognizes only built-in rubrics; custom policy ids stay out of the registry', () => {
    const config = resolveBuildReviewConfig({
      build_review: {
        custom_rubrics: {
          kotlinPolicy: {
            skill: 'kotlin-review',
            question: 'Does this change preserve Kotlin API compatibility?',
            enabled: true,
          },
        },
      },
    } as HarnessConfig);

    expect(isRegisteredRubric('testQuality')).toBe(true);
    expect(isRegisteredRubric('security')).toBe(true);
    expect(isRegisteredRubric('kotlinPolicy')).toBe(false);
    expect(config.catalog).toContainEqual(expect.objectContaining({
      id: 'kotlinPolicy',
      kind: 'custom',
    }));
    expect(getBuildReviewRubricDescriptor('testQuality')).toBe(
      BUILD_REVIEW_RUBRIC_REGISTRY.testQuality,
    );
    expect(getBuildReviewRubricDescriptor('security')).toBe(
      BUILD_REVIEW_RUBRIC_REGISTRY.security,
    );
  });

  it.each(BUILD_REVIEW_RUBRIC_IDS)(
    'reserves shipped built-in %s from custom rubric declarations',
    (id) => {
      expect(validateConfig({ build_review: { custom_rubrics: {
        [id]: { skill: 'project-review', question: 'Review the change.' },
      } } })).toMatchObject({
        ok: false,
        error: { message: expect.stringMatching(/reserved built-in rubric/i) },
      });
    },
  );

  it('fingerprints resolved execution policy canonically while preserving ordered fallback semantics', () => {
    const policy: ResolvedBuildReviewRubricPolicy = {
      enabled: true,
      max_projection_bytes: 1_048_576,
      llm_provider: ['codex', 'claude'],
      model: 'gpt-5.6-sol',
      effort: 'high',
      model_fallback_ladder: ['gpt-5.6-sol', 'gpt-5.6-terra'],
      max_retries: 3,
      escalate: true,
      min_confidence: 0,
    };
    const reorderedObject: ResolvedBuildReviewRubricPolicy = {
      escalate: true,
      max_retries: 3,
      model_fallback_ladder: ['gpt-5.6-sol', 'gpt-5.6-terra'],
      effort: 'high',
      model: 'gpt-5.6-sol',
      llm_provider: ['codex', 'claude'],
      enabled: false,
      max_projection_bytes: 1_048_576,
      min_confidence: 0,
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
