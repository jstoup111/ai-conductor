import { describe, expect, it } from 'vitest';

import {
  parseBuildReviewInfrastructureFailure,
  parseBuildReviewJudgedResult,
  parseBuildReviewLapId,
  parseBuildReviewRubricContractVersion,
  parseBuildReviewSkip,
  type BuildReviewFindingAnchor,
} from '../../src/engine/build-review-domain.js';

describe('build-review domain', () => {
  it('brands lap and rubric-contract identities from their closed grammars', () => {
    expect(parseBuildReviewLapId('lap-20260813-01')).toBe('lap-20260813-01');
    expect(parseBuildReviewLapId('')).toBeUndefined();
    expect(parseBuildReviewLapId('lap with spaces')).toBeUndefined();

    expect(parseBuildReviewRubricContractVersion('v1')).toBe('v1');
    expect(parseBuildReviewRubricContractVersion('v2')).toBeUndefined();
  });

  it('accepts only the typed anchors belonging to each rubric', () => {
    const anchors: readonly BuildReviewFindingAnchor[] = [
      { rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'save', violationKind: 'stayed-green' },
      { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
      { rubric: 'rootCause', statedDefect: 'does not save', locus: 'handler', relation: 'symptom-only' },
      { rubric: 'completeness', planTask: '11', missingOutcome: 'writes state' },
    ];

    expect(anchors).toHaveLength(4);
    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'scope', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{ concernKind: 'unplanned-surface', summary: 'src/a.ts is outside the approved plan', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' } }],
    })).toMatchObject({ verdict: 'FAIL', findings: [{ concernKind: 'unplanned-surface' }] });
    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'scope', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{ concernKind: 'wrong-anchor', anchor: { rubric: 'retired', entryPoint: 'bin/tool', target: 'src/main.ts', relation: 'unreachable' } }],
    })).toBeUndefined();
  });

  it('retains each finding actionable summary and concrete evidence locations at the grader boundary', () => {
    const parsed = parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'scope', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{
        concernKind: 'unplanned-surface',
        summary: 'src/a.ts is outside the approved plan.',
        evidenceLocations: ['src/a.ts:8', '.docs/plans/feature.md:21'],
        anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
      }],
    }) as unknown as { findings: readonly [{ summary: string; evidenceLocations: readonly string[] }] } | undefined;

    expect(parsed?.findings[0]).toEqual({
      concernKind: 'unplanned-surface',
      summary: 'src/a.ts is outside the approved plan.',
      evidenceLocations: ['src/a.ts:8', '.docs/plans/feature.md:21'],
      anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
    });
  });

  it.each([
    ['missing actionable summary', { evidenceLocations: ['src/a.ts:8'] }],
    ['empty actionable summary', { summary: ' ', evidenceLocations: ['src/a.ts:8'] }],
    ['missing evidence locations', { summary: 'src/a.ts is outside the approved plan.' }],
    ['empty evidence locations', { summary: 'src/a.ts is outside the approved plan.', evidenceLocations: [] }],
    ['non-concrete evidence location', { summary: 'src/a.ts is outside the approved plan.', evidenceLocations: [' '] }],
  ])('rejects a finding with %s', (_caseName, payload) => {
    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'scope', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{
        concernKind: 'unplanned-surface',
        ...payload,
        anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
      }],
    })).toBeUndefined();
  });

  it('derives judged PASS exclusively from zero findings and rejects contradictory booleans', () => {
    const pass = parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'rootCause', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1', findings: [],
    });
    expect(pass).toMatchObject({ verdict: 'PASS', findings: [] });

    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'rootCause', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1', findings: [], verdict: 'FAIL', passed: false,
    })).toBeUndefined();
    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'rootCause', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1', findings: [{ concernKind: 'symptom-only', anchor: { rubric: 'rootCause', statedDefect: 'x', locus: 'y', relation: 'symptom-only' } }], verdict: 'PASS', passed: true,
    })).toBeUndefined();
  });

  it('keeps skips and infrastructure failures explicit closed outcomes', () => {
    expect(parseBuildReviewSkip({ kind: 'skipped', rubric: 'wiring', reason: 'missing-entry-points' })).toBeUndefined();
    expect(parseBuildReviewSkip({ kind: 'skipped', rubric: 'scope', reason: 'missing-entry-points' })).toBeUndefined();
    expect(parseBuildReviewSkip({ kind: 'skipped', rubric: 'scope', reason: 'operator-choice' })).toBeUndefined();

    expect(parseBuildReviewInfrastructureFailure({
      kind: 'infrastructure-failure', rubric: 'tautology', reason: 'provider-error', detail: 'provider unavailable',
    })).toEqual({ kind: 'infrastructure-failure', rubric: 'tautology', reason: 'provider-error', detail: 'provider unavailable' });
    expect(parseBuildReviewInfrastructureFailure({
      kind: 'infrastructure-failure', rubric: 'tautology', reason: 'ignored', detail: 'provider unavailable',
    })).toBeUndefined();
  });
});
