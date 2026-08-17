import { describe, expect, it } from 'vitest';

import * as buildReviewDomain from '../../src/engine/build-review-domain.js';
import {
  canonicalizeBuildReviewFindingIdentity,
  canonicalizeBuildReviewFindingSet,
  type BuildReviewFindingIdentityInput,
} from '../../src/engine/build-review-finding-identity.js';

type FindingVocabulary = Readonly<Record<string, readonly string[]>>;
type FindingVocabularies = Readonly<Record<string, FindingVocabulary>>;

function normalizedVocabularyMembers(vocabularies: FindingVocabularies | undefined): readonly string[] {
  if (!vocabularies) throw new Error('build-review finding vocabularies are not exported');
  return Object.values(vocabularies).flatMap((rubric) => Object.values(rubric).flat());
}

describe('build-review finding identity', () => {
  const fixtures: readonly BuildReviewFindingIdentityInput[] = [
    {
      rubric: 'tautology', contractVersion: 'v1', concernKind: 'stayed-green',
      anchor: { rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'save', violationKind: 'stayed-green' },
    },
    {
      rubric: 'scope', contractVersion: 'v1', concernKind: 'unplanned-surface',
      anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
    },
    {
      rubric: 'rootCause', contractVersion: 'v1', concernKind: 'symptom-only',
      anchor: { rubric: 'rootCause', statedDefect: 'does not save', locus: 'handler', relation: 'symptom-only' },
    },
    {
      rubric: 'completeness', contractVersion: 'v1', concernKind: 'missing-outcome',
      anchor: { rubric: 'completeness', planTask: '11', missingSurface: 'src/state.ts', missingOutcome: 'writes state' },
    },
  ];

  it('canonicalizes every rubric-specific typed anchor into a version-bound identity', () => {
    const identities = fixtures.map(canonicalizeBuildReviewFindingIdentity);

    expect(identities).toEqual([
      expect.objectContaining({
        canonicalPayload: {
          rubric: 'tautology', contractVersion: 'v1', concernKind: 'stayed-green',
          anchor: { rubric: 'tautology', changedTest: 'test/a.test.ts', violationKind: 'stayed-green' },
        },
        id: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
      expect.objectContaining({ canonicalPayload: fixtures[1], id: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }),
      expect.objectContaining({
        canonicalPayload: {
          rubric: 'rootCause', contractVersion: 'v1', concernKind: 'symptom-only',
          anchor: { rubric: 'rootCause', locus: 'handler', relation: 'symptom-only' },
        },
        id: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        canonicalPayload: {
          rubric: 'completeness', contractVersion: 'v1', concernKind: 'missing-outcome',
          anchor: { rubric: 'completeness', planTask: '11', missingSurface: 'src/state.ts' },
        },
        id: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    ]);
  });

  it('sorts the complete identity payload before hashing it', () => {
    const identity = canonicalizeBuildReviewFindingIdentity({
      rubric: 'scope', contractVersion: 'v1', concernKind: 'unplanned-surface',
      anchor: { relation: 'outside-plan', rubric: 'scope', path: 'src/a.ts' },
    });

    expect(identity).toMatchObject({
      canonicalJson: '{"anchor":{"path":"src/a.ts","relation":"outside-plan","rubric":"scope"},"concernKind":"unplanned-surface","contractVersion":"v1","rubric":"scope"}',
      canonicalPayload: {
        rubric: 'scope', contractVersion: 'v1', concernKind: 'unplanned-surface',
        anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
      },
    });
  });

  it('preserves identity when prose and evidence locations drift', () => {
    const stableFinding = {
      rubric: 'scope', contractVersion: 'v1', concernKind: 'unplanned-surface',
      anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
    };
    const first = canonicalizeBuildReviewFindingIdentity({
      ...stableFinding, summary: 'The patch changes a file outside the plan.', evidenceLocations: ['src/a.ts:8'],
    });
    const later = canonicalizeBuildReviewFindingIdentity({
      ...stableFinding, summary: 'Unplanned implementation surface.', evidenceLocations: ['src/a.ts:42'],
    });

    expect(later).toEqual(first);
  });

  it('canonicalizes the 2026-08-15 scope re-wording to the accepted finding identity', () => {
    const accepted = canonicalizeBuildReviewFindingIdentity({
      rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-test-change',
      anchor: { rubric: 'scope', path: 'src/conductor/test/engine/step-runners.test.ts', relation: 'not-authorized-by-plan' },
    });
    const reworded = canonicalizeBuildReviewFindingIdentity({
      rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change',
      anchor: { rubric: 'scope', path: 'src/conductor/test/engine/step-runners.test.ts', relation: 'not-authorized-by-plan' },
    });

    expect(reworded).toEqual(accepted);
  });

  it('keeps every closed finding vocabulary unambiguous after normalization', () => {
    const vocabularies = (buildReviewDomain as typeof buildReviewDomain & {
      readonly BUILD_REVIEW_FINDING_VOCABULARIES?: FindingVocabularies;
    }).BUILD_REVIEW_FINDING_VOCABULARIES;
    const normalized = normalizedVocabularyMembers(vocabularies).map((member) => member.toLowerCase().replaceAll('_', '-'));

    expect(new Set(normalized).size).toBe(normalized.length);
  });

  it('excludes report prose subjects from the canonical identity', () => {
    const stableFields = {
      rubric: 'tautology' as const, contractVersion: 'v1' as const, concernKind: 'test-does-not-exercise-changed-behavior',
      anchor: { rubric: 'tautology' as const, changedTest: 'src/conductor/test/engine/build-review-finding-identity.test.ts', exercisedBehavior: 'first prose description', violationKind: 'test-does-not-exercise-changed-behavior' },
    };
    const first = canonicalizeBuildReviewFindingIdentity({
      ...stableFields, summary: 'The assertion still passes after the production change.', evidenceLocations: ['src/conductor/test/engine/build-review-finding-identity.test.ts:1'],
    });
    const reworded = canonicalizeBuildReviewFindingIdentity({
      ...stableFields,
      anchor: { ...stableFields.anchor, exercisedBehavior: 'reworded prose description' },
      summary: 'The changed behavior is not exercised.', evidenceLocations: ['src/conductor/test/engine/build-review-finding-identity.test.ts:999'],
    });

    expect(reworded).toEqual(first);
  });

  it('changes identity for a materially different concern or logical anchor', () => {
    const base = {
      rubric: 'scope', contractVersion: 'v1', concernKind: 'unplanned-surface',
      anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
    };
    const changedConcern = canonicalizeBuildReviewFindingIdentity({ ...base, concernKind: 'missing-approval' });
    const changedAnchor = canonicalizeBuildReviewFindingIdentity({ ...base, anchor: { ...base.anchor, path: 'src/b.ts' } });

    expect([changedConcern?.id, changedAnchor?.id]).not.toContain(canonicalizeBuildReviewFindingIdentity(base)?.id);
  });

  it('retains separate blocking identities when a rubric classification changes at one subject', () => {
    const findingSets = [
      [
        { rubric: 'tautology', contractVersion: 'v1', concernKind: 'assertion-insensitive-to-production', anchor: { rubric: 'tautology', changedTest: 'src/a.test.ts', exercisedBehavior: 'save', violationKind: 'assertion-insensitive-to-production' } },
        { rubric: 'tautology', contractVersion: 'v1', concernKind: 'source-text-mirror', anchor: { rubric: 'tautology', changedTest: 'src/a.test.ts', exercisedBehavior: 'save', violationKind: 'source-text-mirror' } },
      ],
      [
        { rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change', anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'out-of-plan-change' } },
        { rubric: 'scope', contractVersion: 'v1', concernKind: 'not-authorized-by-plan', anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' } },
      ],
      [
        { rubric: 'rootCause', contractVersion: 'v1', concernKind: 'root-cause-unaddressed', anchor: { rubric: 'rootCause', statedDefect: 'save fails', locus: 'handler', relation: 'root-cause-unaddressed' } },
        { rubric: 'rootCause', contractVersion: 'v1', concernKind: 'symptom-only-fix', anchor: { rubric: 'rootCause', statedDefect: 'save fails', locus: 'handler', relation: 'symptom-only-fix' } },
      ],
    ];

    expect(findingSets.map(canonicalizeBuildReviewFindingSet).map((findings) => findings?.length)).toEqual([2, 2, 2]);
  });

  it('keeps distinct missing surfaces under one completeness plan task blocking', () => {
    const findings = canonicalizeBuildReviewFindingSet([
      {
        rubric: 'completeness', contractVersion: 'v1', concernKind: 'missing-deliverable',
        anchor: { rubric: 'completeness', planTask: '10', missingSurface: 'src/first.ts', missingOutcome: 'first outcome' },
      },
      {
        rubric: 'completeness', contractVersion: 'v1', concernKind: 'missing-deliverable',
        anchor: { rubric: 'completeness', planTask: '10', missingSurface: 'src/second.ts', missingOutcome: 'second outcome' },
      },
    ]);

    expect(findings?.map((finding) => finding.id)).toHaveLength(2);
  });

  it('gives a reclassified concern a new identity', () => {
    const sharedSubject = {
      rubric: 'scope', contractVersion: 'v1',
      anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'out-of-plan-change' },
    };
    const first = canonicalizeBuildReviewFindingIdentity({ ...sharedSubject, concernKind: 'out-of-plan-change' });
    const reclassified = canonicalizeBuildReviewFindingIdentity({ ...sharedSubject, concernKind: 'not-authorized-by-plan' });

    expect(reclassified?.id).not.toBe(first?.id);
  });

  it('fails closed instead of omitting invalid, duplicate, or colliding finding records', () => {
    const first = {
      rubric: 'scope', contractVersion: 'v1', concernKind: 'unplanned-surface',
      anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
    };
    const second = { ...first, anchor: { ...first.anchor, path: 'src/b.ts' } };
    const firstId = canonicalizeBuildReviewFindingIdentity(first)?.id;

    expect(canonicalizeBuildReviewFindingSet([
      first,
      { rubric: 'scope', contractVersion: 'v1', concernKind: 'unplanned-surface', anchor: { rubric: 'scope', relation: 'outside-plan' } },
    ])).toBeUndefined();
    expect(canonicalizeBuildReviewFindingSet([{ ...first, contractVersion: 'v2' }])).toBeUndefined();
    expect(canonicalizeBuildReviewFindingSet([first, first])).toBeUndefined();
    expect(canonicalizeBuildReviewFindingSet([{ ...first, id: firstId }, { ...second, id: firstId }])).toBeUndefined();
  });

  it('retains every independently valid finding rather than truncating a grader result', () => {
    const findings = canonicalizeBuildReviewFindingSet([
      {
        rubric: 'scope', contractVersion: 'v1', concernKind: 'unplanned-surface',
        anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
      },
      {
        rubric: 'scope', contractVersion: 'v1', concernKind: 'missing-approval',
        anchor: { rubric: 'scope', path: 'src/b.ts', relation: 'outside-plan' },
      },
    ]);

    expect(findings).toHaveLength(2);
  });
});
