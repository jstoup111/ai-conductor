// Covers: task:3
import { describe, expect, it } from 'vitest';

import type { PlanReviewArtifact } from '../../src/engine/plan-review-artifact.js';
import {
  computeReviewedDigest,
  diffReviewedDigests,
  parsePlanReviewArtifact,
  renderPlanReviewArtifact,
} from '../../src/engine/plan-review-artifact.js';

const inputs = {
  planText: [
    '# Plan',
    '',
    '### Task 1: Render',
    'First task.',
    '',
    '**Dependencies:** none',
    '',
    '### Task 2: Parse',
    'Second task cites `adr-example`.',
    '',
    '**Dependencies:** Task 1',
  ].join('\n'),
  storiesText: [
    '# Stories',
    '',
    '## Story 1: Rendering',
    'The artifact is rendered.',
    '',
    '## Story 2: Parsing',
    'The artifact is parsed.',
  ].join('\n'),
  adrTexts: {
    'adr-example': '## Decision\n\nD1. Keep this decision in scope.\n\nD2. Keep this one too.',
    'adr-change-only': '## Decision\n\nD1. This ADR enters scope from the change set.',
    'adr-outside': '## Decision\n\nD1. This ADR is not in scope.',
  },
  artifactTexts: {
    '.docs/plans/example.md': 'plan artifact',
    '.docs/stories/example.md': 'story artifact',
  },
  changedPaths: ['.docs/decisions/adr-change-only.md'],
} as const;

function reviewArtifact(): PlanReviewArtifact {
  return {
    round: 1,
    authoringHost: 'claude',
    reviewerProvider: 'codex',
    independence: 'cross-provider',
    findings: [{
      id: 'reachability-1',
      severity: 'blocking',
      lens: 'reachability',
      artifact: '.docs/plans/example.md',
      reference: 'task 1',
      relatedReference: null,
      resolvesPrior: null,
      summary: 'The export has no production caller.',
      evidence: ['.docs/plans/example.md:3'],
    }],
    dispositions: [{ findingId: 'reachability-1', kind: 'accepted', reason: 'Operator accepted the bounded risk.' }],
    reviewedDigest: computeReviewedDigest(inputs),
  };
}

describe('plan-review artifact', () => {
  it('round-trips the review metadata, findings, dispositions, and reviewed digest', () => {
    const artifact = reviewArtifact();

    expect(parsePlanReviewArtifact(renderPlanReviewArtifact(artifact))).toEqual(artifact);
  });

  it('refuses a hand edit because the integrity digest covers the complete artifact payload', () => {
    const rendered = renderPlanReviewArtifact(reviewArtifact());

    expect(parsePlanReviewArtifact(rendered.replace('cross-provider', 'same-provider'))).toEqual({ kind: 'integrity-mismatch' });
  });

  it('reports non-artifact text as unparseable', () => {
    expect(parsePlanReviewArtifact('# ordinary markdown\n')).toEqual({ kind: 'unparseable' });
  });

  it('digests each reviewed component independently and ignores ADRs outside the change set and plan citations', () => {
    const baseline = computeReviewedDigest(inputs);
    const changed = computeReviewedDigest({
      ...inputs,
      planText: inputs.planText.replace('Second task cites', 'Changed task cites'),
      storiesText: inputs.storiesText.replace('artifact is parsed', 'parser reports errors'),
      adrTexts: {
        ...inputs.adrTexts,
        'adr-example': inputs.adrTexts['adr-example'].replace('Keep this one too', 'Changed decision'),
        'adr-outside': inputs.adrTexts['adr-outside'].replace('not in scope', 'still out of scope'),
      },
      artifactTexts: { ...inputs.artifactTexts, '.docs/stories/example.md': 'changed story artifact' },
    });

    expect(baseline.planTaskDigests['1']).toBe(changed.planTaskDigests['1']);
    expect(baseline.planTaskDigests['2']).not.toBe(changed.planTaskDigests['2']);
    expect(baseline.storyDigests['1']).toBe(changed.storyDigests['1']);
    expect(baseline.storyDigests['2']).not.toBe(changed.storyDigests['2']);
    expect(baseline.adrDecisionDigests['adr-example#D1']).toBe(changed.adrDecisionDigests['adr-example#D1']);
    expect(baseline.adrDecisionDigests['adr-example#D2']).not.toBe(changed.adrDecisionDigests['adr-example#D2']);
    expect(baseline.adrDecisionDigests).toHaveProperty('adr-change-only#D1');
    expect(changed.adrDecisionDigests).not.toHaveProperty('adr-outside#D1');
    expect(baseline.artifactDigests['.docs/plans/example.md']).toBe(changed.artifactDigests['.docs/plans/example.md']);
    expect(baseline.artifactDigests['.docs/stories/example.md']).not.toBe(changed.artifactDigests['.docs/stories/example.md']);
    expect(baseline.digest).not.toBe(changed.digest);
    expect(diffReviewedDigests(baseline, changed)).toEqual({
      planTaskIds: ['2'],
      storyIds: ['2'],
      adrDecisionIds: ['adr-example#D2'],
      artifactPaths: ['.docs/stories/example.md'],
    });
  });
});
