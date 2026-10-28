// Covers: task:2, task:3
import { describe, expect, it, vi } from 'vitest';

import { renderBuildReviewSeverityDefinitions } from '../../src/engine/build-review-contract.js';
import { renderBuildReviewPolicyContract } from '../../src/engine/build-review-policy-contract.js';
import { BUILD_REVIEW_CUSTOM_V1_CONTRACT } from '../../src/engine/build-review-policy-resolver.js';
import {
  BUILD_REVIEW_RUBRIC_IDS,
  getBuildReviewRubricDescriptor,
} from '../../src/engine/build-review-registry.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { CapturedReviewPolicyBundle } from '../../src/engine/build-review-policy-bundle.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

const policy = {
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

const customPolicyBundle: CapturedReviewPolicyBundle = {
  policy: {
    semanticName: 'boundary-review',
    source: 'plugin',
    plugin: { id: 'quality-policy', version: '1.2.3' },
    installationOrigin: '/installed/quality-policy',
    canonicalSkillPath: '/installed/quality-policy/skills/boundary-review/SKILL.md',
    packageRoot: '/installed/quality-policy',
    declaredDependencies: [],
    availability: 'available',
  },
  materialPath: '/runtime/policies/policy-bundle-123',
  definitionPath: '/runtime/policies/policy-bundle-123/skills/boundary-review/SKILL.md',
  manifest: [{
    relativePath: 'skills/boundary-review/SKILL.md',
    bytes: Buffer.from('# Boundary review\n'),
  }],
  metadata: {
    version: 1,
    semanticName: 'boundary-review',
    source: 'plugin',
    plugin: { id: 'quality-policy', version: '1.2.3' },
    declaredDependencies: [],
  },
  digest: `sha256-v1:${'a'.repeat(64)}`,
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

async function captureRubricPrompt(rubric: typeof BUILD_REVIEW_RUBRIC_IDS[number]): Promise<string> {
  const invoke = vi.fn().mockResolvedValue({ success: false, exitCode: 0 });
  const runner = new DefaultStepRunner({ invoke }, `severity-${rubric}`, '/tmp/project');
  const branch = { rubric, skillName: getBuildReviewRubricDescriptor(rubric).skillName, policy };

  await (runner as unknown as {
    dispatchBuildReviewRubric: (value: typeof branch, input: ReturnType<typeof projection>) => Promise<unknown>;
  }).dispatchBuildReviewRubric(branch, projection(rubric));

  return (invoke.mock.calls[0]![0] as InvokeOptions).prompt;
}

describe('build_review built-in severity prompt', () => {
  it.each(BUILD_REVIEW_RUBRIC_IDS)('%s renders the shared severity definitions immediately after its result schema', async (rubric) => {
    const severityDefinitions = renderBuildReviewSeverityDefinitions();
    const prompt = await captureRubricPrompt(rubric);
    const paragraphs = prompt.split('\n\n');
    const schemaIndex = paragraphs.findIndex((paragraph) =>
      paragraph.startsWith('Your final message MUST end with one JSON object matching this schema:'),
    );

    expect(prompt.split(severityDefinitions)).toHaveLength(2);
    expect(paragraphs[schemaIndex + 1]).toBe(severityDefinitions);
  });

  it('renders the shared severity definitions immediately after the custom shared findings schema', async () => {
    const severityDefinitions = renderBuildReviewSeverityDefinitions();
    const customPrompt = renderBuildReviewPolicyContract({
      bundle: customPolicyBundle,
      question: 'Are boundary changes safe?',
      scope: 'Review frozen sources.',
      contract: BUILD_REVIEW_CUSTOM_V1_CONTRACT,
    });
    const lines = customPrompt.split('\n');
    const schemaIndex = lines.findIndex((line) => line.startsWith('Shared findings payload schema:'));
    const payloadVariants = lines.find((line) => line.startsWith('Payload variants:'));
    const builtInSeverityParagraphs = await Promise.all(BUILD_REVIEW_RUBRIC_IDS.map(async (rubric) => {
      const prompt = await captureRubricPrompt(rubric);
      return prompt.split('\n\n').find((paragraph) => paragraph === severityDefinitions);
    }));

    expect([
      customPrompt.split(severityDefinitions).length,
      lines[schemaIndex + 1],
      customPrompt.includes('Every finding requires severity: critical ('),
      payloadVariants?.includes('{"kind":"custom-findings","version":"v2","findings":[...]}'),
      payloadVariants?.includes('{"kind":"unsupported-policy","requirement":'),
      payloadVariants?.includes('Include no other fields.'),
      builtInSeverityParagraphs,
    ]).toEqual([
      2,
      severityDefinitions,
      false,
      true,
      true,
      true,
      BUILD_REVIEW_RUBRIC_IDS.map(() => severityDefinitions),
    ]);
  });
});
