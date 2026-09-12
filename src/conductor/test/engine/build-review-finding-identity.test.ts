// Covers: task:11
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_FINDING_VOCABULARIES,
  normalizeBuildReviewFindingVocabularyMember,
  type BuildReviewFindingReferenceContext,
} from '../../src/engine/build-review-domain.js';
import {
  canonicalBuildReviewFindingJson,
  canonicalizeBuildReviewFindingIdentity,
  canonicalizeBuildReviewFindingSet,
  stampBuildReviewCustomJudgedResult,
  parseBuildReviewFindingCanonicalPayload,
  rehydrateBuildReviewFindingIdentity,
  type BuildReviewFindingCanonicalPayload,
} from '../../src/engine/build-review-finding-identity.js';

// Surviving coverage in test/engine/build-review-dispositions.test.ts (store
// accepts an engine-produced identity; display drift keeps a disposition
// matched) and build-review-effective.test.ts is deliberately not repeated
// here. This file pins the identity module's own contract.

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;

function finding(locus: Record<string, unknown> = {}, rest: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rubric: 'testQuality', contractVersion: 'v3', concernKind: 'test-insensitive',
    anchor: { rubric: 'testQuality', locus: { path: 'test/widget.test.ts', contentHash: HASH_A, display: 'widget persists state', ...locus } },
    ...rest,
  };
}

const customStamp = {
  rubric: 'portablePolicy',
  lapId: 'lap-1',
  declaration: {
    version: 'v1', rubricId: 'portablePolicy', semanticSkill: 'portable-policy',
    question: 'Does this preserve the portable policy contract?', source: 'project', resources: ['criteria.md'],
  },
  policy: { version: 'v1', bundleDigest: HASH_B },
  candidate: { provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
  reviewedInput: { version: 'v1', contentDigest: HASH_C },
} as const;

const customReferenceContext = {
  sourceRegions: [{
    path: 'src/widget.ts', startLine: 8, endLine: 12, contentHash: HASH_A, display: 'public boundary',
  }],
} as const;

function customPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'custom-findings', version: 'v1', findings: [{
      concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.',
      confidence: 72, evidenceLocations: ['src/widget.ts:8'], sourceRegions: customReferenceContext.sourceRegions,
    }],
    ...overrides,
  };
}

describe('build-review finding identity', () => {
  it('sorts the complete identity payload before hashing and exposes the exact canonical JSON', () => {
    const identity = canonicalizeBuildReviewFindingIdentity({
      anchor: { locus: { display: 'widget persists state', contentHash: HASH_A, path: 'test/widget.test.ts' }, rubric: 'testQuality' },
      concernKind: 'test-insensitive', contractVersion: 'v3', rubric: 'testQuality',
    });
    const canonicalJson = `{"anchor":{"locus":{"contentHash":"${HASH_A}","path":"test/widget.test.ts"},"rubric":"testQuality"},"concernKind":"test-insensitive","contractVersion":"v3","rubric":"testQuality"}`;

    expect(identity).toEqual({
      id: `sha256:${createHash('sha256').update(canonicalJson).digest('hex')}`,
      canonicalJson,
      canonicalPayload: {
        rubric: 'testQuality', contractVersion: 'v3', concernKind: 'test-insensitive',
        anchor: { rubric: 'testQuality', locus: { path: 'test/widget.test.ts', contentHash: HASH_A } },
      },
    });
    expect(canonicalBuildReviewFindingJson(identity!.canonicalPayload)).toBe(canonicalJson);
    expect(canonicalBuildReviewFindingJson({
      anchor: { locus: { occurrence: 2, contentHash: HASH_A, path: 'a.ts' }, rubric: 'testQuality' },
      concernKind: 'test-insensitive', contractVersion: 'v3', rubric: 'testQuality',
    })).toBe(`{"anchor":{"locus":{"contentHash":"${HASH_A}","occurrence":2,"path":"a.ts"},"rubric":"testQuality"},"concernKind":"test-insensitive","contractVersion":"v3","rubric":"testQuality"}`);
  });

  it('keeps identity stable when summary, evidence locations, display, and concern spelling drift', () => {
    const first = canonicalizeBuildReviewFindingIdentity(finding({}, {
      summary: 'The assertion passes against reverted production.', evidenceLocations: ['test/widget.test.ts:8'],
    }));
    const drifted = canonicalizeBuildReviewFindingIdentity(finding(
      { display: 'widget persists state after rebase' },
      { summary: 'Reworded summary.', evidenceLocations: ['test/widget.test.ts:42', 'src/widget.ts:1'], concernKind: 'TEST_INSENSITIVE' },
    ));

    expect(drifted).toEqual(first);
    expect(first!.canonicalJson).not.toContain('display');
    expect(first!.canonicalJson).not.toContain('summary');
  });

  it('changes identity only for concern kind, path, content hash, occurrence, rubric, or contract version', () => {
    const base = canonicalizeBuildReviewFindingIdentity(finding())!;
    const variants = [
      canonicalizeBuildReviewFindingIdentity(finding({ path: 'test/widget-state.test.ts' })),
      canonicalizeBuildReviewFindingIdentity(finding({ contentHash: HASH_B })),
      canonicalizeBuildReviewFindingIdentity(finding({ occurrence: 1 })),
      canonicalizeBuildReviewFindingIdentity(finding({}, { contractVersion: 'v2' })),
    ];

    for (const variant of variants) expect(variant?.id).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(new Set([base.id, ...variants.map((variant) => variant!.id)]).size).toBe(variants.length + 1);
  });

  it('refuses formatted, rephrased, or traversal path references before minting an identity', () => {
    const refused = [
      ' test/widget.test.ts ', '`test/widget.test.ts`', 'The affected test is test/widget.test.ts.',
      'the affected test is test/widget.test.ts', 'test/widget.test.ts, see also test/other.test.ts',
      '/test/widget.test.ts', '../test/widget.test.ts', './test/widget.test.ts', 'test/../widget.test.ts',
    ].map((path) => canonicalizeBuildReviewFindingIdentity(finding({ path })));

    expect(refused).toEqual(Array(9).fill(undefined));
  });

  it('admits a space-containing file name that is not prose (Story 8)', () => {
    expect(canonicalizeBuildReviewFindingIdentity(finding({ path: 'test/space containing name.test.ts' }))).toBeDefined();
  });

  it('refuses a sibling finding when a scoped reference context authorizes only the resolved candidate', () => {
    const first = { path: 'test/widget.test.ts', contentHash: HASH_A, display: 'first assertion' };
    const sibling = { ...first, occurrence: 1, display: 'unrelated sibling assertion' };
    const references: BuildReviewFindingReferenceContext = {
      changedTests: ['test/widget.test.ts'], changedTestRegions: [first], changedPaths: ['test/widget.test.ts'], planTasks: [],
    };

    expect(canonicalizeBuildReviewFindingIdentity(finding(sibling), references)).toBeUndefined();
  });

  it('refuses malformed grader anchors and unknown concern kinds', () => {
    expect(canonicalizeBuildReviewFindingIdentity(finding({ display: '' }))).toBeUndefined();
    expect(canonicalizeBuildReviewFindingIdentity(finding({ contentHash: '' }))).toBeUndefined();
    // An explicit 0-based first occurrence is the omitted form, never a second identity.
    expect(canonicalizeBuildReviewFindingIdentity(finding({ occurrence: 0 }))).toEqual(canonicalizeBuildReviewFindingIdentity(finding({})));
    expect(canonicalizeBuildReviewFindingIdentity(finding({ occurrence: 1.5 }))).toBeUndefined();
    expect(canonicalizeBuildReviewFindingIdentity(finding({}, { concernKind: 'source-text-mirror' }))).toBeUndefined();
    expect(canonicalizeBuildReviewFindingIdentity(finding({}, { rubric: 'tautology' }))).toBeUndefined();
    expect(canonicalizeBuildReviewFindingIdentity(finding({}, { contractVersion: 'v4' }))).toBeUndefined();
    expect(canonicalizeBuildReviewFindingIdentity(finding({}, { anchor: { rubric: 'tautology', locus: { path: 'test/a.test.ts', contentHash: HASH_A, display: 'x' } } }))).toBeUndefined();
    expect(canonicalizeBuildReviewFindingIdentity('prose')).toBeUndefined();
  });

  it('refuses malformed canonical payloads on the canonical schema', () => {
    const payload: BuildReviewFindingCanonicalPayload = canonicalizeBuildReviewFindingIdentity(finding())!.canonicalPayload;
    const anchor = payload.anchor as { rubric: 'testQuality'; locus: Record<string, unknown> };
    const rejected = [
      { ...payload, extra: true },
      { ...payload, summary: 'prose must not survive into the canonical payload' },
      { rubric: payload.rubric, contractVersion: payload.contractVersion, concernKind: payload.concernKind },
      { ...payload, rubric: 'tautology' },
      { ...payload, contractVersion: 'v4' },
      { ...payload, concernKind: 'source-text-mirror' },
      { ...payload, anchor: { ...anchor, locus: { ...anchor.locus, display: 'display is not canonical' } } },
      { ...payload, anchor: { ...anchor, locus: { ...anchor.locus, contentHash: 'sha256:abc' } } },
      { ...payload, anchor: { ...anchor, locus: { ...anchor.locus, contentHash: `sha256:${'A'.repeat(64)}` } } },
      { ...payload, anchor: { ...anchor, locus: { ...anchor.locus, path: '/test/widget.test.ts' } } },
      { ...payload, anchor: { ...anchor, locus: { ...anchor.locus, path: '../widget.test.ts' } } },
      { ...payload, anchor: { ...anchor, locus: { ...anchor.locus, occurrence: 0 } } },
      { ...payload, anchor: { ...anchor, locus: { ...anchor.locus, occurrence: -1 } } },
      { ...payload, anchor: { ...anchor, locus: { ...anchor.locus, occurrence: '1' } } },
      { ...payload, anchor: { rubric: 'testQuality' } },
      { ...payload, anchor: { rubric: 'tautology', locus: anchor.locus } },
      null,
      [],
    ];

    expect(rejected.map(parseBuildReviewFindingCanonicalPayload)).toEqual(Array(rejected.length).fill(undefined));
    expect(rejected.map(rehydrateBuildReviewFindingIdentity)).toEqual(Array(rejected.length).fill(undefined));
  });

  it('rehydrates an engine-produced canonical payload to the identical identity', () => {
    const minted = canonicalizeBuildReviewFindingIdentity(finding({ occurrence: 2 }))!;
    const rehydrated = rehydrateBuildReviewFindingIdentity(JSON.parse(JSON.stringify(minted.canonicalPayload)));

    expect(rehydrated).toEqual(minted);
    expect(rehydrateBuildReviewFindingIdentity({ ...minted.canonicalPayload, concernKind: 'TEST_INSENSITIVE' })).toEqual(minted);
    expect(parseBuildReviewFindingCanonicalPayload(minted.canonicalPayload)).toEqual(minted.canonicalPayload);
  });

  it('canonicalizes a complete finding set and retains every valid member in order', () => {
    const set = canonicalizeBuildReviewFindingSet([
      finding({ path: 'test/b.test.ts' }),
      finding(),
      finding({ occurrence: 1 }),
    ]);

    expect(set?.map((entry) => entry.canonicalPayload.anchor.locus.path)).toEqual(['test/b.test.ts', 'test/widget.test.ts', 'test/widget.test.ts']);
    expect(set?.map((entry) => entry.id)).toEqual([
      canonicalizeBuildReviewFindingIdentity(finding({ path: 'test/b.test.ts' }))!.id,
      canonicalizeBuildReviewFindingIdentity(finding())!.id,
      canonicalizeBuildReviewFindingIdentity(finding({ occurrence: 1 }))!.id,
    ]);
    expect(Object.isFrozen(set)).toBe(true);
  });

  it('fails the whole set closed on one invalid member or one colliding identity', () => {
    expect(canonicalizeBuildReviewFindingSet([finding(), finding({ path: '/abs.test.ts' })])).toBeUndefined();
    expect(canonicalizeBuildReviewFindingSet([finding(), null])).toBeUndefined();
    expect(canonicalizeBuildReviewFindingSet([
      finding({}, { summary: 'first wording' }),
      finding({ display: 'other display' }, { summary: 'second wording' }),
    ])).toBeUndefined();
    expect(canonicalizeBuildReviewFindingSet('not an array')).toBeUndefined();
    expect(canonicalizeBuildReviewFindingSet([])).toEqual([]);
  });

  it('keeps the closed test-quality vocabulary unambiguous after normalization and free of a catch-all', () => {
    expect(normalizeBuildReviewFindingVocabularyMember('TEST_INSENSITIVE')).toBe('test-insensitive');
    for (const vocabulary of Object.values(BUILD_REVIEW_FINDING_VOCABULARIES)) {
      for (const members of [vocabulary.members, vocabulary.concernKinds]) {
        const normalized = members.map(normalizeBuildReviewFindingVocabularyMember);
        expect(new Set(normalized).size).toBe(normalized.length);
        expect(normalized.some((member) => /(?:^|[-_])other(?:$|[-_])/.test(member))).toBe(false);
      }
    }
  });

  it('stamps custom findings from frozen references and engine-owned identity only', () => {
    const stamped = stampBuildReviewCustomJudgedResult(customPayload(), customStamp, customReferenceContext);

    expect(stamped).toMatchObject({
      kind: 'judged', rubric: 'portablePolicy', lapId: 'lap-1', verdict: 'FAIL',
      declaration: customStamp.declaration, policy: customStamp.policy,
      candidate: customStamp.candidate, reviewedInput: customStamp.reviewedInput,
      findings: [{
        concernId: 'portable-policy-gap', confidence: 72,
        sourceRegions: customReferenceContext.sourceRegions,
      }],
    });
    expect(stamped?.findings[0]?.identity.canonicalJson).not.toContain('confidence');
    expect(stamped?.findings[0]?.identity.canonicalJson).not.toContain('lap-1');
    expect(stamped?.findings[0]?.identity.canonicalJson).not.toContain('summary');
    expect(Object.isFrozen(stamped?.findings ?? [])).toBe(true);
  });

  it('refuses custom evidence outside frozen input before a judged envelope can exist', () => {
    const invalidReferences = [
      customPayload({ findings: [{ ...customPayload().findings![0] as object, evidenceLocations: ['src/widget.ts:13'] }] }),
      customPayload({ findings: [{ ...customPayload().findings![0] as object, evidenceLocations: ['src/other.ts:8'] }] }),
      customPayload({ findings: [{ ...customPayload().findings![0] as object, sourceRegions: [{ ...customReferenceContext.sourceRegions[0], startLine: 7 }] }] }),
      customPayload({ findings: [{ ...customPayload().findings![0] as object, sourceRegions: [{ ...customReferenceContext.sourceRegions[0], contentHash: HASH_B }] }] }),
    ];

    for (const payload of invalidReferences) {
      expect(stampBuildReviewCustomJudgedResult(payload, customStamp, customReferenceContext)).toBeUndefined();
    }
  });

  it('changes custom exact identity for declaration or effective policy changes, not confidence or publication timing', () => {
    const first = stampBuildReviewCustomJudgedResult(customPayload(), customStamp, customReferenceContext)!;
    const confidenceDrift = stampBuildReviewCustomJudgedResult(
      customPayload({ findings: [{ ...customPayload().findings![0] as object, confidence: 5 }] }),
      { ...customStamp, lapId: 'lap-2' }, customReferenceContext,
    )!;
    const policyChange = stampBuildReviewCustomJudgedResult(
      customPayload(), { ...customStamp, policy: { version: 'v1', bundleDigest: HASH_C } }, customReferenceContext,
    )!;
    const declarationChange = stampBuildReviewCustomJudgedResult(
      customPayload(), { ...customStamp, declaration: { ...customStamp.declaration, resources: ['stricter-criteria.md'] } }, customReferenceContext,
    )!;

    expect(confidenceDrift.findings[0]!.identity.id).toBe(first.findings[0]!.identity.id);
    expect(policyChange.findings[0]!.identity.id).not.toBe(first.findings[0]!.identity.id);
    expect(declarationChange.findings[0]!.identity.id).not.toBe(first.findings[0]!.identity.id);
  });
});
