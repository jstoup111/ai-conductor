import { describe, expect, it } from 'vitest';

import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { renderBuildReviewReducedCoverageEvidence } from '../../src/engine/artifacts.js';
import {
  BUILD_REVIEW_PROVENANCE_KEYS,
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
      acceptedWidenings: [{ path: 'src/b.ts', rationale: 'b', derived: false, taskId: '2', sha: 'b' }, { path: 'src/a.ts', rationale: 'a', derived: false, taskId: '1', sha: 'a' }],
      entryPoints: ['bin/b', 'bin/a'],
      testSuiteProof: {
        provenanceHeadSha: 'head', outcome: 'PASS',
        startedAt: '2026-08-15T11:00:00.000Z', endedAt: '2026-08-15T11:00:05.000Z', durationMs: 5_000,
        stdout: 'full suite stdout', stderr: 'full suite stderr',
      },
      operatorReseals: [{
        paths: ['.docs/stories/resealed-story.md'],
        reason: 'Operator approved this exact protected-artifact amendment.',
        fromCommit: 'reseal-base',
        toCommit: 'reseal-head',
      }],
      sourceSnapshot: {
        digest: 'sha256:snapshot', contentDigest: 'sha256:content', baseRef: 'origin/main', mergeBase: 'base', headSha: 'head',
        diff: FIXTURE_DIFF, planBody: '# Approved plan\n', repairContext: [{
          id: 'repair-original', gate: 'test_suite', reason: 'command_failed',
          diagnostic: 'fixture repair diagnostic', rebaseInvalidatedAt: 1,
        }],
        acceptedWidenings: [{ path: 'src/a.ts', rationale: 'frozen scope widening', derived: false, taskId: '1', sha: 'a' }],
        removalContext: { deletedFiles: ['old.ts'], removedDeclarations: ['old'], removedMembers: [] },
        verifyOnlyContext: [{
          taskId: '3',
          paths: ['src/verified.ts', 'test/verified.test.ts'],
        }],
        preservationContext: [{
          taskId: '5',
          behavior: 'the preserved behavior remains covered',
        }],
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
        cacheable: true, cacheProvenance: 'miss',
        sourceIdentities: { mergeBase: 'base', headSha: 'head' },
        output: { stdout: 'counterfactual stdout', stderr: 'counterfactual stderr' },
        eligibleSelectorRemovals: [{ selector: 'test/retired.test.ts', removals: ['retired'] }],
        scopedRun: { exitCode: 1, runKind: 'nonzero-exit', ranSelectors: ['test/a.test.ts'], failureExcerpt: 'AssertionError' },
      },
    },
    ...overrides,
  };
}

const ALL_RUBRICS = ['tautology', 'scope', 'rootCause', 'completeness'] as const;
type RubricKey = (typeof ALL_RUBRICS)[number];
type Source = BuildReviewProjectionSource;

function withSnapshot(src: Source, patch: Record<string, unknown>): Source {
  return {
    ...src,
    inputs: {
      ...src.inputs,
      sourceSnapshot: { ...src.inputs.sourceSnapshot, ...patch } as Source['inputs']['sourceSnapshot'],
    },
  };
}

function withProof(src: Source, patch: Record<string, unknown>): Source {
  return {
    ...src,
    inputs: {
      ...src.inputs,
      testSuiteProof: { ...src.inputs.testSuiteProof, ...patch } as Source['inputs']['testSuiteProof'],
    },
  };
}

function withPreflight(src: Source, patch: Record<string, unknown>): Source {
  return {
    ...src,
    tautology: {
      ...src.tautology,
      preflightEvidence: {
        ...(src.tautology.preflightEvidence as Record<string, unknown>),
        ...patch,
      } as Source['tautology']['preflightEvidence'],
    },
  };
}

function withReseal(src: Source, patch: Record<string, unknown>): Source {
  return withSnapshot(src, {
    operatorReseals: [{ ...src.inputs.sourceSnapshot.operatorReseals![0]!, ...patch }],
  });
}

function withWidening(src: Source, patch: Record<string, unknown>): Source {
  return withSnapshot(src, {
    acceptedWidenings: [{ ...src.inputs.sourceSnapshot.acceptedWidenings[0]!, ...patch }],
  });
}

function withRepair(src: Source, patch: Record<string, unknown>): Source {
  return withSnapshot(src, {
    repairContext: [{ ...src.inputs.sourceSnapshot.repairContext[0]!, ...patch }],
  });
}

function withRevertedProductionManifest(src: Source, patch: Record<string, unknown>): Source {
  return {
    ...src,
    tautology: {
      ...src.tautology,
      revertedProductionManifest: [{ ...src.tautology.revertedProductionManifest[0]!, ...patch }],
    },
  };
}

// Semantic siblings: content that MUST stay digest-sensitive next to each excluded key.
const contentFlip = (src: Source): Source => withSnapshot(src, {
  diff: FIXTURE_DIFF.replaceAll('src/a.ts', 'src/changed-a.ts'),
});
const proofFingerprintFlip = (src: Source): Source => withProof(src, { fingerprint: 'changed-proof-fingerprint' });
const preflightClassificationFlip = (src: Source): Source => withPreflight(src, { classification: 'green' });
const repairDiagnosticFlip = (src: Source): Source => withRepair(src, { diagnostic: 'changed repair diagnostic' });

/**
 * One paired case per key in the closed provenance vocabulary: mutating the
 * provenance key must never change any digest, while flipping a semantic
 * sibling in the same record must change the affected rubric digests.
 */
const provenanceKeyCoverage: Record<(typeof BUILD_REVIEW_PROVENANCE_KEYS)[number], {
  readonly provenance: (src: Source) => Source;
  readonly semanticSibling: (src: Source) => Source;
  readonly semanticAffected: readonly RubricKey[];
}> = {
  sha: {
    provenance: (src) => withWidening(src, { sha: 'rebased-widening-sha' }),
    semanticSibling: (src) => withWidening(src, { rationale: 'changed widening rationale' }),
    semanticAffected: ['scope'],
  },
  headSha: {
    provenance: (src) => withSnapshot(src, { headSha: 'rebased-head' }),
    semanticSibling: contentFlip,
    semanticAffected: ALL_RUBRICS,
  },
  mergeBase: {
    provenance: (src) => withSnapshot(src, { mergeBase: 'rebased-merge-base' }),
    semanticSibling: contentFlip,
    semanticAffected: ALL_RUBRICS,
  },
  baseRef: {
    provenance: (src) => withSnapshot(src, { baseRef: 'origin/rebased-main' }),
    semanticSibling: contentFlip,
    semanticAffected: ALL_RUBRICS,
  },
  fromCommit: {
    provenance: (src) => withReseal(src, { fromCommit: 'reseal-base-2' }),
    semanticSibling: (src) => withReseal(src, { reason: 'Operator approved revised protected-artifact scope.' }),
    semanticAffected: ['scope'],
  },
  toCommit: {
    provenance: (src) => withReseal(src, { toCommit: 'reseal-head-2' }),
    semanticSibling: (src) => withReseal(src, { paths: ['.docs/plans/also-resealed.md'] }),
    semanticAffected: ['scope'],
  },
  provenanceHeadSha: {
    provenance: (src) => withProof(src, { provenanceHeadSha: 'rebased-head' }),
    semanticSibling: proofFingerprintFlip,
    semanticAffected: ['tautology'],
  },
  sourceIdentities: {
    provenance: (src) => withPreflight(src, { sourceIdentities: { mergeBase: 'rebased-merge-base', headSha: 'rebased-head' } }),
    semanticSibling: preflightClassificationFlip,
    semanticAffected: ['tautology'],
  },
  lapId: {
    provenance: (src) => ({ ...src, lapId: parseBuildReviewLapId('lap-rebased')! }),
    semanticSibling: contentFlip,
    semanticAffected: ALL_RUBRICS,
  },
  snapshotDigest: {
    provenance: (src) => withSnapshot(src, { digest: 'sha256:rebased-snapshot' }),
    semanticSibling: contentFlip,
    semanticAffected: ALL_RUBRICS,
  },
  startedAt: {
    provenance: (src) => withProof(src, { startedAt: '2026-08-15T12:00:00.000Z' }),
    semanticSibling: proofFingerprintFlip,
    semanticAffected: ['tautology'],
  },
  endedAt: {
    provenance: (src) => withProof(src, { endedAt: '2026-08-15T12:00:08.000Z' }),
    semanticSibling: proofFingerprintFlip,
    semanticAffected: ['tautology'],
  },
  durationMs: {
    provenance: (src) => withProof(src, { durationMs: 8_000 }),
    semanticSibling: proofFingerprintFlip,
    semanticAffected: ['tautology'],
  },
  observedAt: {
    provenance: (src) => withRepair(src, { observedAt: 1_755_000_000_000 }),
    semanticSibling: repairDiagnosticFlip,
    semanticAffected: ['tautology', 'scope', 'rootCause'],
  },
  rebaseInvalidatedAt: {
    provenance: (src) => withRepair(src, { rebaseInvalidatedAt: 9_999 }),
    semanticSibling: (src) => withRepair(src, { reason: 'different_failure_reason' }),
    semanticAffected: ['tautology', 'scope', 'rootCause'],
  },
  id: {
    provenance: (src) => withRepair(src, { id: 'repair-rebased' }),
    semanticSibling: repairDiagnosticFlip,
    semanticAffected: ['tautology', 'scope', 'rootCause'],
  },
  commitSha: {
    provenance: (src) => withRepair(src, { commitSha: 'nested-rebased-commit' }),
    semanticSibling: repairDiagnosticFlip,
    semanticAffected: ['tautology', 'scope', 'rootCause'],
  },
  blobSha: {
    provenance: (src) => withRepair(src, { blobSha: 'nested-rebased-blob' }),
    semanticSibling: repairDiagnosticFlip,
    semanticAffected: ['tautology', 'scope', 'rootCause'],
  },
  executedAt: {
    provenance: (src) => withRepair(src, { executedAt: '2026-08-15T12:00:00.000Z' }),
    semanticSibling: repairDiagnosticFlip,
    semanticAffected: ['tautology', 'scope', 'rootCause'],
  },
  stdout: {
    provenance: (src) => withPreflight(
      withProof(src, { stdout: 'rerun full suite stdout' }),
      { output: { stdout: 'rerun counterfactual stdout', stderr: 'counterfactual stderr' } },
    ),
    semanticSibling: proofFingerprintFlip,
    semanticAffected: ['tautology'],
  },
  stderr: {
    provenance: (src) => withPreflight(
      withProof(src, { stderr: 'rerun full suite stderr' }),
      { output: { stdout: 'counterfactual stdout', stderr: 'rerun counterfactual stderr' } },
    ),
    semanticSibling: preflightClassificationFlip,
    semanticAffected: ['tautology'],
  },
  mergeBaseBlobSha: {
    provenance: (src) => withRevertedProductionManifest(src, { mergeBaseBlobSha: 'rebased-blob-sha' }),
    semanticSibling: (src) => withRevertedProductionManifest(src, { path: 'src/changed-a.ts' }),
    semanticAffected: ['tautology'],
  },
  cacheProvenance: {
    provenance: (src) => withPreflight(src, { cacheProvenance: 'hit' }),
    semanticSibling: preflightClassificationFlip,
    semanticAffected: ['tautology'],
  },
  cacheable: {
    provenance: (src) => withPreflight(src, { cacheable: false }),
    semanticSibling: preflightClassificationFlip,
    semanticAffected: ['tautology'],
  },
};

describe('build-review rubric projections', () => {
  describe('reduced-coverage publication contract (Task 19)', () => {
    const reducedCoverage = {
      kind: 'reduced-coverage' as const,
      version: 'v1' as const,
      feature: { version: 'v1' as const, repository: '/repo', feature: 'feature' },
      identity: { rubric: 'tautology' as const, reason: 'provider-error' as const },
      rationale: 'The provider transport was unavailable after the bounded retry.',
      operator: 'james',
      acceptedAt: '2026-08-20T12:00:00.000Z',
    };

    const currentFailure = {
      kind: 'infrastructure-failure' as const,
      rubric: 'tautology' as const,
      reason: 'provider-error' as const,
      detail: 'provider transport unavailable on this lap',
    };

    it('renders the same complete current-lap entry for every publication surface', () => {
      const rendered = renderBuildReviewReducedCoverageEvidence({
        state: 'known', records: [reducedCoverage], currentFailures: [currentFailure],
      });

      expect(rendered).toEqual({
        ok: true,
        section: [
          '## Reduced build-review coverage',
          '',
          '- Rubric: `tautology`',
          '  Cause: `provider-error`',
          '  Current diagnostic: provider transport unavailable on this lap',
          '  Operator: james',
          '  Rationale: The provider transport was unavailable after the bounded retry.',
          '  Decision time: 2026-08-20T12:00:00.000Z',
        ].join('\n'),
      });
    });

    it('re-stamps only the fault actually present on the current lap', () => {
      const rendered = renderBuildReviewReducedCoverageEvidence({
        state: 'known',
        records: [reducedCoverage],
        currentFailures: [{ ...currentFailure, detail: 'fresh current diagnostic' }],
      });

      expect(rendered).toMatchObject({ ok: true, section: expect.stringContaining('Current diagnostic: fresh current diagnostic') });
      expect(rendered).not.toMatchObject({ section: expect.stringContaining('Current diagnostic: provider transport unavailable on this lap') });
    });

    it('fails closed when a known decision cannot be rendered', () => {
      expect(renderBuildReviewReducedCoverageEvidence({
        state: 'known',
        records: [{ ...reducedCoverage, operator: '   ' }],
        currentFailures: [currentFailure],
      })).toEqual({ ok: false, message: 'reduced build-review coverage contains an unrenderable decision' });
    });

    it('does not invent a section for absent or unreadable decision state', () => {
      expect(renderBuildReviewReducedCoverageEvidence({ state: 'absent' })).toEqual({ ok: true, section: undefined });
      expect(renderBuildReviewReducedCoverageEvidence({ state: 'unreadable' })).toEqual({ ok: true, section: undefined });
    });
  });

  it('derives the four closed projections with every skill dependency and a v1 digest', () => {
    const fixture = source();
    const projections = deriveBuildReviewRubricProjections(fixture);

    expect(Object.keys(projections)).toEqual(['tautology', 'scope', 'rootCause', 'completeness']);
    expect(Object.keys(projections.tautology).sort()).toEqual([
      'changedFiles', 'changedTestSelectors', 'changedTestTitles', 'contentDigest', 'contractVersion', 'digest', 'headSha', 'lapId',
      'mergeBase', 'preflightEvidence', 'projectionVersion', 'removalContext', 'repairContext',
      'revertedProductionManifest', 'rubric', 'snapshotDigest', 'testSuiteProof',
      'verifyOnlyContext',
    ]);
    expect(Object.keys(projections.scope).sort()).toEqual([
      'acceptedWidenings', 'changedFiles', 'contentDigest', 'contractVersion', 'digest', 'headSha', 'lapId',
      'mergeBase', 'operatorReseals', 'planBody', 'projectionVersion', 'removalContext',
      'repairContext', 'rubric', 'snapshotDigest',
      'verifyOnlyContext',
    ]);
    expect(Object.keys(projections.rootCause).sort()).toEqual([
      'changedFiles', 'contentDigest', 'contractVersion', 'digest', 'headSha', 'lapId', 'mergeBase', 'planBody',
      'projectionVersion', 'removalContext', 'repairContext', 'rubric', 'snapshotDigest',
      'verifyOnlyContext',
    ]);
    expect(Object.keys(projections.completeness).sort()).toEqual([
      'changedFiles', 'contentDigest', 'contractVersion', 'digest', 'headSha', 'lapId', 'mergeBase', 'planBody',
      'preservationContext', 'projectionVersion', 'removalContext', 'rubric', 'snapshotDigest', 'verifyOnlyContext',
    ]);
    expect(projections.tautology).toMatchObject({
      rubric: 'tautology', projectionVersion: 'v2', lapId, snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content',
      mergeBase: 'base', headSha: 'head',
      changedFiles: [{
        path: 'src/a.ts', changeKind: 'modified',
        hunks: [{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 3 }],
      }],
      removalContext: { deletedFiles: ['old.ts'], removedDeclarations: ['old'], removedMembers: [] },
      verifyOnlyContext: [{
        taskId: '3',
        paths: ['src/verified.ts', 'test/verified.test.ts'],
      }],
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
    expect(projections.completeness).toMatchObject({
      planBody: '# Approved plan\n',
      preservationContext: [{ taskId: '5', behavior: 'the preserved behavior remains covered' }],
      projectionVersion: 'v2',
      changedFiles: expect.any(Array),
    });
    // The raw diff body must never travel inside a projection — only references do.
    for (const projection of Object.values(projections)) {
      expect(JSON.stringify(projection)).not.toContain('embedded-diff-body-line');
      expect(projection.verifyOnlyContext).toEqual(fixture.inputs.sourceSnapshot.verifyOnlyContext);
    }
    expect(projections.tautology).not.toHaveProperty('planBody');
    for (const projection of [projections.tautology, projections.rootCause, projections.completeness]) {
      expect(projection).not.toHaveProperty('operatorReseals');
    }
    for (const projection of Object.values(projections)) {
      expect(projection.contractVersion).toBe('v3');
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
          startedAt: '2026-08-15T12:00:00.000Z', endedAt: '2026-08-15T12:00:08.000Z', durationMs: 8_000,
          stdout: 'rebased full suite stdout', stderr: 'rebased full suite stderr',
        },
        sourceSnapshot: {
          ...original.inputs.sourceSnapshot,
          digest: 'sha256:rebased-snapshot',
          baseRef: 'origin/rebased-main',
          mergeBase: 'rebased-merge-base',
          headSha: 'rebased-head',
          acceptedWidenings: [{
            ...original.inputs.sourceSnapshot.acceptedWidenings[0]!,
            sha: 'rebased-widening-sha',
          }],
          operatorReseals: [{
            ...original.inputs.sourceSnapshot.operatorReseals![0]!,
            fromCommit: 'rebased-reseal-base',
            toCommit: 'rebased-reseal-head',
          }],
          repairContext: [{
            ...original.inputs.sourceSnapshot.repairContext[0]!,
            id: 'repair-rebased',
            rebaseInvalidatedAt: 9_999,
          }],
        },
      },
      tautology: {
        ...original.tautology,
        preflightEvidence: {
          classification: 'red',
          cacheable: true, cacheProvenance: 'hit',
          sourceIdentities: { mergeBase: 'rebased-merge-base', headSha: 'rebased-head' },
          output: { stdout: 'rebased counterfactual stdout', stderr: 'rebased counterfactual stderr' },
          eligibleSelectorRemovals: [{ selector: 'test/retired.test.ts', removals: ['retired'] }],
          scopedRun: { exitCode: 1, runKind: 'nonzero-exit', ranSelectors: ['test/a.test.ts'], failureExcerpt: 'AssertionError' },
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
    expect(rebased.tautology.preflightEvidence).toMatchObject({
      sourceIdentities: { mergeBase: 'rebased-merge-base', headSha: 'rebased-head' },
      cacheProvenance: 'hit',
      output: { stdout: 'rebased counterfactual stdout', stderr: 'rebased counterfactual stderr' },
    });
    expect(rebased.tautology.testSuiteProof).toMatchObject({
      provenanceHeadSha: 'rebased-head',
      startedAt: '2026-08-15T12:00:00.000Z', endedAt: '2026-08-15T12:00:08.000Z', durationMs: 8_000,
      stdout: 'rebased full suite stdout', stderr: 'rebased full suite stderr',
    });
    expect(rebased.tautology.repairContext).toMatchObject([{ id: 'repair-rebased', rebaseInvalidatedAt: 9_999 }]);
    expect(rebased.scope.operatorReseals).toMatchObject([{ fromCommit: 'rebased-reseal-base', toCommit: 'rebased-reseal-head' }]);

    const contentMutations: readonly {
      readonly name: string;
      readonly affectedRubrics: readonly (keyof typeof first)[];
      readonly changed: BuildReviewProjectionSource;
    }[] = [
      {
        name: 'diff text', affectedRubrics: ['tautology', 'scope', 'rootCause', 'completeness'],
        changed: source({ inputs: { ...original.inputs, sourceSnapshot: {
          ...original.inputs.sourceSnapshot, diff: FIXTURE_DIFF.replaceAll('src/a.ts', 'src/changed-a.ts'),
        } } }),
      },
      {
        name: 'plan body', affectedRubrics: ['scope', 'rootCause', 'completeness'],
        changed: source({ inputs: { ...original.inputs, sourceSnapshot: {
          ...original.inputs.sourceSnapshot, planBody: '# Changed plan\n',
        } } }),
      },
      {
        name: 'repair context', affectedRubrics: ['tautology', 'scope', 'rootCause'],
        changed: source({ inputs: { ...original.inputs, sourceSnapshot: {
          ...original.inputs.sourceSnapshot,
          repairContext: [{ id: 'repair-new', reason: 'command_failed', diagnostic: 'new', rebaseInvalidatedAt: 3 }],
        } } }),
      },
      {
        name: 'accepted widenings', affectedRubrics: ['scope'],
        changed: source({ inputs: { ...original.inputs, sourceSnapshot: {
          ...original.inputs.sourceSnapshot,
          acceptedWidenings: [{ path: 'src/new.ts', rationale: 'new', derived: false, taskId: '3', sha: 'new' }],
        } } }),
      },
      {
        name: 'removal context', affectedRubrics: ['tautology', 'scope', 'rootCause', 'completeness'],
        changed: source({ inputs: { ...original.inputs, sourceSnapshot: {
          ...original.inputs.sourceSnapshot,
          removalContext: { deletedFiles: ['new-old.ts'], removedDeclarations: ['new-old'], removedMembers: [] },
        } } }),
      },
      {
        name: 'verify-only context', affectedRubrics: ['tautology', 'scope', 'rootCause', 'completeness'],
        changed: source({ inputs: { ...original.inputs, sourceSnapshot: {
          ...original.inputs.sourceSnapshot,
          verifyOnlyContext: [{
            taskId: '3',
            paths: ['src/changed-verified.ts', 'test/verified.test.ts'],
          }],
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

  it('pairs digest coverage with every key in the closed provenance vocabulary', () => {
    expect(Object.keys(provenanceKeyCoverage).sort()).toEqual([...BUILD_REVIEW_PROVENANCE_KEYS].sort());
  });

  it.each([...BUILD_REVIEW_PROVENANCE_KEYS])(
    'ignores provenance key %s in every digest while its semantic sibling stays digest-sensitive',
    (key) => {
      const coverage = provenanceKeyCoverage[key];
      const first = deriveBuildReviewRubricProjections(source());

      const provenanceChanged = deriveBuildReviewRubricProjections(coverage.provenance(source()));
      for (const rubric of ALL_RUBRICS) {
        expect(provenanceChanged[rubric].digest, `${key} must not perturb the ${rubric} digest`).toBe(first[rubric].digest);
      }

      const semanticChanged = deriveBuildReviewRubricProjections(coverage.semanticSibling(source()));
      for (const rubric of ALL_RUBRICS) {
        if (coverage.semanticAffected.includes(rubric)) {
          expect(semanticChanged[rubric].digest, `${key}'s semantic sibling must change the ${rubric} digest`).not.toBe(first[rubric].digest);
        } else {
          expect(semanticChanged[rubric].digest, `${key}'s semantic sibling must not change the ${rubric} digest`).toBe(first[rubric].digest);
        }
      }
    },
  );

  it('ignores provenance nested at any depth inside evidence records', () => {
    // Regression: a nested commit SHA or execution-timing field must not
    // change any projection digest — normalization is recursive, not
    // record-shaped, so nesting can never hide provenance again.
    const nested = (headSha: string, startedAt: string, stdout: string): Source => withPreflight(
      withRepair(source(), {
        execution: { provenanceHeadSha: headSha, timing: { startedAt, durationMs: stdout.length } },
      }),
      { counterfactualRun: { anchors: { headSha }, output: { stdout } } },
    );
    const first = deriveBuildReviewRubricProjections(nested('nested-head-a', '2026-08-15T11:00:00.000Z', 'nested log a'));
    const second = deriveBuildReviewRubricProjections(nested('nested-head-b', '2026-08-15T12:00:00.000Z', 'nested log b'));
    for (const rubric of ALL_RUBRICS) {
      expect(second[rubric].digest, `nested provenance must not perturb the ${rubric} digest`).toBe(first[rubric].digest);
    }

    // A semantic field at the same nesting depth stays digest-sensitive.
    const nestedSemantic = (verdict: string): Source =>
      withRepair(source(), { execution: { verdict } });
    expect(deriveBuildReviewRubricProjections(nestedSemantic('flaky')).tautology.digest)
      .not.toBe(deriveBuildReviewRubricProjections(nestedSemantic('settled')).tautology.digest);
  });

  it('keeps counterfactual output and full-suite transcripts readable while digests ignore them', () => {
    const first = deriveBuildReviewRubricProjections(source());
    const second = deriveBuildReviewRubricProjections(withPreflight(
      withProof(source(), { stdout: 'rerun full suite stdout', stderr: 'rerun full suite stderr' }),
      { output: { stdout: 'rerun counterfactual stdout', stderr: 'rerun counterfactual stderr' } },
    ));

    for (const rubric of ALL_RUBRICS) {
      expect(second[rubric].digest).toBe(first[rubric].digest);
    }
    expect(second.tautology.testSuiteProof).toMatchObject({
      stdout: 'rerun full suite stdout', stderr: 'rerun full suite stderr',
    });
    expect(second.tautology.preflightEvidence).toMatchObject({
      output: { stdout: 'rerun counterfactual stdout', stderr: 'rerun counterfactual stderr' },
    });
  });

  it.each([
    ['rationale', { reason: 'Operator approved revised protected-artifact scope.' }],
    ['named path', { paths: ['.docs/plans/also-resealed.md'] }],
  ])('changes only Scope when an operator reseal semantic %s changes', (_field, mutation) => {
    const first = deriveBuildReviewRubricProjections(source());
    const original = source();
    const second = deriveBuildReviewRubricProjections(source({
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
    }));

    expect(second.scope.digest).not.toBe(first.scope.digest);
    expect(second.tautology.digest).toBe(first.tautology.digest);
    expect(second.rootCause.digest).toBe(first.rootCause.digest);
    expect(second.completeness.digest).toBe(first.completeness.digest);
  });

  it.each([
    ['reason', { reason: 'different_failure_reason' }],
    ['diagnostic', { diagnostic: 'different semantic diagnostic' }],
  ])('changes only repair-consuming rubric digests when repair-record %s changes', (_field, mutation) => {
    const first = deriveBuildReviewRubricProjections(source());
    const original = source();
    const second = deriveBuildReviewRubricProjections(source({
      inputs: {
        ...original.inputs,
          sourceSnapshot: {
            ...original.inputs.sourceSnapshot,
            repairContext: [{ ...original.inputs.sourceSnapshot.repairContext[0]!, ...mutation }],
        },
      },
    }));

    expect(second.tautology.digest).not.toBe(first.tautology.digest);
    expect(second.scope.digest).not.toBe(first.scope.digest);
    expect(second.rootCause.digest).not.toBe(first.rootCause.digest);
    expect(second.completeness.digest).toBe(first.completeness.digest);
  });

  it('changes the Completeness cache digest when preservation context is present', () => {
    const withoutPreservation = deriveBuildReviewRubricProjections(withSnapshot(source(), {
      preservationContext: [],
    }));
    const withPreservation = deriveBuildReviewRubricProjections(withSnapshot(source(), {
      preservationContext: [{ taskId: '5', behavior: 'the preserved behavior now requires a dedicated test' }],
    }));

    expect(withPreservation.completeness.digest).not.toBe(withoutPreservation.completeness.digest);
  });

  it('derives Scope widenings solely from the frozen source snapshot and isolates them from the other rubric payloads', () => {
    const original = source();
    const first = deriveBuildReviewRubricProjections(original);
    const changed = source({
      inputs: {
        ...original.inputs,
        // This live input is deliberately stale: it must not be able to alter
        // a projection after input assembly has sealed the source snapshot.
        acceptedWidenings: [{ path: 'src/live-only.ts', rationale: 'must not leak', derived: false, taskId: '99', sha: 'live' }],
        sourceSnapshot: {
          ...original.inputs.sourceSnapshot,
          acceptedWidenings: [{ path: 'src/b.ts', rationale: 'new frozen widening', derived: false, taskId: '2', sha: 'b' }],
        },
      },
    });
    const second = deriveBuildReviewRubricProjections(changed);

    expect(first.scope.acceptedWidenings).toEqual([{ path: 'src/a.ts', rationale: 'frozen scope widening', derived: false, taskId: '1', sha: 'a' }]);
    expect(second.scope.acceptedWidenings).toEqual([{ path: 'src/b.ts', rationale: 'new frozen widening', derived: false, taskId: '2', sha: 'b' }]);
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
          { oldStart: 10, oldCount: 4, newStart: 10, newCount: 6, contentHash: 'sha256:40e1dac31c43a032d6e6681887bb188d68980d6881884495cf776a9c22ad5a50' },
          { oldStart: 40, oldCount: 1, newStart: 42, newCount: 0, contentHash: 'sha256:3295b11d83ea93de0d25ecd955af250d843f8337c57dbf93c80715cea57ca684' },
        ],
      },
      { path: 'src/new.ts', changeKind: 'added', hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2, contentHash: 'sha256:919b1d2ddefb109d9af7518dc903b3451927f27574c6dc167d6394d2a8b63842' }] },
      { path: 'src/gone.ts', changeKind: 'deleted', hunks: [{ oldStart: 1, oldCount: 1, newStart: 0, newCount: 0, contentHash: 'sha256:ffcb1224e9f840636892ab01e9518d523d00b29934eaa8588ee54524c34b8d43' }] },
      {
        path: 'src/new-name.ts', changeKind: 'renamed', previousPath: 'src/old-name.ts',
        hunks: [{ oldStart: 3, oldCount: 2, newStart: 3, newCount: 2, contentHash: 'sha256:f5fbd28f77098cd3e707b7b4e5b73327fdfa7c8cf8fddaafaa2bcc1766eeac51' }],
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
