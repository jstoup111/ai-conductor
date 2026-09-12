// Covers: S3.2, task:3, task:15, task:26
import { describe, expect, it } from 'vitest';

import { deriveBuildReviewScopeIncompleteFault, parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import type { BuildReviewFinding, BuildReviewJudgedResult } from '../../src/engine/build-review-domain.js';
import {
  deriveEffectiveBuildReviewVerdict,
  deriveEffectiveBuildReviewVerdictWithDispositions,
  joinBuildReviewRubricOutcomes,
  parseBuildReviewAggregate,
} from '../../src/engine/build-review-aggregate.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';

// Surviving coverage in test/engine/build-review-verdict.test.ts (gate wiring,
// mechanical-fault lane, incomplete `results`) and test/build-review-compat.test.ts
// (retired dispositions and cache entries) is deliberately not repeated here.

const lapId = parseBuildReviewLapId('lap-current')!;
const snapshotDigest = 'sha256:snapshot';
const HASH = `sha256:${'a'.repeat(64)}`;
const CUSTOM_DIGEST = `sha256:${'c'.repeat(64)}`;

const customAggregateMember = {
  descriptor: {
    version: 'v1', semanticSkill: 'security-review',
    declaration: { version: 'v1', rubricId: 'security', semanticSkill: 'security-review', question: 'Find security regressions.', source: 'plugin', resources: ['references/security.md'] },
    installation: { source: 'plugin', plugin: { id: 'security-suite', version: '2.1.0' } },
    effectivePolicy: { version: 'v1', bundleDigest: CUSTOM_DIGEST },
    reviewedInput: { version: 'v1', contentDigest: CUSTOM_DIGEST },
    producer: { provider: 'codex', model: 'gpt-5.6', effort: 'high' },
  },
  result: {
    kind: 'judged', contractVersion: 'custom-v1', rubric: 'security', lapId: 'lap-current',
    declaration: { version: 'v1', rubricId: 'security', semanticSkill: 'security-review', question: 'Find security regressions.', source: 'plugin', resources: ['references/security.md'] },
    policy: { version: 'v1', bundleDigest: CUSTOM_DIGEST }, candidate: { provider: 'codex', model: 'gpt-5.6', effort: 'high' },
    reviewedInput: { version: 'v1', contentDigest: CUSTOM_DIGEST }, findings: [], verdict: 'PASS',
    identity: { id: CUSTOM_DIGEST, canonicalPayload: {}, canonicalJson: '{}' },
  },
} as const;

function judged(findings: readonly BuildReviewFinding[] = []): BuildReviewJudgedResult {
  return {
    kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest, contractVersion: 'v3',
    findings, verdict: findings.length === 0 ? 'PASS' : 'FAIL',
  };
}

const finding: BuildReviewFinding = {
  concernKind: 'test-insensitive', summary: 'The assertion passes against reverted production.', evidenceLocations: ['test/widget.test.ts:8'],
  anchor: { rubric: 'testQuality', locus: { path: 'test/widget.test.ts', contentHash: HASH, display: 'widget persists state' } },
};

function confidenceFinding(confidence: number | undefined, label: string): BuildReviewFinding {
  return {
    concernKind: 'test-insensitive', summary: `Finding ${label}`, evidenceLocations: [`test/${label}.test.ts:8`],
    anchor: { rubric: 'testQuality', locus: { path: `test/${label}.test.ts`, contentHash: HASH, display: label } },
    ...(confidence === undefined ? {} : { confidence }),
  };
}

function findingId(value: BuildReviewFinding): string {
  return canonicalizeBuildReviewFindingIdentity({
    rubric: 'testQuality', contractVersion: 'v3', concernKind: value.concernKind, anchor: value.anchor,
  })!.id;
}

function currentAggregate() {
  return joinBuildReviewRubricOutcomes({ lapId, snapshotDigest, results: { testQuality: judged() } });
}

describe('build-review raw aggregate', () => {
  it('retains historic custom descriptors while the lap catalog alone selects current custom membership', () => {
    const current = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest, results: { testQuality: judged() },
      customResults: { security: customAggregateMember }, currentCustomRubrics: ['security'],
    } as never);
    const disabledLater = { ...current, currentCustomRubrics: [] };

    expect(parseBuildReviewAggregate(current)).toMatchObject({
      customResults: { security: { descriptor: customAggregateMember.descriptor, result: { kind: 'judged', rubric: 'security' } } },
      currentCustomRubrics: ['security'],
    });
    expect(parseBuildReviewAggregate(disabledLater)).toMatchObject({
      customResults: { security: { descriptor: customAggregateMember.descriptor } }, currentCustomRubrics: [],
    });
  });

  it('rejects a custom failure that tries to carry a judged descriptor', () => {
    const aggregate = {
      ...currentAggregate(), aggregateVersion: 'v2',
      customResults: {
        security: {
          ...customAggregateMember,
          result: { kind: 'infrastructure-failure', rubric: 'security', reason: 'policy-load-failed', detail: 'plugin unavailable' },
        },
      },
      currentCustomRubrics: ['security'],
    };

    expect(parseBuildReviewAggregate(aggregate)).toBeUndefined();
  });

  it('counts only catalog-selected custom evidence as a current blocker', () => {
    const failedCustom = {
      result: { kind: 'infrastructure-failure', rubric: 'security', reason: 'policy-load-failed', detail: 'plugin unavailable' },
    } as const;
    const active = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest, results: { testQuality: judged() },
      customResults: { security: failedCustom }, currentCustomRubrics: ['security'],
    } as never);
    const disabled = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest, results: { testQuality: judged() },
      customResults: { security: failedCustom }, currentCustomRubrics: [],
    } as never);

    expect(active.verdict).toBe('FAIL');
    expect(disabled).toMatchObject({ verdict: 'PASS', customResults: { security: failedCustom }, currentCustomRubrics: [] });
  });

  it('retains judged findings while deriving a blocking scope-incomplete fault from validated indeterminacy', () => {
    const result = {
      ...judged([finding]),
      scopeResolutions: [{
        candidateId: 'candidate:setup', status: 'indeterminate',
        sourceRegion: { path: 'test/widget.test.ts', startLine: 3, endLine: 8, contentHash: HASH, display: 'widget setup' },
        obligationReferences: ['story:S6.1'],
        missingEvidenceReason: 'the helper association is ambiguous',
      }],
    } as BuildReviewJudgedResult;

    const fault = deriveBuildReviewScopeIncompleteFault(result);
    const aggregate = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest, results: { testQuality: result } });

    expect(fault).toMatchObject({
      rubric: 'testQuality', reason: 'scope-incomplete',
      candidates: [{ candidateId: 'candidate:setup', obligationReferences: ['story:S6.1'], missingEvidenceReason: 'the helper association is ambiguous' }],
    });
    expect(aggregate).toMatchObject({
      verdict: 'FAIL', coverage: { testQuality: 'scope-incomplete' },
      results: { testQuality: { findings: [finding] } },
      scopeIncomplete: [fault],
    });
    expect(parseBuildReviewAggregate(aggregate)).toEqual(aggregate);
    expect(deriveEffectiveBuildReviewVerdict(aggregate)).toMatchObject({
      verdict: 'FAIL', unresolvedFindingIds: [expect.any(String)], scopeIncompleteRubrics: ['testQuality'],
      uncoveredScopeIncompleteRubrics: ['testQuality'],
    });
  });

  it('allows reduced coverage to cover only the derived scope fault, never an independent finding', () => {
    const scopeOnly = {
      ...judged(),
      scopeResolutions: [{
        candidateId: 'candidate:setup', status: 'indeterminate',
        sourceRegion: { path: 'test/widget.test.ts', startLine: 3, endLine: 8, contentHash: HASH, display: 'widget setup' },
        obligationReferences: ['story:S6.1'], missingEvidenceReason: 'the helper association is ambiguous',
      }],
    } as BuildReviewJudgedResult;
    const scopeAndFinding: BuildReviewJudgedResult = { ...scopeOnly, findings: [finding], verdict: 'FAIL' };
    const feature = { version: 'v1' as const, repository: '/repo', feature: 'feature' };
    const coverage = [{
      kind: 'reduced-coverage' as const, version: 'v1' as const, feature,
      identity: { rubric: 'testQuality' as const, reason: 'scope-incomplete' as const },
      rationale: 'operator accepts the bounded missing association', operator: 'operator', acceptedAt: '2026-09-06T00:00:00.000Z',
    }];

    expect(deriveEffectiveBuildReviewVerdictWithDispositions(
      joinBuildReviewRubricOutcomes({ lapId, snapshotDigest, results: { testQuality: scopeOnly } }), feature, [], coverage,
    )).toMatchObject({
      verdict: 'PASS', scopeIncompleteRubrics: ['testQuality'], uncoveredScopeIncompleteRubrics: [], unresolvedFindingIds: [],
    });
    expect(deriveEffectiveBuildReviewVerdictWithDispositions(
      joinBuildReviewRubricOutcomes({ lapId, snapshotDigest, results: { testQuality: scopeAndFinding } }), feature, [], coverage,
    )).toMatchObject({
      verdict: 'FAIL', scopeIncompleteRubrics: ['testQuality'], uncoveredScopeIncompleteRubrics: [], unresolvedFindingIds: [expect.any(String)],
    });
  });

  it.each(['wiring', 'scope', 'rootCause', 'completeness', 'causalIntegrity', 'tautology'] as const)(
    'tolerates an in-flight aggregate whose FAIL verdict derives only from the retired %s member',
    (retired) => {
      const aggregate = currentAggregate();
      const legacy = {
        ...aggregate,
        verdict: 'FAIL',
        results: {
          ...aggregate.results,
          [retired]: {
            kind: 'judged', rubric: retired, lapId, snapshotDigest, contractVersion: 'v1',
            findings: [{ concernKind: 'unreached surface', summary: 'orphan', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: retired, path: 'src/a.ts', relation: 'outside-plan' } }],
            verdict: 'FAIL',
          },
        },
        coverage: { ...aggregate.coverage, [retired]: 'judged' },
        rubric: { ...aggregate.rubric, [retired]: true },
        findings: { ...aggregate.findings, [retired]: ['unreached surface'] },
        reasons: [`[${retired}] unreached surface`],
      };

      expect(parseBuildReviewAggregate(legacy)).toEqual(aggregate);
      expect(parseBuildReviewAggregate(legacy)?.verdict).toBe('PASS');
    },
  );

  it('tolerates an in-flight aggregate blocked only by a retired wiring skip', () => {
    const aggregate = currentAggregate();
    const legacy = {
      ...aggregate,
      verdict: 'FAIL',
      results: { ...aggregate.results, wiring: { kind: 'skipped', rubric: 'wiring', reason: 'missing-entry-points' } },
      coverage: { ...aggregate.coverage, wiring: 'skipped' },
      rubric: { ...aggregate.rubric, wiring: false },
      findings: { ...aggregate.findings, wiring: [] },
    };

    expect(parseBuildReviewAggregate(legacy)).toEqual(aggregate);
  });

  it('re-derives a surviving-rubric FAIL even when the retired member carried the stored PASS', () => {
    const aggregate = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest, results: { testQuality: judged([finding]) } });
    const legacy = {
      ...aggregate,
      verdict: 'PASS',
      results: { ...aggregate.results, wiring: { kind: 'skipped', rubric: 'wiring', reason: 'missing-entry-points' } },
      coverage: { ...aggregate.coverage, wiring: 'skipped' },
      rubric: { ...aggregate.rubric, wiring: false },
      findings: { ...aggregate.findings, wiring: [] },
    };

    expect(parseBuildReviewAggregate(legacy)).toEqual(aggregate);
    expect(parseBuildReviewAggregate(legacy)?.verdict).toBe('FAIL');
  });

  it('still rejects a mismatched verdict on a single-rubric aggregate that never carried a retired member', () => {
    expect(parseBuildReviewAggregate({ ...currentAggregate(), verdict: 'FAIL' })).toBeUndefined();
  });

  it('does not let a bare [wiring] reason string authorize a mismatched verdict', () => {
    const aggregate = currentAggregate();

    expect(parseBuildReviewAggregate({ ...aggregate, verdict: 'FAIL', reasons: ['[wiring] historical reason'] })).toBeUndefined();
    expect(parseBuildReviewAggregate({ ...aggregate, reasons: ['[wiring] historical reason'] })).toBeUndefined();
  });

  it('rejects a stale-lap result, a mismatched snapshot, and an extra top-level key', () => {
    const aggregate = currentAggregate();

    expect(parseBuildReviewAggregate({
      ...aggregate, results: { testQuality: { ...aggregate.results.testQuality, lapId: parseBuildReviewLapId('lap-old')! } },
    })).toBeUndefined();
    expect(parseBuildReviewAggregate({ ...aggregate, lapId: parseBuildReviewLapId('lap-old')! })).toBeUndefined();
    expect(parseBuildReviewAggregate({
      ...aggregate, results: { testQuality: { ...aggregate.results.testQuality, snapshotDigest: 'sha256:other' } },
    })).toBeUndefined();
    expect(parseBuildReviewAggregate({ ...aggregate, extra: true })).toBeUndefined();
    expect(parseBuildReviewAggregate({ ...aggregate, results: { ...aggregate.results, extra: judged() } })).toBeUndefined();
  });

  it('records a skipped rubric as coverage, derives FAIL with no judged rubric, and reports it as skipped', () => {
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest, results: { testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' } },
    });

    expect(aggregate).toMatchObject({
      verdict: 'FAIL', coverage: { testQuality: 'skipped' }, rubric: { testQuality: false },
      findings: { testQuality: ['skipped: disabled'] }, reasons: ['[testQuality] skipped: disabled'],
    });
    expect(parseBuildReviewAggregate(aggregate)).toEqual(aggregate);
    expect(deriveEffectiveBuildReviewVerdict(aggregate)).toEqual({
      rawVerdict: 'FAIL', verdict: 'FAIL', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
      skippedRubrics: ['testQuality'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [],
      uncoveredScopeIncompleteRubrics: [],
    });
  });

  it('records an infrastructure failure as blocking coverage rather than a judgement', () => {
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest,
      results: { testQuality: { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'provider-error', detail: 'provider unavailable' } },
    });

    expect(aggregate).toMatchObject({
      verdict: 'FAIL', coverage: { testQuality: 'infrastructure-failure' }, rubric: { testQuality: true },
      reasons: ['[testQuality] infrastructure failure: provider unavailable'],
    });
    expect(deriveEffectiveBuildReviewVerdict(aggregate, new Set(['fabricated']))).toMatchObject({
      verdict: 'FAIL', skippedRubrics: [], infrastructureFailureRubrics: ['testQuality'],
    });
  });

  it('cross-checks legacy top-level fields against the raw results instead of trusting them', () => {
    const aggregate = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest, results: { testQuality: judged([finding]) } });

    expect(aggregate).toMatchObject({ verdict: 'FAIL', rubric: { testQuality: true }, findings: { testQuality: ['test-insensitive'] }, reasons: ['[testQuality] test-insensitive'] });
    expect(parseBuildReviewAggregate({ ...aggregate, rubric: { testQuality: false } })).toBeUndefined();
    expect(parseBuildReviewAggregate({ ...aggregate, coverage: { testQuality: 'skipped' } })).toBeUndefined();
    expect(parseBuildReviewAggregate({ ...aggregate, findings: { testQuality: [] } })).toBeUndefined();
    expect(parseBuildReviewAggregate({ ...aggregate, reasons: [] })).toBeUndefined();
  });

  it('suppresses only findings below the configured confidence floor', () => {
    const below = confidenceFinding(69, 'below-floor');
    const at = confidenceFinding(70, 'at-floor');
    const above = confidenceFinding(90, 'above-floor');
    const aggregate = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest, results: { testQuality: judged([below, at, above]) } });

    expect(deriveEffectiveBuildReviewVerdict(aggregate, new Set(), [], { testQuality: 70 })).toMatchObject({
      suppressedFindingIds: [findingId(below)],
      unresolvedFindingIds: [findingId(at), findingId(above)],
    });
  });

  it('passes when every finding is suppressed and never suppresses an unscored finding', () => {
    const lower = confidenceFinding(20, 'lower');
    const low = confidenceFinding(69, 'low');
    const unscored = confidenceFinding(undefined, 'unscored');
    const allSuppressed = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest, results: { testQuality: judged([lower, low]) } });
    const withUnscored = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest, results: { testQuality: judged([lower, low, unscored]) } });

    expect(deriveEffectiveBuildReviewVerdict(allSuppressed, new Set(), [], { testQuality: 70 })).toMatchObject({
      rawVerdict: 'FAIL', verdict: 'PASS', unresolvedFindingIds: [], suppressedFindingIds: [findingId(lower), findingId(low)],
    });
    expect(deriveEffectiveBuildReviewVerdict(withUnscored, new Set(), [], { testQuality: 70 })).toMatchObject({
      verdict: 'FAIL', suppressedFindingIds: [findingId(lower), findingId(low)], unresolvedFindingIds: [findingId(unscored)],
    });
  });

  it('applies identical floor semantics through the dispositions entry point', () => {
    const below = confidenceFinding(69, 'disposition-below');
    const at = confidenceFinding(70, 'disposition-at');
    const above = confidenceFinding(90, 'disposition-above');
    const aggregate = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest, results: { testQuality: judged([below, at, above]) } });
    const feature = { version: 'v1' as const, repository: '/repo', feature: 'feature' };

    expect(deriveEffectiveBuildReviewVerdictWithDispositions(aggregate, feature, [], [], { testQuality: 70 })).toMatchObject({
      suppressedFindingIds: [findingId(below)],
      unresolvedFindingIds: [findingId(at), findingId(above)],
    });
  });
});
