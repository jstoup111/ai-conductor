import { describe, expect, it } from 'vitest';

import * as buildReviewDomain from '../../src/engine/build-review-domain.js';
import {
  describeBuildReviewDispatchedResultRejection,
  stampBuildReviewDispatchedCandidate,
} from '../../src/engine/build-review-coordinator.js';
import {
  BUILD_REVIEW_FINDING_VOCABULARIES,
  buildReviewFindingReferenceContext,
  describeBuildReviewJudgedResultRejection,
  makeBuildReviewDispatchFailure,
  parseBuildReviewDispatchFailure,
  parseBuildReviewInfrastructureFailure,
  parseBuildReviewJudgedResult,
  parseBuildReviewLapId,
  parseBuildReviewCanonicalPathReference,
  parseBuildReviewCanonicalPlanTaskReference,
  parseBuildReviewRubricContractVersion,
  parseBuildReviewSkip,
  renderBuildReviewJudgedResultShape,
  type BuildReviewFindingAnchor,
} from '../../src/engine/build-review-domain.js';
import type { BuildReviewRubricProjection } from '../../src/engine/build-review-projections.js';

describe('build-review domain', () => {
  it('brands lap and rubric-contract identities from their closed grammars', () => {
    expect(parseBuildReviewLapId('lap-20260813-01')).toBe('lap-20260813-01');
    expect(parseBuildReviewLapId('')).toBeUndefined();
    expect(parseBuildReviewLapId('lap with spaces')).toBeUndefined();

    expect(parseBuildReviewRubricContractVersion('v1')).toBe('v1');
    expect(parseBuildReviewRubricContractVersion('v2')).toBe('v2');
  });

  it('uses immutable tautology changed-test selectors without reclassifying their paths', () => {
    const references = buildReviewFindingReferenceContext({
      rubric: 'tautology',
      changedFiles: [
        { path: 'src/production.ts', changeKind: 'modified', hunks: [] },
        { path: 'test/legacy.test.ts', changeKind: 'modified', hunks: [] },
      ],
      changedTestSelectors: ['src/unit/widget.spec.ts', 'spec/widget.ts'],
    } as unknown as BuildReviewRubricProjection);

    expect(references.changedTests).toEqual(['src/unit/widget.spec.ts', 'spec/widget.ts']);
    for (const changedTest of references.changedTests) {
      expect(parseBuildReviewJudgedResult({
        kind: 'judged', rubric: 'tautology', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
        findings: [{ concernKind: 'source-text-mirror', summary: 'x', evidenceLocations: [`${changedTest}:1`], anchor: { rubric: 'tautology', changedTest, exercisedBehavior: 'x', violationKind: 'source-text-mirror' } }],
      }, references)).toMatchObject({ findings: [{ anchor: { changedTest } }] });
    }
    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'tautology', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{ concernKind: 'source-text-mirror', summary: 'x', evidenceLocations: ['test/legacy.test.ts:1'], anchor: { rubric: 'tautology', changedTest: 'test/legacy.test.ts', exercisedBehavior: 'x', violationKind: 'source-text-mirror' } }],
    }, references)).toBeUndefined();
  });

  it('requires v3 tautology changed-test content regions and excludes their display from matching', () => {
    const references = buildReviewFindingReferenceContext({
      rubric: 'tautology', changedFiles: [], changedTestSelectors: ['src/unit/widget.spec.ts'],
    } as unknown as BuildReviewRubricProjection);
    const changedTest = {
      path: 'src/unit/widget.spec.ts',
      contentHash: 'sha256:f635b6d8e7c57268d63f5a24373a229fd1211ff96bdd05a9f4147741759dd2c9',
      display: 'widget persists state',
    };
    const result = parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'tautology', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v3',
      findings: [{ concernKind: 'source-text-mirror', summary: 'x', evidenceLocations: ['src/unit/widget.spec.ts:1'], anchor: { rubric: 'tautology', changedTest, exercisedBehavior: 'x', violationKind: 'source-text-mirror' } }],
    }, references);

    expect(result).toMatchObject({ findings: [{ anchor: { changedTest } }] });
    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'tautology', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v3',
      findings: [{ concernKind: 'source-text-mirror', summary: 'x', evidenceLocations: ['src/unit/widget.spec.ts:1'], anchor: { rubric: 'tautology', changedTest: changedTest.path, exercisedBehavior: 'x', violationKind: 'source-text-mirror' } }],
    }, references)).toBeUndefined();
  });

  it('derives root-cause content-region references from projected hunk content, independent of line shifts', () => {
    const projectedHunk = {
      oldStart: 12, oldCount: 1, newStart: 14, newCount: 1,
      contentHash: 'sha256:67a8c9094cb9d5c2e93d5b5adba5543970592651c73948b9f441433cc017c3e6',
    };
    const shiftedProjectedHunk = {
      ...projectedHunk,
      oldStart: 112, newStart: 114,
    };
    const projection = (hunk: typeof projectedHunk) => ({
      rubric: 'rootCause',
      changedFiles: [{ path: 'src/handler.ts', changeKind: 'modified', hunks: [hunk] }],
    }) as unknown as BuildReviewRubricProjection;

    const references = buildReviewFindingReferenceContext(projection(projectedHunk)) as unknown as {
      readonly rootCauseLoci: readonly { readonly path: string; readonly contentHash: string; readonly display: string }[];
    };
    const shiftedReferences = buildReviewFindingReferenceContext(projection(shiftedProjectedHunk)) as unknown as {
      readonly rootCauseLoci: readonly { readonly path: string; readonly contentHash: string; readonly display: string }[];
    };

    expect(references.rootCauseLoci).toEqual([{
      path: 'src/handler.ts',
      contentHash: 'sha256:67a8c9094cb9d5c2e93d5b5adba5543970592651c73948b9f441433cc017c3e6',
      display: 'src/handler.ts changed region',
    }]);
    expect(shiftedReferences.rootCauseLoci).toEqual(references.rootCauseLoci);
  });

  it.each(['rem-rootcause-1', 'T0', '8.1'])('accepts repository-valid plan task reference %s', (planTask) => {
    expect(parseBuildReviewCanonicalPlanTaskReference(planTask)).toBe(planTask);
  });

  it.each([' rem-rootcause-1 ', '`T0`', 'Task 8.1'])('rejects formatted or prose plan task reference %s', (planTask) => {
    expect(parseBuildReviewCanonicalPlanTaskReference(planTask)).toBeUndefined();
  });

  it('accepts root-cause loci only as content-region references and rejects coordinate encodings', () => {
    const locus = {
      path: 'src/handler.ts',
      contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      display: 'persistence return branch',
    };
    const result = parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'rootCause', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v3',
      findings: [{
        concernKind: 'root-cause-unaddressed', summary: 'The persisted state is skipped.', evidenceLocations: ['src/handler.ts:14'],
        anchor: { rubric: 'rootCause', statedDefect: 'state is not persisted', locus, relation: 'root-cause-unaddressed' },
      }],
    });
    const coordinateEncodings = ['src/handler.ts@12', 'src/handler.ts:12-14', 'src/handler.ts@12,3:14,4'];

    expect(result).toMatchObject({ findings: [{ anchor: { locus } }] });
    expect(coordinateEncodings.map((coordinate) => parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'rootCause', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v3',
      findings: [{
        concernKind: 'root-cause-unaddressed', summary: 'The persisted state is skipped.', evidenceLocations: ['src/handler.ts:14'],
        anchor: { rubric: 'rootCause', statedDefect: 'state is not persisted', locus: coordinate, relation: 'root-cause-unaddressed' },
      }],
    }))).toEqual([undefined, undefined, undefined]);
  });

  it('rejects malformed or incomplete root-cause content-region references', () => {
    const locus = {
      path: 'src/handler.ts',
      contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      display: 'persistence return branch',
    };
    const malformedLoci = [
      { path: locus.path, contentHash: locus.contentHash },
      { path: locus.path, display: locus.display },
      { contentHash: locus.contentHash, display: locus.display },
      { ...locus, contentHash: 'sha256:not-a-digest' },
      { ...locus, display: '' },
      { ...locus, coordinate: '12-14' },
    ];

    expect(malformedLoci.map((candidate) => parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'rootCause', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v3',
      findings: [{
        concernKind: 'root-cause-unaddressed', summary: 'The persisted state is skipped.', evidenceLocations: ['src/handler.ts:14'],
        anchor: { rubric: 'rootCause', statedDefect: 'state is not persisted', locus: candidate, relation: 'root-cause-unaddressed' },
      }],
    }))).toEqual(Array(6).fill(undefined));
  });

  it('assigns occurrence ordinals to equal-content hunks in one path, in projection order', () => {
    const repeatedHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const distinctHash = 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    const hunk = (contentHash: string, oldStart: number) =>
      ({ oldStart, oldCount: 1, newStart: oldStart + 2, newCount: 1, contentHash });
    const references = buildReviewFindingReferenceContext({
      rubric: 'rootCause',
      changedFiles: [
        { path: 'src/handler.ts', changeKind: 'modified', hunks: [hunk(repeatedHash, 12), hunk(distinctHash, 40), hunk(repeatedHash, 90)] },
        { path: 'src/other.ts', changeKind: 'modified', hunks: [hunk(repeatedHash, 5)] },
      ],
    } as unknown as BuildReviewRubricProjection) as unknown as {
      readonly rootCauseLoci: readonly { readonly path: string; readonly contentHash: string; readonly occurrence?: number }[];
    };

    expect(references.rootCauseLoci.map(({ path, contentHash, occurrence }) => ({ path, contentHash, occurrence }))).toEqual([
      { path: 'src/handler.ts', contentHash: repeatedHash, occurrence: undefined },
      { path: 'src/handler.ts', contentHash: distinctHash, occurrence: undefined },
      { path: 'src/handler.ts', contentHash: repeatedHash, occurrence: 1 },
      { path: 'src/other.ts', contentHash: repeatedHash, occurrence: undefined },
    ]);
  });

  it('assigns occurrence ordinals to duplicate full title chains among changed tests', () => {
    const references = buildReviewFindingReferenceContext({
      rubric: 'tautology', changedFiles: [],
      changedTestSelectors: ['test/widget.test.ts'],
      changedTestTitles: [
        { selector: 'test/widget.test.ts', titleText: 'widget > persists state', staticExtractionFallback: false },
        { selector: 'test/widget.test.ts', titleText: 'widget > persists state', staticExtractionFallback: false },
        { selector: 'test/widget.test.ts', titleText: 'widget > loads state', staticExtractionFallback: false },
      ],
    } as unknown as BuildReviewRubricProjection) as unknown as {
      readonly changedTestRegions: readonly { readonly path: string; readonly contentHash: string; readonly occurrence?: number }[];
    };

    expect(references.changedTestRegions).toHaveLength(3);
    const [first, second, third] = references.changedTestRegions;
    expect(second.contentHash).toBe(first.contentHash);
    expect(first.occurrence).toBeUndefined();
    expect(second.occurrence).toBe(1);
    expect(third.occurrence).toBeUndefined();
    expect(third.contentHash).not.toBe(first.contentHash);
  });

  it('matches grader-cited occurrences against the derived context and rejects unknown or malformed ones', () => {
    const repeatedHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const hunk = (oldStart: number) => ({ oldStart, oldCount: 1, newStart: oldStart, newCount: 1, contentHash: repeatedHash });
    const references = buildReviewFindingReferenceContext({
      rubric: 'rootCause',
      changedFiles: [{ path: 'src/handler.ts', changeKind: 'modified', hunks: [hunk(12), hunk(90)] }],
    } as unknown as BuildReviewRubricProjection);
    const judged = (locus: Record<string, unknown>) => parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'rootCause', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v3',
      findings: [{
        concernKind: 'root-cause-unaddressed', summary: 'The persisted state is skipped.', evidenceLocations: ['src/handler.ts:14'],
        anchor: { rubric: 'rootCause', statedDefect: 'state is not persisted', locus, relation: 'root-cause-unaddressed' },
      }],
    }, references);
    const locus = { path: 'src/handler.ts', contentHash: repeatedHash, display: 'persistence return branch' };

    expect(judged(locus)).toMatchObject({ findings: [{ anchor: { locus: { contentHash: repeatedHash } } }] });
    expect(judged({ ...locus, occurrence: 1 })).toMatchObject({ findings: [{ anchor: { locus: { occurrence: 1 } } }] });
    expect(judged({ ...locus, occurrence: 0 })).toMatchObject({ findings: [{ anchor: { locus: { contentHash: repeatedHash } } }] });
    expect(judged({ ...locus, occurrence: 2 })).toBeUndefined();
    expect(judged({ ...locus, occurrence: -1 })).toBeUndefined();
    expect(judged({ ...locus, occurrence: 1.5 })).toBeUndefined();
    expect(judged({ ...locus, occurrence: '1' })).toBeUndefined();
  });

  it('pins the closed three-kind reference schema and rubric anchor bindings', () => {
    expect({
      kinds: buildReviewDomain.BUILD_REVIEW_FINDING_REFERENCE_KINDS,
      bindings: buildReviewDomain.BUILD_REVIEW_FINDING_REFERENCE_BINDINGS,
    }).toEqual({
      kinds: ['path', 'plan-task', 'content-region'],
      bindings: {
        tautology: { changedTest: 'content-region' },
        scope: { path: 'path' },
        rootCause: { locus: 'content-region' },
        completeness: { planTask: 'plan-task', missingSurface: 'path' },
      },
    });
  });

  // A scope violation frequently lives in a dot-leading repository directory —
  // `.docs/plans/<slug>.md` is the plan itself, the artifact this rubric exists
  // to police. Rejecting the leading dot made those findings unanchorable, so
  // the rubric could never settle no matter how many repair turns it was given.
  it.each([
    '.docs/plans/a-feature.md',
    '.github/workflows/release.yml',
    '.pipeline/events.jsonl',
    'src/conductor/src/engine/step-runners.ts',
    'docs/reference/cli.md',
  ])('accepts %s as a canonical path reference', (path) => {
    expect(parseBuildReviewCanonicalPathReference(path)).toBe(path);
  });

  // The leading dot is admitted; a dot that means traversal, an absent segment,
  // or trailing prose is still refused. These are what the leading-character
  // class was doing by accident and the lookaheads do on purpose.
  it.each([
    ['an absolute path', '/abs/path.md'],
    ['a parent traversal', '../escape.md'],
    ['an interior parent traversal', 'a/../b.md'],
    ['a trailing parent traversal', 'a/..'],
    ['a dot-directory escape', '.docs/../etc.md'],
    ['a leading current-directory segment', './relative.md'],
    ['an interior current-directory segment', 'a/./b.md'],
    ['a bare current directory', '.'],
    ['a bare parent directory', '..'],
    ['an empty interior segment', 'a//b.md'],
    ['a trailing separator', 'a/'],
    ['a path carrying prose', "src/a.ts — the close-boundary flush"],
    ['a prose plan-task title', 'Task 15: Flush the final observation'],
  ])('refuses %s', (_case, path) => {
    expect(parseBuildReviewCanonicalPathReference(path)).toBeUndefined();
  });

  it('accepts only the typed anchors belonging to each rubric', () => {
    const anchors: readonly BuildReviewFindingAnchor[] = [
      { rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'save', violationKind: 'source-text-mirror' },
      { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' },
      { rubric: 'rootCause', statedDefect: 'does not save', locus: 'src/handler.ts', relation: 'symptom-only-fix' },
      { rubric: 'completeness', planTask: '11', missingSurface: 'src/state.ts', missingOutcome: 'writes state', missingKind: 'missing-deliverable' },
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
        anchor: { rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'writes an event', violationKind: 'TEST_DOES_NOT_EXERCISE_CHANGED_BEHAVIOR' },
      }],
    })).toMatchObject({ findings: [{ concernKind: 'test-does-not-exercise-changed-behavior', anchor: { exercisedBehavior: 'writes an event', violationKind: 'test-does-not-exercise-changed-behavior' } }] });

    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'rootCause', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{
        concernKind: 'SYMPTOM_ONLY_FIX', summary: 'The defect remains.', evidenceLocations: ['src/a.ts:8'],
        anchor: { rubric: 'rootCause', statedDefect: 'events are omitted', locus: 'src/handler.ts', relation: 'SYMPTOM_ONLY_FIX' },
      }],
    })).toMatchObject({ findings: [{ concernKind: 'symptom-only-fix', anchor: { statedDefect: 'events are omitted', relation: 'symptom-only-fix' } }] });

    expect(parseBuildReviewJudgedResult({
      kind: 'judged', rubric: 'completeness', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v1',
      findings: [{
        concernKind: 'MISSING_DELIVERABLE', summary: 'A deliverable is absent.', evidenceLocations: ['src/a.ts:8'],
        anchor: { rubric: 'completeness', planTask: '4', missingSurface: 'src/result.ts', missingOutcome: 'writes the result', missingKind: 'MISSING_DELIVERABLE' },
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

  it('accepts only each rubric’s contract-defined concern-to-anchor classification pair', () => {
    const base = { kind: 'judged', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v2', summary: 'x', evidenceLocations: ['src/a.ts:1'] };
    const cases = [
      {
        valid: { rubric: 'scope', concernKind: 'out-of-plan-change', anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' } },
        invalid: { rubric: 'scope', concernKind: 'not-authorized-by-plan', anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'out-of-plan-change' } },
      },
      {
        valid: { rubric: 'tautology', concernKind: 'source-text-mirror', anchor: { rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'x', violationKind: 'source-text-mirror' } },
        invalid: { rubric: 'tautology', concernKind: 'source-text-mirror', anchor: { rubric: 'tautology', changedTest: 'test/a.test.ts', exercisedBehavior: 'x', violationKind: 'assertion-insensitive-to-production' } },
      },
      {
        valid: { rubric: 'rootCause', concernKind: 'symptom-only-fix', anchor: { rubric: 'rootCause', statedDefect: 'x', locus: 'src/a.ts', relation: 'symptom-only-fix' } },
        invalid: { rubric: 'rootCause', concernKind: 'symptom-only-fix', anchor: { rubric: 'rootCause', statedDefect: 'x', locus: 'src/a.ts', relation: 'root-cause-unaddressed' } },
      },
      {
        valid: { rubric: 'completeness', concernKind: 'missing-deliverable', anchor: { rubric: 'completeness', planTask: '1', missingSurface: 'src/a.ts', missingOutcome: 'x', missingKind: 'missing-deliverable' } },
        invalid: { rubric: 'completeness', concernKind: 'missing-deliverable', anchor: { rubric: 'completeness', planTask: '1', missingSurface: 'src/a.ts', missingOutcome: 'x', missingKind: 'other' } },
      },
    ] as const;
    for (const { valid, invalid } of cases) {
      expect(parseBuildReviewJudgedResult({ ...base, rubric: valid.rubric, findings: [{ ...valid, summary: base.summary, evidenceLocations: base.evidenceLocations }] })).toMatchObject({
        findings: [{ concernKind: valid.concernKind }],
      });
      expect(parseBuildReviewJudgedResult({ ...base, rubric: invalid.rubric, findings: [{ ...invalid, summary: base.summary, evidenceLocations: base.evidenceLocations }] })).toBeUndefined();
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

  it('maps coordinator failure reasons into the closed infrastructure failure vocabulary', () => {
    expect(buildReviewDomain.mapBuildReviewCoordinatorFailureReason).toMatchObject({
      'missing-merge-base-file': 'preflight-failed',
      'artifact-write-failed': 'artifact-write-failed',
    });
  });

  it('surfaces an unmapped coordinator reason as a contract defect without reading diagnostic detail', () => {
    const branch = {
      reason: 'unmapped-coordinator-reason',
      get detail(): never { throw new Error('detail must not contribute to the closed cause'); },
    };

    expect(() => buildReviewDomain.deriveBuildReviewInfrastructureFailureReason(
      branch as unknown as { readonly reason: buildReviewDomain.BuildReviewCoordinatorFailureReason },
    )).toThrow(/contract defect/i);
  });
});

describe('build-review judged-result contract rendering and rejection diagnosis', () => {
  const expected = { lapId: 'lap-a237', snapshotDigest: 'sha256:snap' };
  const validScopeAnchor = () => ({ rubric: 'scope' as const, path: 'src/x.ts', relation: 'not-authorized-by-plan' });
  const validScopeFinding = () => ({
    concernKind: 'not-authorized-by-plan', summary: 'The file is outside the plan.', evidenceLocations: ['src/x.ts:1'],
    anchor: validScopeAnchor(),
  });
  const validScopeResult = () => ({
    kind: 'judged', rubric: 'scope', contractVersion: 'v3', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
    findings: [],
  });

  it('renders the exact per-rubric anchor schema', () => {
    expect(renderBuildReviewJudgedResultShape('tautology')).toMatch(/^\{"findings": \[/);
    expect(renderBuildReviewJudgedResultShape('tautology')).not.toContain('"lapId"');
    expect(renderBuildReviewJudgedResultShape('tautology')).not.toContain('"snapshotDigest"');
    expect(renderBuildReviewJudgedResultShape('tautology')).not.toContain('"contractVersion"');
    expect(renderBuildReviewJudgedResultShape('tautology')).toContain(
      '"anchor": {"rubric": "tautology", "changedTest": {"path": "<repository-relative path>", "contentHash": "sha256:<normalized-test-title>", "display": "<human-readable non-coordinate label>", "occurrence": <0-based ordinal among equal-content regions in this path; omit when unique>}, "exercisedBehavior": "<canonical projection reference or report string>", "violationKind": "<one of: assertion-insensitive-to-production | test-does-not-exercise-changed-behavior | assertion-derived-from-test-data | source-text-mirror>"}',
    );
    expect(renderBuildReviewJudgedResultShape('scope')).toContain(
      '"anchor": {"rubric": "scope", "path": "<canonical projection reference or report string>", "relation": "<one of: not-authorized-by-plan>"}',
    );
    expect(renderBuildReviewJudgedResultShape('rootCause')).toContain(
      '"anchor": {"rubric": "rootCause", "statedDefect": "<canonical projection reference or report string>", "locus": {"path": "<repository-relative path>", "contentHash": "sha256:<normalized-hunk-content>", "display": "<human-readable non-coordinate label>", "occurrence": <0-based ordinal among equal-content regions in this path; omit when unique>}, "relation": "<one of: root-cause-unaddressed | symptom-only-fix | provenance-sensitive-cache-identity>"}',
    );
    expect(renderBuildReviewJudgedResultShape('completeness')).toContain(
      '"anchor": {"rubric": "completeness", "planTask": "<canonical projection reference or report string>", "missingSurface": "<canonical projection reference or report string>", "missingOutcome": "<canonical projection reference or report string>", "missingKind": "<one of: missing-deliverable>"}',
    );
  });

  it.each(['tautology', 'scope', 'rootCause', 'completeness'] as const)('renders every allowed %s vocabulary member into its dispatch schema', (rubric) => {
    const shape = renderBuildReviewJudgedResultShape(rubric);
    const vocabulary = BUILD_REVIEW_FINDING_VOCABULARIES[rubric];
    const allowedMembers = vocabulary.concernKinds.join(' | ');

    expect(shape).toContain(`"concernKind": "<one of: ${allowedMembers}>"`);
    for (const [classificationField, members] of Object.entries(vocabulary.anchorFields)) {
      const anchorMembers = members.filter((member) => member !== 'out-of-plan-change').join(' | ');
      expect(shape).toContain(`"${classificationField}": "<one of: ${anchorMembers}>"`);
    }
  });

  it('has no other-style catch-all member in any finding vocabulary', () => {
    expect(
      Object.values(BUILD_REVIEW_FINDING_VOCABULARIES)
        .flatMap((vocabulary) => vocabulary.members)
        .some((member) => /(?:^|[-_])other(?:$|[-_])/.test(member)),
    ).toBe(false);
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
      kind: 'judged', rubric: 'scope', contractVersion: 'v3', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      findings: [], verdict: 'FAIL',
    }, 'scope', expected)).toContain('contradicts the findings array');
  });

  it('preserves a provider-owned tautology relocationAudit through the engine stamp', () => {
    const projection = {
      rubric: 'tautology', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      changedFiles: [], changedTestSelectors: [],
    } as unknown as BuildReviewRubricProjection;
    const relocationAudit = ['[relocation-audit] EXEMPTED: test/fixture/c.md → test/fixture/docs/c.md; production hunk(s) do force the move'];

    // The audit is contract-required evidence on fixture-relocation results
    // (persisted in the artifact, consumed by the aggregate). The stamp must
    // carry it through, not silently discard it with the other provider-owned
    // envelope fields.
    const stamped = stampBuildReviewDispatchedCandidate(
      { findings: [], relocationAudit }, 'tautology', projection,
    ) as Record<string, unknown>;
    expect(stamped.relocationAudit).toEqual(relocationAudit);
    expect(parseBuildReviewJudgedResult(stamped)).toMatchObject({ verdict: 'PASS', relocationAudit });

    // Absent stays absent — the stamp never manufactures audit evidence.
    const bare = stampBuildReviewDispatchedCandidate(
      { findings: [] }, 'tautology', projection,
    ) as Record<string, unknown>;
    expect('relocationAudit' in bare).toBe(false);

    // A non-tautology payload smuggling an audit is rejected with the named
    // problem, not silently laundered by the stamp.
    const smuggled = stampBuildReviewDispatchedCandidate(
      { findings: [], relocationAudit }, 'scope', projection,
    );
    expect(describeBuildReviewJudgedResultRejection(smuggled, 'scope', expected))
      .toContain('"relocationAudit" must be absent or empty for rubric scope');
  });

  it('diagnoses a findings-only provider response under its engine-stamped v3 envelope', () => {
    const projection = {
      rubric: 'tautology', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      changedFiles: [], changedTestSelectors: ['test/widget.test.ts'],
    } as unknown as BuildReviewRubricProjection;
    const candidate = stampBuildReviewDispatchedCandidate({
      // Providers own findings only. Missing envelope keys must be restored
      // from the projection before both validation and diagnosis.
      findings: [{
        concernKind: 'source-text-mirror', summary: 'The assertion mirrors source text.', evidenceLocations: ['test/widget.test.ts:8'],
        anchor: {
          rubric: 'tautology', changedTest: 'test/widget.test.ts',
          exercisedBehavior: 'writes state', violationKind: 'source-text-mirror',
        },
      }],
    }, 'tautology', projection);
    const rejection = describeBuildReviewDispatchedResultRejection(candidate, 'tautology', projection);

    expect(candidate).toMatchObject({
      kind: 'judged', rubric: 'tautology', contractVersion: 'v3',
      lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
    });
    expect(rejection).not.toMatch(/top-level "kind"|"rubric" must be|"contractVersion" must be|"lapId" must echo|"snapshotDigest" must echo/);
    // A string selector was accepted by the pre-v3 grammar. The v3-stamped
    // candidate must diagnose it as the required content-region reference.
    expect(rejection).toContain('findings[0].anchor.changedTest must be a content-region reference');
  });

  it('distinguishes an unexplained finding-classification rejection from a supplied verdict contradiction', () => {
    const withoutVerdict = describeBuildReviewJudgedResultRejection({
      kind: 'judged', rubric: 'rootCause', contractVersion: 'v3', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      // Both classifications are valid, but they must agree.
      findings: [{
        concernKind: 'symptom-only-fix', summary: 'The change repairs only a symptom.', evidenceLocations: ['src/x.ts:1'],
        anchor: {
          rubric: 'rootCause', statedDefect: 'The root cause remains.',
          locus: { path: 'src/x.ts', contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', display: 'changed branch' },
          relation: 'root-cause-unaddressed',
        },
      }],
    }, 'rootCause', expected);
    const withContradictoryVerdict = describeBuildReviewJudgedResultRejection({
      kind: 'judged', rubric: 'scope', contractVersion: 'v3', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      findings: [], verdict: 'FAIL',
    }, 'scope', expected);

    expect(withoutVerdict).toContain('no enumerated check explains why');
    expect(withoutVerdict).not.toMatch(/contradicts the findings array/);
    expect(withContradictoryVerdict).toContain('contradicts the findings array');
  });

  const diagnoseWithReferences = describeBuildReviewJudgedResultRejection as unknown as (
    value: unknown,
    rubric: 'scope' | 'completeness' | 'rootCause',
    expected: { readonly lapId: string; readonly snapshotDigest: string },
    references: unknown,
  ) => string;
  const membershipRejectionCases = [
    ['changed path', 'scope', {
      ...validScopeResult(),
      findings: [{
        ...validScopeFinding(), concernKind: 'not-authorized-by-plan',
        anchor: { ...validScopeAnchor(), path: 'src/absent.ts' },
      }],
    }, { changedTests: [], changedPaths: ['src/changed.ts'], planTasks: [] }, 'findings[0].anchor.path must reference a changed path in the projection'],
    ['plan task', 'completeness', {
      kind: 'judged', rubric: 'completeness', contractVersion: 'v3', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      findings: [{
        concernKind: 'missing-deliverable', summary: 'The requested output is absent.', evidenceLocations: ['src/task.ts:1'],
        anchor: { rubric: 'completeness', planTask: '8', missingSurface: 'src/task.ts', missingOutcome: 'writes output', missingKind: 'missing-deliverable' },
      }],
    }, { changedTests: [], changedPaths: [], planTasks: ['7'], planTaskSurfaces: { '7': ['src/task.ts'] } }, 'findings[0].anchor.planTask must reference a plan task in the projection'],
    ['missing surface ownership', 'completeness', {
      kind: 'judged', rubric: 'completeness', contractVersion: 'v3', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      findings: [{
        concernKind: 'missing-deliverable', summary: 'The requested output is absent.', evidenceLocations: ['src/not-owned.ts:1'],
        anchor: { rubric: 'completeness', planTask: '7', missingSurface: 'src/not-owned.ts', missingOutcome: 'writes output', missingKind: 'missing-deliverable' },
      }],
    }, { changedTests: [], changedPaths: [], planTasks: ['7'], planTaskSurfaces: { '7': ['src/owned.ts'] } }, 'findings[0].anchor.missingSurface must be owned by the referenced plan task'],
    ['content-region hash', 'rootCause', {
      kind: 'judged', rubric: 'rootCause', contractVersion: 'v3', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      findings: [{
        concernKind: 'root-cause-unaddressed', summary: 'The changed path does not repair the cause.', evidenceLocations: ['src/handler.ts:1'],
        anchor: {
          rubric: 'rootCause', statedDefect: 'the state is stale', relation: 'root-cause-unaddressed',
          locus: { path: 'src/handler.ts', contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', display: 'stale state branch' },
        },
      }],
    }, {
      changedTests: [], changedPaths: [], planTasks: [],
      rootCauseLoci: [{ path: 'src/handler.ts', contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', display: 'persisted state branch' }],
    }, 'findings[0].anchor.locus must reference a projected content region'],
  ] as const;
  it.each(membershipRejectionCases)('diagnoses the rejected %s reference specifically', (_kind, rubric, result, references, diagnostic) => {
    expect(diagnoseWithReferences(result, rubric, expected, references)).toContain(diagnostic);
  });

  it('distinguishes absent, wrong-type, non-canonical, and bounded anchor field values', () => {
    const completenessResult = (planTask: unknown, includePlanTask = true) => ({
      kind: 'judged', rubric: 'completeness', contractVersion: 'v3', lapId: expected.lapId, snapshotDigest: expected.snapshotDigest,
      findings: [{
        concernKind: 'missing-deliverable', summary: 'The requested output is absent.', evidenceLocations: ['src/task.ts:1'],
        anchor: {
          rubric: 'completeness', missingSurface: 'src/task.ts', missingOutcome: 'writes output', missingKind: 'missing-deliverable',
          ...(includePlanTask ? { planTask } : {}),
        },
      }],
    });
    const longPlanTask = `the ${'x'.repeat(512)}`;

    expect(describeBuildReviewJudgedResultRejection(completenessResult(undefined, false), 'completeness', expected)).toContain('findings[0].anchor.planTask is required');
    expect(describeBuildReviewJudgedResultRejection(completenessResult(7), 'completeness', expected)).toContain('findings[0].anchor.planTask must be a string (got 7)');
    expect(describeBuildReviewJudgedResultRejection(completenessResult('the install channel resolution step'), 'completeness', expected)).toContain('findings[0].anchor.planTask must be a canonical plan-task reference');
    expect(describeBuildReviewJudgedResultRejection(completenessResult(longPlanTask), 'completeness', expected)).toMatch(/planTask.*"the x{59}…"/);
  });

  const rejectionCases: ReadonlyArray<readonly [string, () => unknown, string]> = [
    ['non-object result', () => 'just prose', 'not a single JSON object'],
    ['kind', () => ({ ...validScopeResult(), kind: 'result' }), 'top-level "kind"'],
    ['rubric', () => ({ ...validScopeResult(), rubric: 'rootCause' }), '"rubric" must be "scope"'],
    ['lap id', () => ({ ...validScopeResult(), lapId: 'lap-other' }), 'must echo the projection\'s lapId'],
    ['contract version', () => ({ ...validScopeResult(), contractVersion: 'v2' }), '"contractVersion" must be "v3"'],
    ['snapshot digest', () => ({ ...validScopeResult(), snapshotDigest: 'sha256:other' }), '"snapshotDigest" must echo'],
    ['findings array', () => ({ ...validScopeResult(), findings: 'none' }), '"findings" must be an array'],
    ['finding object', () => ({ ...validScopeResult(), findings: ['not an object'] }), 'findings[0] is not an object'],
    ['concern kind presence', () => ({ ...validScopeResult(), findings: [{ ...validScopeFinding(), concernKind: '' }] }), 'findings[0].concernKind must be a non-empty string'],
    ['concern kind vocabulary', () => ({ ...validScopeResult(), findings: [{ ...validScopeFinding(), concernKind: 'unknown' }] }), 'findings[0].concernKind must be one of'],
    ['summary', () => ({ ...validScopeResult(), findings: [{ ...validScopeFinding(), summary: '' }] }), 'findings[0].summary must be a non-empty string'],
    ['evidence locations', () => ({ ...validScopeResult(), findings: [{ ...validScopeFinding(), evidenceLocations: [] }] }), 'findings[0].evidenceLocations must be a non-empty array'],
    ['anchor presence', () => ({ ...validScopeResult(), findings: [{ ...validScopeFinding(), anchor: undefined }] }), 'findings[0].anchor is required'],
    ['anchor rubric', () => ({ ...validScopeResult(), findings: [{ ...validScopeFinding(), anchor: { ...validScopeAnchor(), rubric: 'rootCause' } }] }), 'findings[0].anchor.rubric must be "scope"'],
    ['anchor field presence', () => ({ ...validScopeResult(), findings: [{ ...validScopeFinding(), anchor: { ...validScopeAnchor(), path: '' } }] }), 'findings[0].anchor.path must be a non-empty string'],
    ['anchor classification vocabulary', () => ({ ...validScopeResult(), findings: [{ ...validScopeFinding(), anchor: { ...validScopeAnchor(), relation: 'unknown' } }] }), 'findings[0].anchor.relation must be one of'],
    ['relocation audit', () => ({ ...validScopeResult(), relocationAudit: ['unexpected'] }), '"relocationAudit" must be absent or empty for rubric scope'],
    ['verdict contradiction', () => ({ ...validScopeResult(), verdict: 'FAIL' }), 'contradicts the findings array'],
    ['passed contradiction', () => ({ ...validScopeResult(), passed: false }), 'contradicts the findings array'],
  ];
  it.each(rejectionCases)('retains the %s rejection diagnosis', (_cause, candidate, diagnostic) => {
    expect(describeBuildReviewJudgedResultRejection(candidate(), 'scope', expected)).toContain(diagnostic);
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
