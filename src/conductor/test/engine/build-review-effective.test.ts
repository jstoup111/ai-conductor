// Covers: task:2, task:9, task:25, task:26, task:27, task:rem-prd-audit-7, task:rem-prd-audit-7-2
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { deriveEffectiveBuildReviewVerdictWithDispositions, joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId, type BuildReviewRubricContractVersion } from '../../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity, stampBuildReviewCustomJudgedResult } from '../../src/engine/build-review-finding-identity.js';
import { buildReviewConfidenceFloors, buildReviewSeverityThresholds, buildReviewThresholds, deriveComposedBuildReviewEffectiveVerdict, isBuildReviewLapHealthyForAbsenceRetirement, resolveBuildReviewFeatureIdentity, resolveEffectiveBuildReviewVerdict, type BuildReviewEffectiveResolverDeps } from '../../src/engine/build-review-effective.js';
import { projectBuildReviewSuppressionEntries } from '../../src/engine/build-review-suppression-history.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import type { BuildReviewCustomDeclaration } from '../../src/engine/build-review-artifacts.js';
import { rehydrateBuildReviewAcceptedRiskFinding, type BuildReviewReducedCoverageDispositionRecord } from '../../src/engine/build-review-dispositions.js';
import { finalizedBuildReviewSourceIds } from '../../src/engine/remediation-case-store.js';

const lapId = parseBuildReviewLapId('lap-current')!;
const root = '/repo';
const worktree = '/repo/.worktrees/feature';
const feature = { version: 'v1' as const, repository: root, feature: 'feature' };
type Rubric = 'testQuality' | 'security';
const currentContractVersion: BuildReviewRubricContractVersion = 'v3';

if (false) {
  // @ts-expect-error child scope is mandatory at every resolver call.
  const missingChild: BuildReviewEffectiveResolverDeps = { adjudicationEnabled: true };
  // @ts-expect-error adjudication authority is mandatory at every resolver call.
  const missingAdjudication: BuildReviewEffectiveResolverDeps = { child: undefined };
  void [missingChild, missingAdjudication];
}

const testQualityFinding = { concernKind: 'test-insensitive', summary: 'Actionable finding summary', evidenceLocations: ['test/a.test.ts:1'], anchor: { rubric: 'testQuality' as const, locus: { path: 'test/a.test.ts', contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', display: 'fixture test' } } };
const securityFinding = { concernKind: 'committed-secret', summary: 'Credential committed to source.', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'security' as const, locus: { path: 'src/a.ts', contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', display: 'credential assignment' } } };
const implementationQualityFinding = { concernKind: 'primitive-obsession', summary: 'Raw string state permits invalid domain values.', evidenceLocations: ['src/a.ts:8'], anchor: { rubric: 'implementationQuality' as const, locus: { path: 'src/a.ts', contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', display: 'changed state model' } } };

function securityPass() {
  return { kind: 'judged' as const, rubric: 'security' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: currentContractVersion, findings: [], verdict: 'PASS' as const };
}

const CUSTOM_DIGEST = `sha256:${'c'.repeat(64)}`;
const customDeclaration: BuildReviewCustomDeclaration = {
  version: 'v1', rubricId: 'portablePolicy', semanticSkill: 'portable-policy',
  question: 'Does this preserve the portable policy contract?', source: 'project', resources: ['criteria.md'],
};
const customStamp = {
  rubric: 'portablePolicy', lapId: 'lap-current',
  declaration: customDeclaration,
  policy: { version: 'v1', bundleDigest: CUSTOM_DIGEST },
  candidate: { provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
  reviewedInput: { version: 'v1', contentDigest: CUSTOM_DIGEST },
} as const;
const customReferences = {
  sourceRegions: [{ path: 'src/widget.ts', startLine: 8, endLine: 12, contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', display: 'public boundary' }],
} as const;

function customAggregate(confidence: number | undefined) {
  const findings = [{
    concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.',
    evidenceLocations: ['src/widget.ts:8'], sourceRegions: customReferences.sourceRegions,
    ...(confidence === undefined ? {} : { confidence }), severity: 'minor' as const,
  }];
  const judged = stampBuildReviewCustomJudgedResult({ kind: 'custom-findings', version: 'v2', findings }, customStamp, customReferences)!;
  const descriptor = {
    version: 'v1', semanticSkill: 'portable-policy', declaration: customStamp.declaration,
    installation: { source: 'project' }, effectivePolicy: customStamp.policy,
    reviewedInput: customStamp.reviewedInput, producer: customStamp.candidate,
  } as const;
  return {
    aggregate: joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: { testQuality: { kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: currentContractVersion, findings: [], verdict: 'PASS' as const } },
      customResults: { portablePolicy: { descriptor, result: judged } }, currentCustomRubrics: ['portablePolicy'],
    } as never),
    findingId: judged.findings[0]!.identity.id,
  };
}

function customFailureAggregate(
  declaration: BuildReviewCustomDeclaration = customStamp.declaration,
  reason: 'policy-load-failed' | 'provider-error' = 'policy-load-failed',
) {
  return joinBuildReviewRubricOutcomes({
    lapId, snapshotDigest: 'sha256:snapshot',
    results: { testQuality: { kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: currentContractVersion, findings: [], verdict: 'PASS' as const } },
    customResults: {
      portablePolicy: {
        declaration,
        result: { kind: 'infrastructure-failure' as const, rubric: 'portablePolicy', reason, detail: 'policy could not be loaded' },
      },
    },
    currentCustomRubrics: ['portablePolicy'],
  } as never);
}

function reducedCoverageDecision(rubric: Rubric) {
  return { kind: 'reduced-coverage' as const, version: 'v1' as const, feature, identity: { rubric, reason: 'provider-error' as const }, rationale: 'mechanical fault is covered', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' };
}

function aggregate(options: {
  readonly faults?: Partial<Record<Rubric, 'provider-error'>>;
  readonly includeTestQualityFinding?: boolean;
  readonly skipSecurity?: boolean;
} = {}) {
  const judged = (rubric: Rubric, findings = rubric === 'testQuality' && options.includeTestQualityFinding !== false ? [testQualityFinding] : []) => ({
    kind: 'judged' as const, rubric, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: currentContractVersion,
    findings, verdict: findings.length ? 'FAIL' as const : 'PASS' as const,
  });
  const outcome = (rubric: Rubric) => options.faults?.[rubric]
    ? { kind: 'infrastructure-failure' as const, rubric, reason: options.faults[rubric]!, detail: 'provider unavailable' }
    : judged(rubric);
  return joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', results: {
    testQuality: outcome('testQuality'),
    security: options.skipSecurity ? { kind: 'skipped' as const, rubric: 'security' as const, reason: 'disabled' as const } : outcome('security'),
  } });
}

function scopeAggregate(resolution: 'indeterminate' | 'resolved', includeTestQualityFinding = false) {
  const scopeResolution = resolution === 'indeterminate'
    ? {
        candidateId: 'candidate:setup', status: 'indeterminate' as const,
        sourceRegion: { path: 'test/a.test.ts', startLine: 2, endLine: 3, contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', display: 'setup binding' },
        obligationReferences: ['story:S6.2'], missingEvidenceReason: 'the pinned binding is incomplete',
      }
    : {
        candidateId: 'candidate:setup', status: 'resolved' as const,
        sourceRegion: { path: 'test/a.test.ts', startLine: 2, endLine: 3, contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', display: 'setup binding' },
        obligationReferences: ['story:S6.2'], associationReason: 'Corrected pinned binding proves this candidate.',
      };
  const findings = includeTestQualityFinding ? [testQualityFinding] : [];
  return joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', results: {
    testQuality: {
      kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: currentContractVersion,
      findings, scopeResolutions: [scopeResolution], verdict: findings.length ? 'FAIL' as const : 'PASS' as const,
    },
    security: securityPass(),
  } });
}

const identityDeps = {
  resolveMainRoot: async () => root,
  realpath: async (path: string) => path,
  child: undefined,
  adjudicationEnabled: true,
};

describe('live build-review effective resolver', () => {
  // Covers: task:9, task:rem-as-built-r9-2
  it('derives custom confidence and severity thresholds from the shared policy view used by gate completion', async () => {
    const config = resolveBuildReviewConfig({ build_review: { custom_rubrics: {
      portablePolicy: {
        skill: 'portable-policy', question: customDeclaration.question, enabled: true,
        min_confidence: 70, min_severity: 'major',
      },
    } } });

    expect(buildReviewThresholds(config).portablePolicy).toEqual({ minConfidence: 70, minSeverity: 'major' });
    expect(buildReviewConfidenceFloors(config).portablePolicy).toBe(70);
    expect(buildReviewSeverityThresholds(config).portablePolicy).toBe('major');

    const source = await readFile(join(process.cwd(), 'src/engine/build-review-effective.ts'), 'utf8');
    expect(source).toContain('Object.entries(buildReviewThresholds(config)).map(([id, threshold]) => [id, threshold!.minConfidence])');
  });

  // Covers: task:rem-prd-audit-rem-prd-audit-R17f, task:rem-as-built-rem-as-built-R17g
  it('shares current-lap absence-retirement health for built-in, custom, scope, and healthy laps', () => {
    const healthy = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', results: {
        testQuality: {
          kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot',
          contractVersion: currentContractVersion, findings: [], verdict: 'PASS',
        },
        security: securityPass(),
      },
    } as never);

    expect([
      aggregate({ faults: { testQuality: 'provider-error' } }),
      customFailureAggregate(),
      scopeAggregate('indeterminate'),
      healthy,
    ].map(isBuildReviewLapHealthyForAbsenceRetirement)).toEqual([false, false, false, true]);
  });

  it('keeps an above-floor implementation-quality finding unresolved and suppresses a below-floor one', () => {
    const raw = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', results: {
      testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
      implementationQuality: { kind: 'judged', rubric: 'implementationQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: currentContractVersion, findings: [{ ...implementationQualityFinding, confidence: 80 }], verdict: 'FAIL' },
    } });
    const identity = canonicalizeBuildReviewFindingIdentity({ ...implementationQualityFinding, rubric: 'implementationQuality', contractVersion: currentContractVersion })!;
    expect(deriveEffectiveBuildReviewVerdictWithDispositions(raw, feature, [], [], { implementationQuality: 70 })).toMatchObject({ verdict: 'FAIL', unresolvedFindingIds: [identity.id], suppressedFindingIds: [] });
    if (raw.results.implementationQuality.kind !== 'judged') throw new Error('implementation-quality fixture must be judged');
    const below = { ...raw, results: { ...raw.results, implementationQuality: { ...raw.results.implementationQuality, findings: [{ ...implementationQualityFinding, confidence: 60 }] } } };
    expect(deriveEffectiveBuildReviewVerdictWithDispositions(below, feature, [], [], { implementationQuality: 70 })).toMatchObject({ verdict: 'PASS', unresolvedFindingIds: [], suppressedFindingIds: [identity.id] });
  });

  it('suppresses only scored security findings below the security confidence floor', () => {
    const raw = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', results: {
      testQuality: { kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: currentContractVersion, findings: [], verdict: 'PASS' },
      security: {
        kind: 'judged', rubric: 'security', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: currentContractVersion,
        findings: [{ concernKind: 'committed-secret', summary: 'Credential committed to source.', evidenceLocations: ['src/a.ts:1'], confidence: 40, anchor: { rubric: 'security', locus: { path: 'src/a.ts', contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', display: 'credential assignment' } } }],
        verdict: 'FAIL',
      },
    } });
    const suppressed = canonicalizeBuildReviewFindingIdentity({
      rubric: 'security', contractVersion: currentContractVersion, concernKind: 'committed-secret',
      anchor: { rubric: 'security', locus: { path: 'src/a.ts', contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', display: 'credential assignment' } },
    })!;

    expect(deriveEffectiveBuildReviewVerdictWithDispositions(raw, feature, [], [], { security: 60 })).toMatchObject({
      verdict: 'PASS', suppressedFindingIds: [suppressed.id], unresolvedFindingIds: [],
    });
    if (raw.results.security.kind !== 'judged') throw new Error('security fixture must be judged');
    const unscored = {
      ...raw,
      results: {
        ...raw.results,
        security: {
          ...raw.results.security,
          findings: raw.results.security.findings.map(({ confidence: _confidence, ...finding }) => finding),
        },
      },
    };
    expect(deriveEffectiveBuildReviewVerdictWithDispositions(unscored, feature, [], [], { security: 60 })).toMatchObject({
      verdict: 'FAIL', suppressedFindingIds: [], unresolvedFindingIds: [suppressed.id],
    });
  });

  it('excludes an operator-accepted security finding under the current contract version', () => {
    const raw = joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', results: {
      testQuality: { kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: currentContractVersion, findings: [], verdict: 'PASS' },
      security: { kind: 'judged', rubric: 'security', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: currentContractVersion, findings: [securityFinding], verdict: 'FAIL' },
    } });
    const accepted = canonicalizeBuildReviewFindingIdentity({ ...securityFinding, rubric: 'security', contractVersion: currentContractVersion })!;
    const dispositions = [{ version: 'v1' as const, feature, finding: accepted, sourceLapId: lapId, summary: 'accepted security risk', rationale: 'known development credential', operator: 'operator', acceptedAt: '2026-09-14T00:00:00.000Z' }];

    expect(deriveEffectiveBuildReviewVerdictWithDispositions(raw, feature, dispositions)).toMatchObject({
      rawVerdict: 'FAIL', verdict: 'PASS', acceptedFindingIds: [accepted.id], unresolvedFindingIds: [],
    });
    // The custom-aware composed reducer must route every built-in disposition, not only test-quality's.
    expect(deriveComposedBuildReviewEffectiveVerdict(raw, feature, dispositions, [])).toMatchObject({
      rawVerdict: 'FAIL', verdict: 'PASS', acceptedFindingIds: [accepted.id], unresolvedFindingIds: [],
    });
  });

  it('canonicalizes exactly one linked-worktree feature beneath the canonical main root', async () => {
    await expect(resolveBuildReviewFeatureIdentity(worktree, identityDeps)).resolves.toEqual(feature);
    await expect(resolveBuildReviewFeatureIdentity('/repo/.worktrees/feature/nested', identityDeps)).resolves.toBeUndefined();
  });

  it('resolves only exact same-feature disposition payloads after strict raw join', async () => {
    const raw = aggregate();
    const accepted = canonicalizeBuildReviewFindingIdentity({ ...testQualityFinding, rubric: 'testQuality', contractVersion: 'v3' })!;
    const result = await resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [{ version: 'v1' as const, feature, finding: accepted, sourceLapId: lapId, summary: 'old prose', rationale: 'risk', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' }] }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) }),
    });
    expect(result).toMatchObject({ ok: true, effective: { rawVerdict: 'FAIL', verdict: 'PASS', acceptedFindingIds: [accepted.id], unresolvedFindingIds: [] } });
    expect(raw.verdict).toBe('FAIL');
  });

  it('keeps a zero-judged review blocking while rendering current reduced-coverage evidence', async () => {
    const raw = aggregate({ faults: { testQuality: 'provider-error' }, skipSecurity: true });
    const result = await resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({
        list: async () => ({ ok: true as const, records: [] }),
        listReducedCoverage: async () => ({ ok: true as const, records: [{ kind: 'reduced-coverage' as const, version: 'v1' as const, feature, identity: { rubric: 'testQuality' as const, reason: 'provider-error' as const }, rationale: 'mechanical fault is covered', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' }] }),
      }),
    });

    expect(result).toMatchObject({ ok: true, effective: {
      rawVerdict: 'FAIL', verdict: 'FAIL', acceptedFindingIds: [], unresolvedFindingIds: [],
      infrastructureFailureRubrics: ['testQuality'],
    }, reducedCoverageEvidence: [
      '## Reduced build-review coverage',
      '',
      '- Rubric: `testQuality`',
      '  Cause: `provider-error`',
      '  Current diagnostic: provider unavailable',
      '  Operator: operator',
      '  Rationale: mechanical fault is covered',
      '  Decision time: 2026-08-14T00:00:00.000Z',
    ].join('\n') });
  });

  it('recomputes corrected pinned scope and renders an attributed scope-incomplete decision only while it remains current', async () => {
    const coverage: readonly BuildReviewReducedCoverageDispositionRecord[] = [{
      kind: 'reduced-coverage' as const, version: 'v1' as const, feature,
      identity: { rubric: 'testQuality' as const, reason: 'scope-incomplete' as const },
      rationale: 'The association cannot be recovered.', operator: 'operator', acceptedAt: '2026-09-06T00:00:00.000Z',
    }];
    const resolve = (raw: ReturnType<typeof scopeAggregate>) => resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), listReducedCoverage: async () => ({ ok: true as const, records: coverage }) }),
    });

    await expect(resolve(scopeAggregate('indeterminate'))).resolves.toMatchObject({ ok: true, effective: { verdict: 'PASS', scopeIncompleteRubrics: ['testQuality'] }, reducedCoverageEvidence: [
      '## Reduced build-review coverage', '', '- Rubric: `testQuality`', '  Cause: `scope-incomplete`',
      '  Current diagnostic: candidate:setup (story:S6.2): the pinned binding is incomplete', '  Operator: operator',
      '  Rationale: The association cannot be recovered.', '  Decision time: 2026-09-06T00:00:00.000Z',
    ].join('\n') });
    const corrected = await resolve(scopeAggregate('resolved'));
    expect(corrected).toMatchObject({ ok: true, effective: { verdict: 'PASS' } });
    expect(corrected).not.toHaveProperty('effective.scopeIncompleteRubrics');
    expect(corrected).not.toHaveProperty('reducedCoverageEvidence');
    await expect(resolve(scopeAggregate('indeterminate', true))).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL', unresolvedFindingIds: [expect.any(String)] } });
  });

  it('keeps scope-incomplete blocking when reduced-coverage state cannot be read', async () => {
    await expect(resolveEffectiveBuildReviewVerdict(worktree, scopeAggregate('indeterminate'), {
      ...identityDeps,
      createStore: () => ({
        list: async () => ({ ok: true as const, records: [] }),
        listReducedCoverage: async () => ({ ok: false as const, kind: 'unreadable' as const, message: 'state cannot be read' }),
      }),
    })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('state cannot be read') });
  });

  it('uses the production effective reducer to reject unknown, foreign, and non-identical coverage', () => {
    const raw = aggregate({ faults: { testQuality: 'provider-error' }, includeTestQualityFinding: false });
    const accepted = reducedCoverageDecision('testQuality');
    const resolve = (coverage: readonly unknown[]) => deriveEffectiveBuildReviewVerdictWithDispositions(
      raw, feature, [], coverage as never,
    );

    for (const coverage of [
      [{ kind: 'unrecognised-disposition' }],
      [{ ...accepted, feature: { ...feature, feature: 'other' } }],
      [{ ...accepted, identity: { rubric: 'testQuality', reason: 'preflight-failed' } }],
    ]) {
      expect(resolve(coverage)).toMatchObject({
        verdict: 'FAIL', infrastructureFailureRubrics: ['testQuality'],
      });
    }
  });

  it('reports a stored superseded-contract disposition without letting it bind again', async () => {
    const raw = aggregate();
    const superseded = canonicalizeBuildReviewFindingIdentity({ ...testQualityFinding, rubric: 'testQuality', contractVersion: 'v1' })!;
    const emitted: unknown[] = [];
    const result = await resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [{ version: 'v1' as const, feature, finding: superseded, sourceLapId: lapId, summary: 'old prose', rationale: 'risk', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' }] }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) }),
      emit: async (event) => { emitted.push(event); },
    });

    expect(emitted).toEqual([{
      type: 'build_review_disposition_version_invalidated', feature: 'feature', findingId: superseded.id,
      rubric: 'testQuality', contractVersion: 'v1',
    }]);
    expect(result).toMatchObject({ ok: true, effective: { rawVerdict: 'FAIL', verdict: 'FAIL', acceptedFindingIds: [], unresolvedFindingIds: [expect.any(String)] } });
  });

  it('fails closed for an invalid aggregate, unavailable identity, unreadable state, or foreign state', async () => {
    await expect(resolveEffectiveBuildReviewVerdict(worktree, { verdict: 'PASS' }, identityDeps)).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('aggregate') });
    await expect(resolveEffectiveBuildReviewVerdict(worktree, aggregate(), { ...identityDeps, resolveMainRoot: async () => '/elsewhere' })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('identity') });
    await expect(resolveEffectiveBuildReviewVerdict(worktree, aggregate(), { ...identityDeps, createStore: () => ({ list: async () => ({ ok: false as const, kind: 'unreadable' as const, message: 'broken' }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) }) })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('unavailable') });
    await expect(resolveEffectiveBuildReviewVerdict(worktree, aggregate(), { ...identityDeps, createStore: () => ({ list: async () => ({ ok: true as const, records: [{ version: 'v1' as const, feature: { ...feature, feature: 'other' }, finding: canonicalizeBuildReviewFindingIdentity({ ...testQualityFinding, rubric: 'testQuality', contractVersion: 'v1' })!, sourceLapId: lapId, summary: 'x', rationale: 'x', operator: 'x', acceptedAt: '2026-08-14T00:00:00.000Z' }] }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) }) })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('foreign') });
  });

  it('fails closed when a malformed reduced-coverage record reaches the effective resolver', async () => {
    const raw = aggregate({ faults: { testQuality: 'provider-error' }, includeTestQualityFinding: false });
    await expect(resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({
        list: async () => ({ ok: true as const, records: [] }),
        listReducedCoverage: async () => ({ ok: true as const, records: [null] as never }),
      }),
    })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('state') });
  });

  it('keeps uncovered infrastructure, unresolved findings, and zero-judged reviews blocking', async () => {
    const decision = reducedCoverageDecision('testQuality');
    const uncoveredFault = aggregate({ faults: { testQuality: 'provider-error' }, includeTestQualityFinding: false });
    const unresolvedFinding = aggregate();
    const nothingJudged = aggregate({ faults: { testQuality: 'provider-error' }, includeTestQualityFinding: false, skipSecurity: true });
    const resolver = (raw: ReturnType<typeof aggregate>, reducedCoverage = [decision]) => resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), listReducedCoverage: async () => ({ ok: true as const, records: reducedCoverage }) }),
    });

    await expect(resolver(uncoveredFault, [])).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL', infrastructureFailureRubrics: ['testQuality'] } });
    await expect(resolver(unresolvedFinding)).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL', unresolvedFindingIds: [expect.any(String)] } });
    await expect(resolver(nothingJudged, [
      decision,
    ])).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL' } });
  });

  describe('finalized remediation cases settle their current sources', () => {
    // The adjudication coordinator finalizes a case and marks build_review done;
    // the completion check reads this resolver, so it must honor the same
    // settlement or the gate re-selects a settled lap until the loop guard halts.
    const noDispositions = () => ({ list: async () => ({ ok: true as const, records: [] }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) });
    const caseRecord = (sourceId: string, disposition: 'reject' | 'act', effect: Record<string, unknown> = { kind: 'none' }) => ({
      id: 'case-1', domain: 'build_review', disposition, resolution: disposition === 'act' ? 'open' : 'resolved',
      sources: [{ sourceId, outcome: disposition === 'act' ? 'acted' : 'rejected' }], effect,
    });
    const withCases = (raw: unknown, cases: readonly unknown[] | 'unreadable') => resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: noDispositions,
      createCaseStore: () => ({
        read: async () => cases === 'unreadable'
          ? { ok: false as const, reason: 'malformed-json' as const }
          : { ok: true as const, state: { cases } } as never,
      }),
    });
    const builtinId = canonicalizeBuildReviewFindingIdentity({
      rubric: 'testQuality', contractVersion: currentContractVersion, concernKind: testQualityFinding.concernKind, anchor: testQualityFinding.anchor,
    } as never)!.id;

    it('passes a built-in finding whose rubric-namespaced source a rejected case settled', async () => {
      await expect(withCases(aggregate(), [caseRecord(`testQuality:${builtinId}`, 'reject')])).resolves.toMatchObject({ ok: true, effective: {
        rawVerdict: 'FAIL', verdict: 'PASS', unresolvedFindingIds: [], acceptedFindingIds: [], settledFindingIds: [builtinId],
      } });
    });

    it('passes a custom finding whose source a rejected case settled', async () => {
      const { aggregate: raw, findingId } = customAggregate(undefined);
      await expect(withCases(raw, [caseRecord(`portablePolicy:${findingId}`, 'reject')])).resolves.toMatchObject({ ok: true, effective: {
        rawVerdict: 'FAIL', verdict: 'PASS', unresolvedFindingIds: [], settledFindingIds: [findingId],
      } });
    });

    it('passes built-in and custom findings whose authoritative case links are carried', async () => {
      const carriedCase = (sourceId: string) => ({
        ...caseRecord(sourceId, 'act', { id: 'action-effect', kind: 'action', status: 'applied', workOrderId: 'work-order' }),
        resolution: 'resolved' as const,
        sources: [{ sourceId, outcome: 'carried' as const }],
      });
      const { aggregate: customRaw, findingId: customFindingId } = customAggregate(undefined);

      await expect(Promise.all([
        withCases(aggregate(), [carriedCase(`testQuality:${builtinId}`)]),
        withCases(customRaw, [carriedCase(`portablePolicy:${customFindingId}`)]),
      ])).resolves.toMatchObject([
        { ok: true, effective: { rawVerdict: 'FAIL', verdict: 'PASS', settledFindingIds: [builtinId] } },
        { ok: true, effective: { rawVerdict: 'FAIL', verdict: 'PASS', settledFindingIds: [customFindingId] } },
      ]);
    });

    it('keeps the finding blocking for an open action case, another rubric, or unreadable case state', async () => {
      const blocked = { ok: true, effective: { verdict: 'FAIL', unresolvedFindingIds: [builtinId] } };
      await expect(withCases(aggregate(), [caseRecord(`testQuality:${builtinId}`, 'act', { kind: 'action', status: 'reserved' })])).resolves.toMatchObject(blocked);
      await expect(withCases(aggregate(), [caseRecord(`security:${builtinId}`, 'reject')])).resolves.toMatchObject(blocked);
      await expect(withCases(aggregate(), 'unreadable')).resolves.toMatchObject(blocked);
    });

    it('derives the coordinator-equivalent unsettled set for resolved R and open N on S', async () => {
      const sourceId = `testQuality:${builtinId}`;
      const resolved = caseRecord(sourceId, 'reject');
      const open = caseRecord(sourceId, 'act', { kind: 'action', status: 'reserved' });
      const cases = [resolved, open];

      expect(finalizedBuildReviewSourceIds(cases as never)).toEqual(new Set());
      await expect(withCases(aggregate(), cases)).resolves.toMatchObject({ ok: true, effective: {
        verdict: 'FAIL', unresolvedFindingIds: [builtinId],
      } });
    });
  });

  it('distinguishes an exactly covered infrastructure branch from an uncovered one', async () => {
    const decision = reducedCoverageDecision('testQuality');
    const fault = aggregate({ faults: { testQuality: 'provider-error' }, includeTestQualityFinding: false });
    const resolver = (reducedCoverage: unknown[]) => resolveEffectiveBuildReviewVerdict(worktree, fault, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), listReducedCoverage: async () => ({ ok: true as const, records: reducedCoverage as never }) }),
    });

    // Both branches still report the raw infrastructure failure; only the
    // UNCOVERED projection may pin the gate to the mechanical lane.
    await expect(resolver([])).resolves.toMatchObject({ ok: true, effective: {
      infrastructureFailureRubrics: ['testQuality'], uncoveredInfrastructureFailureRubrics: ['testQuality'],
    } });
    await expect(resolver([decision])).resolves.toMatchObject({ ok: true, effective: {
      infrastructureFailureRubrics: ['testQuality'], uncoveredInfrastructureFailureRubrics: [],
    } });
  });

  it('does not let finding acceptance and reduced coverage substitute for each other', async () => {
    const accepted = canonicalizeBuildReviewFindingIdentity({ ...testQualityFinding, rubric: 'testQuality', contractVersion: 'v3' })!;
    const findingAcceptance = { version: 'v1' as const, feature, finding: accepted, sourceLapId: lapId, summary: 'old prose', rationale: 'risk', operator: 'operator', acceptedAt: '2026-08-14T00:00:00.000Z' };
    const reducedCoverage = reducedCoverageDecision('testQuality');
    const resolver = (raw: ReturnType<typeof aggregate>, records = [findingAcceptance], coverage = [reducedCoverage]) => resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records }), listReducedCoverage: async () => ({ ok: true as const, records: coverage }) }),
    });

    await expect(resolver(aggregate({ faults: { testQuality: 'provider-error' }, includeTestQualityFinding: false }), [findingAcceptance], [])).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL' } });
    await expect(resolver(aggregate(), [], [reducedCoverage])).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL', unresolvedFindingIds: [accepted.id] } });
  });

  it('leaves a full-coverage review passing without decisions', async () => {
    const result = await resolveEffectiveBuildReviewVerdict(worktree, aggregate({ includeTestQualityFinding: false }), {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) }),
    });
    expect(result).toMatchObject({ ok: true, effective: { rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], infrastructureFailureRubrics: [] } });
  });

  it('applies digestless reduced coverage only to the current custom declaration and closed failure reason', async () => {
    const raw = customFailureAggregate();
    const coverage: readonly BuildReviewReducedCoverageDispositionRecord[] = [{
      kind: 'reduced-coverage' as const, version: 'v1' as const, feature,
      identity: { declaration: customStamp.declaration, reason: 'policy-load-failed' },
      rationale: 'The initial policy load is unavailable.', operator: 'operator', acceptedAt: '2026-09-12T00:00:00.000Z',
    }];
    const result = await resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({
        list: async () => ({ ok: true as const, records: [] }),
        listReducedCoverage: async () => ({ ok: true as const, records: coverage }),
      }),
    });

    expect(result).toMatchObject({ ok: true, effective: { rawVerdict: 'FAIL', verdict: 'PASS', unresolvedFindingIds: [] } });
  });

  it('honors only the exact recorded custom accepted risk in the live effective verdict', async () => {
    const { aggregate: raw, findingId } = customAggregate(undefined);
    const member = raw.customResults?.portablePolicy;
    if (!member || member.result.kind !== 'judged') throw new Error('expected a judged custom policy result');
    const current = rehydrateBuildReviewAcceptedRiskFinding(
      (member.result.findings[0] as { identity?: { canonicalPayload?: unknown } } | undefined)?.identity?.canonicalPayload,
    );
    if (!current || !('policy' in current.canonicalPayload)) throw new Error('expected a valid current custom policy identity');
    const changedPolicy = rehydrateBuildReviewAcceptedRiskFinding({
      ...current.canonicalPayload,
      policy: { ...current.canonicalPayload.policy, bundleDigest: `sha256:${'d'.repeat(64)}` },
    });
    if (!changedPolicy) throw new Error('expected a valid changed custom policy identity');
    const decision = (finding: typeof current) => ({
      version: 'v1' as const, feature, finding, sourceLapId: lapId,
      summary: 'The operator accepted this exact current custom policy finding.',
      rationale: 'The documented risk is intentional.', operator: 'operator', acceptedAt: '2026-09-14T00:00:00.000Z',
    });
    const resolve = (records: readonly ReturnType<typeof decision>[]) => resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({
        list: async () => ({ ok: true as const, records }),
        listReducedCoverage: async () => ({ ok: true as const, records: [] }),
      }),
    });

    await expect(resolve([decision(current)])).resolves.toMatchObject({ ok: true, effective: {
      rawVerdict: 'FAIL', verdict: 'PASS', acceptedFindingIds: [findingId], unresolvedFindingIds: [],
    } });
    await expect(resolve([decision(changedPolicy)])).resolves.toMatchObject({ ok: true, effective: {
      rawVerdict: 'FAIL', verdict: 'FAIL', acceptedFindingIds: [], unresolvedFindingIds: [findingId],
    } });
  });

  it('keeps changed custom declarations and reasons uncovered', async () => {
    const coverage: readonly BuildReviewReducedCoverageDispositionRecord[] = [{
      kind: 'reduced-coverage' as const, version: 'v1' as const, feature,
      identity: { declaration: customStamp.declaration, reason: 'policy-load-failed' },
      rationale: 'The initial policy load is unavailable.', operator: 'operator', acceptedAt: '2026-09-12T00:00:00.000Z',
    }];
    const resolve = (raw: ReturnType<typeof customFailureAggregate>) => resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), listReducedCoverage: async () => ({ ok: true as const, records: coverage }) }),
    });

    await expect(resolve(customFailureAggregate({ ...customStamp.declaration, question: 'Does this preserve the revised portable policy contract?' }))).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL' } });
    await expect(resolve(customFailureAggregate({ ...customStamp.declaration, source: 'global' }))).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL' } });
    await expect(resolve(customFailureAggregate({ ...customStamp.declaration, resources: ['revised-criteria.md'] }))).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL' } });
    await expect(resolve(customFailureAggregate(customStamp.declaration, 'provider-error'))).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL' } });
  });

  it('does not let custom coverage suppress a healed policy finding or a wholly unjudged lap', async () => {
    const coverage: readonly BuildReviewReducedCoverageDispositionRecord[] = [{
      kind: 'reduced-coverage' as const, version: 'v1' as const, feature,
      identity: { declaration: customStamp.declaration, reason: 'policy-load-failed' },
      rationale: 'The initial policy load is unavailable.', operator: 'operator', acceptedAt: '2026-09-12T00:00:00.000Z',
    }];
    const resolver = (raw: ReturnType<typeof joinBuildReviewRubricOutcomes>) => resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), listReducedCoverage: async () => ({ ok: true as const, records: coverage }) }),
    });
    const healed = customAggregate(undefined).aggregate;
    const unjudged = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: { testQuality: { kind: 'skipped' as const, rubric: 'testQuality' as const, reason: 'disabled' as const } },
      customResults: { portablePolicy: { declaration: customStamp.declaration, result: { kind: 'infrastructure-failure' as const, rubric: 'portablePolicy', reason: 'policy-load-failed' as const, detail: 'policy could not be loaded' } } },
      currentCustomRubrics: ['portablePolicy'],
    } as never);

    await expect(resolver(healed)).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL', unresolvedFindingIds: [expect.any(String)] } });
    await expect(resolver(unjudged)).resolves.toMatchObject({ ok: true, effective: { verdict: 'FAIL', unresolvedFindingIds: [] } });
  });

  it('keeps custom confidence suppression visible, non-blocking, and durably attributable without operator authority', async () => {
    const { aggregate: raw, findingId } = customAggregate(72);
    const result = await resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      minConfidence: { portablePolicy: 80 },
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) }),
    });

    expect(result).toMatchObject({ ok: true, effective: {
      rawVerdict: 'FAIL', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [findingId],
    } });
    expect(projectBuildReviewSuppressionEntries({
      aggregate: raw, suppressedFindingIds: [findingId], floors: { portablePolicy: 80 },
    })).toEqual([{
      kind: 'confidence', findingId, rubric: 'portablePolicy', summary: 'The changed boundary lacks compatibility evidence.',
      confidence: 72, floor: 80, lastSeenLap: 'lap-current',
    }]);
  });

  it('leaves a custom finding with missing confidence unresolved and absent from suppression history', async () => {
    const { aggregate: raw, findingId } = customAggregate(undefined);
    await expect(resolveEffectiveBuildReviewVerdict(worktree, raw, {
      ...identityDeps,
      minConfidence: { portablePolicy: 80 },
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), listReducedCoverage: async () => ({ ok: true as const, records: [] }) }),
    })).resolves.toMatchObject({ ok: true, effective: {
      verdict: 'FAIL', unresolvedFindingIds: [findingId], suppressedFindingIds: [],
    } });
    expect(projectBuildReviewSuppressionEntries({
      aggregate: raw, suppressedFindingIds: [findingId], floors: { portablePolicy: 80 },
    })).toEqual([]);
  });
});
