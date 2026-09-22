// Covers: task:5
import { describe, expect, it, vi } from 'vitest';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import type { TestQualityProjection } from '../../src/engine/build-review-projections.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const branch = {
  rubric: 'testQuality' as const,
  skillName: 'build-review-test-quality',
  policy: {
    enabled: true,
    llm_provider: 'claude' as const,
    model: 'opus',
    effort: 'high' as const,
    model_fallback_ladder: ['opus'],
    max_retries: 1,
    escalate: false,
  },
};

const projection: TestQualityProjection = {
  rubric: 'testQuality',
  contractVersion: 'v3',
  projectionVersion: 'v3',
  lapId: parseBuildReviewLapId('lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8')!,
  snapshotDigest: 'sha256:projection',
  contentDigest: 'sha256:content',
  digest: 'sha256:projection',
  mergeBase: 'base-sha',
  headSha: 'head-sha',
  changedFiles: [],
  changedTestSelectors: [],
  runnerSelectors: [],
  unresolvedMarkers: [],
  changedTestTitles: [],
  testScope: { evidence: [], candidates: [] },
  testSuiteProof: {},
  revertedProductionManifest: [],
  preflight: { classification: 'not-requested', excerpt: '' },
};

async function captureRubricPrompt(): Promise<string> {
  const invoke = vi.fn().mockResolvedValue({
    success: false,
    exitCode: 0,
  });
  const runner = new DefaultStepRunner({ invoke }, 'build-review-prompt', '/tmp/project');

  await (runner as unknown as {
    dispatchBuildReviewRubric: (value: typeof branch, input: typeof projection) => Promise<unknown>;
  }).dispatchBuildReviewRubric(branch, projection);

  return (invoke.mock.calls[0]![0] as InvokeOptions).prompt;
}

describe('build_review testQuality evidence re-read prompt', () => {
  it('instructs the provider to verify pinned evidence and leave unreadable evidence indeterminate', async () => {
    const prompt = await captureRubricPrompt();
    const evidenceInstruction = prompt.split('\n\n').find((paragraph) =>
      paragraph.includes('git show <mergeBase>:<path>')
      && paragraph.includes('git show <headSha>:<path>')
      && paragraph.includes('startLine')
      && paragraph.includes('endLine')
      && paragraph.includes('contentHash')
      && paragraph.includes('hash-mismatched')
      && paragraph.includes('unreadable')
      && paragraph.includes('not judged')
      && paragraph.includes('indeterminate')
      && paragraph.includes('missingEvidenceReason'),
    );

    expect(evidenceInstruction).toBeDefined();
  });

  it('directs the provider to hash the byteRegion bytes and never to treat character offsets as bytes', async () => {
    // Pinned evidence hashes the UTF-16 slice's UTF-8 bytes; a provider that
    // hashes the byte span at the character offsets fails on any non-ASCII
    // file and reports every candidate indeterminate (#2612).
    const prompt = await captureRubricPrompt();

    expect(prompt).toMatch(/sha256 of the raw bytes from `byteRegion\.start`/);
    expect(prompt).toMatch(/must not be used as byte offsets/);
    expect(prompt).not.toMatch(/whitespace-normalized title/);
  });

  it('contains no provider-specific paths, environment variables, or model names', async () => {
    const prompt = await captureRubricPrompt();

    expect(prompt).not.toMatch(/~\/.claude|CLAUDE_|CODEX_|claude-|gpt-|\b(?:opus|sonnet)\b/i);
  });
});
