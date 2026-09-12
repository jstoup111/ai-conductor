// Covers: task:26
import { describe, expect, it, vi } from 'vitest';

import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { stampBuildReviewDispatchedCandidate, validateBuildReviewDispatchedResult } from '../../src/engine/build-review-coordinator.js';
import {
  buildReviewBranchArtifactPath,
  parseBuildReviewBranchArtifact,
  readBuildReviewBranchArtifact,
  writeBuildReviewBranchArtifact,
  type BuildReviewArtifactFilesystem,
} from '../../src/engine/build-review-artifacts.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';

const lapId = parseBuildReviewLapId('lap-current')!;

function filesystem(files: Record<string, string> = {}): BuildReviewArtifactFilesystem & { files: Record<string, string> } {
  return {
    files,
    readFile: vi.fn(async (path: string) => {
      if (!(path in files)) throw new Error('missing');
      return files[path]!;
    }),
    mkdir: vi.fn(async () => {}),
    writeFile: vi.fn(async (path: string, contents: string) => { files[path] = contents; }),
    rename: vi.fn(async (from: string, to: string) => { files[to] = files[from]!; delete files[from]; }),
  };
}

function judged(contractVersion: 'v1' | 'v2' = 'v1') {
  return {
    kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot',
    contractVersion: contractVersion as never, findings: [], verdict: 'PASS' as const,
  };
}

const persistedV1Artifact = {
    version: 1,
    rubric: 'testQuality',
    lapId,
    snapshotDigest: 'sha256:snapshot',
    result: {
      kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v1',
      findings: [{
        concernKind: 'test-insensitive', summary: 'A changed test does not observe the behavior it should.',
        evidenceLocations: ['src/conductor/src/engine/build-review-artifacts.ts:1'],
        anchor: { rubric: 'testQuality', locus: { path: 'src/conductor/test/engine/build-review-artifacts.test.ts', contentHash: 'sha256:fixture', display: 'fixture test' } },
      }],
      verdict: 'FAIL',
    },
    provenance: { kind: 'fresh' },
} as const;

const persistedV2Artifact = {
    version: 1,
    rubric: 'testQuality',
    lapId,
    snapshotDigest: 'sha256:snapshot',
    result: {
      kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2',
      findings: [{
        concernKind: 'test-insensitive', summary: 'A changed test does not observe the behavior it should.',
        evidenceLocations: ['src/conductor/src/engine/build-review-artifacts.ts:1'],
        anchor: { rubric: 'testQuality', locus: { path: 'src/conductor/test/engine/build-review-artifacts.test.ts', contentHash: 'sha256:fixture', display: 'fixture test' } },
      }],
      verdict: 'FAIL',
    },
    provenance: { kind: 'fresh' },
} as const;

const persistedV3Artifact = {
  version: 1,
  rubric: 'testQuality',
  lapId,
  snapshotDigest: 'sha256:snapshot',
  result: {
    kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3',
    findings: [{
      concernKind: 'test-insensitive', summary: 'A legacy v3 finding identity remains readable.',
      evidenceLocations: ['src/conductor/src/engine/build-review-artifacts.ts:1'],
      anchor: { rubric: 'testQuality', locus: { path: 'src/conductor/test/engine/build-review-artifacts.test.ts', contentHash: 'sha256:fixture', display: 'fixture test' } },
    }],
    verdict: 'FAIL',
  },
  provenance: { kind: 'fresh' },
} as const;

const CUSTOM_DIGEST = `sha256:${'c'.repeat(64)}`;
const customDescriptor = {
  version: 'v1',
  semanticSkill: 'security-review',
  declaration: {
    version: 'v1', rubricId: 'security', semanticSkill: 'security-review', question: 'Find security regressions.',
    source: 'plugin', resources: ['references/security.md'],
  },
  installation: { source: 'plugin', plugin: { id: 'security-suite', version: '2.1.0' } },
  effectivePolicy: { version: 'v1', bundleDigest: CUSTOM_DIGEST },
  reviewedInput: { version: 'v1', contentDigest: CUSTOM_DIGEST },
  producer: { provider: 'codex', model: 'gpt-5.6', effort: 'high' },
} as const;

const customJudgedResult = {
  kind: 'judged', contractVersion: 'custom-v1', rubric: 'security', lapId: 'lap-current',
  declaration: customDescriptor.declaration,
  policy: customDescriptor.effectivePolicy,
  candidate: customDescriptor.producer,
  reviewedInput: customDescriptor.reviewedInput,
  findings: [], verdict: 'PASS',
  identity: {
    id: CUSTOM_DIGEST,
    canonicalPayload: {
      version: 'v1', rubric: 'security', declaration: customDescriptor.declaration,
      policy: customDescriptor.effectivePolicy, candidate: customDescriptor.producer,
      reviewedInput: customDescriptor.reviewedInput, findingIds: [],
    },
    canonicalJson: '{}',
  },
} as const;

describe('build-review current-lap branch artifacts', () => {
  it('uses a write-disjoint path for every lap', () => {
    expect([
      buildReviewBranchArtifactPath('/feature', lapId, 'testQuality'),
      buildReviewBranchArtifactPath('/feature', parseBuildReviewLapId('lap-next')!, 'testQuality'),
    ]).toEqual([
      '/feature/.pipeline/build-review/lap-current/testQuality.json',
      '/feature/.pipeline/build-review/lap-next/testQuality.json',
    ]);
  });

  it('stamps engine-owned identity and atomically writes only the addressed branch', async () => {
    const fs = filesystem();
    const artifact = await writeBuildReviewBranchArtifact('/feature', {
      rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', result: judged(), provenance: { kind: 'fresh' },
    }, fs);

    expect(artifact).toMatchObject({ rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', result: judged() });
    expect(Object.keys(fs.files)).toEqual(['/feature/.pipeline/build-review/lap-current/testQuality.json']);
    expect(await readBuildReviewBranchArtifact('/feature', 'testQuality', lapId, 'sha256:snapshot', fs)).toEqual(artifact);
  });

  it('round-trips optional counterfactual sensitivity through the stamped envelope, artifact, and aggregate', async () => {
    const projection = {
      rubric: 'testQuality', contractVersion: 'v3', projectionVersion: 'v2', lapId, snapshotDigest: 'sha256:snapshot',
      contentDigest: 'sha256:content', digest: 'sha256:projection', mergeBase: 'base', headSha: 'head', changedFiles: [],
      removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
      planBody: '# Plan', repairContext: [], acceptedWidenings: [], operatorReseals: [],
    } as never;
    const result = validateBuildReviewDispatchedResult(
      stampBuildReviewDispatchedCandidate({ findings: [], counterfactualSensitivity: 'indeterminate' }, 'testQuality', projection),
      'testQuality', projection,
    )!;
    const fs = filesystem();
    await writeBuildReviewBranchArtifact('/feature', {
      rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', result, provenance: { kind: 'fresh' },
    }, fs);
    const reread = await readBuildReviewBranchArtifact('/feature', 'testQuality', lapId, 'sha256:snapshot', fs);

    expect(result).toMatchObject({ counterfactualSensitivity: 'indeterminate' });
    expect(reread?.result).toMatchObject({ counterfactualSensitivity: 'indeterminate' });
    expect(joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', results: { testQuality: reread!.result } }))
      .toMatchObject({ results: { testQuality: { counterfactualSensitivity: 'indeterminate' } } });

    const absent = stampBuildReviewDispatchedCandidate({ findings: [] }, 'testQuality', projection) as Record<string, unknown>;
    expect(Object.keys(absent)).toEqual(['kind', 'rubric', 'contractVersion', 'lapId', 'snapshotDigest', 'findings']);
  });

  it('round-trips engine-validated scope resolutions through the branch artifact reader', async () => {
    const scopeRegion = { path: 'test/widget.test.ts', startLine: 1, endLine: 1, contentHash: `sha256:${'a'.repeat(64)}`, display: 'widget persists state' };
    const projection = {
      rubric: 'testQuality', contractVersion: 'v3', projectionVersion: 'v3', lapId, snapshotDigest: 'sha256:snapshot',
      contentDigest: 'sha256:content', digest: 'sha256:projection', mergeBase: 'base', headSha: 'head', changedFiles: [], changedTestSelectors: [], runnerSelectors: [], unresolvedMarkers: [], changedTestTitles: [],
      testScope: { candidates: [{ candidateId: 'candidate-widget', sourceRegion: scopeRegion, obligationReferences: ['criterion:S5.1'] }] }, testSuiteProof: {}, revertedProductionManifest: [], preflight: { classification: 'approved-exception', exception: 'empty-test-set' },
    } as never;
    const resolution = { candidateId: 'candidate-widget', status: 'out-of-scope', exclusionReason: 'Pinned candidate is unrelated.' };
    const result = validateBuildReviewDispatchedResult(stampBuildReviewDispatchedCandidate({ findings: [], scopeResolutions: [resolution] }, 'testQuality', projection), 'testQuality', projection)!;
    const fs = filesystem();
    await writeBuildReviewBranchArtifact('/feature', { rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', result, provenance: { kind: 'fresh' } }, fs);

    await expect(readBuildReviewBranchArtifact('/feature', 'testQuality', lapId, 'sha256:snapshot', fs)).resolves.toMatchObject({
      result: { scopeResolutions: [resolution], verdict: 'PASS' },
    });
    const reread = await readBuildReviewBranchArtifact('/feature', 'testQuality', lapId, 'sha256:snapshot', fs);
    expect(joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', results: { testQuality: reread!.result } }))
      .toMatchObject({ results: { testQuality: { scopeResolutions: [resolution] } } });
  });

  async function exerciseLiveV3StampBoundary(fs: BuildReviewArtifactFilesystem): Promise<void> {
    const projection = {
      rubric: 'testQuality', contractVersion: 'v3', projectionVersion: 'v2', lapId, snapshotDigest: 'sha256:snapshot',
      contentDigest: 'sha256:content', digest: 'sha256:projection', mergeBase: 'base', headSha: 'head', changedFiles: [],
      removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
      planBody: '# Plan', repairContext: [], acceptedWidenings: [], operatorReseals: [],
    } as never;
    const stamped = stampBuildReviewDispatchedCandidate({ findings: [] }, 'testQuality', projection);
    const result = validateBuildReviewDispatchedResult(stamped, 'testQuality', projection)!;
    const artifact = await writeBuildReviewBranchArtifact('/feature', {
      rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', result, provenance: { kind: 'fresh' },
    }, fs);
    expect(artifact.result).toMatchObject({ contractVersion: 'v3', lapId, snapshotDigest: 'sha256:snapshot', findings: [] });
  }

  it('stamps a live v3 envelope before parsing a persisted v1 artifact at rest', async () => {
    const path = buildReviewBranchArtifactPath('/feature', lapId, 'testQuality');
    const fs = filesystem({ [path]: JSON.stringify(persistedV1Artifact) });

    await exerciseLiveV3StampBoundary(filesystem());
    await expect(readBuildReviewBranchArtifact('/feature', 'testQuality', lapId, 'sha256:snapshot', fs)).resolves.toMatchObject({
      result: { contractVersion: 'v1', findings: [{ anchor: { rubric: 'testQuality' } }] },
    });
  });

  it('stamps a live v3 envelope before parsing a persisted v2 artifact at rest', async () => {
    const path = buildReviewBranchArtifactPath('/feature', lapId, 'testQuality');
    const fs = filesystem({ [path]: JSON.stringify(persistedV2Artifact) });

    await exerciseLiveV3StampBoundary(filesystem());
    await expect(readBuildReviewBranchArtifact('/feature', 'testQuality', lapId, 'sha256:snapshot', fs)).resolves.toMatchObject({
      result: { contractVersion: 'v2', findings: [{ anchor: { rubric: 'testQuality' } }] },
    });
  });

  it('keeps a legacy result-v3 finding identity readable without migrating its persisted shape', async () => {
    const path = buildReviewBranchArtifactPath('/feature', lapId, 'testQuality');
    const fs = filesystem({ [path]: JSON.stringify(persistedV3Artifact) });

    await expect(readBuildReviewBranchArtifact('/feature', 'testQuality', lapId, 'sha256:snapshot', fs)).resolves.toMatchObject({
      result: { contractVersion: 'v3', findings: [{ anchor: { rubric: 'testQuality', locus: { contentHash: 'sha256:fixture' } } }] },
    });
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['unknown envelope field', JSON.stringify({ version: 1, rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', result: judged(), provenance: { kind: 'fresh' }, extra: true })],
    ['mismatched result identity', JSON.stringify({ version: 1, rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', result: { ...judged(), rubric: 'scope' }, provenance: { kind: 'fresh' } })],
    ['missing result', JSON.stringify({ version: 1, rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', provenance: { kind: 'fresh' } })],
  ])('rejects %s without promoting it to a current branch', async (_name, raw) => {
    const path = buildReviewBranchArtifactPath('/feature', lapId, 'testQuality');
    const fs = filesystem({ [path]: raw });
    if (raw.startsWith('{not json')) {
      expect(() => JSON.parse(raw)).toThrow();
    } else {
      expect(parseBuildReviewBranchArtifact(JSON.parse(raw))).toBeUndefined();
    }
    await expect(readBuildReviewBranchArtifact('/feature', 'testQuality', lapId, 'sha256:snapshot', fs)).resolves.toBeUndefined();
  });

  it('accepts cache provenance only when the rematerialized result names the current lap and snapshot', async () => {
    const artifact = {
      version: 1,
      rubric: 'testQuality',
      lapId,
      snapshotDigest: 'sha256:snapshot',
      result: judged(),
      provenance: {
        kind: 'cache-hit', cachedLapId: parseBuildReviewLapId('lap-old')!, cachedSnapshotDigest: 'sha256:old',
        projectionDigest: 'sha256:projection', policyFingerprint: 'sha256:policy',
      },
    } as const;
    expect(parseBuildReviewBranchArtifact(artifact)).toEqual(artifact);
    expect(parseBuildReviewBranchArtifact({ ...artifact, result: { ...artifact.result, lapId: parseBuildReviewLapId('lap-old')! } })).toBeUndefined();
  });

  it('round-trips versioned self-describing custom judgement provenance and a separate current-lap reuse link', async () => {
    const fs = filesystem();
    const artifact = {
      version: 2,
      rubric: 'security', lapId: 'lap-current', snapshotDigest: 'sha256:snapshot',
      descriptor: customDescriptor,
      result: customJudgedResult,
      provenance: { kind: 'cache-hit', cachedLapId: 'lap-prior', cachedSnapshotDigest: 'sha256:prior', projectionDigest: CUSTOM_DIGEST, policyFingerprint: CUSTOM_DIGEST },
      reuse: { sourceLapId: 'lap-prior', sourceSnapshotDigest: 'sha256:prior' },
    };

    expect(parseBuildReviewBranchArtifact(artifact)).toEqual(artifact);
    await writeBuildReviewBranchArtifact('/feature', artifact as never, fs);
    await expect(readBuildReviewBranchArtifact('/feature', 'security' as never, 'lap-current' as never, 'sha256:snapshot', fs)).resolves.toEqual(artifact);
  });

  it('retains a validated declaration on a custom loading failure without inventing judged provenance', () => {
    const failure = {
      version: 2, rubric: 'security', lapId: 'lap-current', snapshotDigest: 'sha256:snapshot',
      declaration: customDescriptor.declaration,
      result: { kind: 'infrastructure-failure', rubric: 'security', reason: 'policy-load-failed', detail: 'plugin is unavailable' },
      provenance: { kind: 'fresh' },
    };

    expect(parseBuildReviewBranchArtifact(failure)).toMatchObject({ declaration: customDescriptor.declaration, result: { kind: 'infrastructure-failure' } });
    expect(parseBuildReviewBranchArtifact({ ...failure, descriptor: customDescriptor })).toBeUndefined();
  });
});
