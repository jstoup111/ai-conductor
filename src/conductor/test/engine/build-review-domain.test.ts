import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_FINDING_VOCABULARIES,
  buildReviewFindingReferenceContext,
  deriveBuildReviewInfrastructureFailureReason,
  makeBuildReviewDispatchFailure,
  mapBuildReviewCoordinatorFailureReason,
  parseBuildReviewCanonicalPathReference,
  parseBuildReviewDispatchFailure,
  parseBuildReviewFindingAnchor,
  parseBuildReviewInfrastructureFailure,
  parseBuildReviewJudgedResult,
  parseBuildReviewLapId,
  parseBuildReviewRubricContractVersion,
  parseBuildReviewRubricResult,
  parseBuildReviewSkip,
  renderBuildReviewJudgedResultShape,
  type BuildReviewInfrastructureFailureReason, describeBuildReviewJudgedResultRejection } from '../../src/engine/build-review-domain.js';
import type { BuildReviewRubricProjection } from '../../src/engine/build-review-projections.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const locus = { path: 'test/widget.test.ts', contentHash: HASH, display: 'widget persists state' };

function judged(findings: readonly unknown[], rest: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'judged', rubric: 'testQuality', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v3', findings, ...rest };
}

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    concernKind: 'test-insensitive', summary: 'The assertion passes against reverted production.',
    evidenceLocations: ['test/widget.test.ts:8'], anchor: { rubric: 'testQuality', locus }, ...overrides,
  };
}

function titleHash(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

describe('build-review domain', () => {
  it('brands lap identities from the closed grammar', () => {
    expect(parseBuildReviewLapId('lap-20260813-01')).toBe('lap-20260813-01');
    expect(parseBuildReviewLapId('lap.x_y-Z9')).toBe('lap.x_y-Z9');
    expect(parseBuildReviewLapId('a'.repeat(128))).toBe('a'.repeat(128));
    expect(parseBuildReviewLapId('')).toBeUndefined();
    expect(parseBuildReviewLapId('lap with spaces')).toBeUndefined();
    expect(parseBuildReviewLapId('-leading-separator')).toBeUndefined();
    expect(parseBuildReviewLapId('a'.repeat(129))).toBeUndefined();
    expect(parseBuildReviewLapId(1)).toBeUndefined();
  });

  it('accepts only the three known rubric-contract versions', () => {
    expect(parseBuildReviewRubricContractVersion('v1')).toBe('v1');
    expect(parseBuildReviewRubricContractVersion('v2')).toBe('v2');
    expect(parseBuildReviewRubricContractVersion('v3')).toBe('v3');
    expect(parseBuildReviewRubricContractVersion('v4')).toBeUndefined();
    expect(parseBuildReviewRubricContractVersion('V3')).toBeUndefined();
    expect(parseBuildReviewRubricContractVersion(3)).toBeUndefined();
  });

  it('accepts canonical repository-relative paths and refuses absolute, traversal, dot-relative, and prose forms', () => {
    for (const path of ['src/a.ts', '.docs/plans/x.md', 'a/.hidden', 'src/@scope/x+y-z_1.ts', 'README']) {
      expect(parseBuildReviewCanonicalPathReference(path), path).toBe(path);
    }
    for (const path of [
      '/abs/x.ts', '../x.ts', 'a/../b.ts', './a.ts', 'a/./b.ts',
      ' src/a.ts', 'src/a.ts ', '`src/a.ts`', 'The file src/a.ts', 'a b', '-x', '', 42, null,
    ]) {
      expect(parseBuildReviewCanonicalPathReference(path), JSON.stringify(path)).toBeUndefined();
    }
  });

  it('rejects malformed content-region loci at the grader anchor boundary', () => {
    expect(parseBuildReviewFindingAnchor({ rubric: 'testQuality', locus })).toEqual({ rubric: 'testQuality', locus });
    expect(parseBuildReviewFindingAnchor({ rubric: 'testQuality', locus: { ...locus, occurrence: 2 } })).toEqual({ rubric: 'testQuality', locus: { ...locus, occurrence: 2 } });

    const { path: _path, ...withoutPath } = locus;
    const { contentHash: _hash, ...withoutHash } = locus;
    const { display: _display, ...withoutDisplay } = locus;
    const rejected = [
      withoutPath, withoutHash, withoutDisplay,
      { ...locus, path: '/test/widget.test.ts' }, { ...locus, path: '' },
      { ...locus, contentHash: '' }, { ...locus, contentHash: '   ' }, { ...locus, contentHash: 42 },
      { ...locus, display: '' }, { ...locus, display: '  ' },
      { ...locus, occurrence: -1 }, { ...locus, occurrence: 1.5 }, { ...locus, occurrence: '1' },
      'test/widget.test.ts', null,
    ];

    expect(rejected.map((candidate) => parseBuildReviewFindingAnchor({ rubric: 'testQuality', locus: candidate }))).toEqual(Array(rejected.length).fill(undefined));
    expect(parseBuildReviewFindingAnchor({ rubric: 'tautology', locus })).toBeUndefined();
    expect(parseBuildReviewFindingAnchor({ rubric: 'testQuality' })).toBeUndefined();
    // The skill contract's 0-based ordinal: an explicit 0 is the unique/first
    // region and normalizes away, so it can never mint a second identity.
    expect(parseBuildReviewFindingAnchor({ rubric: 'testQuality', locus: { ...locus, occurrence: 0 } })).toEqual(
      parseBuildReviewFindingAnchor({ rubric: 'testQuality', locus }),
    );
    expect(parseBuildReviewFindingAnchor({ rubric: 'testQuality', locus: { ...locus, occurrence: 2 } })).toEqual({ rubric: 'testQuality', locus: { ...locus, occurrence: 2 } });
  });

  it('stamps occurrence ordinals onto duplicate titles in one path so each region is citable', () => {
    const projection = {
      rubric: 'testQuality', changedTestSelectors: ['test/dup.test.ts'], changedFiles: [],
      changedTestTitles: [
        { selector: 'test/dup.test.ts', titleText: 'same title' },
        { selector: 'test/dup.test.ts', titleText: 'same title' },
        { selector: 'test/dup.test.ts', titleText: 'other title' },
        { selector: 'test/other.test.ts', titleText: 'same title' },
      ],
    } as unknown as Parameters<typeof buildReviewFindingReferenceContext>[0];
    const hash = (title: string) => `sha256:${createHash('sha256').update(title).digest('hex')}`;

    const references = buildReviewFindingReferenceContext(projection);

    expect(references.changedTestRegions).toEqual([
      { path: 'test/dup.test.ts', contentHash: hash('same title'), display: 'same title' },
      { path: 'test/dup.test.ts', contentHash: hash('same title'), display: 'same title', occurrence: 1 },
      { path: 'test/dup.test.ts', contentHash: hash('other title'), display: 'other title' },
      { path: 'test/other.test.ts', contentHash: hash('same title'), display: 'same title' },
    ]);
    const cite = (occurrence?: number) => parseBuildReviewFindingAnchor(
      { rubric: 'testQuality', locus: { path: 'test/dup.test.ts', contentHash: hash('same title'), display: 'same title', ...(occurrence === undefined ? {} : { occurrence }) } },
      references,
    );
    expect(cite()).toBeDefined();
    expect(cite(0)).toEqual(cite());
    expect(cite(1)).toMatchObject({ locus: { occurrence: 1 } });
    expect(cite(2)).toBeUndefined();
  });

  it('names each enumerated contract problem in a rejection so the repair turn can act on it', () => {
    const expected = { lapId: 'lap-1', snapshotDigest: 'sha256:snapshot' };
    const locus = { path: 'test/widget.test.ts', contentHash: `sha256:${'a'.repeat(64)}`, display: 'widget renders' };
    const valid = { concernKind: 'test-insensitive', summary: 'Passes against a stub.', evidenceLocations: ['test/widget.test.ts:3'], anchor: { rubric: 'testQuality', locus } };
    const describe = (value: unknown, references?: Parameters<typeof describeBuildReviewJudgedResultRejection>[3]) =>
      describeBuildReviewJudgedResultRejection(value, 'testQuality', expected, references);

    expect(describe('not an object')).toBe('the result is not a single JSON object');
    expect(describe({ kind: 'result', rubric: 'scope', lapId: 'lap-2', contractVersion: 'v2', snapshotDigest: 'sha256:other', findings: 'none' })).toBe([
      'top-level "kind" must be exactly the string "judged" (got "result")',
      '"rubric" must be "testQuality"',
      '"lapId" must echo the projection\'s lapId "lap-1" verbatim',
      '"contractVersion" must be "v3"',
      '"snapshotDigest" must echo the projection\'s snapshotDigest verbatim',
      '"findings" must be an array (empty when no concern was found)',
    ].join('; '));
    const envelope = (findings: unknown[]) => ({ kind: 'judged', rubric: 'testQuality', contractVersion: 'v3', findings, ...expected });
    expect(describe(envelope([{ kind: 'test-insensitive', summary: '', evidenceLocations: [], rubric: 'testQuality', locus }]))).toBe([
      'findings[0].concernKind must be a non-empty string (never "kind")',
      'findings[0].summary must be a non-empty string',
      'findings[0].evidenceLocations must be a non-empty array of "path:line" strings',
      'findings[0].anchor is required: a nested object {"rubric": "testQuality", "locus": {"path", "contentHash", "display"}} — never flattened top-level fields, and never an alternate name such as "anchors"',
    ].join('; '));
    expect(describe(envelope([{ ...valid, concernKind: 'symptom-only-fix', anchor: { rubric: 'tautology', locus: { ...locus, path: '' } } }]))).toBe([
      'findings[0].concernKind must be one of "test-insensitive" (got "symptom-only-fix")',
      'findings[0].anchor.rubric must be "testQuality"',
      'findings[0].anchor.locus must be a content-region reference {"path", "contentHash", "display", "occurrence"?}',
    ].join('; '));
    expect(describe(envelope([valid]), { changedTests: [], changedTestRegions: [{ ...locus, path: 'test/other.test.ts' }], changedPaths: [], planTasks: [] })).toBe(
      'findings[0].anchor.locus must reference a projected in-scope content region (path, contentHash, and occurrence must match one)',
    );
    expect(describe(envelope([valid, { ...valid, summary: 'Reworded.' }]))).toBe(
      'findings must not repeat one concern on one content region (duplicated: "widget renders") — merge equivalent findings',
    );
    // Bounded: six named problems, then a count.
    const many = envelope(Array.from({ length: 8 }, () => ({ summary: 'x' })));
    expect(describe(many)).toMatch(/; and \d+ more problem\(s\)$/);
  });

  it('retains each finding actionable summary and concrete evidence locations and derives the verdict', () => {
    const pass = parseBuildReviewJudgedResult(judged([]));
    const fail = parseBuildReviewJudgedResult(judged([finding()]));

    expect(pass).toEqual({
      kind: 'judged', rubric: 'testQuality', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v3', findings: [], verdict: 'PASS',
    });
    expect(fail).toMatchObject({ verdict: 'FAIL', findings: [finding()] });
    expect(Object.isFrozen(fail?.findings)).toBe(true);
  });

  it('accepts an optional normalized counterfactualSensitivity from its closed vocabulary', () => {
    for (const counterfactualSensitivity of ['supports', 'indeterminate', 'not-applicable']) {
      expect(parseBuildReviewJudgedResult(judged([], { counterfactualSensitivity })), counterfactualSensitivity).toMatchObject({
        contractVersion: 'v3', counterfactualSensitivity,
      });
    }

    expect(parseBuildReviewJudgedResult(judged([]))).toEqual({
      kind: 'judged', rubric: 'testQuality', lapId: 'lap-1', snapshotDigest: 'sha256:abc', contractVersion: 'v3', findings: [], verdict: 'PASS',
    });
  });

  it('rejects invalid counterfactualSensitivity values with a named contract problem', () => {
    const expected = { lapId: 'lap-1', snapshotDigest: 'sha256:abc' };

    for (const counterfactualSensitivity of ['unknown', 42]) {
      const candidate = judged([], { counterfactualSensitivity });
      expect(parseBuildReviewJudgedResult(candidate), JSON.stringify(counterfactualSensitivity)).toBeUndefined();
      expect(describeBuildReviewJudgedResultRejection(candidate, 'testQuality', expected), JSON.stringify(counterfactualSensitivity)).toContain('counterfactualSensitivity');
    }
  });

  it('requires a non-empty summary and non-empty evidence locations on every finding', () => {
    const rejected = [
      finding({ summary: '' }), finding({ summary: '   ' }), finding({ summary: undefined }),
      finding({ evidenceLocations: [] }), finding({ evidenceLocations: [''] }), finding({ evidenceLocations: ['test/widget.test.ts:8', ' '] }),
      finding({ evidenceLocations: 'test/widget.test.ts:8' }),
      finding({ concernKind: 'source-text-mirror' }), finding({ concernKind: undefined }),
      finding({ anchor: { rubric: 'testQuality', locus: { ...locus, display: '' } } }),
      null,
    ];

    for (const entry of rejected) expect(parseBuildReviewJudgedResult(judged([finding(), entry])), JSON.stringify(entry)).toBeUndefined();
    expect(parseBuildReviewJudgedResult(judged([finding({ concernKind: 'TEST_INSENSITIVE' })]))).toMatchObject({ findings: [{ concernKind: 'test-insensitive' }] });
  });

  it('rejects judged envelopes with the wrong rubric, an invalid lap, a blank snapshot, or an unknown contract', () => {
    expect(parseBuildReviewJudgedResult(judged([], { rubric: 'tautology' }))).toBeUndefined();
    expect(parseBuildReviewJudgedResult(judged([], { lapId: 'lap with spaces' }))).toBeUndefined();
    expect(parseBuildReviewJudgedResult(judged([], { snapshotDigest: ' ' }))).toBeUndefined();
    expect(parseBuildReviewJudgedResult(judged([], { contractVersion: 'v4' }))).toBeUndefined();
    expect(parseBuildReviewJudgedResult(judged([], { kind: 'skipped' }))).toBeUndefined();
    expect(parseBuildReviewJudgedResult({ ...judged([]), findings: 'none' })).toBeUndefined();
  });

  it('keeps skips a closed vocabulary that round-trips through the rubric-result parser', () => {
    const skip = { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' };

    expect(parseBuildReviewSkip(skip)).toEqual(skip);
    expect(parseBuildReviewRubricResult(skip)).toEqual(skip);
    expect(parseBuildReviewSkip({ ...skip, reason: 'operator-choice' })).toBeUndefined();
    expect(parseBuildReviewSkip({ ...skip, reason: 'missing-entry-points' })).toBeUndefined();
    expect(parseBuildReviewSkip({ ...skip, rubric: 'wiring' })).toBeUndefined();
    expect(parseBuildReviewSkip({ ...skip, kind: 'judged' })).toBeUndefined();
  });

  it('keeps infrastructure failures a closed vocabulary that round-trips through the rubric-result parser', () => {
    const reasons = [...new Set(Object.values(mapBuildReviewCoordinatorFailureReason))];
    for (const reason of reasons) {
      const failure = { kind: 'infrastructure-failure', rubric: 'testQuality', reason, detail: 'provider unavailable' };
      expect(parseBuildReviewInfrastructureFailure(failure), reason).toEqual(failure);
      expect(parseBuildReviewRubricResult(failure), reason).toEqual(failure);
    }
    const base = { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'provider-error', detail: 'provider unavailable' };
    expect(parseBuildReviewInfrastructureFailure({ ...base, reason: 'ignored' })).toBeUndefined();
    expect(parseBuildReviewInfrastructureFailure({ ...base, reason: 'no-changed-tests' })).toBeUndefined();
    expect(parseBuildReviewInfrastructureFailure({ ...base, detail: '' })).toBeUndefined();
    expect(parseBuildReviewInfrastructureFailure({ ...base, rubric: 'scope' })).toBeUndefined();
    expect(parseBuildReviewRubricResult({ ...base, reason: 'ignored' })).toBeUndefined();
  });

  it('maps every coordinator failure reason into the closed infrastructure vocabulary', () => {
    const closed: readonly BuildReviewInfrastructureFailureReason[] = [
      'provider-error', 'retry-exhausted', 'missing-artifact', 'malformed-artifact', 'stale-artifact',
      'identity-mismatch', 'preflight-failed', 'artifact-read-failed', 'artifact-write-failed',
    ];

    expect(mapBuildReviewCoordinatorFailureReason).toMatchObject({
      'no-changed-tests': 'preflight-failed', 'missing-merge-base-file': 'preflight-failed', 'scoped-run-timeout': 'preflight-failed',
      'cache-read-failed': 'artifact-read-failed', 'cache-write-failed': 'artifact-write-failed', 'artifact-write-failed': 'artifact-write-failed',
      'projection-rubric-mismatch': 'malformed-artifact', 'invalid-provider-result': 'malformed-artifact',
      'provider-error': 'provider-error', 'missing-settlement': 'missing-artifact',
    });
    for (const [coordinatorReason, infrastructureReason] of Object.entries(mapBuildReviewCoordinatorFailureReason)) {
      expect(closed, coordinatorReason).toContain(infrastructureReason);
      expect(deriveBuildReviewInfrastructureFailureReason({ reason: coordinatorReason as keyof typeof mapBuildReviewCoordinatorFailureReason })).toBe(infrastructureReason);
    }
  });

  it('renders every test-quality vocabulary member into the dispatch shape with no catch-all', () => {
    const shape = renderBuildReviewJudgedResultShape('testQuality');
    const vocabulary = BUILD_REVIEW_FINDING_VOCABULARIES.testQuality;

    expect(vocabulary.concernKinds.length).toBeGreaterThan(0);
    for (const member of [...vocabulary.members, ...vocabulary.concernKinds]) expect(shape).toContain(member);
    expect(shape).toContain('rubric: "testQuality"');
    expect(shape).toContain('contractVersion: "v3"');
    expect(shape).toContain('contentHash');
    expect(shape).not.toMatch(/(?:^|[-_"\s])other(?:$|[-_"\s])/);
    expect([...vocabulary.members, ...vocabulary.concernKinds].some((member) => /(?:^|[-_])other(?:$|[-_])/.test(member))).toBe(false);
  });

  it('round-trips a dispatch-failure report and rejects other shapes', () => {
    const report = makeBuildReviewDispatchFailure('contract not satisfied; excerpt: ...');

    expect(report).toEqual({ kind: 'dispatch-failure', detail: 'contract not satisfied; excerpt: ...' });
    expect(parseBuildReviewDispatchFailure(report)).toEqual(report);
    expect(parseBuildReviewDispatchFailure({ kind: 'dispatch-failure', detail: '' })).toBeUndefined();
    expect(parseBuildReviewDispatchFailure({ kind: 'dispatch-failure', detail: '  ' })).toBeUndefined();
    expect(parseBuildReviewDispatchFailure({ kind: 'judged' })).toBeUndefined();
    expect(parseBuildReviewDispatchFailure(undefined)).toBeUndefined();
    expect(parseBuildReviewDispatchFailure('dispatch-failure')).toBeUndefined();
  });

  describe('finding reference context', () => {
    const projection = {
      rubric: 'testQuality',
      changedTestSelectors: ['test/widget.test.ts', 'test/loader.test.ts'],
      changedFiles: [{ path: 'src/widget.ts', changeKind: 'modified', hunks: [] }, { path: 'test/widget.test.ts', changeKind: 'modified', hunks: [] }],
      changedTestTitles: [
        { selector: 'test/widget.test.ts', titleText: 'widget > persists state', staticExtractionFallback: false },
        { selector: 'test/loader.test.ts', titleText: '', staticExtractionFallback: true },
        { selector: '/absolute/ignored.test.ts', titleText: 'ignored', staticExtractionFallback: false },
      ],
    } as unknown as BuildReviewRubricProjection;

    it('builds content regions from declared titles, hashing the selector on static fallback', () => {
      const references = buildReviewFindingReferenceContext(projection);

      expect(references).toEqual({
        changedTests: ['test/widget.test.ts', 'test/loader.test.ts'],
        changedTestRegions: [
          { path: 'test/widget.test.ts', contentHash: titleHash('widget > persists state'), display: 'widget > persists state' },
          { path: 'test/loader.test.ts', contentHash: titleHash('test/loader.test.ts'), display: 'test/loader.test.ts changed test' },
        ],
        changedPaths: ['src/widget.ts', 'test/widget.test.ts'],
        planTasks: [],
      });
      expect(buildReviewFindingReferenceContext({ ...projection, changedTestTitles: undefined } as unknown as BuildReviewRubricProjection).changedTestRegions).toEqual([]);
    });

    it('accepts only a locus that names a projected content region when references are supplied', () => {
      const references = buildReviewFindingReferenceContext(projection);
      const region = references.changedTestRegions![0]!;
      const cite = (candidate: unknown) => parseBuildReviewFindingAnchor({ rubric: 'testQuality', locus: candidate }, references);

      expect(cite(region)).toEqual({ rubric: 'testQuality', locus: region });
      expect(cite({ ...region, display: 'a different human label' })).toEqual({ rubric: 'testQuality', locus: { ...region, display: 'a different human label' } });
      expect(cite({ ...region, contentHash: HASH })).toBeUndefined();
      expect(cite({ ...region, path: 'test/other.test.ts' })).toBeUndefined();
      expect(cite({ ...region, occurrence: 1 })).toBeUndefined();
      expect(parseBuildReviewJudgedResult(judged([finding({ anchor: { rubric: 'testQuality', locus } })]), references)).toBeUndefined();
      expect(parseBuildReviewJudgedResult(judged([finding({ anchor: { rubric: 'testQuality', locus: region } })]), references)).toMatchObject({ verdict: 'FAIL' });
      expect(parseBuildReviewJudgedResult(judged([finding({ anchor: { rubric: 'testQuality', locus } })]), { ...references, changedTestRegions: undefined })).toMatchObject({ verdict: 'FAIL' });
    });
  });
});
