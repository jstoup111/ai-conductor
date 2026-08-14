import { describe, expect, it } from 'vitest';

import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import type { BuildReviewFinding, BuildReviewJudgedResult } from '../../src/engine/build-review-domain.js';
import {
  deriveEffectiveBuildReviewVerdict,
  deriveEffectiveBuildReviewVerdictWithDispositions,
  joinBuildReviewRubricOutcomes,
  parseBuildReviewAggregate,
} from '../../src/engine/build-review-aggregate.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import type { BuildReviewDispositionRecord, BuildReviewFeatureIdentity } from '../../src/engine/build-review-dispositions.js';

const lapId = parseBuildReviewLapId('lap-current')!;
const feature: BuildReviewFeatureIdentity = {
  version: 'v1', repository: 'github.com/acme/conductor', feature: 'review-rubrics',
};

function judged(
  rubric: 'tautology' | 'scope' | 'rootCause' | 'completeness' | 'wiring',
  findings: readonly BuildReviewFinding[] = [],
): BuildReviewJudgedResult {
  return {
    kind: 'judged' as const, rubric, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v1' as never,
    findings, verdict: findings.length === 0 ? 'PASS' as const : 'FAIL' as const,
  };
}

function results(overrides: Record<string, unknown> = {}) {
  return {
    tautology: judged('tautology'), scope: judged('scope'), rootCause: judged('rootCause'),
    completeness: judged('completeness'), wiring: judged('wiring'), ...overrides,
  };
}

describe('build-review raw aggregate', () => {
  it('joins all current judged branches with zero findings into one backward-compatible PASS', () => {
    const aggregate = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', results: results(), codeStamp: 'head' });
    expect(aggregate).toMatchObject({
      aggregateVersion: 'v1', lapId, snapshotDigest: 'sha256:snapshot', verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false, wiring: false }, codeStamp: 'head',
    });
    expect(parseBuildReviewAggregate(aggregate)).toEqual(aggregate);
  });

  it('retains complete named findings and derives FAIL without folding the rubric result', () => {
    const finding = { concernKind: 'unplanned change', anchor: { rubric: 'scope' as const, path: 'src/a.ts', relation: 'outside-plan' } };
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', results: results({ scope: judged('scope', [finding]) }),
    });
    expect(aggregate).toMatchObject({ verdict: 'FAIL', rubric: { scope: true }, findings: { scope: ['unplanned change'] } });
    expect(aggregate.results.scope).toMatchObject({ kind: 'judged', findings: [finding] });
  });

  it('records skips and infrastructure failures as coverage, never as a passing judgement', () => {
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: results({
        tautology: { kind: 'skipped', rubric: 'tautology', reason: 'disabled' },
        wiring: { kind: 'infrastructure-failure', rubric: 'wiring', reason: 'provider-error', detail: 'provider unavailable' },
      }),
    });
    expect(aggregate).toMatchObject({
      verdict: 'FAIL', coverage: { tautology: 'skipped', wiring: 'infrastructure-failure' },
      rubric: { tautology: true, wiring: true },
    });
  });

  it('rejects missing, malformed, stale, or identity-mismatched branch results', () => {
    const aggregate = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', results: results() });
    expect(parseBuildReviewAggregate({ ...aggregate, results: { ...aggregate.results, wiring: undefined } })).toBeUndefined();
    expect(parseBuildReviewAggregate({ ...aggregate, results: { ...aggregate.results, scope: { ...aggregate.results.scope, lapId: parseBuildReviewLapId('lap-old')! } } })).toBeUndefined();
    expect(parseBuildReviewAggregate({ ...aggregate, extra: true })).toBeUndefined();
  });

  it('derives effective state only after strict raw judgement, without changing raw findings', () => {
    const finding = { concernKind: 'unplanned change', anchor: { rubric: 'scope' as const, path: 'src/a.ts', relation: 'outside-plan' } };
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', results: results({ scope: judged('scope', [finding]) }),
    });
    const id = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'scope', contractVersion: 'v1' })!.id;

    expect(deriveEffectiveBuildReviewVerdict(aggregate)).toMatchObject({
      verdict: 'FAIL', acceptedFindingIds: [], unresolvedFindingIds: [id], rawVerdict: 'FAIL',
    });
    expect(deriveEffectiveBuildReviewVerdict(aggregate, new Set([id]))).toMatchObject({
      verdict: 'PASS', acceptedFindingIds: [id], unresolvedFindingIds: [], rawVerdict: 'FAIL',
    });
    expect(aggregate.results.scope).toMatchObject({ findings: [finding] });
  });

  it('matches only a feature-scoped full canonical payload after raw grading', () => {
    const first = { concernKind: 'unplanned change', anchor: { rubric: 'scope' as const, path: 'src/a.ts', relation: 'outside-plan' } };
    const second = { concernKind: 'missing approval', anchor: { rubric: 'scope' as const, path: 'src/b.ts', relation: 'outside-plan' } };
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', results: results({ scope: judged('scope', [first, second]) }),
    });
    const firstIdentity = canonicalizeBuildReviewFindingIdentity({ ...first, rubric: 'scope', contractVersion: 'v1' })!;
    const differentIdentity = canonicalizeBuildReviewFindingIdentity({ ...first, rubric: 'scope', contractVersion: 'v1', anchor: { ...first.anchor, path: 'src/other.ts' } })!;
    const accepted: BuildReviewDispositionRecord = {
      version: 'v1', feature, finding: firstIdentity, sourceLapId: lapId,
      summary: 'Older wording at src/a.ts:8', rationale: 'Accepted migration risk', operator: 'james', acceptedAt: '2026-08-14T12:00:00.000Z',
    };
    const sameIdButDifferentPayload: BuildReviewDispositionRecord = {
      ...accepted, finding: { ...differentIdentity, id: firstIdentity.id }, summary: 'Different concern',
    };
    const foreignFeature: BuildReviewDispositionRecord = { ...accepted, feature: { ...feature, feature: 'other-feature' } };

    expect(deriveEffectiveBuildReviewVerdictWithDispositions(aggregate, feature, [accepted, sameIdButDifferentPayload, foreignFeature]))
      .toMatchObject({ rawVerdict: 'FAIL', verdict: 'FAIL', acceptedFindingIds: [firstIdentity.id], unresolvedFindingIds: [canonicalizeBuildReviewFindingIdentity({ ...second, rubric: 'scope', contractVersion: 'v1' })!.id] });
    expect(aggregate.results.scope).toMatchObject({ findings: [first, second] });
  });

  it('never resolves legacy, stale, skipped, or infrastructure-shaped evidence', () => {
    const cacheHitCurrentLap = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', results: results() });
    const skipped = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', results: results({ tautology: { kind: 'skipped', rubric: 'tautology', reason: 'disabled' } }),
    });
    const infra = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', results: results({ wiring: { kind: 'infrastructure-failure', rubric: 'wiring', reason: 'provider-error', detail: 'provider unavailable' } }),
    });

    expect(deriveEffectiveBuildReviewVerdict(cacheHitCurrentLap)).toMatchObject({ verdict: 'PASS' });
    expect(deriveEffectiveBuildReviewVerdict(skipped, new Set(['fabricated']))).toMatchObject({ verdict: 'FAIL' });
    expect(deriveEffectiveBuildReviewVerdict(infra, new Set(['fabricated']))).toMatchObject({ verdict: 'FAIL' });
    expect(deriveEffectiveBuildReviewVerdict({ verdict: 'PASS' }, new Set(['fabricated']))).toBeUndefined();
    expect(deriveEffectiveBuildReviewVerdict({ ...cacheHitCurrentLap, lapId: parseBuildReviewLapId('lap-old')!, results: cacheHitCurrentLap.results })).toBeUndefined();
  });

  it('keeps infrastructure failures blocking even when a stored disposition exists', () => {
    const infrastructure = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: results({ wiring: { kind: 'infrastructure-failure', rubric: 'wiring', reason: 'provider-error', detail: 'provider unavailable' } }),
    });
    const stored: BuildReviewDispositionRecord = {
      version: 'v1', feature,
      finding: canonicalizeBuildReviewFindingIdentity({
        rubric: 'scope', contractVersion: 'v1', concernKind: 'unplanned-surface',
        anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
      })!,
      sourceLapId: lapId, summary: 'summary', rationale: 'reason', operator: 'james', acceptedAt: '2026-08-14T12:00:00.000Z',
    };

    expect(deriveEffectiveBuildReviewVerdictWithDispositions(infrastructure, feature, [stored]))
      .toMatchObject({ rawVerdict: 'FAIL', verdict: 'FAIL', infrastructureFailureRubrics: ['wiring'] });
  });
});
