import { describe, expect, it } from 'vitest';

import { parseBuildReviewJudgedResult } from '../../src/engine/build-review-domain.js';
import type { BuildReviewInputs } from '../../src/engine/build-review-inputs.js';
import { buildGraderPrompt } from '../../src/engine/build-review-prompt.js';

const inputs: BuildReviewInputs = {
  diff: 'diff --git a/test/widget.test.ts b/test/widget.test.ts\n+test change\n',
  planBody: '## Plan\n\nTest behavior.',
  mergeBase: 'deadbeef',
  baseRef: 'main',
  baseKind: 'local',
  trackingRefSha: null,
  remoteHeadSha: null,
  fresh: false,
};

describe('buildGraderPrompt', () => {
  it('renders the sole test-quality reviewer result contract', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toContain("failedRubrics: ('testQuality')[]");
    expect(prompt).toContain('test-insensitive');
    expect(prompt).toContain('anchor": { "rubric": "testQuality"');
  });

  it('preserves the reviewed diff and plan without maker-session state', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toContain(inputs.diff);
    expect(prompt).toContain(inputs.planBody);
    expect(prompt).not.toMatch(/task-status|maker summary|transcript/i);
  });

  it('accepts only the current test-quality finding vocabulary', () => {
    const locus = {
      path: 'test/widget.test.ts',
      contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      display: 'persists the updated widget',
    };
    const result = {
      kind: 'judged', rubric: 'testQuality', contractVersion: 'v3',
      lapId: 'lap-test-quality', snapshotDigest: 'sha256:snapshot',
      findings: [{
        concernKind: 'test-insensitive', summary: 'The assertion is stub-passable.',
        evidenceLocations: ['test/widget.test.ts:12'],
        anchor: { rubric: 'testQuality', locus },
      }],
    };

    expect(parseBuildReviewJudgedResult(result)).toMatchObject({ rubric: 'testQuality' });
    expect(parseBuildReviewJudgedResult({
      ...result,
      findings: [{ ...result.findings[0], concernKind: 'symptom-only-fix' }],
    })).toBeUndefined();
  });
});
