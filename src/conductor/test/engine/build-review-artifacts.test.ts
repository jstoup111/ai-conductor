import { describe, expect, it, vi } from 'vitest';

import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
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
    kind: 'judged' as const, rubric: 'scope' as const, lapId, snapshotDigest: 'sha256:snapshot',
    contractVersion: contractVersion as never, findings: [], verdict: 'PASS' as const,
  };
}

const persistedV1ScopeArtifact = {
    version: 1,
    rubric: 'scope',
    lapId,
    snapshotDigest: 'sha256:snapshot',
    result: {
      kind: 'judged', rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v1',
      findings: [{
        concernKind: 'out-of-plan-change', summary: 'A change is outside the approved plan.',
        evidenceLocations: ['src/conductor/src/engine/build-review-artifacts.ts:1'],
        anchor: { rubric: 'scope', path: 'src/conductor/src/engine/build-review-artifacts.ts', relation: 'out-of-plan-change' },
      }],
      verdict: 'FAIL',
    },
    provenance: { kind: 'fresh' },
} as const;

const persistedV2ScopeArtifact = {
    version: 1,
    rubric: 'scope',
    lapId,
    snapshotDigest: 'sha256:snapshot',
    result: {
      kind: 'judged', rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2',
      findings: [{
        concernKind: 'out-of-plan-change', summary: 'A change is outside the approved plan.',
        evidenceLocations: ['src/conductor/src/engine/build-review-artifacts.ts:1'],
        anchor: { rubric: 'scope', path: 'src/conductor/src/engine/build-review-artifacts.ts', relation: 'not-authorized-by-plan' },
      }],
      verdict: 'FAIL',
    },
    provenance: { kind: 'fresh' },
} as const;

describe('build-review current-lap branch artifacts', () => {
  it('uses a write-disjoint path for every rubric and lap', () => {
    expect([
      buildReviewBranchArtifactPath('/feature', lapId, 'scope'),
      buildReviewBranchArtifactPath('/feature', lapId, 'tautology'),
      buildReviewBranchArtifactPath('/feature', parseBuildReviewLapId('lap-next')!, 'scope'),
    ]).toEqual([
      '/feature/.pipeline/build-review/lap-current/scope.json',
      '/feature/.pipeline/build-review/lap-current/tautology.json',
      '/feature/.pipeline/build-review/lap-next/scope.json',
    ]);
  });

  it('stamps engine-owned identity and atomically writes only the addressed branch', async () => {
    const fs = filesystem();
    const artifact = await writeBuildReviewBranchArtifact('/feature', {
      rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', result: judged(), provenance: { kind: 'fresh' },
    }, fs);

    expect(artifact).toMatchObject({ rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', result: judged() });
    expect(Object.keys(fs.files)).toEqual(['/feature/.pipeline/build-review/lap-current/scope.json']);
    expect(await readBuildReviewBranchArtifact('/feature', 'scope', lapId, 'sha256:snapshot', fs)).toEqual(artifact);
  });

  it('parses a persisted v1 record with v1-only scope relation at rest', async () => {
    const path = buildReviewBranchArtifactPath('/feature', lapId, 'scope');
    const fs = filesystem({ [path]: JSON.stringify(persistedV1ScopeArtifact) });

    await expect(readBuildReviewBranchArtifact('/feature', 'scope', lapId, 'sha256:snapshot', fs)).resolves.toMatchObject({
      result: { contractVersion: 'v1', findings: [{ anchor: { relation: 'out-of-plan-change' } }] },
    });
  });

  it('parses a persisted v2 record with v2-only scope relation at rest', async () => {
    const path = buildReviewBranchArtifactPath('/feature', lapId, 'scope');
    const fs = filesystem({ [path]: JSON.stringify(persistedV2ScopeArtifact) });

    await expect(readBuildReviewBranchArtifact('/feature', 'scope', lapId, 'sha256:snapshot', fs)).resolves.toMatchObject({
      result: { contractVersion: 'v2', findings: [{ anchor: { relation: 'not-authorized-by-plan' } }] },
    });
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['unknown envelope field', JSON.stringify({ version: 1, rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', result: judged(), provenance: { kind: 'fresh' }, extra: true })],
    ['mismatched result identity', JSON.stringify({ version: 1, rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', result: { ...judged(), rubric: 'tautology' }, provenance: { kind: 'fresh' } })],
    ['missing result', JSON.stringify({ version: 1, rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', provenance: { kind: 'fresh' } })],
  ])('rejects %s without promoting it to a current branch', async (_name, raw) => {
    const path = buildReviewBranchArtifactPath('/feature', lapId, 'scope');
    const fs = filesystem({ [path]: raw });
    if (raw.startsWith('{not json')) {
      expect(() => JSON.parse(raw)).toThrow();
    } else {
      expect(parseBuildReviewBranchArtifact(JSON.parse(raw))).toBeUndefined();
    }
    await expect(readBuildReviewBranchArtifact('/feature', 'scope', lapId, 'sha256:snapshot', fs)).resolves.toBeUndefined();
  });

  it('accepts cache provenance only when the rematerialized result names the current lap and snapshot', async () => {
    const artifact = {
      version: 1,
      rubric: 'scope',
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
