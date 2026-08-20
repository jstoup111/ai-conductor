import { describe, expect, it } from 'vitest';

import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import { resolveBuildReviewFeatureIdentity, resolveEffectiveBuildReviewVerdict } from '../../src/engine/build-review-effective.js';

const lapId = parseBuildReviewLapId('lap-current')!;
const root = '/repo';
const worktree = '/repo/.worktrees/feature';
const feature = { version: 'v1' as const, repository: root, feature: 'feature' };
type Rubric = 'tautology' | 'scope' | 'rootCause' | 'completeness';

const scopeFinding = { concernKind: 'out-of-plan-change', summary: 'Actionable finding summary', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope' as const, path: 'src/a.ts', relation: 'not-authorized-by-plan' } };

function reducedCoverageDecision(rubric: Rubric) {
  return { kind: 'reduced-coverage' as const, version: 'v1' as const, feature, identity: { rubric, reason: 'provider-error' as const }, rationale: 'mechanical fault is covered', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' };
}

function aggregate(options: {
  readonly faults?: Partial<Record<Rubric, 'provider-error'>>;
  readonly includeScopeFinding?: boolean;
} = {}) {
  const judged = (rubric: Rubric, findings = rubric === 'scope' && options.includeScopeFinding !== false ? [scopeFinding] : []) => ({
    kind: 'judged' as const, rubric, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never,
    findings, verdict: findings.length ? 'FAIL' as const : 'PASS' as const,
  });
  const outcome = (rubric: Rubric) => options.faults?.[rubric]
    ? { kind: 'infrastructure-failure' as const, rubric, reason: options.faults[rubric]!, detail: 'provider unavailable' }
    : judged(rubric);
  return joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', results: {
    tautology: outcome('tautology'), scope: outcome('scope'), rootCause: outcome('rootCause'), completeness: outcome('completeness'),
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
      createStore: () => ({ list: async () => ({ ok: true as const, records: [{ version: 'v1' as const, feature, finding: accepted, sourceLapId: lapId, summary: 'old prose', rationale: 'risk', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' }] }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) }),
    });
    expect(result).toMatchObject({ ok: true, effective: { rawVerdict: 'FAIL', verdict: 'PASS', acceptedFindingIds: [accepted.id], unresolvedFindingIds: [] } });
    expect(raw.verdict).toBe('FAIL');
  });

  it('passes from current reduced-coverage state when it covers the infrastructure branch', async () => {
    const raw = aggregate({ faults: { completeness: 'provider-error' } });
    const accepted = canonicalizeBuildReviewFindingIdentity({ rubric: 'scope', contractVersion: 'v2', concernKind: 'out-of-plan-change', summary: 'Actionable finding summary', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' } })!;
    const result = await resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({
        list: async () => ({ ok: true as const, records: [{ version: 'v1' as const, feature, finding: accepted, sourceLapId: lapId, summary: 'old prose', rationale: 'risk', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' }] }),
        listReducedCoverage: async () => ({ ok: true as const, records: [{ kind: 'reduced-coverage' as const, version: 'v1' as const, feature, identity: { rubric: 'completeness' as const, reason: 'provider-error' as const }, rationale: 'mechanical fault is covered', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' }] }),
      }),
    });

    expect(result).toMatchObject({ ok: true, effective: {
      rawVerdict: 'FAIL', verdict: 'PASS', acceptedFindingIds: [accepted.id], unresolvedFindingIds: [],
      infrastructureFailureRubrics: ['completeness'],
    }, reducedCoverageEvidence: [
      '## Reduced build-review coverage',
      '',
      '- Rubric: `completeness`',
      '  Cause: `provider-error`',
      '  Current diagnostic: provider unavailable',
      '  Operator: operator',
      '  Rationale: mechanical fault is covered',
      '  Decision time: 2026-08-14T00:00:00.000Z',
    ].join('\n') });
  });

  it('reports a stored superseded-contract disposition without letting it bind again', async () => {
    const raw = aggregate();
    const superseded = canonicalizeBuildReviewFindingIdentity({ rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change', summary: 'Actionable finding summary', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'out-of-plan-change' } })!;
    const emitted: unknown[] = [];
    const result = await resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [{ version: 'v1' as const, feature, finding: superseded, sourceLapId: lapId, summary: 'old prose', rationale: 'risk', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' }] }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) }),
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
    await expect(resolveEffectiveBuildReviewVerdict(worktree, aggregate(), { ...identityDeps, createStore: () => ({ list: async () => ({ ok: false as const, kind: 'unreadable' as const, message: 'broken' }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) }) })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('unavailable') });
    await expect(resolveEffectiveBuildReviewVerdict(worktree, aggregate(), { ...identityDeps, createStore: () => ({ list: async () => ({ ok: true as const, records: [{ version: 'v1' as const, feature: { ...feature, feature: 'other' }, finding: canonicalizeBuildReviewFindingIdentity({ rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change', summary: 'Actionable finding summary', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope', path: 'x', relation: 'out-of-plan-change' } })!, sourceLapId: lapId, summary: 'x', rationale: 'x', operator: 'x', acceptedAt: '2026-08-14T00:00:00.000Z' }] }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) }) })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('foreign') });
  });

  it('fails closed when a malformed reduced-coverage record reaches the effective resolver', async () => {
    const raw = aggregate({ faults: { completeness: 'provider-error' }, includeScopeFinding: false });
    await expect(resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({
        list: async () => ({ ok: true as const, records: [] }),
        listReducedCoverage: async () => ({ ok: true as const, records: [null] as never }),
      }),
    })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('state') });
  });

  it('keeps uncovered infrastructure, unresolved findings, and zero-judged reviews blocking', async () => {
    const decision = reducedCoverageDecision('tautology');
    const mixedFaults = aggregate({ faults: { tautology: 'provider-error', completeness: 'provider-error' }, includeScopeFinding: false });
    const unresolvedFinding = aggregate({ faults: { tautology: 'provider-error' } });
    const nothingJudged = aggregate({ faults: { tautology: 'provider-error', scope: 'provider-error', rootCause: 'provider-error', completeness: 'provider-error' }, includeScopeFinding: false });
    const resolver = (raw: ReturnType<typeof aggregate>, reducedCoverage = [decision]) => resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), listReducedCoverage: async () => ({ ok: true as const, records: reducedCoverage }) }),
    });

    await expect(resolver(mixedFaults)).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL', infrastructureFailureRubrics: ['tautology', 'completeness'] } });
    await expect(resolver(unresolvedFinding)).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL', unresolvedFindingIds: [expect.any(String)] } });
    await expect(resolver(nothingJudged, [
      decision,
      reducedCoverageDecision('scope'),
      reducedCoverageDecision('rootCause'),
      reducedCoverageDecision('completeness'),
    ])).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL' } });
  });

  it('does not let finding acceptance and reduced coverage substitute for each other', async () => {
    const accepted = canonicalizeBuildReviewFindingIdentity({ rubric: 'scope', contractVersion: 'v2', concernKind: 'out-of-plan-change', summary: 'Actionable finding summary', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' } })!;
    const findingAcceptance = { version: 'v1' as const, feature, finding: accepted, sourceLapId: lapId, summary: 'old prose', rationale: 'risk', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' };
    const reducedCoverage = reducedCoverageDecision('completeness');
    const resolver = (raw: ReturnType<typeof aggregate>, records = [findingAcceptance], coverage = [reducedCoverage]) => resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records }), listReducedCoverage: async () => ({ ok: true as const, records: coverage }) }),
    });

    await expect(resolver(aggregate({ faults: { completeness: 'provider-error' }, includeScopeFinding: false }), [findingAcceptance], [])).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL' } });
    await expect(resolver(aggregate(), [], [reducedCoverage])).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL', unresolvedFindingIds: [accepted.id] } });
  });

  it('leaves a full-coverage review passing without decisions', async () => {
    const result = await resolveEffectiveBuildReviewVerdict(worktree, aggregate({ includeScopeFinding: false }), {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) }),
    });
    expect(result).toMatchObject({ ok: true, effective: { rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], infrastructureFailureRubrics: [] } });
  });
});
