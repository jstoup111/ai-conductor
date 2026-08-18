import { describe, expect, it } from 'vitest';

import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import { resolveBuildReviewFeatureIdentity, resolveEffectiveBuildReviewVerdict } from '../../src/engine/build-review-effective.js';

const lapId = parseBuildReviewLapId('lap-current')!;
const root = '/repo';
const worktree = '/repo/.worktrees/feature';
const feature = { version: 'v1' as const, repository: root, feature: 'feature' };

function aggregate() {
  const finding = { concernKind: 'out-of-plan-change', summary: 'Actionable finding summary', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope' as const, path: 'src/a.ts', relation: 'not-authorized-by-plan' } };
  const judged = (rubric: 'tautology' | 'scope' | 'rootCause' | 'completeness', findings = rubric === 'scope' ? [finding] : []) => ({
    kind: 'judged' as const, rubric, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never,
    findings, verdict: findings.length ? 'FAIL' as const : 'PASS' as const,
  });
  return joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', results: {
    tautology: judged('tautology'), scope: judged('scope'), rootCause: judged('rootCause'), completeness: judged('completeness'),
  } });
}

const identityDeps = { resolveMainRoot: async () => root, realpath: async (path: string) => path };

describe('live build-review effective resolver', () => {
  it('canonicalizes exactly one linked-worktree feature beneath the canonical main root', async () => {
    await expect(resolveBuildReviewFeatureIdentity(worktree, identityDeps)).resolves.toEqual(feature);
    await expect(resolveBuildReviewFeatureIdentity('/repo/.worktrees/feature/nested', identityDeps)).resolves.toBeUndefined();
  });

  it('resolves only exact same-feature disposition payloads after strict raw join', async () => {
    const raw = aggregate();
    const accepted = canonicalizeBuildReviewFindingIdentity({ rubric: 'scope', contractVersion: 'v2', concernKind: 'out-of-plan-change', summary: 'Actionable finding summary', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' } })!;
    const result = await resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [{ version: 'v1' as const, feature, finding: accepted, sourceLapId: lapId, summary: 'old prose', rationale: 'risk', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' }] }) }),
    });
    expect(result).toMatchObject({ ok: true, effective: { rawVerdict: 'FAIL', verdict: 'PASS', acceptedFindingIds: [accepted.id], unresolvedFindingIds: [] } });
    expect(raw.verdict).toBe('FAIL');
  });

  it('reports a stored superseded-contract disposition without letting it bind again', async () => {
    const raw = aggregate();
    const superseded = canonicalizeBuildReviewFindingIdentity({ rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change', summary: 'Actionable finding summary', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'out-of-plan-change' } })!;
    const emitted: unknown[] = [];
    const result = await resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [{ version: 'v1' as const, feature, finding: superseded, sourceLapId: lapId, summary: 'old prose', rationale: 'risk', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' }] }) }),
      emit: async (event) => { emitted.push(event); },
    });

    expect(emitted).toEqual([{
      type: 'build_review_disposition_version_invalidated', feature: 'feature', findingId: superseded.id,
      rubric: 'scope', contractVersion: 'v1',
    }]);
    expect(result).toMatchObject({ ok: true, effective: { rawVerdict: 'FAIL', verdict: 'FAIL', acceptedFindingIds: [], unresolvedFindingIds: [expect.any(String)] } });
  });

  it('fails closed for an invalid aggregate, unavailable identity, unreadable state, or foreign state', async () => {
    await expect(resolveEffectiveBuildReviewVerdict(worktree, { verdict: 'PASS' }, identityDeps)).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('aggregate') });
    await expect(resolveEffectiveBuildReviewVerdict(worktree, aggregate(), { ...identityDeps, resolveMainRoot: async () => '/elsewhere' })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('identity') });
    await expect(resolveEffectiveBuildReviewVerdict(worktree, aggregate(), { ...identityDeps, createStore: () => ({ list: async () => ({ ok: false as const, kind: 'unreadable' as const, message: 'broken' }) }) })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('unavailable') });
    await expect(resolveEffectiveBuildReviewVerdict(worktree, aggregate(), { ...identityDeps, createStore: () => ({ list: async () => ({ ok: true as const, records: [{ version: 'v1' as const, feature: { ...feature, feature: 'other' }, finding: canonicalizeBuildReviewFindingIdentity({ rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change', summary: 'Actionable finding summary', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope', path: 'x', relation: 'out-of-plan-change' } })!, sourceLapId: lapId, summary: 'x', rationale: 'x', operator: 'x', acceptedAt: '2026-08-14T00:00:00.000Z' }] }) }) })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('foreign') });
  });
});
