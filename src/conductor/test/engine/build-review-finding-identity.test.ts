// Covers: task:6, task:11
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_CUSTOM_V1_SCHEMA,
  BUILD_REVIEW_FINDING_VOCABULARIES,
  diagnoseBuildReviewCustomReviewerPayloadRejection,
  MAX_CUSTOM_EVIDENCE_LOCATION_LENGTH,
  MAX_CUSTOM_EVIDENCE_LOCATIONS,
  MAX_CUSTOM_FINDINGS,
  MAX_CUSTOM_SOURCE_REGIONS,
  MAX_CUSTOM_SUMMARY_LENGTH,
  normalizeBuildReviewFindingVocabularyMember,
  parseBuildReviewCustomReviewerPayload,
  type BuildReviewFindingReferenceContext,
} from '../../src/engine/build-review-domain.js';
import {
  canonicalizeBuildReviewCustomFindingIdentity,
  canonicalBuildReviewFindingJson,
  canonicalizeBuildReviewFindingIdentity,
  canonicalizeBuildReviewFindingSet,
  stampBuildReviewCustomJudgedResult,
  parseBuildReviewFindingCanonicalPayload,
  rehydrateBuildReviewFindingIdentity,
  type BuildReviewFindingCanonicalPayload,
} from '../../src/engine/build-review-finding-identity.js';

import { fromCodexStrictResult } from '../../src/execution/codex-strict-schema.js';
import { admitBuildReviewCustomSourceRegions } from '../../src/engine/build-review-source-region-admission.js';

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

function securityFinding(rest: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rubric: 'security', contractVersion: 'v3', concernKind: 'injection',
    anchor: { rubric: 'security', locus: { path: 'src/auth.ts', contentHash: HASH_A, display: 'request-derived shell command' } },
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
  it('gives security findings the same identity when only display evidence changes', () => {
    const first = canonicalizeBuildReviewFindingIdentity(securityFinding({ summary: 'Shell command includes request input.', evidenceLocations: ['src/auth.ts:8'] }));
    const drifted = canonicalizeBuildReviewFindingIdentity(securityFinding({ summary: 'Reworded.', evidenceLocations: ['src/auth.ts:42'], anchor: { rubric: 'security', locus: { path: 'src/auth.ts', contentHash: HASH_A, display: 'different display' } } }));

    expect(first).toBeDefined();
    expect(first).toMatchObject({
      id: /^sha256:[a-f0-9]{64}$/,
      canonicalPayload: { rubric: 'security', concernKind: 'injection' },
    });
    expect(drifted).toEqual(first);
  });

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
      changedTests: ['test/widget.test.ts'], changedTestRegions: [first], changedContentRegions: [], changedPaths: ['test/widget.test.ts'], planTasks: [],
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

  it('stamps the ledger-demo Codex moneySafety range findings against the frozen blob', async () => {
    // Captured final output: rollout 01a0df56-d9a4-7993-a780-a5f393b6339b,
    // lap-165ec7de9ffb5cb381591485c96204be2c826140. Hashes are literal evidence,
    // not generated by the implementation under test.
    const raw = {
      "kind": "custom-findings",
      "version": "v1",
      "findings": [
        {
          "concernId": "float-money-average-calculation",
          "summary": "Rules 1 and 2: `averageDollars` returns and accumulates monetary amounts as `float64`, converts integer cents through `float64(cents) / 100`, and computes the mean with floating-point division. This abandons integer-cent precision during conversion and calculation.",
          "confidence": 100,
          "evidenceLocations": [
            "internal/httpapi/average.go:10-19"
          ],
          "sourceRegions": [
            {
              "path": "internal/httpapi/average.go",
              "startLine": 10,
              "endLine": 19,
              "contentHash": "sha256:ad638544bce338bce284f53c35e152926a4590ac4e520c92b0286673e18573fc",
              "display": "func averageDollars(transactions []ledger.Transaction) (float64, bool) { ... var sum float64 ... sum += float64(cents) / 100 ... return sum / float64(len(transactions)), true"
            }
          ]
        },
        {
          "concernId": "float-money-formatting",
          "summary": "Rules 1 and 4: `formatAverage(avg float64)` accepts a monetary amount as floating point and renders it with `fmt.Sprintf(\"%.2f\", avg)`, making displayed cents depend on floating-point formatting and rounding.",
          "confidence": 100,
          "evidenceLocations": [
            "internal/httpapi/average.go:23-24"
          ],
          "sourceRegions": [
            {
              "path": "internal/httpapi/average.go",
              "startLine": 23,
              "endLine": 24,
              "contentHash": "sha256:ac0b57a79ea6873fcf58e550be3b0b146cd0534ffe638ce4362f3b9bf592044f",
              "display": "func formatAverage(avg float64) string {\n\treturn fmt.Sprintf(\"%.2f\", avg)"
            }
          ]
        }
      ],
      "requirement": null
    };
    const frozenBlob = `package httpapi

import (
	"fmt"

	"github.com/jstoup111/ledger-demo/internal/ledger"
)

// averageDollars converts each amount with float64(cents) / 100 and returns the float64 mean.
func averageDollars(transactions []ledger.Transaction) (float64, bool) {
	if len(transactions) == 0 {
		return 0, false
	}
	var sum float64
	for _, transaction := range transactions {
		cents := transaction.Amount
		sum += float64(cents) / 100
	}
	return sum / float64(len(transactions)), true
}

// formatAverage renders the mean with fmt.Sprintf("%.2f", avg).
func formatAverage(avg float64) string {
	return fmt.Sprintf("%.2f", avg)
}
`;
    const payload = parseBuildReviewCustomReviewerPayload(fromCodexStrictResult(BUILD_REVIEW_CUSTOM_V1_SCHEMA, raw));
    expect(payload?.kind).toBe('custom-findings');
    if (payload?.kind !== 'custom-findings') throw new Error('fixture did not parse');
    const admission = await admitBuildReviewCustomSourceRegions(
      payload.findings.flatMap((finding) => finding.sourceRegions),
      [{ kind: 'A', path: 'internal/httpapi/average.go' }],
      { read: async (side, path) => {
        expect([side, path]).toEqual(['head', 'internal/httpapi/average.go']);
        return { kind: 'present', value: frozenBlob };
      } },
    );
    expect(admission.kind).toBe('admitted');
    if (admission.kind !== 'admitted') throw new Error(admission.detail);
    const stamped = stampBuildReviewCustomJudgedResult(payload, customStamp, admission);
    expect(stamped?.verdict).toBe('FAIL');
    expect(stamped?.findings.map((finding) => finding.evidenceLocations)).toEqual([
      ['internal/httpapi/average.go:10-19'], ['internal/httpapi/average.go:23-24'],
    ]);
    for (const finding of stamped!.findings) {
      expect(canonicalizeBuildReviewCustomFindingIdentity(finding)).toEqual(finding.identity);
    }
  });

  it('preserves the custom-v1 golden while ignoring provider envelope fields', () => {
    const golden = stampBuildReviewCustomJudgedResult(customPayload(), customStamp, customReferenceContext)!;
    const providerWrapped = customPayload({ rubric: 'provider-rubric', lapId: 'provider-lap' });
    const stamped = stampBuildReviewCustomJudgedResult(providerWrapped, customStamp, customReferenceContext);

    expect(stamped).toEqual(golden);
    expect(stamped?.rubric).toBe(customStamp.rubric);
    expect(stamped?.lapId).toBe(customStamp.lapId);
    expect(stamped?.findings.map((finding) => finding.identity.id)).toEqual(
      golden.findings.map((finding) => finding.identity.id),
    );
  });

  it('admits unsupported-policy as a distinct custom-v1 structured result', () => {
    expect(parseBuildReviewCustomReviewerPayload({
      kind: 'unsupported-policy', requirement: 'network access is required', rubric: 'provider-rubric', lapId: 'provider-lap',
    })).toEqual({ kind: 'unsupported-policy', requirement: 'network access is required' });
  });

  it('names rejected custom source regions and non-integer confidence fields', () => {
    const region = customReferenceContext.sourceRegions[0]!;
    const outsideFrozenRegion = customPayload({ findings: [{
      concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.',
      confidence: 72, evidenceLocations: ['src/widget.ts:8'], sourceRegions: [{ ...region, startLine: 13, endLine: 13 }],
    }] });
    const fractionalConfidence = customPayload({ findings: [{
      concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.',
      confidence: 85.5, evidenceLocations: ['src/widget.ts:8'], sourceRegions: customReferenceContext.sourceRegions,
    }] });

    expect(diagnoseBuildReviewCustomReviewerPayloadRejection(outsideFrozenRegion, customReferenceContext)).toMatchObject({
      kind: 'explained', problems: [{ field: 'findings[0].sourceRegions[0]' }],
    });
    expect(diagnoseBuildReviewCustomReviewerPayloadRejection(fractionalConfidence, customReferenceContext)).toMatchObject({
      kind: 'explained', problems: [{ field: 'findings[0].confidence', required: 'must be an integer from 0 to 100' }],
    });
  });

  it('names the offending field for each parser-only custom-v1 bound instead of a generic root rejection', () => {
    const region = customReferenceContext.sourceRegions[0]!;
    const base = {
      concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.',
      evidenceLocations: ['src/widget.ts:8'], sourceRegions: customReferenceContext.sourceRegions,
    };
    const cases: Array<[string, unknown]> = [
      ['findings', customPayload({ findings: Array.from({ length: MAX_CUSTOM_FINDINGS + 1 }, () => base) })],
      ['findings[0].summary', customPayload({ findings: [{ ...base, summary: 'x'.repeat(MAX_CUSTOM_SUMMARY_LENGTH + 1) }] })],
      ['findings[0].summary', customPayload({ findings: [{ ...base, summary: '' }] })],
      ['findings[0].evidenceLocations', customPayload({ findings: [{ ...base, evidenceLocations: [] }] })],
      ['findings[0].evidenceLocations', customPayload({ findings: [{ ...base, evidenceLocations: Array.from({ length: MAX_CUSTOM_EVIDENCE_LOCATIONS + 1 }, () => 'src/widget.ts:8') }] })],
      ['findings[0].evidenceLocations[1]', customPayload({ findings: [{ ...base, evidenceLocations: ['src/widget.ts:8', 'y'.repeat(MAX_CUSTOM_EVIDENCE_LOCATION_LENGTH + 1)] }] })],
      ['findings[0].sourceRegions', customPayload({ findings: [{ ...base, sourceRegions: [] }] })],
      ['findings[0].sourceRegions', customPayload({ findings: [{ ...base, sourceRegions: Array.from({ length: MAX_CUSTOM_SOURCE_REGIONS + 1 }, () => region) }] })],
      ['findings[0].concernId', customPayload({ findings: [{ ...base, concernId: 'Not A Concern Id!' }] })],
    ];

    for (const [field, payload] of cases) {
      expect(parseBuildReviewCustomReviewerPayload(payload)).toBeUndefined();
      const rejection = diagnoseBuildReviewCustomReviewerPayloadRejection(payload, customReferenceContext);
      expect(rejection.kind, field).toBe('explained');
      expect(rejection.problems.map((problem) => problem.field), field).toContain(field);
      expect(rejection.problems.map((problem) => problem.field), field).not.toContain('$');
    }
  });

  it('accepts the versioned digest emitted by the captured policy package', () => {
    const digest = `sha256-v1:${'d'.repeat(64)}`;
    const stamped = stampBuildReviewCustomJudgedResult(
      customPayload(),
      { ...customStamp, policy: { version: 'v1', bundleDigest: digest } },
      customReferenceContext,
    );

    expect(stamped?.policy.bundleDigest).toBe(digest);
  });

  it('refuses evidence ranges spanning a gap between admitted regions', () => {
    const sourceRegions = [
      { ...customReferenceContext.sourceRegions[0], startLine: 8, endLine: 9 },
      { ...customReferenceContext.sourceRegions[0], startLine: 11, endLine: 12 },
    ];
    const payload = customPayload({ findings: [{
      concernId: 'portable-policy-gap', summary: 'A range cannot bridge uncited code.',
      evidenceLocations: ['src/widget.ts:8-12'], sourceRegions,
    }] });
    expect(stampBuildReviewCustomJudgedResult(payload, customStamp, { sourceRegions })).toBeUndefined();
  });

  it('refuses custom evidence outside frozen input before a judged envelope can exist', () => {
    const finding = {
      concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.',
      confidence: 72, evidenceLocations: ['src/widget.ts:8'], sourceRegions: customReferenceContext.sourceRegions,
    };
    const region = customReferenceContext.sourceRegions[0]!;
    const invalidReferences = [
      customPayload({ findings: [{ ...finding, evidenceLocations: ['src/widget.ts:13'] }] }),
      customPayload({ findings: [{ ...finding, evidenceLocations: ["src/widget.ts:7-8"] }] }),
      customPayload({ findings: [{ ...finding, evidenceLocations: ["src/widget.ts:8-13"] }] }),
      customPayload({ findings: [{ ...finding, evidenceLocations: ["src/widget.ts:9-8"] }] }),
      customPayload({ findings: [{ ...finding, evidenceLocations: ["src/widget.ts:0-8"] }] }),
      customPayload({ findings: [{ ...finding, evidenceLocations: ["src/widget.ts:8-9007199254740993"] }] }),
      customPayload({ findings: [{ ...finding, evidenceLocations: ["src/widget.ts:8-9junk"] }] }),
      customPayload({ findings: [{ ...finding, evidenceLocations: ["src/other.ts:8-9"] }] }),
      customPayload({ findings: [{ ...finding, evidenceLocations: ["../src/widget.ts:8-9"] }] }),
      customPayload({ findings: [{ ...finding, evidenceLocations: ['src/other.ts:8'] }] }),
      customPayload({ findings: [{ ...finding, sourceRegions: [{ ...region, startLine: 7 }] }] }),
      customPayload({ findings: [{ ...finding, sourceRegions: [{ ...region, contentHash: HASH_B }] }] }),
    ];

    for (const payload of invalidReferences) {
      expect(stampBuildReviewCustomJudgedResult(payload, customStamp, customReferenceContext)).toBeUndefined();
    }
  });

  it('changes custom exact identity for declaration or effective policy changes, not confidence or publication timing', () => {
    const finding = {
      concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.',
      confidence: 72, evidenceLocations: ['src/widget.ts:8'], sourceRegions: customReferenceContext.sourceRegions,
    };
    const first = stampBuildReviewCustomJudgedResult(customPayload(), customStamp, customReferenceContext)!;
    const confidenceDrift = stampBuildReviewCustomJudgedResult(
      customPayload({ findings: [{ ...finding, confidence: 5 }] }),
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
