// Covers: task:1
import { describe, expect, it } from 'vitest';

import { resolveBuildReviewAcceptance } from '../../src/engine/build-review-acceptance-resolver.js';
import { buildReviewAdjudicationSourceId } from '../../src/engine/build-review-adjudication-context.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import type { BuildReviewDispositionListResult, BuildReviewDispositionRecord } from '../../src/engine/build-review-dispositions.js';
import type { RemediationCaseRecord, RemediationCaseStoreReadResult } from '../../src/engine/remediation-case-store.js';

const feature = { version: 'v1' as const, repository: 'acme/conductor', feature: 'carried-acceptance' };
const otherFeature = { ...feature, feature: 'another-feature' };
const lap1 = parseBuildReviewLapId('lap-1')!;

function finding(id: string) {
  const hash = id === 'origin' ? 'a' : id === 'lap-two' ? 'b' : 'c';
  return canonicalizeBuildReviewFindingIdentity({
    rubric: 'testQuality', contractVersion: 'v3', concernKind: 'test-insensitive',
    anchor: { rubric: 'testQuality', locus: {
      path: `test/engine/${id}.test.ts`,
      contentHash: `sha256:${hash.repeat(64)}`,
      display: id,
    } },
  })!;
}

const origin = finding('origin');
const lap2 = finding('lap-two');
const lap3 = finding('lap-three');

function disposition(
  acceptedFinding = origin,
  overrides: Partial<BuildReviewDispositionRecord> = {},
): BuildReviewDispositionRecord {
  return {
    version: 'v1', feature, finding: acceptedFinding, sourceLapId: lap1,
    summary: 'Accepted temporary risk', rationale: 'The operator accepts this risk.',
    operator: 'james', acceptedAt: '2026-10-19T10:00:00.000Z', ...overrides,
  };
}

function source(findingId: typeof origin, recordedAt: string) {
  return {
    sourceId: buildReviewAdjudicationSourceId({ rubric: findingId.canonicalPayload.rubric, findingId: findingId.id }),
    outcome: 'acted' as const, recordedAt,
  };
}

function caseRecord(sources: RemediationCaseRecord['sources']): RemediationCaseRecord {
  return {
    id: 'case-1', domain: 'build_review', disposition: 'act', priority: 'high',
    rationale: 'A build-review case.', confidence: 'high', resolution: 'open', sources,
    effect: { kind: 'none' },
  };
}

function cases(records: readonly RemediationCaseRecord[]): RemediationCaseStoreReadResult {
  return { ok: true, state: { version: 'v2', feature, cases: records, prdWideningCases: [], suppressions: [] } };
}

function dispositions(records: readonly BuildReviewDispositionRecord[]): BuildReviewDispositionListResult {
  return { ok: true, records };
}

describe('build-review acceptance resolver', () => {
  it('resolves an exact feature disposition directly', () => {
    expect(resolveBuildReviewAcceptance(feature, origin, dispositions([disposition()]), cases([]))).toEqual({ kind: 'direct' });
  });

  it('carries a later case link with its direct origin metadata', () => {
    expect(resolveBuildReviewAcceptance(feature, lap2, dispositions([disposition()]), cases([
      caseRecord([source(origin, '2026-10-19T09:00:00.000Z'), source(lap2, '2026-10-19T11:00:00.000Z')]),
    ]))).toEqual({
      kind: 'carried', caseId: 'case-1', originFindingId: origin.id, originLapId: lap1,
      operator: 'james', rationale: 'The operator accepts this risk.',
    });
  });

  it('does not carry an acceptance recorded in the lap being evaluated', () => {
    expect(resolveBuildReviewAcceptance(feature, lap2, dispositions([
      disposition(origin, { sourceLapId: parseBuildReviewLapId('lap-2')! }),
    ]), cases([
      caseRecord([source(origin, '2026-10-19T09:00:00.000Z'), source(lap2, '2026-10-19T11:00:00.000Z')]),
    ]), parseBuildReviewLapId('lap-2')!)).toEqual({ kind: 'none' });
  });

  it.each([
    ['same-reconciliation sibling', '2026-10-19T09:00:00.000Z'],
    ['pre-acceptance link', '2026-10-19T09:30:00.000Z'],
  ])('does not carry a %s', (_label, recordedAt) => {
    expect(resolveBuildReviewAcceptance(feature, lap2, dispositions([disposition()]), cases([
      caseRecord([source(origin, '2026-10-19T09:00:00.000Z'), source(lap2, recordedAt)]),
    ]))).toEqual({ kind: 'none' });
  });

  it('does not carry a case without a directly accepted source or a foreign-feature disposition', () => {
    const linked = cases([caseRecord([source(origin, '2026-10-19T09:00:00.000Z'), source(lap2, '2026-10-19T11:00:00.000Z')])]);
    expect(resolveBuildReviewAcceptance(feature, lap2, dispositions([]), linked)).toEqual({ kind: 'none' });
    expect(resolveBuildReviewAcceptance(feature, lap2, dispositions([disposition(origin, { feature: otherFeature })]), linked)).toEqual({ kind: 'none' });
  });

  it('carries a three-link chain from the original direct acceptance, never the intermediate link', () => {
    expect(resolveBuildReviewAcceptance(feature, lap3, dispositions([disposition()]), cases([
      caseRecord([
        source(origin, '2026-10-19T09:00:00.000Z'),
        source(lap2, '2026-10-19T11:00:00.000Z'),
        source(lap3, '2026-10-19T12:00:00.000Z'),
      ]),
    ]))).toMatchObject({ kind: 'carried', originFindingId: origin.id, originLapId: lap1 });
  });

  it.each(['unreadable', 'malformed-state'] as const)('fails closed for %s case input while preserving direct acceptance', (reason) => {
    const failedCaseRead: RemediationCaseStoreReadResult = { ok: false, reason };
    expect(resolveBuildReviewAcceptance(feature, lap2, dispositions([disposition()]), failedCaseRead)).toEqual({ kind: 'none' });
    expect(resolveBuildReviewAcceptance(feature, origin, dispositions([disposition()]), failedCaseRead)).toEqual({ kind: 'direct' });
  });

  it.each([
    { ok: false as const, kind: 'unreadable' as const, message: 'cannot read accepted risk' },
    { ok: false as const, kind: 'invalid' as const, message: 'accepted risk is malformed' },
  ])('returns a disposition read failure unchanged', (failedDispositionRead) => {
    const caseInput = cases([caseRecord([source(origin, '2026-10-19T09:00:00.000Z'), source(lap2, '2026-10-19T11:00:00.000Z')])]);
    expect(resolveBuildReviewAcceptance(feature, lap2, failedDispositionRead, caseInput)).toBe(failedDispositionRead);
  });

  it('removes carry when the origin disposition disappears', () => {
    const caseInput = cases([caseRecord([source(origin, '2026-10-19T09:00:00.000Z'), source(lap2, '2026-10-19T11:00:00.000Z')])]);
    expect(resolveBuildReviewAcceptance(feature, lap2, dispositions([]), caseInput)).toEqual({ kind: 'none' });
  });
});
