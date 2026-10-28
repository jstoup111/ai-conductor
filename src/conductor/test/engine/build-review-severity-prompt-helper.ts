import { vi } from 'vitest';

import {
  BUILD_REVIEW_RUBRIC_IDS,
  getBuildReviewRubricDescriptor,
} from '../../src/engine/build-review-registry.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

export const policy = {
  enabled: true,
  llm_provider: 'claude' as const,
  model: 'opus',
  effort: 'high' as const,
  model_fallback_ladder: ['opus'],
  max_retries: 1,
  escalate: false,
  max_projection_bytes: 1_000_000,
  min_confidence: 0,
};

function projection(rubric: typeof BUILD_REVIEW_RUBRIC_IDS[number]) {
  return {
    rubric,
    contractVersion: 'v4',
    projectionVersion: 'v4',
    lapId: 'lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8',
    snapshotDigest: 'sha256:projection',
    contentDigest: 'sha256:content',
    digest: 'sha256:projection',
    mergeBase: 'base-sha',
    headSha: 'head-sha',
    changedFiles: [],
    reviewScope: { mode: 'full', deltaHunks: [] },
    ...(rubric === 'testQuality'
      ? {
          changedTestSelectors: [], runnerSelectors: [], unresolvedMarkers: [], changedTestTitles: [],
          testScope: { evidence: [], candidates: [] }, testSuiteProof: {}, revertedProductionManifest: [],
          preflight: { classification: 'not-requested', excerpt: '' },
        }
      : {}),
  };
}

export async function captureRubricPrompt(
  rubric: typeof BUILD_REVIEW_RUBRIC_IDS[number],
  stepId = `severity-${rubric}`,
): Promise<string> {
  const invoke = vi.fn().mockResolvedValue({ success: false, exitCode: 0 });
  const runner = new DefaultStepRunner({ invoke }, stepId, '/tmp/project');
  const branch = { rubric, skillName: getBuildReviewRubricDescriptor(rubric).skillName, policy };

  await (runner as unknown as {
    dispatchBuildReviewRubric: (value: typeof branch, input: ReturnType<typeof projection>) => Promise<unknown>;
  }).dispatchBuildReviewRubric(branch, projection(rubric));

  return (invoke.mock.calls[0]![0] as InvokeOptions).prompt;
}
