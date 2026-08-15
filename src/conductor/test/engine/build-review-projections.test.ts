import { describe, expect, it } from 'vitest';

import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import {
  deriveBuildReviewRubricProjections,
  parseBuildReviewRubricProjection,
  projectionDigest,
  type BuildReviewProjectionSource,
} from '../../src/engine/build-review-projections.js';

const lapId = parseBuildReviewLapId('lap-1')!;

function source(overrides: Partial<BuildReviewProjectionSource> = {}): BuildReviewProjectionSource {
  return {
    lapId,
    inputs: {
      diff: 'diff --git a/src/a.ts b/src/a.ts\n+change\n',
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
        digest: 'sha256:snapshot', baseRef: 'origin/main', mergeBase: 'base', headSha: 'head',
        diff: 'diff --git a/src/a.ts b/src/a.ts\n+change\n', planBody: '# Approved plan\n', repairContext: [],
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
      revertedProductionPatch: 'revert patch',
      preflightEvidence: { classification: 'red', command: 'npm test' },
    },
    ...overrides,
  };
}

describe('build-review rubric projections', () => {
  it('derives the four closed projections with every skill dependency and a v1 digest', () => {
    const projections = deriveBuildReviewRubricProjections(source());

    expect(Object.keys(projections)).toEqual(['tautology', 'scope', 'rootCause', 'completeness']);
    expect(Object.keys(projections.tautology).sort()).toEqual([
      'changedTestSelectors', 'contractVersion', 'diff', 'digest', 'lapId', 'preflightEvidence',
      'projectionVersion', 'revertedProductionPatch', 'rubric', 'snapshotDigest', 'testSuiteProof',
    ]);
    expect(Object.keys(projections.scope).sort()).toEqual([
      'acceptedWidenings', 'contractVersion', 'diff', 'digest', 'lapId', 'operatorReseals', 'planBody', 'projectionVersion',
      'repairContext', 'rubric', 'snapshotDigest',
    ]);
    expect(Object.keys(projections.rootCause).sort()).toEqual([
      'contractVersion', 'diff', 'digest', 'lapId', 'planBody', 'projectionVersion', 'repairContext',
      'rubric', 'snapshotDigest',
    ]);
    expect(Object.keys(projections.completeness).sort()).toEqual([
      'contractVersion', 'diff', 'digest', 'lapId', 'planBody', 'projectionVersion', 'rubric',
      'snapshotDigest',
    ]);
    expect(projections.tautology).toMatchObject({
      rubric: 'tautology', projectionVersion: 'v1', lapId, snapshotDigest: 'sha256:snapshot',
      diff: expect.any(String), changedTestSelectors: expect.any(Array), testSuiteProof: expect.any(Object),
      revertedProductionPatch: 'revert patch', preflightEvidence: expect.any(Object),
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
    expect(projections.completeness).toMatchObject({ planBody: '# Approved plan\n', diff: expect.any(String) });
    for (const projection of [projections.tautology, projections.rootCause, projections.completeness]) {
      expect(projection).not.toHaveProperty('operatorReseals');
    }
    for (const projection of Object.values(projections)) {
      expect(projection.contractVersion).toBe('v1');
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
        entryPoints: [...(original.inputs.entryPoints ?? [])].reverse(),
      },
      tautology: { ...original.tautology, changedTestSelectors: [...original.tautology.changedTestSelectors].reverse() },
    };
    const second = deriveBuildReviewRubricProjections(reordered);

    expect(second).toEqual(first);
    expect(projectionDigest(first.scope)).toBe(first.scope.digest);
    expect(projectionDigest({ ...first.scope, projectionVersion: 'v2' } as unknown as typeof first.scope))
      .not.toBe(first.scope.digest);

    const forbiddenSource = source();
    const changedForbiddenProse: BuildReviewProjectionSource = {
      ...forbiddenSource,
      inputs: { ...forbiddenSource.inputs, repairProvenance: { disposition: 'no_join' } },
    };
    expect(deriveBuildReviewRubricProjections(changedForbiddenProse)).toEqual(first);
  });

  it('rejects any undeclared field rather than widening a rubric contract', () => {
    const projection = deriveBuildReviewRubricProjections(source()).scope;
    expect(parseBuildReviewRubricProjection(projection)).toEqual(projection);
    expect(parseBuildReviewRubricProjection({ ...projection, makerNarrative: 'trust me' })).toBeUndefined();
  });

  it.each([
    ['rationale', { reason: 'Operator approved revised protected-artifact scope.' }],
    ['named path', { paths: ['.docs/plans/also-resealed.md'] }],
    ['from commit', { fromCommit: 'reseal-base-2' }],
    ['to commit', { toCommit: 'reseal-head-2' }],
  ])('invalidates only Scope when a reseal %s changes', (_field, mutation) => {
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

    expect(second.scope.digest).not.toBe(first.scope.digest);
    expect(second.tautology.digest).toBe(first.tautology.digest);
    expect(second.rootCause.digest).toBe(first.rootCause.digest);
    expect(second.completeness.digest).toBe(first.completeness.digest);
  });

  it('parses an explicit empty reseal channel but rejects malformed Scope reseal evidence', () => {
    const empty = deriveBuildReviewRubricProjections(source({
      inputs: {
        ...source().inputs,
        sourceSnapshot: { ...source().inputs.sourceSnapshot, operatorReseals: [] },
      },
    })).scope;
    expect(parseBuildReviewRubricProjection(empty)).toEqual(empty);

    const malformed = {
      ...empty,
      operatorReseals: [{ paths: ['.docs/stories/resealed-story.md'], reason: '', fromCommit: 'base' }],
    };
    expect(parseBuildReviewRubricProjection({ ...malformed, digest: projectionDigest(malformed as never) })).toBeUndefined();
  });
});
