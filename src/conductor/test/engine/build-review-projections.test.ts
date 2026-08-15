import { describe, expect, it } from 'vitest';

import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import {
  deriveBuildReviewRubricProjections,
  deriveChangedFileReferences,
  projectionDigest,
  type BuildReviewProjectionSource,
} from '../../src/engine/build-review-projections.js';

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

function source(overrides: Partial<BuildReviewProjectionSource> = {}): BuildReviewProjectionSource {
  return {
    lapId,
    inputs: {
      diff: FIXTURE_DIFF,
      planBody: '# Approved plan\n',
      mergeBase: 'base', baseRef: 'origin/main', baseKind: 'remote', trackingRefSha: 'base', remoteHeadSha: 'base', fresh: true,
      repairContext: [{ id: 'repair-b', reason: 'command_failed', diagnostic: 'b', observedAt: 2 }, { id: 'repair-a', reason: 'command_failed', diagnostic: 'a', observedAt: 1 }],
      acceptedWidenings: [{ path: 'src/b.ts', rationale: 'b', taskId: '2', sha: 'b' }, { path: 'src/a.ts', rationale: 'a', taskId: '1', sha: 'a' }],
      entryPoints: ['bin/b', 'bin/a'],
      testSuiteProof: { provenanceHeadSha: 'head', outcome: 'PASS' },
      operatorReseals: [{
        paths: ['.docs/stories/resealed-story.md'],
        reason: 'Operator approved this exact protected-artifact amendment.',
        fromCommit: 'reseal-base',
        toCommit: 'reseal-head',
      }],
      sourceSnapshot: {
        digest: 'sha256:snapshot', contentDigest: 'sha256:content', baseRef: 'origin/main', mergeBase: 'base', headSha: 'head',
        diff: FIXTURE_DIFF, planBody: '# Approved plan\n', repairContext: [],
        acceptedWidenings: [{ path: 'src/a.ts', rationale: 'frozen scope widening', taskId: '1', sha: 'a' }],
        removalContext: { deletedFiles: ['old.ts'], removedDeclarations: ['old'], removedMembers: [] },
        operatorReseals: [{
          paths: ['.docs/stories/resealed-story.md'],
          reason: 'Operator approved this exact protected-artifact amendment.',
          fromCommit: 'reseal-base',
          toCommit: 'reseal-head',
        }],
      },
    } as unknown as BuildReviewProjectionSource['inputs'],
    tautology: {
      changedTestSelectors: ['test/b.test.ts', 'test/a.test.ts'],
      revertedProductionManifest: [{ path: 'src/a.ts', mergeBaseBlobSha: 'e79120aab4682bfe81153595c7d2ec1ad3bd3dd8' }],
      preflightEvidence: {
        classification: 'red',
        eligibleSelectorRemovals: [{ selector: 'test/retired.test.ts', removals: ['retired'] }],
        scopedRun: { exitCode: 1, runKind: 'test-failure', ranSelectors: ['test/a.test.ts'], failureExcerpt: 'AssertionError' },
      },
    },
    ...overrides,
  };
}

describe('build-review rubric projections', () => {
  it('derives the four closed projections with every skill dependency and a v1 digest', () => {
    const projections = deriveBuildReviewRubricProjections(source());

    expect(Object.keys(projections)).toEqual(['tautology', 'scope', 'rootCause', 'completeness']);
    expect(Object.keys(projections.tautology).sort()).toEqual([
      'changedFiles', 'changedTestSelectors', 'contentDigest', 'contractVersion', 'digest', 'headSha', 'lapId',
      'mergeBase', 'preflightEvidence', 'projectionVersion', 'removalContext', 'repairContext',
      'revertedProductionManifest', 'rubric', 'snapshotDigest', 'testSuiteProof',
    ]);
    expect(Object.keys(projections.scope).sort()).toEqual([
      'acceptedWidenings', 'changedFiles', 'contentDigest', 'contractVersion', 'digest', 'headSha', 'lapId',
      'mergeBase', 'operatorReseals', 'planBody', 'projectionVersion', 'removalContext',
      'repairContext', 'rubric', 'snapshotDigest',
    ]);
    expect(Object.keys(projections.rootCause).sort()).toEqual([
      'changedFiles', 'contentDigest', 'contractVersion', 'digest', 'headSha', 'lapId', 'mergeBase', 'planBody',
      'projectionVersion', 'removalContext', 'repairContext', 'rubric', 'snapshotDigest',
    ]);
    expect(Object.keys(projections.completeness).sort()).toEqual([
      'changedFiles', 'contentDigest', 'contractVersion', 'digest', 'headSha', 'lapId', 'mergeBase', 'planBody',
      'projectionVersion', 'removalContext', 'rubric', 'snapshotDigest',
    ]);
    expect(projections.tautology).toMatchObject({
      rubric: 'tautology', projectionVersion: 'v2', lapId, snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content',
      mergeBase: 'base', headSha: 'head',
      changedFiles: [{
        path: 'src/a.ts', changeKind: 'modified',
        hunks: [{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 3 }],
      }],
      removalContext: { deletedFiles: ['old.ts'], removedDeclarations: ['old'], removedMembers: [] },
      changedTestSelectors: expect.any(Array), testSuiteProof: expect.any(Object),
      revertedProductionManifest: [{ path: 'src/a.ts', mergeBaseBlobSha: 'e79120aab4682bfe81153595c7d2ec1ad3bd3dd8' }],
      preflightEvidence: expect.any(Object), repairContext: expect.any(Array),
    });
    expect(projections.tautology.preflightEvidence).toMatchObject({
      eligibleSelectorRemovals: [{ selector: 'test/retired.test.ts', removals: ['retired'] }],
    });
    expect(projections.scope).toMatchObject({
      planBody: '# Approved plan\n', repairContext: expect.any(Array), acceptedWidenings: expect.any(Array),
      operatorReseals: [{
        paths: ['.docs/stories/resealed-story.md'],
        reason: 'Operator approved this exact protected-artifact amendment.',
        fromCommit: 'reseal-base', toCommit: 'reseal-head',
      }],
    });
    expect(projections.rootCause).toMatchObject({ planBody: '# Approved plan\n', repairContext: expect.any(Array) });
    expect(projections.completeness).toMatchObject({ planBody: '# Approved plan\n', changedFiles: expect.any(Array) });
    // The raw diff body must never travel inside a projection — only references do.
    for (const projection of Object.values(projections)) {
      expect(JSON.stringify(projection)).not.toContain('embedded-diff-body-line');
    }
    for (const projection of [projections.tautology, projections.rootCause, projections.completeness]) {
      expect(projection).not.toHaveProperty('operatorReseals');
    }
    for (const projection of Object.values(projections)) {
      expect(projection.contractVersion).toBe('v1');
      expect(projection.contentDigest).toBe('sha256:content');
      expect(projection.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it('canonically serializes unordered evidence and ignores source prose outside a projection', () => {
    const first = deriveBuildReviewRubricProjections(source());
    const original = source();
    const reordered: BuildReviewProjectionSource = {
      ...original,
      inputs: {
        ...original.inputs,
        repairContext: [...(original.inputs.repairContext ?? [])].reverse(),
        acceptedWidenings: [...(original.inputs.acceptedWidenings ?? [])].reverse(),
      },
      tautology: { ...original.tautology, changedTestSelectors: [...original.tautology.changedTestSelectors].reverse() },
    };
    const second = deriveBuildReviewRubricProjections(reordered);

    expect(second).toEqual(first);
    expect(projectionDigest(first.scope)).toBe(first.scope.digest);
    expect(projectionDigest({ ...first.scope, projectionVersion: 'v1' } as unknown as typeof first.scope))
      .not.toBe(first.scope.digest);

    const forbiddenSource = source();
    const changedForbiddenProse: BuildReviewProjectionSource = {
      ...forbiddenSource,
      inputs: { ...forbiddenSource.inputs, repairProvenance: { disposition: 'no_join' } },
    };
    expect(deriveBuildReviewRubricProjections(changedForbiddenProse)).toEqual(first);
  });

  it('keeps SHA anchors readable while all four projection digests ignore rebase-only metadata', () => {
    const first = deriveBuildReviewRubricProjections(source());
    const original = source();
    const rebasedLapId = parseBuildReviewLapId('lap-rebased')!;
    const rebased = deriveBuildReviewRubricProjections(source({
      lapId: rebasedLapId,
      inputs: {
        ...original.inputs,
        baseRef: 'origin/rebased-main',
        mergeBase: 'rebased-merge-base',
        testSuiteProof: {
          ...original.inputs.testSuiteProof,
          provenanceHeadSha: 'rebased-head',
        },
        sourceSnapshot: {
          ...original.inputs.sourceSnapshot,
          digest: 'sha256:rebased-snapshot',
          baseRef: 'origin/rebased-main',
          mergeBase: 'rebased-merge-base',
          headSha: 'rebased-head',
        },
      },
    }));

    for (const rubric of ['tautology', 'scope', 'rootCause', 'completeness'] as const) {
      expect(rebased[rubric].digest).toBe(first[rubric].digest);
      expect(rebased[rubric]).toMatchObject({
        lapId: rebasedLapId,
        snapshotDigest: 'sha256:rebased-snapshot',
        mergeBase: 'rebased-merge-base',
        headSha: 'rebased-head',
      });
    }

    const contentMutations: readonly {
      readonly name: string;
      readonly affectedRubrics: readonly (keyof typeof first)[];
      readonly changed: BuildReviewProjectionSource;
    }[] = [
      {
        name: 'diff text', affectedRubrics: ['tautology', 'scope', 'rootCause', 'completeness'],
        changed: source({ inputs: { ...original.inputs, sourceSnapshot: {
          ...original.inputs.sourceSnapshot, contentDigest: 'sha256:content-diff', diff: `${FIXTURE_DIFF}changed`,
        } } }),
      },
      {
        name: 'plan body', affectedRubrics: ['tautology', 'scope', 'rootCause', 'completeness'],
        changed: source({ inputs: { ...original.inputs, sourceSnapshot: {
          ...original.inputs.sourceSnapshot, contentDigest: 'sha256:content-plan', planBody: '# Changed plan\n',
        } } }),
      },
      {
        name: 'repair context', affectedRubrics: ['tautology', 'scope', 'rootCause', 'completeness'],
        changed: source({ inputs: { ...original.inputs, sourceSnapshot: {
          ...original.inputs.sourceSnapshot, contentDigest: 'sha256:content-repair',
          repairContext: [{ id: 'repair-new', reason: 'command_failed', diagnostic: 'new', rebaseInvalidatedAt: 3 }],
        } } }),
      },
      {
        name: 'accepted widenings', affectedRubrics: ['tautology', 'scope', 'rootCause', 'completeness'],
        changed: source({ inputs: { ...original.inputs, sourceSnapshot: {
          ...original.inputs.sourceSnapshot, contentDigest: 'sha256:content-widening',
          acceptedWidenings: [{ path: 'src/new.ts', rationale: 'new', taskId: '3', sha: 'new' }],
        } } }),
      },
      {
        name: 'removal context', affectedRubrics: ['tautology', 'scope', 'rootCause', 'completeness'],
        changed: source({ inputs: { ...original.inputs, sourceSnapshot: {
          ...original.inputs.sourceSnapshot, contentDigest: 'sha256:content-removal',
          removalContext: { deletedFiles: ['new-old.ts'], removedDeclarations: ['new-old'], removedMembers: [] },
        } } }),
      },
      {
        name: 'tautology preflight evidence', affectedRubrics: ['tautology'],
        changed: source({ tautology: { ...original.tautology, preflightEvidence: { classification: 'green' } } }),
      },
      {
        name: 'changed test selectors', affectedRubrics: ['tautology'],
        changed: source({ tautology: { ...original.tautology, changedTestSelectors: ['test/new.test.ts'] } }),
      },
      {
        name: 'test suite evidence content', affectedRubrics: ['tautology'],
        changed: source({ inputs: {
          ...original.inputs,
          testSuiteProof: { ...original.inputs.testSuiteProof, fingerprint: 'changed-proof-fingerprint' },
        } }),
      },
    ];

    for (const { name, affectedRubrics, changed } of contentMutations) {
      const changedProjections = deriveBuildReviewRubricProjections(changed);
      for (const rubric of ['tautology', 'scope', 'rootCause', 'completeness'] as const) {
        const expectation = affectedRubrics.includes(rubric) ? 'not' : '';
        if (expectation === 'not') {
          expect(changedProjections[rubric].digest, name).not.toBe(first[rubric].digest);
        } else {
          expect(changedProjections[rubric].digest, name).toBe(first[rubric].digest);
        }
      }
    }
  });

  it.each([
    ['rationale', { reason: 'Operator approved revised protected-artifact scope.' }],
    ['named path', { paths: ['.docs/plans/also-resealed.md'] }],
    ['from commit', { fromCommit: 'reseal-base-2' }],
    ['to commit', { toCommit: 'reseal-head-2' }],
  ])('uses the supplied shared snapshot identity while a reseal %s changes only Scope', (_field, mutation) => {
    const first = deriveBuildReviewRubricProjections(source());
    const original = source();
    const changed = source({
      inputs: {
        ...original.inputs,
        sourceSnapshot: {
          ...original.inputs.sourceSnapshot,
          operatorReseals: [{
            ...original.inputs.sourceSnapshot.operatorReseals![0],
            ...mutation,
          }],
        },
      },
    });
    const second = deriveBuildReviewRubricProjections(changed);

    expect(second.scope.snapshotDigest).toBe(first.scope.snapshotDigest);
    expect(second.scope.digest).not.toBe(first.scope.digest);
    expect(second.tautology.digest).toBe(first.tautology.digest);
    expect(second.rootCause.digest).toBe(first.rootCause.digest);
    expect(second.completeness.digest).toBe(first.completeness.digest);
  });

  it('derives Scope widenings solely from the frozen source snapshot and isolates them from the other rubric payloads', () => {
    const original = source();
    const first = deriveBuildReviewRubricProjections(original);
    const changed = source({
      inputs: {
        ...original.inputs,
        // This live input is deliberately stale: it must not be able to alter
        // a projection after input assembly has sealed the source snapshot.
        acceptedWidenings: [{ path: 'src/live-only.ts', rationale: 'must not leak', taskId: '99', sha: 'live' }],
        sourceSnapshot: {
          ...original.inputs.sourceSnapshot,
          acceptedWidenings: [{ path: 'src/b.ts', rationale: 'new frozen widening', taskId: '2', sha: 'b' }],
        },
      },
    });
    const second = deriveBuildReviewRubricProjections(changed);

    expect(first.scope.acceptedWidenings).toEqual([{ path: 'src/a.ts', rationale: 'frozen scope widening', taskId: '1', sha: 'a' }]);
    expect(second.scope.acceptedWidenings).toEqual([{ path: 'src/b.ts', rationale: 'new frozen widening', taskId: '2', sha: 'b' }]);
    expect(second.scope.digest).not.toBe(first.scope.digest);
    expect(second.tautology).toEqual(first.tautology);
    expect(second.rootCause).toEqual(first.rootCause);
    expect(second.completeness).toEqual(first.completeness);
  });

  it('derives per-file references with change kinds and hunk line ranges from the diff text', () => {
    const diff = [
      'diff --git a/src/kept.ts b/src/kept.ts',
      'index 1111111..2222222 100644',
      '--- a/src/kept.ts',
      '+++ b/src/kept.ts',
      '@@ -10,4 +10,6 @@ export function kept() {',
      ' context',
      '+added line',
      '@@ -40 +42,0 @@',
      '-removed line',
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+export const created = true;',
      '+export const alsoCreated = true;',
      'diff --git a/src/gone.ts b/src/gone.ts',
      'deleted file mode 100644',
      'index 4444444..0000000',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-export const gone = true;',
      'diff --git a/src/old-name.ts b/src/new-name.ts',
      'similarity index 90%',
      'rename from src/old-name.ts',
      'rename to src/new-name.ts',
      'index 5555555..6666666 100644',
      '--- a/src/old-name.ts',
      '+++ b/src/new-name.ts',
      '@@ -3,2 +3,2 @@',
      '-before',
      '+after',
      '',
    ].join('\n');

    expect(deriveChangedFileReferences(diff)).toEqual([
      {
        path: 'src/kept.ts', changeKind: 'modified',
        hunks: [
          { oldStart: 10, oldCount: 4, newStart: 10, newCount: 6 },
          { oldStart: 40, oldCount: 1, newStart: 42, newCount: 0 },
        ],
      },
      { path: 'src/new.ts', changeKind: 'added', hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 }] },
      { path: 'src/gone.ts', changeKind: 'deleted', hunks: [{ oldStart: 1, oldCount: 1, newStart: 0, newCount: 0 }] },
      {
        path: 'src/new-name.ts', changeKind: 'renamed', previousPath: 'src/old-name.ts',
        hunks: [{ oldStart: 3, oldCount: 2, newStart: 3, newCount: 2 }],
      },
    ]);
    // Deterministic: the same diff text always yields the same references.
    expect(deriveChangedFileReferences(diff)).toEqual(deriveChangedFileReferences(diff));
    expect(deriveChangedFileReferences('')).toEqual([]);
  });

  it('derives an explicit empty reseal channel into a canonical Scope projection', () => {
    const empty = deriveBuildReviewRubricProjections(source({
      inputs: {
        ...source().inputs,
        sourceSnapshot: { ...source().inputs.sourceSnapshot, operatorReseals: [] },
      },
    })).scope;
    expect(empty.operatorReseals).toEqual([]);
    expect(projectionDigest(empty)).toBe(empty.digest);
  });
});
