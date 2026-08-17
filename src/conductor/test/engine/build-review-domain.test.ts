import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_FINDING_VOCABULARIES,
  describeBuildReviewJudgedResultRejection,
  makeBuildReviewDispatchFailure,
  parseBuildReviewDispatchFailure,
  parseBuildReviewInfrastructureFailure,
  parseBuildReviewJudgedResult,
  parseBuildReviewLapId,
  parseBuildReviewRubricContractVersion,
  parseBuildReviewSkip,
  renderBuildReviewJudgedResultShape,
  type BuildReviewFindingAnchor,
} from '../../src/engine/build-review-domain.js';

describe('build-review domain', () => {
  it('brands lap and rubric-contract identities from their closed grammars', () => {
    expect(parseBuildReviewLapId('lap-20260813-01')).toBe('lap-20260813-01');
    expect(parseBuildReviewLapId('')).toBeUndefined();
    expect(parseBuildReviewLapId('lap with spaces')).toBeUndefined();

    expect(parseBuildReviewRubricContractVersion('v1')).toBe('v1');
    expect(parseBuildReviewRubricContractVersion('v2')).toBe('v2');
  });

  it('accepts only the typed anchors belonging to each rubric', () => {
    const anchors: readonly BuildReviewFindingAnchor[] = [
      { rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'save', violationKind: 'stayed-green' },
      { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
      { rubric: 'rootCause', statedDefect: 'does not save', locus: 'handler', relation: 'symptom-only' },
      { rubric: 'completeness', planTask: '11', missingSurface: 'src/state.ts', missingOutcome: 'writes state' },
    ];

    expect(anchors).toHaveLength(4);
    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'scope', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{ concernKind: 'out-of-plan-change', summary: 'src/a.ts is outside the approved plan', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' } }],
    })).toMatchObject({ verdict: 'FAIL', findings: [{ concernKind: 'out-of-plan-change' }] });
    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'scope', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{ concernKind: 'wrong-anchor', anchor: { rubric: 'retired', entryPoint: 'bin/tool', target: 'src/main.ts', relation: 'unreachable' } }],
    })).toBeUndefined();
  });

  it('retains each finding actionable summary and concrete evidence locations at the grader boundary', () => {
    const parsed = parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'scope', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{
        concernKind: 'out-of-plan-change',
        summary: 'src/a.ts is outside the approved plan.',
        evidenceLocations: ['src/a.ts:8', '.docs/plans/feature.md:21'],
        anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' },
      }],
    }) as unknown as { findings: readonly [{ summary: string; evidenceLocations: readonly string[] }] } | undefined;

    expect(parsed?.findings[0]).toEqual({
      concernKind: 'out-of-plan-change',
      summary: 'src/a.ts is outside the approved plan.',
      evidenceLocations: ['src/a.ts:8', '.docs/plans/feature.md:21'],
      anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' },
    });
  });

  it('normalizes closed classifications and rejects values outside the owning rubric vocabulary', () => {
    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'scope', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{
        concernKind: 'OUT_OF_PLAN_CHANGE', summary: 'The path is outside the plan.', evidenceLocations: ['src/a.ts:8'],
        anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'NOT_AUTHORIZED_BY_PLAN' },
      }],
    })).toMatchObject({ findings: [{ concernKind: 'out-of-plan-change', anchor: { relation: 'not-authorized-by-plan' } }] });

    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'tautology', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{
        concernKind: 'TEST_DOES_NOT_EXERCISE_CHANGED_BEHAVIOR', summary: 'The assertion remains green.', evidenceLocations: ['test/a.test.ts:8'],
        anchor: { rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'writes an event', violationKind: 'ASSERTION_INSENSITIVE_TO_PRODUCTION' },
      }],
    })).toMatchObject({ findings: [{ concernKind: 'test-does-not-exercise-changed-behavior', anchor: { exercisedBehavior: 'writes an event', violationKind: 'assertion-insensitive-to-production' } }] });

    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'rootCause', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{
        concernKind: 'SYMPTOM_ONLY_FIX', summary: 'The defect remains.', evidenceLocations: ['src/a.ts:8'],
        anchor: { rubric: 'rootCause', statedDefect: 'events are omitted', locus: 'handler', relation: 'ROOT_CAUSE_UNADDRESSED' },
      }],
    })).toMatchObject({ findings: [{ concernKind: 'symptom-only-fix', anchor: { statedDefect: 'events are omitted', relation: 'root-cause-unaddressed' } }] });

    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'completeness', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{
        concernKind: 'MISSING_DELIVERABLE', summary: 'A deliverable is absent.', evidenceLocations: ['src/a.ts:8'],
        anchor: { rubric: 'completeness', planTask: '4', missingSurface: 'src/result.ts', missingOutcome: 'writes the result' },
      }],
    })).toMatchObject({ findings: [{ concernKind: 'missing-deliverable', anchor: { missingOutcome: 'writes the result' } }] });

    for (const [rubric, finding] of [
      ['scope', { concernKind: 'unrecognized', summary: 'x', evidenceLocations: ['src/a.ts:8'], anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'unrecognized' } }],
      ['tautology', { concernKind: 'assertion-insensitive-to-production', summary: 'x', evidenceLocations: ['test/a.test.ts:8'], anchor: { rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'x', violationKind: 'unrecognized' } }],
      ['rootCause', { concernKind: 'root-cause-unaddressed', summary: 'x', evidenceLocations: ['src/a.ts:8'], anchor: { rubric: 'rootCause', statedDefect: 'x', locus: 'handler', relation: 'unrecognized' } }],
    ] as const) {
      expect(parseBuildReviewJudgedResult({
        kind: 'judged', rubric, lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1', findings: [finding],
      })).toBeUndefined();
    }
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
        concernKind: 'out-of-plan-change',
        ...payload,
        anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' },
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

  it('retains a validated fixture-relocation audit entry on a zero-finding Tautology PASS', () => {
    const relocationAudit = '[relocation-audit] EXEMPTED: test/fixture/c.md → test/fixture/docs/c.md; production hunk(s) do force the move';

    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'tautology', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [], relocationAudit: [relocationAudit],
    })).toMatchObject({ verdict: 'PASS', relocationAudit: [relocationAudit] });

    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'tautology', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [], relocationAudit: ['[relocation-audit] EXEMPTED: old → new'],
    })).toBeUndefined();
  });

  it('preserves omission of the optional relocation audit', () => {
    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'scope', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1', findings: [],
    })).toEqual({
      kind: 'judged', rubric: 'scope', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1', findings: [], verdict: 'PASS',
    });
  });

  it('keeps skips and infrastructure failures explicit closed outcomes', () => {
    expect(parseBuildReviewSkip({ kind: 'skipped', rubric: 'wiring', reason: 'missing-entry-points' })).toBeUndefined();
    expect(parseBuildReviewSkip({ kind: 'skipped', rubric: 'scope', reason: 'missing-entry-points' })).toBeUndefined();
    expect(parseBuildReviewSkip({ kind: 'skipped', rubric: 'scope', reason: 'operator-choice' })).toBeUndefined();

    expect(parseBuildReviewInfrastructureFailure({
      kind: 'infrastructure-failure', rubric: 'tautology', reason: 'provider-error', detail: 'provider unavailable',
    })).toEqual({ kind: 'infrastructure-failure', rubric: 'tautology', reason: 'provider-error', detail: 'provider unavailable' });
    expect(parseBuildReviewInfrastructureFailure({
      kind: 'infrastructure-failure', rubric: 'scope', reason: 'artifact-read-failed', detail: 'missing current-lap artifact',
    })).toEqual({ kind: 'infrastructure-failure', rubric: 'scope', reason: 'artifact-read-failed', detail: 'missing current-lap artifact' });
    expect(parseBuildReviewInfrastructureFailure({
      kind: 'infrastructure-failure', rubric: 'tautology', reason: 'ignored', detail: 'provider unavailable',
    })).toBeUndefined();
  });
});

describe('build-review judged-result contract rendering and rejection diagnosis', () => {
  const expected = { lapId: 'lap-a237', snapshotDigest: 'sha256:snap' };

  it('renders the exact per-rubric anchor schema', () => {
    expect(renderBuildReviewJudgedResultShape('tautology')).toContain(
      '"anchor": {"rubric": "tautology", "changedTest": "<string>", "exercisedBehavior": "<string>", "violationKind": "<one of: assertion-insensitive-to-production | test-does-not-exercise-changed-behavior | assertion-derived-from-test-data | source-text-mirror>"}',
    );
    expect(renderBuildReviewJudgedResultShape('scope')).toContain(
      '"anchor": {"rubric": "scope", "path": "<string>", "relation": "<one of: out-of-plan-change | not-authorized-by-plan>"}',
    );
    expect(renderBuildReviewJudgedResultShape('rootCause')).toContain(
      '"anchor": {"rubric": "rootCause", "statedDefect": "<string>", "locus": "<string>", "relation": "<one of: root-cause-unaddressed | symptom-only-fix | provenance-sensitive-cache-identity>"}',
    );
    expect(renderBuildReviewJudgedResultShape('completeness')).toContain(
      '"anchor": {"rubric": "completeness", "planTask": "<string>", "missingSurface": "<string>", "missingOutcome": "<string>"}',
    );
  });

  it.each([
    ['tautology', 'violationKind'],
    ['scope', 'relation'],
    ['rootCause', 'relation'],
    ['completeness', undefined],
  ] as const)('renders every allowed %s vocabulary member into its dispatch schema', (rubric, classificationField) => {
    const shape = renderBuildReviewJudgedResultShape(rubric);
    const allowedMembers = BUILD_REVIEW_FINDING_VOCABULARIES[rubric].members.join(' | ');

    expect(shape).toContain(`"concernKind": "<one of: ${allowedMembers}>"`);
    if (classificationField) {
      expect(shape).toContain(`"${classificationField}": "<one of: ${allowedMembers}>"`);
    }
  });

  it('names the tautology vocabulary when a prose violationKind is outside it', () => {
    const rejection = describeBuildReviewJudgedResultRejection({
      kind: 'judged', rubric: 'tautology', contractVersion: 'v2', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      findings: [{
        concernKind: 'assertion-insensitive-to-production', summary: 'The assertion remains green.', evidenceLocations: ['test/a.test.ts:8'],
        anchor: {
          rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'writes an event',
          violationKind: 'a prose explanation instead of a classification',
        },
      }],
    }, 'tautology', expected);

    expect(rejection).toContain('findings[0].anchor.violationKind');
    expect(rejection).toContain(BUILD_REVIEW_FINDING_VOCABULARIES.tautology.members.join(' | '));
  });

  it('names the missing anchor when a finding flattens anchor fields to its top level (2026-08-15 tautology incident shape)', () => {
    const rejection = describeBuildReviewJudgedResultRejection({
      kind: 'judged', rubric: 'tautology', contractVersion: 'v1', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      findings: [{
        concernKind: 'assertion-cannot-fail',
        changedTest: { path: 't.test.ts', name: 'case' },
        exercisedBehavior: { productionSymbol: 'EVENT_SINKS' },
        violationKind: 'assertion-over-test-local-construct',
        summary: 'cannot fail', evidenceLocations: ['t.test.ts:519'],
      }],
    }, 'tautology', expected);

    expect(rejection).toContain('findings[0].anchor is required');
    expect(rejection).toContain('"changedTest": "<string>"');
    expect(rejection).toContain('never flattened');
  });

  it('names concernKind and anchor for the completeness kind/planAnchor drift (2026-08-15 completeness incident shape)', () => {
    const rejection = describeBuildReviewJudgedResultRejection({
      kind: 'judged', rubric: 'completeness', contractVersion: 'v1', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      findings: [{
        kind: 'missing_deliverable',
        planAnchor: { type: 'task', id: 'Task 11' },
        deliverableAnchor: { type: 'documentation', id: 'docs/x.md' },
        summary: 'doc still stale', evidenceLocations: ['docs/x.md:648'],
      }],
    }, 'completeness', expected);

    expect(rejection).toContain('findings[0].concernKind must be a non-empty string (never "kind")');
    expect(rejection).toContain('findings[0].anchor is required');
    expect(rejection).toContain('"planTask": "<string>"');
  });

  it('rejects the plural anchors variant by naming the required singular anchor object', () => {
    const rejection = describeBuildReviewJudgedResultRejection({
      kind: 'judged', rubric: 'tautology', contractVersion: 'v1', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      findings: [{
        concernKind: 'vacuous-assertion',
        anchors: { changedTest: 'a > b', exercisedBehavior: 'x', violationKind: 'y' },
        summary: 'never observes production', evidenceLocations: ['t.test.ts:519'],
      }],
    }, 'tautology', expected);

    expect(rejection).toContain('never an alternate name such as "anchors"');
  });

  it('diagnoses non-object results, identity mismatches, and verdict contradictions without throwing', () => {
    expect(describeBuildReviewJudgedResultRejection('just prose', 'scope', expected)).toContain('not a single JSON object');
    expect(describeBuildReviewJudgedResultRejection({ verdict: 'PASS' }, 'scope', expected)).toContain('"kind" must be exactly the string "judged"');
    expect(describeBuildReviewJudgedResultRejection({
      kind: 'judged', rubric: 'scope', contractVersion: 'v2', lapId: 'lap-other', snapshotDigest: expected.snapshotDigest, findings: [],
    }, 'scope', expected)).toContain('must echo the projection\'s lapId "lap-a237" verbatim');
    expect(describeBuildReviewJudgedResultRejection({
      kind: 'judged', rubric: 'scope', contractVersion: 'v2', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      findings: [], verdict: 'FAIL',
    }, 'scope', expected)).toContain('contradicts the findings array');
  });

  it('bounds the diagnosis to a fixed number of named problems', () => {
    const findings = Array.from({ length: 10 }, () => ({}));
    const rejection = describeBuildReviewJudgedResultRejection(
      { kind: 'judged', rubric: 'scope', contractVersion: 'v1', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest, findings },
      'scope', expected,
    );
    expect(rejection).toMatch(/and \d+ more problem\(s\)$/);
  });

  it('round-trips a dispatch-failure report and rejects other shapes', () => {
    const report = makeBuildReviewDispatchFailure('contract not satisfied; excerpt: ...');
    expect(parseBuildReviewDispatchFailure(report)).toEqual(report);
    expect(parseBuildReviewDispatchFailure({ kind: 'dispatch-failure', detail: '' })).toBeUndefined();
    expect(parseBuildReviewDispatchFailure({ kind: 'judged' })).toBeUndefined();
    expect(parseBuildReviewDispatchFailure(undefined)).toBeUndefined();
  });
});
