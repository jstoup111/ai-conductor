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

  async function exerciseLiveV3StampBoundary(fs: BuildReviewArtifactFilesystem): Promise<void> {
    const projection = {
      rubric: 'testQuality', contractVersion: 'v3', projectionVersion: 'v2', lapId, snapshotDigest: 'sha256:snapshot',
      contentDigest: 'sha256:content', digest: 'sha256:projection', mergeBase: 'base', headSha: 'head', changedFiles: [],
      removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, verifyOnlyContext: [],
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
});
