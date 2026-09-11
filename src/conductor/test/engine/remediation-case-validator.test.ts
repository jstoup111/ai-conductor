// Covers: task:2
import { describe, expect, it } from 'vitest';

import {
  validateRemediationCaseGraph,
  type RemediationCaseJudgement,
} from '../../src/engine/remediation-case-validator.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import {
  assembleBuildReviewAdjudicationContext,
  buildReviewAdjudicationSourceId,
} from '../../src/engine/build-review-adjudication-context.js';

const CURRENT_SOURCE_IDS = [
  'testQuality:finding-1',
  'testQuality:finding-2',
  'testQuality:finding-3',
  'testQuality:finding-4',
] as const;

const VALID_JUDGEMENT = {
  mode: 'case-v1',
  domain: 'build_review',
  sourceOutcomes: [
    { sourceId: 'testQuality:finding-1', outcome: 'acted', caseRef: 'case-a' },
    { sourceId: 'testQuality:finding-2', outcome: 'merged', caseRef: 'case-a' },
    { sourceId: 'testQuality:finding-3', outcome: 'deferred', caseRef: 'case-b' },
    { sourceId: 'testQuality:finding-4', outcome: 'rejected', caseRef: 'case-c' },
  ],
  cases: [
    {
      caseRef: 'case-a',
      disposition: 'act',
      priority: 'high',
      rationale: 'Both findings need the same focused test repair.',
      confidence: 'high',
      effect: { kind: 'action', route: 'build', tasks: [{ title: 'test/widget.test.ts — cover the changed branch' }] },
    },
    {
      caseRef: 'case-b',
      disposition: 'defer',
      priority: 'low',
      rationale: 'The work is outside the approved plan.',
      confidence: 'medium',
      effect: {
        kind: 'deferral',
        title: 'Cover the unrelated widget branch',
        body: 'The current feature has no approved task for this behavior.',
        exclusionRationale: 'No current plan task admits this follow-up behavior.',
      },
    },
    {
      caseRef: 'case-c',
      disposition: 'reject',
      priority: 'medium',
      rationale: 'The finding does not violate the governing rubric.',
      confidence: 'low',
      effect: { kind: 'none' },
    },
  ],
} as const satisfies RemediationCaseJudgement;

const VALID_REFUTATION = {
  claim: 'The earlier action did not cover this finding.',
  assertions: [{
    assertion: 'The repaired branch is still absent.', verdict: 'refuted',
    evidence: [{ path: 'test/widget.test.ts', excerpt: 'covers the changed branch' }],
  }],
} as const;

const VALID_REFUTE_JUDGEMENT = {
  ...VALID_JUDGEMENT,
  sourceOutcomes: [
    ...VALID_JUDGEMENT.sourceOutcomes.slice(0, 3),
    { ...VALID_JUDGEMENT.sourceOutcomes[3], outcome: 'refuted', caseRef: 'case-refuted' },
  ],
  cases: [
    ...VALID_JUDGEMENT.cases.slice(0, 2),
    {
      caseRef: 'case-refuted', existingCaseId: 'existing-case-1', disposition: 'refute', priority: 'medium',
      rationale: 'The earlier action did not address the asserted defect.', confidence: 'high', effect: { kind: 'none' },
      refutation: VALID_REFUTATION,
    },
  ],
} as const satisfies RemediationCaseJudgement;

describe('remediation case graph validator', () => {
  it('reconstructs every current source through exactly one canonical case', () => {
    const result = validateRemediationCaseGraph(CURRENT_SOURCE_IDS, VALID_JUDGEMENT);

    expect(result).toEqual({
      ok: true,
      graph: {
        sourceOutcomes: VALID_JUDGEMENT.sourceOutcomes,
        cases: [
          { case: VALID_JUDGEMENT.cases[0], sources: VALID_JUDGEMENT.sourceOutcomes.slice(0, 2) },
          { case: VALID_JUDGEMENT.cases[1], sources: [VALID_JUDGEMENT.sourceOutcomes[2]] },
          { case: VALID_JUDGEMENT.cases[2], sources: [VALID_JUDGEMENT.sourceOutcomes[3]] },
        ],
      },
    });
  });

  it('does not require an outcome for a suppressed finding excluded by adjudication context assembly', () => {
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId: 'lap-suppressed-source' as never,
      snapshotDigest: 'snapshot-suppressed-source',
      results: {
        testQuality: {
          kind: 'judged', rubric: 'testQuality', lapId: 'lap-suppressed-source' as never,
          snapshotDigest: 'snapshot-suppressed-source', contractVersion: 'v3', verdict: 'FAIL',
          findings: [
            { concernKind: 'test-insensitive', summary: 'Live finding.', evidenceLocations: ['test/live.test.ts:1'], anchor: { rubric: 'testQuality', locus: { path: 'test/live.test.ts', contentHash: 'sha256:live', display: 'live' } } },
            { concernKind: 'test-insensitive', summary: 'Suppressed finding.', evidenceLocations: ['test/suppressed.test.ts:1'], anchor: { rubric: 'testQuality', locus: { path: 'test/suppressed.test.ts', contentHash: 'sha256:suppressed', display: 'suppressed' } } },
          ],
        },
      },
    });
    const sources = projectBuildReviewAggregateSources(aggregate)!;
    const [liveSource, suppressedSource] = sources;
    const context = assembleBuildReviewAdjudicationContext({
      aggregate,
      priorCases: [],
      excludedSourceIds: new Set([buildReviewAdjudicationSourceId(suppressedSource!)]),
      suppressions: [{
        findingId: suppressedSource!.findingId, rubric: 'testQuality', summary: 'Suppressed finding.',
        confidence: 40, floor: 70, lastSeenLap: 'lap-suppressed-source',
      }],
    });
    expect(context).toMatchObject({ ok: true });
    if (!context.ok) throw new Error('expected suppression context to assemble');
    const liveSourceIds = context.context.currentFindings.map((source) => source.sourceId);
    const suppressedSourceId = buildReviewAdjudicationSourceId(suppressedSource!);
    const judgement = {
      mode: 'case-v1',
      domain: 'build_review',
      sourceOutcomes: [{ sourceId: buildReviewAdjudicationSourceId(liveSource!), outcome: 'rejected', caseRef: 'case-live' }],
      cases: [{
        caseRef: 'case-live', disposition: 'reject', priority: 'low',
        rationale: 'The live finding is not actionable.', confidence: 'high', effect: { kind: 'none' },
      }],
    } as const satisfies RemediationCaseJudgement;

    expect(liveSourceIds).toEqual([buildReviewAdjudicationSourceId(liveSource!)]);
    expect(liveSourceIds).not.toContain(suppressedSourceId);
    expect(context.context.suppressionHistory).toHaveLength(1);
    expect(validateRemediationCaseGraph(liveSourceIds, judgement)).toMatchObject({ ok: true });
  });

  it.each([
    ['omitted source', {
      ...VALID_JUDGEMENT,
      sourceOutcomes: VALID_JUDGEMENT.sourceOutcomes.slice(0, 3),
    }, 'missing-source'],
    ['duplicate source', {
      ...VALID_JUDGEMENT,
      sourceOutcomes: [...VALID_JUDGEMENT.sourceOutcomes, VALID_JUDGEMENT.sourceOutcomes[0]],
    }, 'duplicate-source'],
    ['unknown source', {
      ...VALID_JUDGEMENT,
      sourceOutcomes: [{ ...VALID_JUDGEMENT.sourceOutcomes[0], sourceId: 'testQuality:unknown' }, ...VALID_JUDGEMENT.sourceOutcomes.slice(1)],
    }, 'unknown-source'],
    ['dangling case reference', {
      ...VALID_JUDGEMENT,
      sourceOutcomes: [{ ...VALID_JUDGEMENT.sourceOutcomes[0], caseRef: 'case-missing' }, ...VALID_JUDGEMENT.sourceOutcomes.slice(1)],
    }, 'unknown-case-reference'],
    ['contradictory source outcome', {
      ...VALID_JUDGEMENT,
      sourceOutcomes: [{ ...VALID_JUDGEMENT.sourceOutcomes[0], outcome: 'deferred' }, ...VALID_JUDGEMENT.sourceOutcomes.slice(1)],
    }, 'contradictory-source-outcome'],
    ['contradictory case route', {
      ...VALID_JUDGEMENT,
      cases: [...VALID_JUDGEMENT.cases, { ...VALID_JUDGEMENT.cases[0], disposition: 'defer', effect: VALID_JUDGEMENT.cases[1].effect }],
    }, 'contradictory-case-disposition'],
    ['taskless action', {
      ...VALID_JUDGEMENT,
      cases: [{ ...VALID_JUDGEMENT.cases[0], effect: { kind: 'action', route: 'build', tasks: [] } }, ...VALID_JUDGEMENT.cases.slice(1)],
    }, 'invalid-action-effect'],
    ['deferral without exclusion rationale', {
      ...VALID_JUDGEMENT,
      cases: [VALID_JUDGEMENT.cases[0], {
        ...VALID_JUDGEMENT.cases[1],
        effect: { ...VALID_JUDGEMENT.cases[1].effect, exclusionRationale: '' },
      }, VALID_JUDGEMENT.cases[2]],
    }, 'invalid-deferral-effect'],
    ['provider durable case id', {
      ...VALID_JUDGEMENT,
      cases: [{ ...VALID_JUDGEMENT.cases[0], caseId: 'provider-case-id' }, ...VALID_JUDGEMENT.cases.slice(1)],
    }, 'provider-durable-id'],
    ['provider durable effect id', {
      ...VALID_JUDGEMENT,
      cases: [{ ...VALID_JUDGEMENT.cases[0], effect: { ...VALID_JUDGEMENT.cases[0].effect, effectId: 'provider-effect-id' } }, ...VALID_JUDGEMENT.cases.slice(1)],
    }, 'provider-durable-id'],
  ] as const)('rejects %s atomically', (_name, judgement, reason) => {
    const result = validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement as RemediationCaseJudgement);

    expect(result).toEqual({ ok: false, reason });
  });

  it.each([
    ['a refute row without an existing case binding', {
      ...VALID_REFUTE_JUDGEMENT,
      cases: [...VALID_REFUTE_JUDGEMENT.cases.slice(0, 2), { ...VALID_REFUTE_JUDGEMENT.cases[2], existingCaseId: undefined }],
    }, 'refute-without-binding'],
    ['a refutation with no refuted assertion', {
      ...VALID_REFUTE_JUDGEMENT,
      cases: [...VALID_REFUTE_JUDGEMENT.cases.slice(0, 2), {
        ...VALID_REFUTE_JUDGEMENT.cases[2],
        refutation: { ...VALID_REFUTATION, assertions: [{ ...VALID_REFUTATION.assertions[0], verdict: 'upheld' }] },
      }],
    }, 'refutation-without-refuted-assertion'],
    ['a refutation below high confidence', {
      ...VALID_REFUTE_JUDGEMENT,
      cases: [...VALID_REFUTE_JUDGEMENT.cases.slice(0, 2), { ...VALID_REFUTE_JUDGEMENT.cases[2], confidence: 'medium' }],
    }, 'refutation-confidence-not-high'],
    ['an action effect on a refute row', {
      ...VALID_REFUTE_JUDGEMENT,
      cases: [...VALID_REFUTE_JUDGEMENT.cases.slice(0, 2), { ...VALID_REFUTE_JUDGEMENT.cases[2], effect: VALID_JUDGEMENT.cases[0].effect }],
    }, 'invalid-refute-effect'],
    ['a refute deferral without an exclusion rationale', {
      ...VALID_REFUTE_JUDGEMENT,
      cases: [...VALID_REFUTE_JUDGEMENT.cases.slice(0, 2), {
        ...VALID_REFUTE_JUDGEMENT.cases[2],
        effect: { kind: 'deferral', title: 'Follow up', body: 'The plan excludes this work.', exclusionRationale: '' },
      }],
    }, 'invalid-deferral-effect'],
    ['a refuted source outcome on a reject row', {
      ...VALID_JUDGEMENT,
      sourceOutcomes: [...VALID_JUDGEMENT.sourceOutcomes.slice(0, 3), { ...VALID_JUDGEMENT.sourceOutcomes[3], outcome: 'refuted' }],
    }, 'contradictory-source-outcome'],
  ] as const)('rejects %s', (_name, judgement, reason) => {
    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement as RemediationCaseJudgement)).toEqual({ ok: false, reason });
  });

  it('accepts a valid refute graph', () => {
    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, VALID_REFUTE_JUDGEMENT)).toMatchObject({ ok: true });
  });

  it.each([
    ['refuted', 'refute', true],
    ['refuted', 'reject', false],
    ['merged', 'act', true],
    ['merged', 'defer', true],
    ['merged', 'reject', true],
    ['merged', 'refute', true],
  ] as const)('accepts %s only for an allowed %s disposition', (outcome, disposition, expected) => {
    const caseRow = disposition === 'refute'
      ? VALID_REFUTE_JUDGEMENT.cases[2]
      : {
        caseRef: 'case-target', disposition, priority: 'medium', rationale: 'A test case.', confidence: 'high',
        effect: disposition === 'act'
          ? VALID_JUDGEMENT.cases[0].effect
          : disposition === 'defer'
            ? VALID_JUDGEMENT.cases[1].effect
            : { kind: 'none' },
      };
    const judgement = {
      ...VALID_REFUTE_JUDGEMENT,
      sourceOutcomes: [...VALID_REFUTE_JUDGEMENT.sourceOutcomes.slice(0, 3), { ...VALID_REFUTE_JUDGEMENT.sourceOutcomes[3], outcome, caseRef: 'case-target' }],
      cases: [...VALID_REFUTE_JUDGEMENT.cases.slice(0, 2), { ...caseRow, caseRef: 'case-target' }],
    } as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement).ok).toBe(expected);
  });
});
