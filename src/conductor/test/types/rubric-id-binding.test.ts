import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_RUBRIC_REGISTRY,
  type BuildReviewRubricDescriptor,
} from '../../src/engine/build-review-registry.js';
import { BUILD_REVIEW_RUBRIC_IDS, type BuildReviewRubricId } from '../../src/types/config.js';

const descriptor = BUILD_REVIEW_RUBRIC_REGISTRY.testQuality;

const complete: Record<BuildReviewRubricId, BuildReviewRubricDescriptor> = {
  testQuality: descriptor,
  security: descriptor,
  implementationQuality: descriptor,
};

// @ts-expect-error BuildReviewRubricId records must include every built-in rubric.
const missing: Record<BuildReviewRubricId, BuildReviewRubricDescriptor> = {
  testQuality: descriptor,
  security: descriptor,
};

const extra: Record<BuildReviewRubricId, BuildReviewRubricDescriptor> = {
  ...complete,
  // @ts-expect-error BuildReviewRubricId records reject unknown rubric keys.
  unknownRubric: descriptor,
};

describe('type binding: build-review rubric ids', () => {
  it('keeps the configured rubric identifiers aligned with the live registry', () => {
    expect(Object.keys(BUILD_REVIEW_RUBRIC_REGISTRY).sort()).toEqual([...BUILD_REVIEW_RUBRIC_IDS].sort());
    expect(complete).toBeDefined();
    expect(missing).toBeDefined();
    expect(extra).toBeDefined();
  });
});
