// Covers: task:2
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const sentinel = vi.hoisted(() => 'SEVERITY_DEFINITIONS_FROM_ENGINE');

vi.mock('../../src/engine/build-review-contract.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-contract.js')>(),
  renderBuildReviewSeverityDefinitions: () => sentinel,
}));

import {
  BUILD_REVIEW_RUBRIC_IDS,
  getBuildReviewRubricDescriptor,
} from '../../src/engine/build-review-registry.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

const meanings = [
  'security exposure, data loss, or wrong results',
  'a real defect or broken invariant',
  'a real, low-impact quality issue',
  'cosmetic, such as naming or style',
];
const policy = {
  enabled: true, llm_provider: 'claude' as const, model: 'opus', effort: 'high' as const,
  model_fallback_ladder: ['opus'], max_retries: 1, escalate: false,
  max_projection_bytes: 1_000_000, min_confidence: 0,
};

function projection(rubric: typeof BUILD_REVIEW_RUBRIC_IDS[number]) {
  return {
    rubric, contractVersion: 'v4', projectionVersion: 'v4',
    lapId: 'lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8', snapshotDigest: 'sha256:projection',
    contentDigest: 'sha256:content', digest: 'sha256:projection', mergeBase: 'base-sha', headSha: 'head-sha',
    changedFiles: [], reviewScope: { mode: 'full', deltaHunks: [] },
    ...(rubric === 'testQuality' ? {
      changedTestSelectors: [], runnerSelectors: [], unresolvedMarkers: [], changedTestTitles: [],
      testScope: { evidence: [], candidates: [] }, testSuiteProof: {}, revertedProductionManifest: [],
      preflight: { classification: 'not-requested', excerpt: '' },
    } : {}),
  };
}

async function captureRubricPrompt(rubric: typeof BUILD_REVIEW_RUBRIC_IDS[number]): Promise<string> {
  const invoke = vi.fn().mockResolvedValue({ success: false, exitCode: 0 });
  const runner = new DefaultStepRunner({ invoke }, `severity-source-${rubric}`, '/tmp/project');
  const branch = { rubric, skillName: getBuildReviewRubricDescriptor(rubric).skillName, policy };
  await (runner as unknown as {
    dispatchBuildReviewRubric: (value: typeof branch, input: ReturnType<typeof projection>) => Promise<unknown>;
  }).dispatchBuildReviewRubric(branch, projection(rubric));
  return (invoke.mock.calls[0]![0] as InvokeOptions).prompt;
}

describe('build_review built-in severity prompt source', () => {
  it.each(BUILD_REVIEW_RUBRIC_IDS)('%s renders severity definitions from the engine rather than its SKILL.md', async (rubric) => {
    const skillPaths = BUILD_REVIEW_RUBRIC_IDS.map((id) => fileURLToPath(new URL(
      `../../../../skills/${getBuildReviewRubricDescriptor(id).skillName}/SKILL.md`, import.meta.url,
    )));
    const before = await Promise.all(skillPaths.map((path) => readFile(path)));
    const prompt = await captureRubricPrompt(rubric);
    const after = await Promise.all(skillPaths.map((path) => readFile(path)));

    expect(prompt.split(sentinel)).toHaveLength(2);
    for (const meaning of meanings) expect(prompt).not.toContain(meaning);
    expect(after).toEqual(before);
  });
});
