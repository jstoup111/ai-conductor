// Covers: task:10
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import {
  BUILD_REVIEW_PROVENANCE_KEYS,
  canonicalJson,
  deriveBuildReviewRubricProjections,
  deriveChangedFileReferences,
  buildReviewRubricPromptView,
  isTestQualityProjection,
  projectionDigest,
  type BuildReviewProjectionSource,
  type TestQualityProjection,
} from '../../src/engine/build-review-projections.js';
import type {
  BuildReviewPinnedScopeEvidence,
} from '../../src/engine/build-review-inputs.js';
import type { BuildReviewTestScope } from '../../src/engine/build-review-test-scope.js';
import { analyzeBuildReviewTestScope } from '../../src/engine/build-review-test-scope.js';

// The reduced-coverage publication contract and cache-identity behaviour are
// covered by test/engine/build-review-cache.test.ts and the coordinator tests;
// this file pins projection derivation itself.

const lapId = parseBuildReviewLapId('lap-1')!;

function contentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

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

const THREE_FILE_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1 @@',
  '-export const stale = true;',
  '+export const current = true;',
  'diff --git a/src/b.ts b/src/b.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/b.ts',
  '@@ -0,0 +1 @@',
  '+export const added = true;',
  'diff --git a/src/c.ts b/src/c.ts',
  'deleted file mode 100644',
  '--- a/src/c.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-export const removed = true;',
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
        classification: 'nonzero-exit', exitCode: 7, runKind: 'nonzero-exit',
        ranSelectors: ['test/a.test.ts'], excerpt: 'AssertionError',
        output: { stdout: 'counterfactual stdout', stderr: 'counterfactual stderr' },
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

function typedScopeWithUnchangedSiblings(siblingCount: number): BuildReviewTestScope {
  const source = (changed: boolean) => [
    '// Covers: task:10',
    `it('changed assertion', () => expect(true).toBe(${changed ? 'false' : 'true'}));`,
    ...Array.from({ length: siblingCount }, (_, index) => `it('unchanged sibling ${index + 1}', () => expect(true).toBe(true));`),
  ].join('\n');
  return analyzeBuildReviewTestScope({
    base: { source: { fileName: 'test/a.test.ts', bytes: Buffer.from(source(false).replace('// Covers: task:10\n', '')) }, storiesText: '', planText: '### Task 10: Scope\n' },
    head: { source: { fileName: 'test/a.test.ts', bytes: Buffer.from(source(true)) }, storiesText: '', planText: '### Task 10: Scope\n' },
  });
}

/** Frozen typed assembly output: one directly changed declaration and no sibling targets. */
function scopedSource(overrides: {
  readonly bindingId?: string;
  readonly helperContent?: string;
  readonly analysisVersion?: string;
  readonly provenanceHeadSha?: string;
  readonly provenanceStartedAt?: string;
} = {}): Source {
  const {
    bindingId = '10',
    helperContent = 'export const helper = 1;',
    analysisVersion = 'test-scope-v1',
    provenanceHeadSha = 'head',
    provenanceStartedAt = '2026-08-15T11:00:00.000Z',
  } = overrides;
  const declaration = {
    kind: 'test' as const,
    titleChain: ['changed assertion'],
    modifierChain: [],
    occurrence: 0,
    span: { start: 24, end: 72 },
    argumentsSpan: { start: 27, end: 69 },
    bodySpan: { start: 50, end: 69 },
    change: 'modified' as const,
  };
  const testScope: BuildReviewTestScope = {
    changedDeclarations: [declaration],
    targets: [{
      source: { fileName: 'test/a.test.ts', side: 'head' },
      declaration,
      bindings: [{
        kind: 'bound',
        target: declaration,
        marker: { span: { start: 0, end: 18 }, reference: { kind: 'task', id: bindingId } },
        owner: { kind: 'test', association: 'leading-comment', declaration },
      }],
      associationChanges: [],
    }],
    candidates: [{
      source: { fileName: 'test/a.test.ts', side: 'head' },
      declaration,
      markers: [],
      associationChanges: [],
      reasons: ['uncertain-association'],
    }],
    notes: [],
    affectedGroups: [],
    sharedSources: [],
  };
  const evidence: readonly BuildReviewPinnedScopeEvidence[] = [{
    id: 'source:head:src/helper.ts:0:24',
    source: { fileName: 'src/helper.ts', side: 'head' },
    region: { start: 0, end: helperContent.length },
    contentHash: contentHash(helperContent),
  }];

  return withProof(withSnapshot(source(), {
    headSha: provenanceHeadSha,
    testScope,
    testScopeEvidence: evidence,
    testScopeAnalysisVersion: analysisVersion,
  } as Partial<Source['inputs']['sourceSnapshot']>), { startedAt: provenanceStartedAt });
}

describe('build-review rubric projections', () => {
  it('derives the whole frozen diff as a sealed security projection', () => {
    const threeFileSource = withSnapshot(source(), { diff: THREE_FILE_DIFF });
    const first = deriveBuildReviewRubricProjections(threeFileSource).security;
    const second = deriveBuildReviewRubricProjections(threeFileSource).security;

    expect(Object.keys(first).sort()).toEqual([
      'changedFiles', 'contentDigest', 'contractVersion', 'digest', 'headSha', 'lapId',
      'mergeBase', 'projectionVersion', 'rubric', 'snapshotDigest',
    ]);
    expect(first).toMatchObject({ rubric: 'security', changedFiles: deriveChangedFileReferences(THREE_FILE_DIFF) });
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.digest).toBe(first.digest);
    expect(Object.isFrozen(first)).toBe(true);
    expect(isTestQualityProjection(first)).toBe(false);
    expect(isTestQualityProjection(deriveBuildReviewRubricProjections(threeFileSource).testQuality)).toBe(true);
  });

  it('keeps the security projection sealed when the post-exclusion frozen diff is empty', () => {
    const projection = deriveBuildReviewRubricProjections(withSnapshot(source(), { diff: '' })).security;

    expect(projection.changedFiles).toEqual([]);
    expect(projection.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('projects the frozen v3 test scope compactly and keeps runner selectors separate from review targets', () => {
    const projection = deriveBuildReviewRubricProjections(scopedSource()).testQuality as unknown as Record<string, unknown>;

    expect(projection.projectionVersion).toBe('v3');
    expect(projection.runnerSelectors).toEqual(['test/a.test.ts', 'test/b.test.ts']);
    expect(projection.testScope).toMatchObject({
      analysisVersion: 'test-scope-v1',
      targets: [{
        declaration: { titleChain: ['changed assertion'], occurrence: 0 },
        bindings: [{ marker: { reference: { id: '10' } } }],
      }],
      candidates: [{ reasons: ['uncertain-association'] }],
      evidence: [{ id: 'source:head:src/helper.ts:0:24', contentHash: contentHash('export const helper = 1;') }],
    });
    expect((projection.testScope as { targets: readonly unknown[] }).targets).toHaveLength(1);
    expect(JSON.stringify((projection.testScope as { evidence: unknown }).evidence)).not.toContain('"content"');
  });

  it('bounds serialized test-quality projection size by evidence count, not evidence bytes', () => {
    const regionContent = 'x'.repeat(12 * 1024);
    const evidence: readonly BuildReviewPinnedScopeEvidence[] = Array.from({ length: 98 }, (_, index) => ({
      id: `source:head:src/helper-${index}.ts:0:${regionContent.length}`,
      source: { fileName: `src/helper-${index}.ts`, side: 'head' },
      region: { start: 0, end: regionContent.length },
      contentHash: contentHash(regionContent),
    }));
    const projection = deriveBuildReviewRubricProjections(withSnapshot(scopedSource(), {
      testScopeEvidence: evidence,
    })).testQuality;

    expect(Buffer.byteLength(JSON.stringify(projection), 'utf8')).toBeLessThan(64 * 1024);
  });

  it('does not inflate direct review targets when frozen input adds unchanged sibling titles', () => {
    const directOnly = deriveBuildReviewRubricProjections(withSnapshot(scopedSource(), {
      testScope: typedScopeWithUnchangedSiblings(0),
    })).testQuality as unknown as Record<string, unknown>;
    const surroundedByUnchangedSiblings = deriveBuildReviewRubricProjections(withSnapshot(scopedSource(), {
      testScope: typedScopeWithUnchangedSiblings(724),
    })).testQuality as unknown as Record<string, unknown>;

    expect((directOnly.testScope as { targets: readonly unknown[] }).targets).toEqual(
      (surroundedByUnchangedSiblings.testScope as { targets: readonly unknown[] }).targets,
    );
    expect((surroundedByUnchangedSiblings.testScope as { targets: readonly { declaration: { titleChain: readonly string[] } }[] }).targets)
      .toMatchObject([{ declaration: { titleChain: ['changed assertion'] } }]);
  });

  it('binds v3 semantic identity to frozen binding, pinned helper content, and analysis schema while ignoring provenance', () => {
    const baseline = deriveBuildReviewRubricProjections(scopedSource()).testQuality;

    expect(deriveBuildReviewRubricProjections(scopedSource({ bindingId: '7.5' })).testQuality.digest).not.toBe(baseline.digest);
    expect(deriveBuildReviewRubricProjections(scopedSource({ helperContent: 'export const helper = 2;' })).testQuality.digest).not.toBe(baseline.digest);
    expect(deriveBuildReviewRubricProjections(scopedSource({ analysisVersion: 'test-scope-v2' })).testQuality.digest).not.toBe(baseline.digest);
    expect(deriveBuildReviewRubricProjections(scopedSource({ provenanceHeadSha: 'head-rebased' })).testQuality.digest).toBe(baseline.digest);
    expect(deriveBuildReviewRubricProjections(scopedSource({ provenanceStartedAt: '2026-08-16T11:00:00.000Z' })).testQuality.digest).toBe(baseline.digest);
  });

  it('changes the projection digest when only a pinned evidence contentHash changes', () => {
    const baseline = scopedSource();
    const evidence = baseline.inputs.sourceSnapshot.testScopeEvidence![0]!;
    const changedHash = `sha256:${'f'.repeat(64)}`;
    const changed = withSnapshot(baseline, {
      testScopeEvidence: [{ ...evidence, contentHash: changedHash }],
    });

    expect(changed.inputs.sourceSnapshot.testScopeEvidence![0]!.contentHash).toBe(changedHash);
    expect(digestOf(changed)).not.toBe(digestOf(baseline));
  });

  it('derives the closed test-quality projection by reference, never embedding the raw diff body', () => {
    const projections = deriveBuildReviewRubricProjections(source());
    const projection: TestQualityProjection = projections.testQuality;

    expect(Object.keys(projections)).toEqual(['testQuality', 'security']);
    expect(Object.keys(projection).sort()).toEqual([
      'changedFiles', 'changedTestSelectors', 'changedTestTitles', 'contentDigest', 'contractVersion', 'digest', 'headSha', 'lapId',
      'mergeBase', 'preflight', 'projectionVersion', 'revertedProductionManifest', 'rubric', 'runnerSelectors', 'snapshotDigest', 'testScope', 'testSuiteProof', 'unresolvedMarkers',
    ]);
    expect(projection).toMatchObject({
      rubric: 'testQuality', contractVersion: 'v3', projectionVersion: 'v3', lapId, snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content',
      mergeBase: 'base', headSha: 'head',
      changedFiles: [{ path: 'src/a.ts', changeKind: 'modified', hunks: [{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 3, contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }] }],
      changedTestTitles: [{ selector: 'test/a.test.ts', titleText: 'a > persists', staticExtractionFallback: false }],
      preflight: expect.objectContaining({
        classification: 'nonzero-exit', exitCode: 7, runKind: 'nonzero-exit',
        ranSelectors: ['test/a.test.ts'], excerpt: 'AssertionError',
      }),
    });
    expect(projection.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(projection)).not.toContain('embedded-diff-body-line');
    expect(projection).not.toHaveProperty('planBody');
    expect(projection).not.toHaveProperty('diff');
    expect(projection.preflight).not.toHaveProperty('counterfactualSensitivity');
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

describe('build-review rubric prompt view', () => {
  const declaration = (start: number, end: number, title: string) => ({
    kind: 'test', change: 'added', occurrence: 0, modifierChain: [], titleChain: [title],
    span: { start, end }, argumentsSpan: { start, end }, bodySpan: { start, end },
  });
  const evidenceAt = (fileName: string, start: number, end: number) => ({
    id: `source:head:${fileName}:${start}:${end}`, source: { fileName, side: 'head' },
    region: { start, end }, startLine: 1, endLine: 2, contentHash: contentHash(`${fileName}:${start}`),
  });
  const bloatedSource = () => withSnapshot(source(), {
    testScope: {
      targets: [], affectedGroups: [], sharedSources: [],
      candidates: [{ source: { fileName: 'test/kept.test.ts', side: 'head' }, declaration: declaration(0, 40, 'kept'), reasons: ['file-header-marker'], markers: [], associationChanges: [] }],
      changedDeclarations: [declaration(0, 40, 'kept'), declaration(50, 90, 'unbound sibling')],
      notes: [
        { kind: 'unbound', declaration: declaration(50, 90, 'unbound sibling') },
        { kind: 'declaration-uncertainty', declaration: declaration(0, 40, 'kept') },
      ],
    },
    // Same offsets in another file must not ride along with the candidate.
    testScopeEvidence: [evidenceAt('test/kept.test.ts', 0, 40), evidenceAt('test/other.test.ts', 0, 40), evidenceAt('test/kept.test.ts', 50, 90)],
    changedTestTitles: [{ selector: 'test/kept.test.ts', titleText: 'kept', staticExtractionFallback: false }],
  });

  it('keeps only candidate-bound scope and hunk ranges in the testQuality prompt', () => {
    const projection = deriveBuildReviewRubricProjections(bloatedSource()).testQuality;
    const view = buildReviewRubricPromptView(projection) as Record<string, any>;

    expect(view.testScope.evidence.map((entry: { id: string }) => entry.id)).toEqual(['source:head:test/kept.test.ts:0:40']);
    expect(view.testScope.notes.map((note: { kind: string }) => note.kind)).toEqual(['declaration-uncertainty']);
    expect(view.testScope.changedDeclarations).toEqual([]);
    expect(view.testScope.candidates).toEqual(projection.testScope && (projection.testScope as Record<string, unknown>).candidates);
    expect(view).not.toHaveProperty('changedTestTitles');
    expect(view.changedFiles).toEqual([{ path: 'src/a.ts', changeKind: 'modified', hunks: [{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 3 }] }]);
    expect(view).toMatchObject({ lapId: projection.lapId, snapshotDigest: projection.snapshotDigest, digest: projection.digest, mergeBase: projection.mergeBase, headSha: projection.headSha, preflight: projection.preflight });
  });

  it('leaves the projection itself, and the security prompt, untouched', () => {
    const projections = deriveBuildReviewRubricProjections(bloatedSource());
    const before = JSON.stringify(projections.testQuality);
    buildReviewRubricPromptView(projections.testQuality);

    expect(JSON.stringify(projections.testQuality)).toBe(before);
    expect(buildReviewRubricPromptView(projections.security)).toBe(projections.security);
  });
});
