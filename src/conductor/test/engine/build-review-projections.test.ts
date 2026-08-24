import { describe, expect, it } from 'vitest';

import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import {
  BUILD_REVIEW_PROVENANCE_KEYS,
  canonicalJson,
  deriveBuildReviewRubricProjections,
  deriveChangedFileReferences,
  projectionDigest,
  type BuildReviewProjectionSource,
  type TestQualityProjection,
} from '../../src/engine/build-review-projections.js';

// The reduced-coverage publication contract and cache-identity behaviour are
// covered by test/engine/build-review-cache.test.ts and the coordinator tests;
// this file pins projection derivation itself.

const lapId = parseBuildReviewLapId('lap-1')!;

const FIXTURE_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' context',
  '+embedded-diff-body-line',
  '',
].join('\n');

type Source = BuildReviewProjectionSource;

function source(overrides: Partial<Source> = {}): Source {
  return {
    lapId,
    inputs: {
      diff: FIXTURE_DIFF,
      planBody: '# Approved plan\n',
      mergeBase: 'base', baseRef: 'origin/main', baseKind: 'remote', trackingRefSha: 'base', remoteHeadSha: 'base', fresh: true,
      testSuiteProof: {
        provenanceHeadSha: 'head', outcome: 'PASS', reason: 'exit_zero', fingerprint: 'sha256:suite',
        startedAt: '2026-08-15T11:00:00.000Z', endedAt: '2026-08-15T11:00:05.000Z', durationMs: 5_000,
        stdout: 'full suite stdout', stderr: 'full suite stderr',
      },
      sourceSnapshot: {
        digest: 'sha256:snapshot', contentDigest: 'sha256:content', baseRef: 'origin/main', mergeBase: 'base', headSha: 'head',
        diff: FIXTURE_DIFF, planBody: '# Approved plan\n',
        changedTestTitles: [{ selector: 'test/a.test.ts', titleText: 'a > persists', staticExtractionFallback: false }],
      },
    } as unknown as Source['inputs'],
    testQuality: {
      changedTestSelectors: ['test/b.test.ts', 'test/a.test.ts'],
      unresolvedMarkers: [{ selector: 'test/b.test.ts', reference: 'other-feature' }, { selector: 'test/a.test.ts', reference: 'another-feature' }],
      revertedProductionManifest: [
        { path: 'src/b.ts', mergeBaseBlobSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
        { path: 'src/a.ts', mergeBaseBlobSha: 'e79120aab4682bfe81153595c7d2ec1ad3bd3dd8' },
      ],
      preflight: {
        classification: 'red', cacheable: true, cacheProvenance: 'miss',
        sourceIdentities: { mergeBase: 'base', headSha: 'head' },
        output: { stdout: 'counterfactual stdout', stderr: 'counterfactual stderr' },
        scopedRun: { exitCode: 1, runKind: 'nonzero-exit', ranSelectors: ['test/a.test.ts'], failureExcerpt: 'AssertionError' },
      } as unknown as Source['testQuality']['preflight'],
    },
    ...overrides,
  };
}

function withSnapshot(src: Source, patch: Record<string, unknown>): Source {
  return { ...src, inputs: { ...src.inputs, sourceSnapshot: { ...src.inputs.sourceSnapshot, ...patch } as Source['inputs']['sourceSnapshot'] } };
}

function withProof(src: Source, patch: Record<string, unknown>): Source {
  return { ...src, inputs: { ...src.inputs, testSuiteProof: { ...src.inputs.testSuiteProof, ...patch } as Source['inputs']['testSuiteProof'] } };
}

function withPreflight(src: Source, patch: Record<string, unknown>): Source {
  return {
    ...src,
    testQuality: { ...src.testQuality, preflight: { ...(src.testQuality.preflight as Record<string, unknown>), ...patch } as Source['testQuality']['preflight'] },
  };
}

function digestOf(src: Source): string {
  return deriveBuildReviewRubricProjections(src).testQuality.digest;
}

describe('build-review rubric projections', () => {
  it('derives the closed test-quality projection by reference, never embedding the raw diff body', () => {
    const projections = deriveBuildReviewRubricProjections(source());
    const projection: TestQualityProjection = projections.testQuality;

    expect(Object.keys(projections)).toEqual(['testQuality']);
    expect(Object.keys(projection).sort()).toEqual([
      'changedFiles', 'changedTestSelectors', 'changedTestTitles', 'contentDigest', 'contractVersion', 'digest', 'headSha', 'lapId',
      'mergeBase', 'preflight', 'projectionVersion', 'revertedProductionManifest', 'rubric', 'snapshotDigest', 'testSuiteProof', 'unresolvedMarkers',
    ]);
    expect(projection).toMatchObject({
      rubric: 'testQuality', contractVersion: 'v3', projectionVersion: 'v2', lapId, snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content',
      mergeBase: 'base', headSha: 'head',
      changedFiles: [{ path: 'src/a.ts', changeKind: 'modified', hunks: [{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 3, contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }] }],
      changedTestTitles: [{ selector: 'test/a.test.ts', titleText: 'a > persists', staticExtractionFallback: false }],
      preflight: { classification: 'red' },
    });
    expect(projection.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(projection)).not.toContain('embedded-diff-body-line');
    expect(projection).not.toHaveProperty('planBody');
    expect(projection).not.toHaveProperty('diff');
    expect(Object.isFrozen(projection)).toBe(true);
  });

  it('canonically serializes unordered evidence so member order never perturbs the projection or digest', () => {
    const first = deriveBuildReviewRubricProjections(source());
    const original = source();
    const second = deriveBuildReviewRubricProjections({
      ...original,
      testQuality: {
        ...original.testQuality,
        changedTestSelectors: [...original.testQuality.changedTestSelectors].reverse(),
        unresolvedMarkers: [...original.testQuality.unresolvedMarkers].reverse(),
        revertedProductionManifest: [...original.testQuality.revertedProductionManifest].reverse(),
      },
    });

    expect(second).toEqual(first);
    expect(first.testQuality.changedTestSelectors).toEqual(['test/a.test.ts', 'test/b.test.ts']);
    expect(projectionDigest(first.testQuality)).toBe(first.testQuality.digest);
    expect(canonicalJson({ b: [{ z: 1, y: 2 }, 'a'], a: null })).toBe('{"a":null,"b":["a",{"y":2,"z":1}]}');
  });

  it('binds the digest to the projection and contract versions', () => {
    const projection = deriveBuildReviewRubricProjections(source()).testQuality;

    expect(projectionDigest({ ...projection, projectionVersion: 'v1' } as unknown as TestQualityProjection)).not.toBe(projection.digest);
    expect(projectionDigest({ ...projection, contractVersion: 'v2' } as unknown as TestQualityProjection)).not.toBe(projection.digest);
    expect(projectionDigest({ ...projection, digest: 'sha256:tampered' })).toBe(projection.digest);
  });

  it('keeps commit anchors readable while the digest ignores rebase-only provenance', () => {
    const first = deriveBuildReviewRubricProjections(source()).testQuality;
    const rebased = deriveBuildReviewRubricProjections(withSnapshot(
      withProof(source({ lapId: parseBuildReviewLapId('lap-rebased')! }), { provenanceHeadSha: 'head-rebased' }),
      { digest: 'sha256:snapshot-rebased', mergeBase: 'base-rebased', headSha: 'head-rebased' },
    )).testQuality;

    expect(rebased).toMatchObject({ lapId: 'lap-rebased', snapshotDigest: 'sha256:snapshot-rebased', mergeBase: 'base-rebased', headSha: 'head-rebased' });
    expect(rebased.digest).toBe(first.digest);
    expect(digestOf(withSnapshot(source(), { contentDigest: 'sha256:other-content' }))).not.toBe(first.digest);
  });

  it.each([...BUILD_REVIEW_PROVENANCE_KEYS])('ignores provenance key %s at any depth while a semantic sibling stays digest-sensitive', (key) => {
    const nested = (value: string, sibling: string): Source => withPreflight(source(), {
      evidence: { [key]: value, classificationNote: sibling, deeper: { [key]: value } },
    });
    const first = digestOf(nested('a', 'same'));

    expect(digestOf(nested('b', 'same'))).toBe(first);
    expect(digestOf(nested('a', 'different'))).not.toBe(first);
  });

  it('keeps counterfactual output and full-suite transcripts readable while the digest ignores them', () => {
    const first = deriveBuildReviewRubricProjections(source()).testQuality;
    const second = deriveBuildReviewRubricProjections(withPreflight(
      withProof(source(), { stdout: 'rerun full suite stdout', stderr: 'rerun full suite stderr', durationMs: 9 }),
      { output: { stdout: 'rerun counterfactual stdout', stderr: 'rerun counterfactual stderr' } },
    )).testQuality;

    expect(second.digest).toBe(first.digest);
    expect(second.testSuiteProof).toMatchObject({ stdout: 'rerun full suite stdout', stderr: 'rerun full suite stderr' });
    expect(second.preflight).toMatchObject({ output: { stdout: 'rerun counterfactual stdout', stderr: 'rerun counterfactual stderr' } });
    expect(digestOf(withPreflight(source(), { scopedRun: { exitCode: 0, runKind: 'zero-exit', ranSelectors: ['test/a.test.ts'], failureExcerpt: '' } }))).not.toBe(first.digest);
    expect(digestOf(withProof(source(), { fingerprint: 'sha256:other-suite' }))).not.toBe(first.digest);
  });

  describe('deriveChangedFileReferences', () => {
    it('classifies added, modified, deleted, and renamed files with hunk ranges and content hashes', () => {
      const diff = [
        'diff --git a/src/new.ts b/src/new.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/src/new.ts',
        '@@ -0,0 +1 @@',
        '+export const fresh = 1;',
        'diff --git a/src/mod.ts b/src/mod.ts',
        '--- a/src/mod.ts',
        '+++ b/src/mod.ts',
        '@@ -10,3 +12,4 @@ function f() {',
        ' context',
        '-  return old;',
        '+  return updated;',
        '+  // trailing',
        '@@ -40 +43 @@',
        '-x',
        '+y',
        'diff --git a/src/gone.ts b/src/gone.ts',
        'deleted file mode 100644',
        '--- a/src/gone.ts',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-export const gone = 1;',
        'diff --git a/src/before.ts b/src/after.ts',
        'similarity index 90%',
        'rename from src/before.ts',
        'rename to src/after.ts',
        '',
      ].join('\n');

      const references = deriveChangedFileReferences(diff);

      expect(references).toEqual([
        { path: 'src/new.ts', changeKind: 'added', hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }] },
        {
          path: 'src/mod.ts', changeKind: 'modified',
          hunks: [
            { oldStart: 10, oldCount: 3, newStart: 12, newCount: 4, contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
            { oldStart: 40, oldCount: 1, newStart: 43, newCount: 1, contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
          ],
        },
        { path: 'src/gone.ts', changeKind: 'deleted', hunks: [{ oldStart: 1, oldCount: 1, newStart: 0, newCount: 0, contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }] },
        { path: 'src/after.ts', changeKind: 'renamed', previousPath: 'src/before.ts', hunks: [] },
      ]);
      expect(Object.isFrozen(references)).toBe(true);
      expect(references.map((reference) => reference.path)).toEqual(['src/new.ts', 'src/mod.ts', 'src/gone.ts', 'src/after.ts']);
    });

    it('hashes only whitespace-normalized added and removed lines, deterministically', () => {
      const hunk = (body: string[]) => ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,2 @@', ...body, ''].join('\n');
      const base = deriveChangedFileReferences(hunk([' context', '-return staleState;', '+return persistedState;']));
      const whitespaceOnly = deriveChangedFileReferences(hunk([' other context', '-  return   staleState;', '+\treturn persistedState;  ']));
      const changedContent = deriveChangedFileReferences(hunk([' context', '-return staleState;', '+return fallbackState;']));

      expect(base).toEqual(deriveChangedFileReferences(hunk([' context', '-return staleState;', '+return persistedState;'])));
      expect(whitespaceOnly[0]!.hunks[0]!.contentHash).toBe(base[0]!.hunks[0]!.contentHash);
      expect(changedContent[0]!.hunks[0]!.contentHash).not.toBe(base[0]!.hunks[0]!.contentHash);
      expect(JSON.stringify(base)).not.toContain('staleState');
    });

    it('returns no references for an empty diff or one without file headers', () => {
      expect(deriveChangedFileReferences('')).toEqual([]);
      expect(deriveChangedFileReferences('just prose\n')).toEqual([]);
    });
  });
});
