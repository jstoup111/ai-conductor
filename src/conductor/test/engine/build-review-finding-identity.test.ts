import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { BUILD_REVIEW_FINDING_VOCABULARIES } from '../../src/engine/build-review-domain.js';
import {
  canonicalizeBuildReviewFindingIdentity,
  canonicalizeBuildReviewFindingSet,
  type BuildReviewFindingIdentityInput,
} from '../../src/engine/build-review-finding-identity.js';

type FindingVocabulary = { readonly members: readonly string[]; readonly concernKinds: readonly string[]; readonly anchorFields: Readonly<Record<string, readonly string[]>> };
type FindingVocabularies = Readonly<Record<string, FindingVocabulary>>;

function normalizedVocabularyMembers(vocabularies: FindingVocabularies): readonly string[] {
  return Object.values(vocabularies).flatMap((rubric) => [rubric.members, rubric.concernKinds, ...Object.values(rubric.anchorFields)].flat());
}

function contentHashForHunk(hunk: string): string {
  const normalized = hunk
    .split('\n')
    .filter((line) => line.startsWith('-') || line.startsWith('+'))
    .map((line) => line.slice(1))
    .join('\n')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

describe('build-review finding identity', () => {
  const fixtures: readonly BuildReviewFindingIdentityInput[] = [
    {
      rubric: 'tautology', contractVersion: 'v1', concernKind: 'source-text-mirror',
      anchor: { rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'save', violationKind: 'source-text-mirror' },
    },
    {
      rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change',
      anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' },
    },
    {
      rubric: 'rootCause', contractVersion: 'v1', concernKind: 'symptom-only-fix',
      anchor: { rubric: 'rootCause', statedDefect: 'does not save', locus: 'src/handler.ts', relation: 'symptom-only-fix' },
    },
    {
      rubric: 'completeness', contractVersion: 'v1', concernKind: 'missing-deliverable',
      anchor: { rubric: 'completeness', planTask: '11', missingSurface: 'src/state.ts', missingOutcome: 'writes state', missingKind: 'missing-deliverable' },
    },
  ];

  it('canonicalizes every rubric-specific typed anchor into a version-bound identity', () => {
    const identities = fixtures.map(canonicalizeBuildReviewFindingIdentity);

    expect(identities).toEqual([
      expect.objectContaining({
        canonicalPayload: {
          rubric: 'tautology', contractVersion: 'v1', concernKind: 'source-text-mirror',
          anchor: { rubric: 'tautology', changedTest: 'test/a.test.ts', violationKind: 'source-text-mirror' },
        },
        id: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
      expect.objectContaining({ canonicalPayload: fixtures[1], id: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }),
      expect.objectContaining({
        canonicalPayload: {
          rubric: 'rootCause', contractVersion: 'v1', concernKind: 'symptom-only-fix',
          anchor: { rubric: 'rootCause', locus: 'src/handler.ts', relation: 'symptom-only-fix' },
        },
        id: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        canonicalPayload: {
          rubric: 'completeness', contractVersion: 'v1', concernKind: 'missing-deliverable',
          anchor: { rubric: 'completeness', planTask: '11', missingSurface: 'src/state.ts' },
        },
        id: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    ]);
  });

  it('sorts the complete identity payload before hashing it', () => {
    const identity = canonicalizeBuildReviewFindingIdentity({
      rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change',
      anchor: { relation: 'not-authorized-by-plan', rubric: 'scope', path: 'src/a.ts' },
    });

    expect(identity).toMatchObject({
      canonicalJson: '{"anchor":{"path":"src/a.ts","relation":"not-authorized-by-plan","rubric":"scope"},"concernKind":"out-of-plan-change","contractVersion":"v1","rubric":"scope"}',
      canonicalPayload: {
        rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change',
        anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' },
      },
    });
  });

  it('preserves identity when prose and evidence locations drift', () => {
    const stableFinding = {
      rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change',
      anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' },
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
    const members = normalizedVocabularyMembers(BUILD_REVIEW_FINDING_VOCABULARIES);
    expect(members.length).toBeGreaterThan(0);
    for (const rubric of Object.values(BUILD_REVIEW_FINDING_VOCABULARIES)) {
      for (const members of [rubric.members, rubric.concernKinds, ...Object.values(rubric.anchorFields)]) {
        const normalized = members.map((member) => member.toLowerCase().replaceAll('_', '-'));
        expect(new Set(normalized).size).toBe(normalized.length);
      }
    }
  });

  it('excludes report prose subjects from every canonical identity', () => {
    const tautology = {
      rubric: 'tautology' as const, contractVersion: 'v1' as const, concernKind: 'test-does-not-exercise-changed-behavior',
      anchor: { rubric: 'tautology' as const, changedTest: 'src/conductor/test/engine/build-review-finding-identity.test.ts', exercisedBehavior: 'first prose description', violationKind: 'test-does-not-exercise-changed-behavior' },
    };
    const rootCause = {
      rubric: 'rootCause' as const, contractVersion: 'v1' as const, concernKind: 'root-cause-unaddressed',
      anchor: { rubric: 'rootCause' as const, statedDefect: 'first prose defect description', locus: 'src/engine/handler.ts', relation: 'root-cause-unaddressed' },
    };
    const completeness = {
      rubric: 'completeness' as const, contractVersion: 'v1' as const, concernKind: 'missing-deliverable',
      anchor: { rubric: 'completeness' as const, planTask: '5', missingSurface: 'src/engine/handler.ts', missingOutcome: 'first prose outcome description', missingKind: 'missing-deliverable' },
    };

    const first = [tautology, rootCause, completeness].map((finding) => canonicalizeBuildReviewFindingIdentity({
      ...finding, summary: 'The initial wording.', evidenceLocations: ['src/conductor/test/engine/build-review-finding-identity.test.ts:1'],
    }));
    const reworded = [
      {
        ...tautology,
        anchor: { ...tautology.anchor, exercisedBehavior: 'reworded prose description' },
      },
      {
        ...rootCause,
        anchor: { ...rootCause.anchor, statedDefect: 'reworded prose defect description' },
      },
      {
        ...completeness,
        anchor: { ...completeness.anchor, missingOutcome: 'reworded prose outcome description' },
      },
    ].map((finding) => canonicalizeBuildReviewFindingIdentity({
      ...finding, summary: 'The reworded summary.', evidenceLocations: ['src/conductor/test/engine/build-review-finding-identity.test.ts:999'],
    }));

    expect(reworded).toEqual(first);
  });

  it('rejects grader rephrasing or formatting of canonical snapshot references before they mint identities', () => {
    const subjects = [
      { rubric: 'tautology', concernKind: 'source-text-mirror', anchor: { rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'x', violationKind: 'source-text-mirror' }, field: 'changedTest' },
      { rubric: 'rootCause', concernKind: 'root-cause-unaddressed', anchor: { rubric: 'rootCause', statedDefect: 'x', locus: 'src/a.ts', relation: 'root-cause-unaddressed' }, field: 'locus' },
      { rubric: 'completeness', concernKind: 'missing-deliverable', anchor: { rubric: 'completeness', planTask: '1', missingSurface: 'src/a.ts', missingOutcome: 'x', missingKind: 'missing-deliverable' }, field: 'planTask' },
      { rubric: 'completeness', concernKind: 'missing-deliverable', anchor: { rubric: 'completeness', planTask: '1', missingSurface: 'src/a.ts', missingOutcome: 'x', missingKind: 'missing-deliverable' }, field: 'missingSurface' },
    ] as const;

    const identities = subjects.flatMap((subject) => {
      const finding = { ...subject, contractVersion: 'v1' } as Record<string, unknown>;
      const reference = String((subject.anchor as Record<string, string>)[subject.field]);
      return [
        canonicalizeBuildReviewFindingIdentity({ ...finding, anchor: { ...subject.anchor, [subject.field]: ` ${reference} ` } }),
        canonicalizeBuildReviewFindingIdentity({ ...finding, anchor: { ...subject.anchor, [subject.field]: `\`${reference}\`` } }),
        canonicalizeBuildReviewFindingIdentity({ ...finding, anchor: { ...subject.anchor, [subject.field]: `The affected reference is ${reference}.` } }),
      ];
    });

    expect(identities).toEqual(Array(12).fill(undefined));
  });

  it.each(['rem-rootcause-1', 'T0', '8.1'])('gives repository-valid plan task ID %s a stable completeness identity', (planTask) => {
    const finding = {
      rubric: 'completeness' as const, contractVersion: 'v1' as const, concernKind: 'missing-deliverable',
      anchor: { rubric: 'completeness' as const, planTask, missingSurface: 'src/a.ts', missingOutcome: 'x', missingKind: 'missing-deliverable' as const },
    };

    expect(canonicalizeBuildReviewFindingIdentity(finding)).toMatchObject({
      id: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      canonicalPayload: { anchor: { planTask } },
    });
  });

  it('keeps distinct canonical snapshot references as distinct identities', () => {
    const subjects = [
      { rubric: 'tautology', concernKind: 'source-text-mirror', anchor: { rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'x', violationKind: 'source-text-mirror' }, field: 'changedTest', alternate: 'test/b.test.ts' },
      { rubric: 'rootCause', concernKind: 'root-cause-unaddressed', anchor: { rubric: 'rootCause', statedDefect: 'x', locus: 'src/a.ts', relation: 'root-cause-unaddressed' }, field: 'locus', alternate: 'src/b.ts' },
      { rubric: 'completeness', concernKind: 'missing-deliverable', anchor: { rubric: 'completeness', planTask: '1', missingSurface: 'src/a.ts', missingOutcome: 'x', missingKind: 'missing-deliverable' }, field: 'planTask', alternate: '2' },
      { rubric: 'completeness', concernKind: 'missing-deliverable', anchor: { rubric: 'completeness', planTask: '1', missingSurface: 'src/a.ts', missingOutcome: 'x', missingKind: 'missing-deliverable' }, field: 'missingSurface', alternate: 'src/b.ts' },
    ] as const;

    const referencesStayDistinct = subjects.map((subject) => {
      const finding = { ...subject, contractVersion: 'v2' } as Record<string, unknown>;
      const first = canonicalizeBuildReviewFindingIdentity(finding);
      const second = canonicalizeBuildReviewFindingIdentity({ ...finding, anchor: { ...subject.anchor, [subject.field]: subject.alternate } });
      return first?.id !== second?.id;
    });

    expect(referencesStayDistinct).toEqual([true, true, true, true]);
  });

  it('anchors root-cause identity to normalized hunk content rather than prose or coordinates', () => {
    const hunk = '- return staleState;\n+ return persistedState;';
    const whitespaceOnlyHunk = '-  return   staleState;\n+\treturn persistedState;  ';
    const distinctHunk = '- return cachedState;\n+ return recomputedState;';
    const changedHunk = '- return staleState;\n+ return fallbackState;';
    const contentHash = contentHashForHunk(hunk);
    const base = {
      rubric: 'rootCause' as const, contractVersion: 'v3' as const, concernKind: 'root-cause-unaddressed',
      anchor: {
        rubric: 'rootCause' as const, statedDefect: 'state is not persisted', relation: 'root-cause-unaddressed',
        locus: {
          path: 'src/handler.ts',
          contentHash,
          display: 'persistence return branch',
        },
      },
    };
    const first = canonicalizeBuildReviewFindingIdentity(base);
    const reworded = canonicalizeBuildReviewFindingIdentity({
      ...base, summary: 'A different explanation of the same defect.', evidenceLocations: ['src/handler.ts:99'],
      anchor: { ...base.anchor, statedDefect: 'The state write is omitted.' },
    } as unknown as BuildReviewFindingIdentityInput);
    const lineShifted = canonicalizeBuildReviewFindingIdentity({
      ...base,
      anchor: { ...base.anchor, locus: { ...base.anchor.locus, display: 'persistence return branch after rebase' } },
    } as unknown as BuildReviewFindingIdentityInput);
    const differentHunk = canonicalizeBuildReviewFindingIdentity({
      ...base,
      anchor: { ...base.anchor, locus: { ...base.anchor.locus, contentHash: contentHashForHunk(distinctHunk), display: 'cache return branch' } },
    } as unknown as BuildReviewFindingIdentityInput);
    const changedContent = canonicalizeBuildReviewFindingIdentity({
      ...base,
      anchor: { ...base.anchor, locus: { ...base.anchor.locus, contentHash: contentHashForHunk(changedHunk) } },
    } as unknown as BuildReviewFindingIdentityInput);

    expect(contentHashForHunk(whitespaceOnlyHunk)).toBe(contentHash);
    expect(first).toMatchObject({
      canonicalPayload: { anchor: { locus: { path: 'src/handler.ts', contentHash: base.anchor.locus.contentHash } } },
    });
    expect(reworded).toEqual(first);
    expect(lineShifted).toEqual(first);
    expect(differentHunk?.id).not.toBe(first?.id);
    expect(changedContent?.id).not.toBe(first?.id);
  });

  it('changes identity for a materially different concern or logical anchor', () => {
    const base = {
      rubric: 'rootCause', contractVersion: 'v1', concernKind: 'root-cause-unaddressed',
      anchor: { rubric: 'rootCause', statedDefect: 'save fails', locus: 'src/a.ts', relation: 'root-cause-unaddressed' },
    };
    const changedConcern = canonicalizeBuildReviewFindingIdentity({
      ...base,
      concernKind: 'symptom-only-fix',
      anchor: { ...base.anchor, relation: 'symptom-only-fix' },
    });
    const changedAnchor = canonicalizeBuildReviewFindingIdentity({ ...base, anchor: { ...base.anchor, locus: 'src/b.ts' } });

    expect([changedConcern?.id, changedAnchor?.id]).not.toContain(canonicalizeBuildReviewFindingIdentity(base)?.id);
  });

  it('retains separate blocking identities when a valid classification changes at one subject', () => {
    const findingSets = [
      [
        { rubric: 'tautology', contractVersion: 'v1', concernKind: 'assertion-insensitive-to-production', anchor: { rubric: 'tautology', changedTest: 'src/a.test.ts', exercisedBehavior: 'save', violationKind: 'assertion-insensitive-to-production' } },
        { rubric: 'tautology', contractVersion: 'v1', concernKind: 'source-text-mirror', anchor: { rubric: 'tautology', changedTest: 'src/a.test.ts', exercisedBehavior: 'save', violationKind: 'source-text-mirror' } },
      ],
      [
        { rubric: 'rootCause', contractVersion: 'v1', concernKind: 'root-cause-unaddressed', anchor: { rubric: 'rootCause', statedDefect: 'save fails', locus: 'src/handler.ts', relation: 'root-cause-unaddressed' } },
        { rubric: 'rootCause', contractVersion: 'v1', concernKind: 'symptom-only-fix', anchor: { rubric: 'rootCause', statedDefect: 'save fails', locus: 'src/handler.ts', relation: 'symptom-only-fix' } },
      ],
    ];

    expect(findingSets.map(canonicalizeBuildReviewFindingSet).map((findings) => findings?.length)).toEqual([2, 2]);
  });

  it('keeps distinct missing surfaces under one completeness plan task blocking', () => {
    const findings = canonicalizeBuildReviewFindingSet([
      {
        rubric: 'completeness', contractVersion: 'v1', concernKind: 'missing-deliverable',
        anchor: { rubric: 'completeness', planTask: '10', missingSurface: 'src/first.ts', missingOutcome: 'first outcome', missingKind: 'missing-deliverable' },
      },
      {
        rubric: 'completeness', contractVersion: 'v1', concernKind: 'missing-deliverable',
        anchor: { rubric: 'completeness', planTask: '10', missingSurface: 'src/second.ts', missingOutcome: 'second outcome', missingKind: 'missing-deliverable' },
      },
    ]);

    expect(findings?.map((finding) => finding.id)).toHaveLength(2);
  });

  it('gives a reclassified concern a new identity', () => {
    const sharedSubject = {
      rubric: 'rootCause', contractVersion: 'v1',
      anchor: { rubric: 'rootCause', statedDefect: 'x', locus: 'src/a.ts', relation: 'root-cause-unaddressed' },
    };
    const first = canonicalizeBuildReviewFindingIdentity({ ...sharedSubject, concernKind: 'root-cause-unaddressed' });
    const reclassified = canonicalizeBuildReviewFindingIdentity({ ...sharedSubject, concernKind: 'symptom-only-fix', anchor: { ...sharedSubject.anchor, relation: 'symptom-only-fix' } });

    expect(reclassified?.id).not.toBe(first?.id);
  });

  it('fails closed instead of omitting invalid, duplicate, or colliding finding records', () => {
    const first = {
      rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change',
      anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' },
    };
    const second = { ...first, anchor: { ...first.anchor, path: 'src/b.ts' } };
    const firstId = canonicalizeBuildReviewFindingIdentity(first)?.id;

    expect(canonicalizeBuildReviewFindingSet([
      first,
      { rubric: 'scope', contractVersion: 'v1', concernKind: 'unplanned-surface', anchor: { rubric: 'scope', relation: 'outside-plan' } },
    ])).toBeUndefined();
    expect(canonicalizeBuildReviewFindingSet([{ ...first, contractVersion: 'v3' }])).toBeUndefined();
    expect(canonicalizeBuildReviewFindingSet([first, first])).toBeUndefined();
    expect(canonicalizeBuildReviewFindingSet([{ ...first, id: firstId }, { ...second, id: firstId }])).toBeUndefined();
  });

  it('retains every independently valid finding rather than truncating a grader result', () => {
    const findings = canonicalizeBuildReviewFindingSet([
      {
        rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change',
        anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' },
      },
      {
        rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change',
        anchor: { rubric: 'scope', path: 'src/b.ts', relation: 'not-authorized-by-plan' },
      },
    ]);

    expect(findings).toHaveLength(2);
  });
});
