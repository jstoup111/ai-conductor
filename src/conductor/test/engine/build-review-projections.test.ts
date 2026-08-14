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
      sourceSnapshot: {
        digest: 'sha256:snapshot', baseRef: 'origin/main', mergeBase: 'base', headSha: 'head',
        diff: 'diff --git a/src/a.ts b/src/a.ts\n+change\n', planBody: '# Approved plan\n', repairContext: [],
        removalContext: { deletedFiles: ['old.ts'], removedDeclarations: ['old'], removedMembers: [] },
      },
    } as unknown as BuildReviewProjectionSource['inputs'],
    tautology: {
      changedTestSelectors: ['test/b.test.ts', 'test/a.test.ts'],
      revertedProductionPatch: 'revert patch',
      preflightEvidence: { classification: 'red', command: 'npm test' },
    },
    wiring: {
      relocationEvidence: [{ from: 'src/old.ts', to: 'src/new.ts' }],
      scaffoldingDeclarations: [{ taskId: '4', surface: 'src/future.ts' }],
    },
    ...overrides,
  };
}

describe('build-review rubric projections', () => {
  it('derives the five closed projections with every skill dependency and a v1 digest', () => {
    const projections = deriveBuildReviewRubricProjections(source());

    expect(Object.keys(projections)).toEqual(['tautology', 'scope', 'rootCause', 'completeness', 'wiring']);
    expect(projections.tautology).toMatchObject({
      rubric: 'tautology', projectionVersion: 'v1', lapId, snapshotDigest: 'sha256:snapshot',
      diff: expect.any(String), changedTestSelectors: expect.any(Array), testSuiteProof: expect.any(Object),
      revertedProductionPatch: 'revert patch', preflightEvidence: expect.any(Object),
    });
    expect(projections.scope).toMatchObject({ planBody: '# Approved plan\n', repairContext: expect.any(Array), acceptedWidenings: expect.any(Array) });
    expect(projections.rootCause).toMatchObject({ planBody: '# Approved plan\n', repairContext: expect.any(Array) });
    expect(projections.completeness).toMatchObject({ planBody: '# Approved plan\n', diff: expect.any(String) });
    expect(projections.wiring).toMatchObject({ entryPoints: expect.any(Array), removalContext: expect.any(Object), relocationEvidence: expect.any(Array), scaffoldingDeclarations: expect.any(Array) });
    for (const projection of Object.values(projections)) expect(projection.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
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

    const forbiddenSource = source();
    const changedForbiddenProse: BuildReviewProjectionSource = {
      ...forbiddenSource,
      inputs: { ...forbiddenSource.inputs, repairProvenance: { disposition: 'no_join' } },
    };
    expect(deriveBuildReviewRubricProjections(changedForbiddenProse).completeness).toEqual(first.completeness);
  });

  it('rejects any undeclared field rather than widening a rubric contract', () => {
    const projection = deriveBuildReviewRubricProjections(source()).scope;
    expect(parseBuildReviewRubricProjection(projection)).toEqual(projection);
    expect(parseBuildReviewRubricProjection({ ...projection, makerNarrative: 'trust me' })).toBeUndefined();
  });
});
