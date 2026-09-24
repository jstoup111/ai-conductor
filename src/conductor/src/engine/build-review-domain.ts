import { createHash } from 'node:crypto';

import type { BuildReviewRubricId } from '../types/config.js';
import type { RubricOutputJsonSchema } from './build-review-contract.js';
import type { ProviderSetupExhaustion } from './provider-setup-failure.js';
import type {
  BuildReviewPolicyIncompatibility,
  BuildReviewPolicyIncompatibilityKind,
  BuildReviewPolicyUnsupportedResult,
} from './build-review-policy-contract.js';
import { buildReviewScopeCandidateIdentityKey } from './build-review-scope-identity.js';
import type {
  BuildReviewRubricProjection,
  TestQualityProjection,
} from './build-review-projections.js';
import { isCanonicalBuildReviewRepoRelativePath } from './build-review-scope-source.js';

export type BuildReviewLapId = string & { readonly __brand: 'BuildReviewLapId' };
export type BuildReviewRubricContractVersion = 'v1' | 'v2' | 'v3';
export const CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION = 'v3' as const;
export type BuildReviewSkipReason = 'disabled' | 'test_quality_empty_scope';
export type BuildReviewInfrastructureFailureReason = 'provider-error' | 'retry-exhausted' | 'missing-artifact' | 'malformed-artifact' | 'stale-artifact' | 'identity-mismatch' | 'preflight-failed' | 'artifact-read-failed' | 'artifact-write-failed' | 'scope-incomplete' | 'projection-oversized' | 'invalid-structured-result' | 'native-schema-unsupported';
export const mapBuildReviewCoordinatorFailureReason = Object.freeze({
  'no-changed-tests': 'preflight-failed', 'no-production-changes': 'preflight-failed', 'missing-scoped-configuration': 'preflight-failed', 'materialization-failed': 'preflight-failed', 'missing-merge-base-file': 'preflight-failed', 'scoped-run-failed': 'preflight-failed', 'scoped-run-launch-failed': 'preflight-failed', 'scoped-run-timeout': 'preflight-failed', 'scoped-run-signaled': 'preflight-failed', aborted: 'preflight-failed', 'cleanup-failed': 'preflight-failed', 'cache-read-failed': 'artifact-read-failed', 'cache-write-failed': 'artifact-write-failed', 'artifact-write-failed': 'artifact-write-failed', 'projection-rubric-mismatch': 'malformed-artifact', 'projection-oversized': 'projection-oversized', 'invalid-provider-result': 'malformed-artifact', 'invalid-structured-result': 'invalid-structured-result', 'native-schema-unsupported': 'native-schema-unsupported', 'provider-error': 'provider-error', 'missing-settlement': 'missing-artifact', 'scope-incomplete': 'scope-incomplete',
} satisfies Record<string, BuildReviewInfrastructureFailureReason>);
export type BuildReviewCoordinatorFailureReason = keyof typeof mapBuildReviewCoordinatorFailureReason;
export function deriveBuildReviewInfrastructureFailureReason(branch: { readonly reason: BuildReviewCoordinatorFailureReason }): BuildReviewInfrastructureFailureReason { return mapBuildReviewCoordinatorFailureReason[branch.reason]; }

/**
 * Policy incompatibility is a typed closed failure lane.  The requirement
 * text remains evidence only; it cannot select a waiver, recovery, or route.
 */
export const mapBuildReviewPolicyIncompatibilityToCoordinatorFailureReason = Object.freeze({
  'required-action': 'preflight-failed',
  'unavailable-capability': 'preflight-failed',
  'unavailable-tool': 'preflight-failed',
  'unavailable-dependency': 'preflight-failed',
  'runtime-unsupported': 'unsupported-policy',
} satisfies Record<BuildReviewPolicyIncompatibilityKind, BuildReviewInfrastructureFailureReason | 'unsupported-policy'>);

export type BuildReviewPolicyIncompatibilityClassification =
  | {
  readonly kind: 'infrastructure-failure';
  readonly reason: BuildReviewInfrastructureFailureReason;
  /** Typed cause retained for coverage and later dynamic-rubric projection. */
  readonly detail: BuildReviewPolicyIncompatibility;
  }
  | { readonly kind: 'unsupported-policy'; readonly requirement: string; readonly detail: BuildReviewPolicyIncompatibility };

/** Converts policy refusal into a closed uncovered result, never PASS. */
export function classifyBuildReviewPolicyIncompatibility(
  result: BuildReviewPolicyUnsupportedResult,
): BuildReviewPolicyIncompatibilityClassification {
  if (result.incompatibility.kind === 'runtime-unsupported') {
    return { kind: 'unsupported-policy', requirement: result.incompatibility.requirement, detail: result.incompatibility };
  }
  return {
    kind: 'infrastructure-failure',
    reason: mapBuildReviewPolicyIncompatibilityToCoordinatorFailureReason[result.incompatibility.kind],
    detail: result.incompatibility,
  };
}

export interface BuildReviewContentRegionReference { readonly path: string; readonly contentHash: string; readonly display: string; readonly occurrence?: number; }
export type BuildReviewFindingAnchor =
  | { readonly rubric: 'testQuality'; readonly locus: BuildReviewContentRegionReference }
  | { readonly rubric: 'security'; readonly locus: BuildReviewContentRegionReference };
export interface BuildReviewFindingReferenceContext { readonly changedTests: readonly string[]; readonly changedTestRegions?: readonly BuildReviewContentRegionReference[]; readonly changedContentRegions: readonly BuildReviewContentRegionReference[]; readonly changedPaths: readonly string[]; readonly planTasks: readonly string[]; }

/** Compatibility title fields are authoritative only for projections before typed scope. */
export function isLegacyBuildReviewTestScope(testScope: unknown): boolean {
  return testScope === undefined;
}

/** Kept local to avoid making the domain module a runtime projection dependency. */
function isTestQualityProjection(
  projection: BuildReviewRubricProjection,
): projection is TestQualityProjection {
  return projection.rubric === 'testQuality';
}
export interface BuildReviewCandidateScopeSourceRegion { readonly path: string; readonly startLine: number; readonly endLine: number; readonly contentHash: string; readonly display: string; }
export interface BuildReviewCandidateScopeCandidate { readonly candidateId: string; readonly sourceRegion: BuildReviewCandidateScopeSourceRegion; readonly obligationReferences: readonly string[]; }
export interface BuildReviewCandidateScopeResolutionResolved { readonly candidateId: string; readonly status: 'resolved'; readonly sourceRegion: BuildReviewCandidateScopeSourceRegion; readonly obligationReferences: readonly string[]; readonly associationReason: string; }
export interface BuildReviewCandidateScopeResolutionOutOfScope { readonly candidateId: string; readonly status: 'out-of-scope'; readonly exclusionReason: string; }
/**
 * The provider supplies only `candidateId` and `missingEvidenceReason`.
 * Validation stamps the frozen binding evidence onto the result before it is
 * persisted, so a later aggregate can re-derive the fault without reading a
 * mutable projection or trusting an unbound provider claim.
 */
export interface BuildReviewCandidateScopeResolutionIndeterminate { readonly candidateId: string; readonly status: 'indeterminate'; readonly sourceRegion: BuildReviewCandidateScopeSourceRegion; readonly obligationReferences: readonly string[]; readonly missingEvidenceReason: string; }
export type BuildReviewCandidateScopeResolution = BuildReviewCandidateScopeResolutionResolved | BuildReviewCandidateScopeResolutionOutOfScope | BuildReviewCandidateScopeResolutionIndeterminate;
export interface BuildReviewCandidateScopeResolutionContext { readonly candidates: readonly BuildReviewCandidateScopeCandidate[]; }
export interface BuildReviewFinding { readonly concernKind: string; readonly summary: string; readonly evidenceLocations: readonly string[]; readonly anchor: BuildReviewFindingAnchor; readonly confidence?: number; }
export interface BuildReviewJudgedResult { readonly kind: 'judged'; readonly rubric: BuildReviewRubricId; readonly lapId: BuildReviewLapId; readonly snapshotDigest: string; readonly contractVersion: BuildReviewRubricContractVersion; readonly findings: readonly BuildReviewFinding[]; readonly scopeResolutions?: readonly BuildReviewCandidateScopeResolution[]; readonly counterfactualSensitivity?: CounterfactualSensitivity; readonly verdict: 'PASS' | 'FAIL'; }
/** Parser identity selected from the effective catalog member, never enabled-map membership. */
export type BuildReviewEffectiveResultDescriptor =
  | { readonly kind: 'builtin'; readonly rubric: 'testQuality'; readonly parser: 'test-quality-v3' }
  | { readonly kind: 'builtin'; readonly rubric: 'security'; readonly parser: 'security-v3' }
  | { readonly kind: 'custom'; readonly rubric: string; readonly parser: 'custom-findings-v1' };
export type BuildReviewCustomFindingContractVersion = 'v1';
export interface BuildReviewCustomFinding {
  readonly concernId: string;
  readonly summary: string;
  readonly confidence?: number;
  readonly evidenceLocations: readonly string[];
  readonly sourceRegions: readonly BuildReviewCandidateScopeSourceRegion[];
}
/** Frozen source authority for a custom reviewer payload. */
export interface BuildReviewCustomFindingReferenceContext {
  readonly sourceRegions: readonly BuildReviewCandidateScopeSourceRegion[];
}
/** Reviewer-owned payload only; engine-owned result identity is stamped later. */
export interface BuildReviewCustomFindingsPayload {
  readonly kind: 'custom-findings';
  readonly version: BuildReviewCustomFindingContractVersion;
  readonly findings: readonly BuildReviewCustomFinding[];
}
/** A runtime refusal is deliberately not an empty successful judgement. */
export interface BuildReviewCustomUnsupportedPayload {
  readonly kind: 'unsupported-policy';
  readonly requirement: string;
}
export type BuildReviewCustomReviewerPayload = BuildReviewCustomFindingsPayload | BuildReviewCustomUnsupportedPayload;
export interface BuildReviewSkip { readonly kind: 'skipped'; readonly rubric: BuildReviewRubricId; readonly reason: BuildReviewSkipReason; }
export interface BuildReviewInfrastructureFailure { readonly kind: 'infrastructure-failure'; readonly rubric: BuildReviewRubricId; readonly reason: BuildReviewInfrastructureFailureReason; readonly detail: string; readonly providerSetupExhaustion?: ProviderSetupExhaustion; readonly rejection?: BuildReviewJudgedResultRejection; }
export type BuildReviewRubricResult = BuildReviewJudgedResult | BuildReviewSkip | BuildReviewInfrastructureFailure;
/** A non-judgment coverage fault derived only from an already-valid judged result. */
export interface BuildReviewScopeIncompleteFault {
  readonly rubric: BuildReviewRubricId;
  readonly reason: 'scope-incomplete';
  readonly candidates: readonly BuildReviewCandidateScopeResolutionIndeterminate[];
  /** Bounded diagnostic for the existing mechanical-fault ledger and rendering path. */
  readonly detail: string;
}
export const BUILD_REVIEW_FINDING_VOCABULARIES = Object.freeze({
  testQuality: Object.freeze({
    members: Object.freeze(['test-insensitive']),
    concernKinds: Object.freeze(['test-insensitive']),
    anchorFields: Object.freeze({}),
  }),
  security: Object.freeze({
    members: Object.freeze([
      'committed-secret', 'injection', 'broken-access-control', 'path-traversal',
      'unsafe-deserialization', 'cryptographic-failure', 'security-misconfiguration',
      'authentication-failure', 'integrity-failure', 'ssrf',
    ]),
    concernKinds: Object.freeze([
      'committed-secret', 'injection', 'broken-access-control', 'path-traversal',
      'unsafe-deserialization', 'cryptographic-failure', 'security-misconfiguration',
      'authentication-failure', 'integrity-failure', 'ssrf',
    ]),
    anchorFields: Object.freeze({}),
  }),
});
export const COUNTERFACTUAL_SENSITIVITY_VOCABULARY = Object.freeze(['supports', 'indeterminate', 'not-applicable'] as const);
export type CounterfactualSensitivity = typeof COUNTERFACTUAL_SENSITIVITY_VOCABULARY[number];
const BUILD_REVIEW_CONFIDENCE_VALUES = Object.freeze(Array.from({ length: 101 }, (_, value) => value));

/**
 * Parser-enforced grammar stated in the descriptor schemas, restricted to the
 * keyword subset the native provider grammar accepts: `enum`, `pattern`, and
 * `minItems` of 0 or 1. Claude's structured outputs reject `minLength`,
 * `maxLength`, `minimum`, `maximum`, and `maxItems` with a 400, so length,
 * count, and ordinal bounds stay parser-only and are named by the rejection
 * diagnosis instead.
 */
const NON_BLANK_STRING_PATTERN = '\\S';
const SHA256_CONTENT_HASH_PATTERN = '^sha256:[a-f0-9]{64}$';
export const CUSTOM_SOURCE_REGION_CONTENT_HASH = new RegExp(SHA256_CONTENT_HASH_PATTERN);
const NON_BLANK_STRING = Object.freeze({ type: 'string', pattern: NON_BLANK_STRING_PATTERN });
const CONTENT_HASH_STRING = Object.freeze({ type: 'string', pattern: SHA256_CONTENT_HASH_PATTERN });
const NON_EMPTY_NON_BLANK_STRING_ARRAY = Object.freeze({ type: 'array', minItems: 1, items: NON_BLANK_STRING });

export interface BuildReviewJudgedV3Schema extends RubricOutputJsonSchema {
  readonly type: 'object';
  readonly additionalProperties: false;
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
}

function freezeSchema<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSchema(child);
    Object.freeze(value);
  }
  return value;
}

function buildReviewJudgedV3Schema(rubric: BuildReviewRubricId): BuildReviewJudgedV3Schema {
  return freezeSchema({
    type: 'object',
    additionalProperties: false,
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['concernKind', 'summary', 'evidenceLocations', 'anchor'],
          properties: {
            concernKind: { type: 'string', enum: BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds },
            summary: NON_BLANK_STRING,
            evidenceLocations: NON_EMPTY_NON_BLANK_STRING_ARRAY,
            confidence: { type: 'integer', enum: BUILD_REVIEW_CONFIDENCE_VALUES },
            anchor: {
              type: 'object',
              additionalProperties: false,
              required: ['rubric', 'locus'],
              properties: {
                rubric: { type: 'string', enum: [rubric] },
                locus: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['path', 'contentHash', 'display'],
                  properties: {
                    path: NON_BLANK_STRING,
                    // Security loci are sha256 content hashes; test-quality loci
                    // may also carry projected title hashes, so only non-blankness
                    // is grammar there and membership stays in the diagnosis.
                    contentHash: rubric === 'security' ? CONTENT_HASH_STRING : NON_BLANK_STRING,
                    display: NON_BLANK_STRING,
                    occurrence: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      // Test-quality evidence only: the security parser rejects these fields, so
      // offering them in the security schema invites a result it must refuse.
      ...(rubric === 'testQuality' ? TEST_QUALITY_EVIDENCE_SCHEMA_PROPERTIES : {}),
    },
  }) as BuildReviewJudgedV3Schema;
}

const TEST_QUALITY_EVIDENCE_SCHEMA_PROPERTIES = {
      relocationAudit: { type: 'array', items: { type: 'object', additionalProperties: false, required: [], properties: {} } },
      counterfactualSensitivity: { type: 'string', enum: COUNTERFACTUAL_SENSITIVITY_VOCABULARY },
      scopeResolutions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['candidateId', 'status'],
          properties: {
            candidateId: NON_BLANK_STRING,
            status: { type: 'string', enum: ['resolved', 'out-of-scope', 'indeterminate'] },
            sourceRegion: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'startLine', 'endLine', 'contentHash', 'display'],
              properties: {
                path: NON_BLANK_STRING,
                startLine: { type: 'integer' },
                endLine: { type: 'integer' },
                contentHash: CONTENT_HASH_STRING,
                display: NON_BLANK_STRING,
              },
            },
            obligationReferences: NON_EMPTY_NON_BLANK_STRING_ARRAY,
            associationReason: NON_BLANK_STRING,
            exclusionReason: NON_BLANK_STRING,
            missingEvidenceReason: NON_BLANK_STRING,
          },
        },
      },
} as const;

/** The test-quality judged-v3 schema; every built-in branch uses a rubric-bound variant below. */
export const BUILD_REVIEW_JUDGED_V3_SCHEMA = buildReviewJudgedV3Schema('testQuality');

/** Closed per-rubric variants keep concern-kind vocabulary in the engine-owned schema. */
export const BUILD_REVIEW_JUDGED_V3_SCHEMAS = Object.freeze({
  testQuality: BUILD_REVIEW_JUDGED_V3_SCHEMA,
  security: buildReviewJudgedV3Schema('security'),
});

export function normalizeBuildReviewFindingVocabularyMember(value: string): string { return value.toLowerCase().replaceAll('_', '-'); }
export function parseBuildReviewFindingConcernKind(value: unknown, rubric: BuildReviewRubricId): string | undefined {
  const normalized = typeof value === 'string' ? normalizeBuildReviewFindingVocabularyMember(value) : '';
  return BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds.includes(normalized)
    ? normalized
    : undefined;
}
function parseCounterfactualSensitivity(value: unknown): CounterfactualSensitivity | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  const matches = COUNTERFACTUAL_SENSITIVITY_VOCABULARY.filter((member) => member === normalized);
  return matches.length === 1 ? matches[0] : undefined;
}

const LAP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const CUSTOM_CONCERN_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
export const MAX_CUSTOM_FINDINGS = 64;
export const MAX_CUSTOM_EVIDENCE_LOCATIONS = 64;
export const MAX_CUSTOM_SOURCE_REGIONS = 64;
export const MAX_CUSTOM_SUMMARY_LENGTH = 4_096;
export const MAX_CUSTOM_EVIDENCE_LOCATION_LENGTH = 1_024;
export const MAX_CUSTOM_UNSUPPORTED_REQUIREMENT_LENGTH = 512;

/**
 * Native structural schema for the reviewer-owned custom-v1 payload. It states
 * every parser-enforced grammar the native provider subset can express
 * (identifier and hash patterns, non-blank strings, non-empty arrays). The
 * `MAX_CUSTOM_*` count and length bounds and the line-number ordering need
 * `maxItems`/`maxLength`/`minimum`, which the Claude native grammar rejects,
 * so they remain parser-enforced and are named by the rejection diagnosis.
 */
export const BUILD_REVIEW_CUSTOM_V1_SCHEMA = freezeSchema({
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'version', 'findings'],
      properties: {
        kind: { type: 'string', enum: ['custom-findings'] },
        version: { type: 'string', enum: ['v1'] },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['concernId', 'summary', 'evidenceLocations', 'sourceRegions'],
            properties: {
              concernId: { type: 'string', pattern: CUSTOM_CONCERN_ID.source },
              summary: NON_BLANK_STRING,
              confidence: { type: 'integer', enum: BUILD_REVIEW_CONFIDENCE_VALUES },
              evidenceLocations: NON_EMPTY_NON_BLANK_STRING_ARRAY,
              sourceRegions: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['path', 'startLine', 'endLine', 'contentHash', 'display'],
                  properties: {
                    path: NON_BLANK_STRING,
                    startLine: { type: 'integer' },
                    endLine: { type: 'integer' },
                    contentHash: CONTENT_HASH_STRING,
                    display: NON_BLANK_STRING,
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'requirement'],
      properties: {
        kind: { type: 'string', enum: ['unsupported-policy'] },
        requirement: NON_BLANK_STRING,
      },
    },
  ],
}) satisfies RubricOutputJsonSchema;

function object(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
export function parseBuildReviewCanonicalPathReference(value: unknown): string | undefined { return typeof value === 'string' && isCanonicalBuildReviewRepoRelativePath(value) ? value : undefined; }
export function parseBuildReviewLapId(value: unknown): BuildReviewLapId | undefined { return typeof value === 'string' && LAP.test(value) ? value as BuildReviewLapId : undefined; }
export function parseBuildReviewRubricContractVersion(value: unknown): BuildReviewRubricContractVersion | undefined { return value === 'v1' || value === 'v2' || value === 'v3' ? value : undefined; }
// `occurrence` is the 0-based ordinal among equal-content regions in one path;
// 0 is the unique/first region and normalizes away so identities never differ
// on an explicit-versus-omitted zero.
function region(value: unknown): BuildReviewContentRegionReference | undefined { const source = object(value); if (!source || !text(source.path) || !isCanonicalBuildReviewRepoRelativePath(source.path) || !text(source.contentHash) || !text(source.display) || (source.occurrence !== undefined && (!Number.isInteger(source.occurrence) || (source.occurrence as number) < 0))) return undefined; return contentRegionReference(source.path, source.contentHash, source.display, source.occurrence as number | undefined); }
function contentRegionReference(path: string, contentHash: string, display: string, occurrence = 0): BuildReviewContentRegionReference { return { path, contentHash, display, ...(occurrence > 0 ? { occurrence } : {}) }; }
function candidateScopeSourceRegion(value: unknown): BuildReviewCandidateScopeSourceRegion | undefined {
  const source = object(value);
  return source && parseBuildReviewCanonicalPathReference(source.path) &&
    Number.isInteger(source.startLine) && (source.startLine as number) > 0 &&
    Number.isInteger(source.endLine) && (source.endLine as number) >= (source.startLine as number) &&
    typeof source.contentHash === 'string' && CUSTOM_SOURCE_REGION_CONTENT_HASH.test(source.contentHash) && text(source.display)
    ? { path: source.path as string, startLine: source.startLine as number, endLine: source.endLine as number, contentHash: source.contentHash, display: source.display as string }
    : undefined;
}
function customSourceRegion(value: unknown): BuildReviewCandidateScopeSourceRegion | undefined {
  const source = object(value);
  return source && exactKeys(source, ['path', 'startLine', 'endLine', 'contentHash', 'display'])
    ? candidateScopeSourceRegion(source)
    : undefined;
}
function sameCandidateScopeSourceRegion(left: BuildReviewCandidateScopeSourceRegion, right: BuildReviewCandidateScopeSourceRegion): boolean {
  return left.path === right.path && left.startLine === right.startLine && left.endLine === right.endLine && left.contentHash === right.contentHash;
}
function obligationReferences(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(text) && new Set(value).size === value.length
    ? Object.freeze([...value] as string[])
    : undefined;
}
function candidateScopeCandidate(value: unknown): BuildReviewCandidateScopeCandidate | undefined {
  const source = object(value); const sourceRegion = source && candidateScopeSourceRegion(source.sourceRegion); const obligations = source && obligationReferences(source.obligationReferences);
  return source && text(source.candidateId) && sourceRegion && obligations
    ? { candidateId: source.candidateId, sourceRegion, obligationReferences: obligations }
    : undefined;
}
/** Validates exactly one source-grounded reviewer disposition for every frozen scope candidate. */
export function parseBuildReviewCandidateScopeResolutions(value: unknown, context: BuildReviewCandidateScopeResolutionContext): readonly BuildReviewCandidateScopeResolution[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const candidates = context.candidates.map(candidateScopeCandidate);
  if (candidates.some((candidate) => !candidate)) return undefined;
  const known = candidates as BuildReviewCandidateScopeCandidate[];
  if (new Set(known.map((candidate) => candidate.candidateId)).size !== known.length || value.length !== known.length) return undefined;
  const resolutions = value.map((entry): BuildReviewCandidateScopeResolution | undefined => {
    const source = object(entry); const candidate = source && known.find((item) => item.candidateId === source.candidateId);
    if (!source || !candidate) return undefined;
    if (source.status === 'resolved') {
      const sourceRegion = candidateScopeSourceRegion(source.sourceRegion); const obligations = obligationReferences(source.obligationReferences);
      return sourceRegion && obligations && obligations.every((reference) => candidate.obligationReferences.includes(reference)) &&
        sameCandidateScopeSourceRegion(sourceRegion, candidate.sourceRegion) && text(source.associationReason)
        ? { candidateId: candidate.candidateId, status: 'resolved', sourceRegion, obligationReferences: obligations, associationReason: source.associationReason }
        : undefined;
    }
    if (source.status === 'out-of-scope' && text(source.exclusionReason)) return { candidateId: candidate.candidateId, status: 'out-of-scope', exclusionReason: source.exclusionReason };
    if (source.status === 'indeterminate' && text(source.missingEvidenceReason)) return {
      candidateId: candidate.candidateId, status: 'indeterminate', sourceRegion: candidate.sourceRegion,
      obligationReferences: candidate.obligationReferences, missingEvidenceReason: source.missingEvidenceReason,
    };
    return undefined;
  });
  return resolutions.some((resolution) => !resolution) || new Set(resolutions.map((resolution) => resolution!.candidateId)).size !== known.length
    ? undefined
    : Object.freeze(known.map((candidate) => resolutions.find((resolution) => resolution!.candidateId === candidate.candidateId)!));
}
/** Parses persisted scope evidence after the dispatch boundary has already bound it to frozen candidates. */
function parsePersistedBuildReviewCandidateScopeResolutions(value: unknown): readonly BuildReviewCandidateScopeResolution[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const resolutions = value.map((entry): BuildReviewCandidateScopeResolution | undefined => {
    const source = object(entry);
    if (!source || !text(source.candidateId)) return undefined;
    if (source.status === 'resolved') {
      const sourceRegion = candidateScopeSourceRegion(source.sourceRegion); const obligations = obligationReferences(source.obligationReferences);
      return sourceRegion && obligations && text(source.associationReason)
        ? { candidateId: source.candidateId, status: 'resolved', sourceRegion, obligationReferences: obligations, associationReason: source.associationReason }
        : undefined;
    }
    if (source.status === 'out-of-scope' && text(source.exclusionReason)) return { candidateId: source.candidateId, status: 'out-of-scope', exclusionReason: source.exclusionReason };
    if (source.status === 'indeterminate') {
      const sourceRegion = candidateScopeSourceRegion(source.sourceRegion); const obligations = obligationReferences(source.obligationReferences);
      return sourceRegion && obligations && text(source.missingEvidenceReason)
        ? { candidateId: source.candidateId, status: 'indeterminate', sourceRegion, obligationReferences: obligations, missingEvidenceReason: source.missingEvidenceReason }
        : undefined;
    }
    return undefined;
  });
  return resolutions.some((resolution) => !resolution) || new Set(resolutions.map((resolution) => resolution!.candidateId)).size !== resolutions.length
    ? undefined
    : Object.freeze(resolutions as BuildReviewCandidateScopeResolution[]);
}
/** Stamp occurrence ordinals onto equal-content references sharing one path, in projection order. */
function withOccurrenceOrdinals(references: readonly BuildReviewContentRegionReference[]): readonly BuildReviewContentRegionReference[] {
  const seen = new Map<string, number>();
  return references.map((reference) => {
    const key = `${reference.path}\u0000${reference.contentHash}`;
    const next = seen.get(key) ?? 0;
    // A typed declaration's ordinal is already authoritative. Coarse regions
    // use the next free ordinal in that same namespace.
    const occurrence = reference.occurrence ?? next;
    seen.set(key, Math.max(next, occurrence + 1));
    return contentRegionReference(reference.path, reference.contentHash, reference.display, occurrence);
  });
}
function sameRegion(left: BuildReviewContentRegionReference, right: BuildReviewContentRegionReference): boolean { return left.path === right.path && left.contentHash === right.contentHash && left.occurrence === right.occurrence; }
/**
 * adr-2026-08-18 fixes finding identity as `sha256(whitespace-normalized
 * titleText)`, and the skill contract states the same shape to providers.
 * A reflowed or re-indented declared title is the same declared test, so both
 * title-hash sites derive their content hash here and cannot diverge.
 */
function normalizedTitleHash(titleText: string): string {
  return `sha256:${createHash('sha256').update(titleText.trim().replace(/\s+/g, ' ')).digest('hex')}`;
}
/**
 * The declared titles the frozen projection carries for its uncertain
 * candidates.  A resolved candidate whose display names one of these is
 * recoverable, so decision 8 requires the existing declared-title reference
 * rather than its source-byte resolution evidence.
 */
interface DeclaredTitleOccurrenceIndex {
  readonly targets: ReadonlyMap<string, readonly number[]>;
  readonly candidatesById: ReadonlyMap<string, { readonly title: string; readonly occurrence: number }>;
  readonly candidates: ReadonlyMap<string, readonly number[]>;
}

function declaredHeadTestTarget(entry: unknown): {
  readonly path: string;
  readonly title: string;
  readonly occurrence: number;
} | undefined {
  const item = object(entry); const declaration = item && object(item.declaration); const source = item && object(item.source);
  const path = source && parseBuildReviewCanonicalPathReference(source.fileName);
  const titleChain = declaration?.titleChain;
  const occurrence = declaration?.occurrence;
  if (!path || source?.side !== 'head' || declaration?.kind !== 'test' || !Array.isArray(titleChain) || titleChain.length === 0 || !titleChain.every(text) || !Number.isInteger(occurrence) || (occurrence as number) < 0) return undefined;
  return { path, title: titleChain.join(' > '), occurrence: occurrence as number };
}

function declaredTitleOccurrenceIndex(projection: TestQualityProjection): DeclaredTitleOccurrenceIndex {
  const scope = object(projection.testScope);
  const targets = new Map<string, number[]>();
  const candidatesById = new Map<string, { readonly title: string; readonly occurrence: number }>();
  const candidates = new Map<string, number[]>();
  if (!scope) return { targets, candidatesById, candidates };
  for (const entry of Array.isArray(scope.targets) ? scope.targets : []) {
    const target = declaredHeadTestTarget(entry);
    if (!target) continue;
    const key = `${target.path}\u0000${target.title}`;
    const occurrences = targets.get(key) ?? [];
    occurrences.push(target.occurrence);
    targets.set(key, occurrences);
  }
  const evidence = Array.isArray(scope.evidence) ? scope.evidence.map(object) : [];
  for (const entry of Array.isArray(scope.candidates) ? scope.candidates : []) {
    const item = object(entry); const declaration = item && object(item.declaration);
    const source = item && object(item.source); const span = declaration && object(declaration.span);
    const titleChain = declaration?.titleChain;
    const occurrence = declaration?.occurrence;
    if (declaration?.kind !== 'test' || !Array.isArray(titleChain) || titleChain.length === 0 || !titleChain.every(text) || !Number.isInteger(occurrence) || (occurrence as number) < 0) continue;
    const title = titleChain.join(' > ');
    const key = title;
    const occurrences = candidates.get(key) ?? [];
    occurrences.push(occurrence as number);
    candidates.set(key, occurrences);
    const candidateIdentity = source && span
      ? buildReviewScopeCandidateIdentityKey({
          source: { fileName: source.fileName as string, side: source.side as 'base' | 'head' },
          region: { start: span.start as number, end: span.end as number },
        })
      : undefined;
    const matchedEvidence = evidence.find((item) => {
      const evidenceSource = object(item?.source); const region = object(item?.region);
      return candidateIdentity !== undefined && evidenceSource && region &&
        buildReviewScopeCandidateIdentityKey({
          source: { fileName: evidenceSource.fileName as string, side: evidenceSource.side as 'base' | 'head' },
          region: { start: region.start as number, end: region.end as number },
        }) === candidateIdentity;
    });
    const candidateId = typeof item?.candidateId === 'string' ? item.candidateId : matchedEvidence?.id;
    if (typeof candidateId === 'string') candidatesById.set(candidateId, { title, occurrence: occurrence as number });
  }
  return { targets, candidatesById, candidates };
}
function targetRegions(projection: TestQualityProjection, declaredTitles: DeclaredTitleOccurrenceIndex): readonly BuildReviewContentRegionReference[] | undefined {
  const scope = object(projection.testScope);
  if (!scope || !Array.isArray(scope.targets)) return undefined;
  return scope.targets.flatMap((target) => {
    const declared = declaredHeadTestTarget(target);
    if (!declared || !declaredTitles.targets.get(`${declared.path}\u0000${declared.title}`)?.includes(declared.occurrence)) return [];
    return [contentRegionReference(declared.path, normalizedTitleHash(declared.title), declared.title, declared.occurrence)];
  });
}
/** Builds finding authority only from established targets and already-validated resolved candidates. */
export function buildReviewFindingReferenceContext(projection: BuildReviewRubricProjection, scopeResolutions: readonly BuildReviewCandidateScopeResolution[] = []): BuildReviewFindingReferenceContext {
  if (!isTestQualityProjection(projection)) {
    const changedContentRegions = withOccurrenceOrdinals(projection.changedFiles.flatMap((file) =>
      file.hunks.map((hunk) => contentRegionReference(file.path, hunk.contentHash, `${file.path}:${hunk.newStart}`)),
    ));
    return { changedTests: [], changedContentRegions, changedPaths: projection.changedFiles.map((file) => file.path), planTasks: [] };
  }
  const declaredTitles = declaredTitleOccurrenceIndex(projection);
  const targets = targetRegions(projection, declaredTitles);
  const useLegacyTitles = isLegacyBuildReviewTestScope(projection.testScope);
  const titleRegions = targets && targets.length > 0 ? targets : useLegacyTitles ? projection.changedTestTitles?.flatMap((title) => {
      const path = parseBuildReviewCanonicalPathReference(title.selector);
      return path ? [{ path, contentHash: title.staticExtractionFallback ? `sha256:${createHash('sha256').update(title.selector).digest('hex')}` : normalizedTitleHash(title.titleText), display: title.titleText || `${path} changed test` }] : [];
    }) ?? [] : [];
  // Resolution evidence stays on the resolution record; it is not an identity
  // input (decision 8).  A recoverable declared title anchors the finding, and
  // only an unrecoverable one falls back to the explicitly coarse source hash.
  const resolvedOccurrences = new Map<string, number[]>();
  for (const [key, occurrences] of declaredTitles.candidates) resolvedOccurrences.set(key, [...occurrences]);
  const resolvedRegions = scopeResolutions.flatMap((resolution) => {
    if (resolution.status !== 'resolved') return [];
    const declaredCandidate = useLegacyTitles ? undefined : declaredTitles.candidatesById.get(resolution.candidateId);
    const title = declaredCandidate?.title ?? resolution.sourceRegion.display;
    const occurrences = declaredCandidate ? undefined : resolvedOccurrences.get(title);
    const occurrence = declaredCandidate?.occurrence ?? occurrences?.shift();
    return [{
      path: resolution.sourceRegion.path,
      contentHash: declaredCandidate || occurrences ? normalizedTitleHash(title) : resolution.sourceRegion.contentHash,
      display: resolution.sourceRegion.display,
      ...(occurrence === undefined ? {} : { occurrence }),
    }];
  });
  const changedTestRegions = withOccurrenceOrdinals(targets !== undefined
    ? [...targets, ...resolvedRegions]
    : [...titleRegions, ...resolvedRegions]);
  return { changedTests: projection.changedTestSelectors, changedTestRegions, changedContentRegions: [], changedPaths: projection.changedFiles.map((file) => file.path), planTasks: [] };
}
function securityRegion(value: unknown): BuildReviewContentRegionReference | undefined {
  const source = object(value);
  const locus = region(value);
  if (!locus || !source) return undefined;
  const allowed = source.occurrence === undefined
    ? ['path', 'contentHash', 'display']
    : ['path', 'contentHash', 'display', 'occurrence'];
  return Object.keys(source).length === allowed.length && Object.keys(source).every((key) => allowed.includes(key)) && CUSTOM_SOURCE_REGION_CONTENT_HASH.test(locus.contentHash)
    ? locus
    : undefined;
}
export function parseBuildReviewFindingAnchor(value: unknown, references?: BuildReviewFindingReferenceContext): BuildReviewFindingAnchor | undefined {
  const source = object(value);
  const locus = source && region(source.locus);
  if (source?.rubric === 'testQuality' && locus && (!references?.changedTestRegions || references.changedTestRegions.some((candidate) => sameRegion(candidate, locus)))) return { rubric: 'testQuality', locus };
  const securityLocus = source?.rubric === 'security' ? securityRegion(source.locus) : undefined;
  return securityLocus && (!references || references.changedContentRegions.some((candidate) => sameRegion(candidate, securityLocus)))
    ? { rubric: 'security', locus: securityLocus }
    : undefined;
}
function finding(value: unknown, rubric: BuildReviewRubricId, references?: BuildReviewFindingReferenceContext): BuildReviewFinding | undefined { const source = object(value); const anchor = source && parseBuildReviewFindingAnchor(source.anchor, references); const confidence = source?.confidence; const concernKind = parseBuildReviewFindingConcernKind(source?.concernKind, rubric); if (!source || !anchor || anchor.rubric !== rubric || !concernKind || !text(source.summary) || !Array.isArray(source.evidenceLocations) || source.evidenceLocations.length === 0 || source.evidenceLocations.some((item) => !text(item)) || (confidence !== undefined && (typeof confidence !== 'number' || !Number.isInteger(confidence) || confidence < 0 || confidence > 100))) return undefined; return { concernKind, summary: source.summary, evidenceLocations: Object.freeze([...source.evidenceLocations] as string[]), anchor, ...(confidence === undefined ? {} : { confidence: confidence as number }) }; }
const TEST_QUALITY_EVIDENCE_FIELDS = ['scopeResolutions', 'relocationAudit', 'counterfactualSensitivity'] as const;
function judgedFindingIdentityId(rubric: BuildReviewRubricId, contractVersion: BuildReviewRubricContractVersion, concernKind: string, anchor: BuildReviewFindingAnchor): string {
  const locus = anchor.locus;
  const canonical = JSON.stringify({
    anchor: { locus: { contentHash: locus.contentHash, ...(locus.occurrence === undefined ? {} : { occurrence: locus.occurrence }), path: locus.path }, rubric: anchor.rubric },
    concernKind: normalizeBuildReviewFindingVocabularyMember(concernKind),
    contractVersion,
    rubric,
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function hasDuplicateJudgedFindingIdentity(findings: readonly BuildReviewFinding[], contractVersion: BuildReviewRubricContractVersion): boolean {
  const ids = new Set<string>();
  for (const entry of findings) {
    const id = judgedFindingIdentityId(entry.anchor.rubric, contractVersion, entry.concernKind, entry.anchor);
    if (ids.has(id)) return true;
    ids.add(id);
  }
  return false;
}

export function parseBuildReviewJudgedResult(value: unknown, references?: BuildReviewFindingReferenceContext, scopeContext?: BuildReviewCandidateScopeResolutionContext): BuildReviewJudgedResult | undefined { const source = object(value); const rubric = source?.rubric; const contractVersion = parseBuildReviewRubricContractVersion(source?.contractVersion); if (rubric === 'security' && TEST_QUALITY_EVIDENCE_FIELDS.some((field) => source?.[field] !== undefined)) return undefined; if (!source || source.kind !== 'judged' || (rubric !== 'testQuality' && rubric !== 'security') || !parseBuildReviewLapId(source.lapId) || !text(source.snapshotDigest) || !contractVersion || !Array.isArray(source.findings)) return undefined; const scopeResolutions = source.scopeResolutions === undefined ? undefined : (scopeContext ? parseBuildReviewCandidateScopeResolutions(source.scopeResolutions, scopeContext) : parsePersistedBuildReviewCandidateScopeResolutions(source.scopeResolutions)); const findings = source.findings.map((entry) => finding(entry, rubric, references)); const counterfactualSensitivity = source.counterfactualSensitivity === undefined ? undefined : parseCounterfactualSensitivity(source.counterfactualSensitivity); if (findings.some((entry) => !entry) || hasDuplicateJudgedFindingIdentity(findings as BuildReviewFinding[], contractVersion) || (source.scopeResolutions !== undefined && !scopeResolutions) || (scopeContext && scopeContext.candidates.length > 0 && scopeResolutions === undefined) || (source.counterfactualSensitivity !== undefined && !counterfactualSensitivity)) return undefined; return { kind: 'judged', rubric, lapId: source.lapId as BuildReviewLapId, snapshotDigest: source.snapshotDigest, contractVersion, findings: Object.freeze(findings as BuildReviewFinding[]), ...(scopeResolutions === undefined ? {} : { scopeResolutions }), ...(counterfactualSensitivity === undefined ? {} : { counterfactualSensitivity }), verdict: findings.length ? 'FAIL' : 'PASS' }; }
export function parseBuildReviewSkip(value: unknown): BuildReviewSkip | undefined { const source = object(value); return source?.kind === 'skipped' && (source.rubric === 'testQuality' || source.rubric === 'security') && (source.reason === 'disabled' || (source.rubric === 'testQuality' && source.reason === 'test_quality_empty_scope')) ? { kind: 'skipped', rubric: source.rubric, reason: source.reason } : undefined; }
export function parseBuildReviewInfrastructureFailure(value: unknown): BuildReviewInfrastructureFailure | undefined { const source = object(value); return source?.kind === 'infrastructure-failure' && (source.rubric === 'testQuality' || source.rubric === 'security') && typeof source.reason === 'string' && (Object.values(mapBuildReviewCoordinatorFailureReason) as string[]).includes(source.reason) && text(source.detail) ? { kind: 'infrastructure-failure', rubric: source.rubric, reason: source.reason as BuildReviewInfrastructureFailureReason, detail: source.detail } : undefined; }
function customFinding(value: unknown): BuildReviewCustomFinding | undefined {
  const source = object(value);
  const requiredKeys = ['concernId', 'summary', 'evidenceLocations', 'sourceRegions'];
  if (!source || (!exactKeys(source, requiredKeys) && !exactKeys(source, [...requiredKeys, 'confidence']))) return undefined;
  const confidence = source.confidence;
  const evidenceLocations = source.evidenceLocations;
  const sourceRegions = source.sourceRegions;
  if (!CUSTOM_CONCERN_ID.test(source.concernId as string) || !text(source.summary) || source.summary.length > MAX_CUSTOM_SUMMARY_LENGTH ||
    !Array.isArray(evidenceLocations) || evidenceLocations.length === 0 || evidenceLocations.length > MAX_CUSTOM_EVIDENCE_LOCATIONS ||
    evidenceLocations.some((location) => !text(location) || location.length > MAX_CUSTOM_EVIDENCE_LOCATION_LENGTH) ||
    !Array.isArray(sourceRegions) || sourceRegions.length === 0 || sourceRegions.length > MAX_CUSTOM_SOURCE_REGIONS ||
    (confidence !== undefined && (typeof confidence !== 'number' || !Number.isInteger(confidence) || confidence < 0 || confidence > 100))) return undefined;
  const parsedRegions = sourceRegions.map(customSourceRegion);
  if (parsedRegions.some((region) => !region)) return undefined;
  return Object.freeze({
    concernId: source.concernId as string,
    summary: source.summary as string,
    evidenceLocations: Object.freeze([...evidenceLocations] as string[]),
    sourceRegions: Object.freeze(parsedRegions as BuildReviewCandidateScopeSourceRegion[]),
    ...(confidence === undefined ? {} : { confidence: confidence as number }),
  });
}

/**
 * These fields belong to the engine-stamped envelope, not the custom-v1
 * reviewer payload.  Native schemas do not request them, but providers can
 * still wrap a structured result with routing metadata.  Discard the wrapper
 * metadata before applying the closed reviewer-payload grammar.
 */
const CUSTOM_REVIEWER_ENVELOPE_FIELDS = new Set(['rubric', 'lapId']);

function reviewerOwnedCustomPayload(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([field]) => !CUSTOM_REVIEWER_ENVELOPE_FIELDS.has(field)),
  );
}

/**
 * Parses only the reviewer-owned custom payload.  Rubric, policy, provider,
 * lap, verdict, case, effect, and disposition identity remain engine-owned.
 */
export function parseBuildReviewCustomReviewerPayload(value: unknown): BuildReviewCustomReviewerPayload | undefined {
  const raw = object(value);
  if (!raw) return undefined;
  const source = reviewerOwnedCustomPayload(raw);
  if (source.kind === 'unsupported-policy') {
    return exactKeys(source, ['kind', 'requirement']) && text(source.requirement) && source.requirement.length <= MAX_CUSTOM_UNSUPPORTED_REQUIREMENT_LENGTH
      ? Object.freeze({ kind: 'unsupported-policy', requirement: source.requirement })
      : undefined;
  }
  if (source.kind !== 'custom-findings' || source.version !== 'v1' || !exactKeys(source, ['kind', 'version', 'findings']) || !Array.isArray(source.findings) || source.findings.length > MAX_CUSTOM_FINDINGS) return undefined;
  const findings = source.findings.map(customFinding);
  return findings.some((entry) => !entry)
    ? undefined
    : Object.freeze({ kind: 'custom-findings', version: 'v1', findings: Object.freeze(findings as BuildReviewCustomFinding[]) });
}

/** Explain custom-v1 payload rejection without trusting its envelope fields. */
export function diagnoseBuildReviewCustomReviewerPayloadRejection(
  value: unknown,
  references?: BuildReviewCustomFindingReferenceContext,
): BuildReviewJudgedResultRejection {
  const raw = object(value);
  if (!raw) {
    return Object.freeze({ kind: 'explained', problems: Object.freeze([
      rejectionProblem('$', 'must be an object', 'the custom result is not a single JSON object'),
    ]) });
  }
  const source = reviewerOwnedCustomPayload(raw);
  const problems: BuildReviewJudgedResultRejectionProblem[] = [];
  if (source.kind === 'unsupported-policy') {
    if (!text(source.requirement) || source.requirement.length > MAX_CUSTOM_UNSUPPORTED_REQUIREMENT_LENGTH) {
      problems.push(rejectionProblem('requirement', `must be a non-empty string no longer than ${MAX_CUSTOM_UNSUPPORTED_REQUIREMENT_LENGTH} characters`));
    }
  } else {
    if (source.kind !== 'custom-findings') problems.push(rejectionProblem('kind', 'must be "custom-findings" or "unsupported-policy"'));
    if (source.version !== 'v1') problems.push(rejectionProblem('version', 'must be "v1" for custom-findings'));
    if (!Array.isArray(source.findings) || source.findings.length > MAX_CUSTOM_FINDINGS) {
      problems.push(rejectionProblem('findings', `must be an array of at most ${MAX_CUSTOM_FINDINGS} findings`));
    } else {
      source.findings.forEach((entry, findingIndex) => {
        const findingSource = object(entry);
        const prefix = `findings[${findingIndex}]`;
        if (!findingSource) {
          problems.push(rejectionProblem(prefix, 'must be an object'));
          return;
        }
        // Parser-only bounds (kept out of the native schema because provider
        // structured outputs reject maxItems/maxLength/minimum) are named here
        // per field, so a violation never collapses to a generic `$` rejection.
        if (typeof findingSource.concernId !== 'string' || !CUSTOM_CONCERN_ID.test(findingSource.concernId)) {
          problems.push(rejectionProblem(`${prefix}.concernId`, `must match ${CUSTOM_CONCERN_ID.source}`));
        }
        if (!text(findingSource.summary) || findingSource.summary.length > MAX_CUSTOM_SUMMARY_LENGTH) {
          problems.push(rejectionProblem(`${prefix}.summary`, `must be a non-empty string no longer than ${MAX_CUSTOM_SUMMARY_LENGTH} characters`));
        }
        const evidenceLocations = findingSource.evidenceLocations;
        if (!Array.isArray(evidenceLocations) || evidenceLocations.length === 0 || evidenceLocations.length > MAX_CUSTOM_EVIDENCE_LOCATIONS) {
          problems.push(rejectionProblem(`${prefix}.evidenceLocations`, `must be a non-empty array of at most ${MAX_CUSTOM_EVIDENCE_LOCATIONS} locations`));
        } else {
          evidenceLocations.forEach((location, locationIndex) => {
            if (!text(location) || location.length > MAX_CUSTOM_EVIDENCE_LOCATION_LENGTH) {
              problems.push(rejectionProblem(`${prefix}.evidenceLocations[${locationIndex}]`, `must be a non-empty string no longer than ${MAX_CUSTOM_EVIDENCE_LOCATION_LENGTH} characters`));
            }
          });
        }
        const confidence = findingSource.confidence;
        if (confidence !== undefined && (
          typeof confidence !== 'number' || !Number.isInteger(confidence) || confidence < 0 || confidence > 100
        )) {
          problems.push(rejectionProblem(`${prefix}.confidence`, 'must be an integer from 0 to 100'));
        }
        if (!Array.isArray(findingSource.sourceRegions) || findingSource.sourceRegions.length === 0 || findingSource.sourceRegions.length > MAX_CUSTOM_SOURCE_REGIONS) {
          problems.push(rejectionProblem(`${prefix}.sourceRegions`, `must be a non-empty array of at most ${MAX_CUSTOM_SOURCE_REGIONS} source regions`));
          return;
        }
        findingSource.sourceRegions.forEach((regionValue, regionIndex) => {
          const sourceRegion = customSourceRegion(regionValue);
          const field = `findings[${findingIndex}].sourceRegions[${regionIndex}]`;
          if (!sourceRegion) {
            problems.push(rejectionProblem(field, 'must be a source region with path, startLine, endLine, contentHash, and display'));
          } else if (references && !references.sourceRegions.some((admitted) => sameCandidateScopeSourceRegion(admitted, sourceRegion))) {
            problems.push(rejectionProblem(field, 'must exactly match an admitted frozen source region'));
          }
        });
      });
    }
  }
  if (problems.length === 0 && parseBuildReviewCustomReviewerPayload(value) === undefined) {
    problems.push(rejectionProblem('$', 'must satisfy the custom-v1 reviewer payload contract'));
  }
  return problems.length === 0
    ? Object.freeze({ kind: 'unexplained', problems: Object.freeze([]) })
    : Object.freeze({ kind: 'explained', problems: Object.freeze(problems.slice(0, MAX_REJECTION_PROBLEMS)) });
}
/** The effective catalog chooses a parser; global enabled rubric maps never do. */
export function parseBuildReviewReviewerPayload(
  value: unknown,
  descriptor: BuildReviewEffectiveResultDescriptor,
): BuildReviewJudgedResult | BuildReviewCustomReviewerPayload | undefined {
  if (descriptor.kind === 'custom') return parseBuildReviewCustomReviewerPayload(value);
  // Built-ins share the rubric-polymorphic judged parser; the descriptor's own
  // rubric binds it so one built-in's payload never parses as another's.
  const judged = parseBuildReviewJudgedResult(value);
  return judged?.rubric === descriptor.rubric ? judged : undefined;
}
export function parseBuildReviewRubricResult(value: unknown): BuildReviewRubricResult | undefined { return parseBuildReviewJudgedResult(value) ?? parseBuildReviewSkip(value) ?? parseBuildReviewInfrastructureFailure(value); }
/**
 * This deliberately consumes a typed judged result, never provider output.
 * A malformed scope response remains in the ordinary malformed-result repair
 * lane; only valid semantic indeterminacy reaches this bounded recovery path.
 */
export function deriveBuildReviewScopeIncompleteFault(result: BuildReviewJudgedResult): BuildReviewScopeIncompleteFault | undefined {
  const candidates = result.scopeResolutions?.filter((resolution): resolution is BuildReviewCandidateScopeResolutionIndeterminate => resolution.status === 'indeterminate') ?? [];
  if (candidates.length === 0) return undefined;
  const detail = candidates.slice(0, 6).map((candidate) =>
    `${candidate.candidateId} (${candidate.obligationReferences.join(', ')}): ${candidate.missingEvidenceReason}`,
  ).join('; ').slice(0, 2_048);
  return Object.freeze({ rubric: result.rubric, reason: 'scope-incomplete', candidates: Object.freeze(candidates), detail });
}
const MAX_REJECTION_PROBLEMS = 6;
export interface BuildReviewJudgedResultRejectionProblem {
  readonly field: string;
  readonly required: string;
  /** Compatibility rendering for existing human-facing diagnostics. */
  readonly detail: string;
}
export interface BuildReviewJudgedResultRejection {
  readonly kind: 'explained' | 'unexplained';
  readonly problems: readonly BuildReviewJudgedResultRejectionProblem[];
  readonly omittedProblemCount?: number;
}
function rejectionProblem(field: string, required: string, detail = `${field} ${required}`): BuildReviewJudgedResultRejectionProblem {
  return Object.freeze({ field, required, detail });
}
function candidateScopeResolutionProblems(value: unknown, context: BuildReviewCandidateScopeResolutionContext): readonly string[] {
  const candidates = context.candidates.map(candidateScopeCandidate);
  if (candidates.some((candidate) => !candidate)) return ['"scopeResolutions" cannot be checked because its frozen candidate context is invalid'];
  const known = candidates as BuildReviewCandidateScopeCandidate[];
  if (known.length === 0) return [];
  if (value === undefined) return ['"scopeResolutions" is missing: exactly one resolution is required for every frozen candidate'];
  if (!Array.isArray(value)) return ['"scopeResolutions" must be an array of frozen-candidate resolutions (invalid value)'];
  const problems: string[] = [];
  const supplied = new Set<string>();
  for (const entry of value) {
    const source = object(entry);
    if (!source || !text(source.candidateId)) { problems.push('"scopeResolutions" contains an invalid resolution without a candidateId'); continue; }
    const candidate = known.find((item) => item.candidateId === source.candidateId);
    if (!candidate) { problems.push(`"scopeResolutions" names unknown candidateId "${source.candidateId}"`); continue; }
    if (supplied.has(candidate.candidateId)) { problems.push(`"scopeResolutions" duplicates candidateId "${candidate.candidateId}"`); continue; }
    supplied.add(candidate.candidateId);
    if (source.status === 'resolved') {
      const sourceRegion = candidateScopeSourceRegion(source.sourceRegion); const obligations = obligationReferences(source.obligationReferences);
      if (!sourceRegion || !obligations || !text(source.associationReason)) problems.push(`"scopeResolutions" has an invalid resolved entry for candidateId "${candidate.candidateId}"`);
      else if (!sameCandidateScopeSourceRegion(sourceRegion, candidate.sourceRegion) || !obligations.every((reference) => candidate.obligationReferences.includes(reference))) problems.push(`"scopeResolutions" has foreign sourceRegion or obligationReferences for candidateId "${candidate.candidateId}"`);
    } else if (source.status === 'out-of-scope') {
      if (!text(source.exclusionReason)) problems.push(`"scopeResolutions" has an invalid out-of-scope entry for candidateId "${candidate.candidateId}"`);
    } else if (source.status === 'indeterminate') {
      if (!text(source.missingEvidenceReason)) problems.push(`"scopeResolutions" has an invalid indeterminate entry for candidateId "${candidate.candidateId}"`);
    } else problems.push(`"scopeResolutions" has an invalid status for candidateId "${candidate.candidateId}"`);
  }
  for (const candidate of known) if (!supplied.has(candidate.candidateId)) problems.push(`"scopeResolutions" is missing candidateId "${candidate.candidateId}"`);
  return problems;
}
/**
 * Names every enumerated contract problem in a rejected judged result. The
 * predicate that accepts or rejects stays `parseBuildReviewJudgedResult`; this
 * only explains its verdict.
 */
export function diagnoseBuildReviewJudgedResultRejection(value: unknown, rubric: BuildReviewRubricId, expected: { readonly lapId: string; readonly snapshotDigest: string }, references?: BuildReviewFindingReferenceContext, scopeContext?: BuildReviewCandidateScopeResolutionContext): BuildReviewJudgedResultRejection {
  const source = object(value);
  if (!source) return Object.freeze({ kind: 'explained', problems: Object.freeze([rejectionProblem('$', 'must be an object', 'the result is not a single JSON object')]) });
  const problems: BuildReviewJudgedResultRejectionProblem[] = [];
  if (rubric === 'security') {
    for (const field of TEST_QUALITY_EVIDENCE_FIELDS) {
      if (source[field] !== undefined) problems.push(rejectionProblem(field, 'is test-quality evidence and is forbidden for security', `"${field}" is test-quality evidence and is forbidden for security`));
    }
  }
  if (source.kind !== 'judged') problems.push(rejectionProblem('kind', `must be exactly the string "judged" (got ${(JSON.stringify(source.kind) ?? 'no kind field').slice(0, 64)})`, `top-level "kind" must be exactly the string "judged" (got ${(JSON.stringify(source.kind) ?? 'no kind field').slice(0, 64)})`));
  if (source.rubric !== rubric) problems.push(rejectionProblem('rubric', `must be "${rubric}"`, `"rubric" must be "${rubric}"`));
  if (source.lapId !== expected.lapId) problems.push(rejectionProblem('lapId', `must echo the projection's lapId "${expected.lapId}" verbatim`, `"lapId" must echo the projection's lapId "${expected.lapId}" verbatim`));
  if (source.contractVersion !== CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION) problems.push(rejectionProblem('contractVersion', `must be "${CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION}"`, `"contractVersion" must be "${CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION}"`));
  if (source.snapshotDigest !== expected.snapshotDigest) problems.push(rejectionProblem('snapshotDigest', "must echo the projection's snapshotDigest verbatim", '"snapshotDigest" must echo the projection\'s snapshotDigest verbatim'));
  if (source.counterfactualSensitivity !== undefined && !parseCounterfactualSensitivity(source.counterfactualSensitivity)) problems.push(rejectionProblem('counterfactualSensitivity', `must be one of ${COUNTERFACTUAL_SENSITIVITY_VOCABULARY.map((member) => `"${member}"`).join(', ')} (got ${JSON.stringify(source.counterfactualSensitivity).slice(0, 64)})`, `"counterfactualSensitivity" must be one of ${COUNTERFACTUAL_SENSITIVITY_VOCABULARY.map((member) => `"${member}"`).join(', ')} (got ${JSON.stringify(source.counterfactualSensitivity).slice(0, 64)})`));
  if (scopeContext) problems.push(...candidateScopeResolutionProblems(source.scopeResolutions, scopeContext).map((detail) => rejectionProblem('scopeResolutions', detail, detail)));
  if (!Array.isArray(source.findings)) {
    problems.push(rejectionProblem('findings', 'must be an array (empty when no concern was found)', '"findings" must be an array (empty when no concern was found)'));
  } else {
    const vocabulary = BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds;
    source.findings.forEach((entry, index) => {
      const item = object(entry);
      if (!item) { problems.push(rejectionProblem(`findings[${index}]`, 'must be an object')); return; }
      if (!text(item.concernKind)) problems.push(rejectionProblem(`findings[${index}].concernKind`, 'must be a non-empty string (never "kind")'));
      else if (parseBuildReviewFindingConcernKind(item.concernKind, rubric) === undefined) problems.push(rejectionProblem(`findings[${index}].concernKind`, `must be one of ${vocabulary.map((member) => `"${member}"`).join(', ')} (got ${JSON.stringify(item.concernKind).slice(0, 64)})`));
      if (!text(item.summary)) problems.push(rejectionProblem(`findings[${index}].summary`, 'must be a non-empty string'));
      if (!Array.isArray(item.evidenceLocations) || item.evidenceLocations.length === 0 || item.evidenceLocations.some((location) => !text(location))) problems.push(rejectionProblem(`findings[${index}].evidenceLocations`, 'must be a non-empty array of "path:line" strings'));
      const anchor = object(item.anchor);
      if (!anchor) { problems.push(rejectionProblem(`findings[${index}].anchor`, `is required: a nested object {"rubric": "${rubric}", "locus": {"path", "contentHash", "display"}} — never flattened top-level fields, and never an alternate name such as "anchors"`)); return; }
      if (anchor.rubric !== rubric) problems.push(rejectionProblem(`findings[${index}].anchor.rubric`, `must be "${rubric}"`));
      const locus = rubric === 'security' ? securityRegion(anchor.locus) : region(anchor.locus);
      if (!locus) problems.push(rejectionProblem(`findings[${index}].anchor.locus`, 'must be a content-region reference {"path", "contentHash", "display", "occurrence"?}'));
      else if (rubric === 'security' && references && !references.changedContentRegions.some((candidate) => sameRegion(candidate, locus))) problems.push(rejectionProblem(`findings[${index}].anchor.locus.contentHash`, 'must equal a contentHash listed by the projected changed content regions', `findings[${index}].anchor.locus must reference a projected changed content region (path, contentHash, and occurrence must match one)`));
      else if (rubric === 'testQuality' && references?.changedTestRegions && !references.changedTestRegions.some((candidate) => sameRegion(candidate, locus))) problems.push(rejectionProblem(`findings[${index}].anchor.locus.contentHash`, 'must equal a contentHash listed by the projected in-scope content regions', `findings[${index}].anchor.locus must reference a projected in-scope content region (path, contentHash, and occurrence must match one)`));
    });
    const duplicates = new Map<string, number>();
    const seen = new Set<string>();
    const contractVersion = parseBuildReviewRubricContractVersion(source.contractVersion) ?? CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION;
    source.findings.forEach((entry, index) => { const item = object(entry); const anchor = item && object(item.anchor); const locus = anchor && region(anchor.locus); if (!locus || !text(item.concernKind)) return; const key = `${normalizeBuildReviewFindingVocabularyMember(item.concernKind)}\u0000${locus.path}\u0000${locus.contentHash}\u0000${locus.occurrence ?? 0}`; if (seen.has(key)) duplicates.set(judgedFindingIdentityId(rubric, contractVersion, item.concernKind, { rubric, locus }), index); seen.add(key); });
    for (const [id, index] of duplicates) problems.push(rejectionProblem(`findings[${index}].identity`, `must not duplicate finding identity ${id}`, `findings must not repeat one concern on one content region (duplicated identity: ${id}) — merge equivalent findings`));
  }
  if (problems.length === 0) return Object.freeze({ kind: 'unexplained', problems: Object.freeze([]) });
  const shown = problems.slice(0, MAX_REJECTION_PROBLEMS);
  return Object.freeze({ kind: 'explained', problems: Object.freeze(shown), ...(problems.length > shown.length ? { omittedProblemCount: problems.length - shown.length } : {}) });
}

export function renderBuildReviewJudgedResultRejection(rejection: BuildReviewJudgedResultRejection): string {
  if (rejection.kind === 'unexplained') return 'the result did not satisfy the judged contract and no enumerated check explains why';
  return rejection.problems.map((problem) => problem.detail).join('; ') + (rejection.omittedProblemCount === undefined ? '' : `; and ${rejection.omittedProblemCount} more problem(s)`);
}

export function describeBuildReviewJudgedResultRejection(value: unknown, rubric: BuildReviewRubricId, expected: { readonly lapId: string; readonly snapshotDigest: string }, references?: BuildReviewFindingReferenceContext, scopeContext?: BuildReviewCandidateScopeResolutionContext): string {
  return renderBuildReviewJudgedResultRejection(diagnoseBuildReviewJudgedResultRejection(value, rubric, expected, references, scopeContext));
}
export interface BuildReviewDispatchFailure {
  readonly kind: 'dispatch-failure';
  readonly detail: string;
  readonly providerSetupExhaustion?: ProviderSetupExhaustion;
  /** A native structured payload was present but rejected by the engine contract. */
  readonly cause?: 'invalid-structured-result' | 'native-schema-unsupported';
  /** Kept typed so the existing fault event can carry it once its union admits the field. */
  readonly rejection?: BuildReviewJudgedResultRejection;
}
export function renderBuildReviewUnresolvedSkillRemedy(rubricSkillName: string, unresolvedCommandName: string): string {
  const commandDetail = unresolvedCommandName.trim()
    ? ` The unresolved command was "${unresolvedCommandName}".`
    : ' The provider did not report the unresolved command name.';
  return `Build-review rubric skill "${rubricSkillName}" could not be dispatched.${commandDetail} No judgement was produced, and retrying cannot make the command resolvable. Relink the provider skill catalog; if this feature's base predates the skill, rebase the feature.`;
}
function providerSetupExhaustion(value: unknown): ProviderSetupExhaustion | undefined { const source = object(value); if (!source || !Array.isArray(source.candidates) || source.candidates.length === 0) return undefined; const candidates = source.candidates.map(object); if (candidates.some((candidate) => !candidate || !text(candidate.provider) || !text(candidate.reason) || !text(candidate.recoveryAction) || (candidate.capability !== undefined && !text(candidate.capability)))) return undefined; return { candidates: candidates.map((candidate) => ({ provider: candidate!.provider as string, reason: candidate!.reason as string, recoveryAction: candidate!.recoveryAction as string, ...(candidate!.capability === undefined ? {} : { capability: candidate!.capability as string }) })) as unknown as ProviderSetupExhaustion['candidates'] }; }
export function makeBuildReviewDispatchFailure(
  detail: string,
  setupExhaustion?: ProviderSetupExhaustion,
  structuredFailure?: { readonly cause: 'invalid-structured-result'; readonly rejection: BuildReviewJudgedResultRejection } | { readonly cause: 'native-schema-unsupported' },
): BuildReviewDispatchFailure {
  return {
    kind: 'dispatch-failure', detail,
    ...(setupExhaustion ? { providerSetupExhaustion: setupExhaustion } : {}),
    ...(structuredFailure?.cause === 'invalid-structured-result'
      ? { cause: structuredFailure.cause, rejection: structuredFailure.rejection }
      : structuredFailure ? { cause: structuredFailure.cause } : {}),
  };
}
export function parseBuildReviewDispatchFailure(value: unknown): BuildReviewDispatchFailure | undefined {
  const source = object(value);
  const setupExhaustion = source && (source.providerSetupExhaustion === undefined ? undefined : providerSetupExhaustion(source.providerSetupExhaustion));
  // Dispatch failures are engine-created values. Preserve the rejection only
  // for the explicitly stamped cause; ordinary provider failures remain
  // unstructured diagnostics.
  const invalidStructuredResult = source?.cause === 'invalid-structured-result' && source.rejection !== undefined
    ? source.rejection as BuildReviewJudgedResultRejection
    : undefined;
  const nativeSchemaUnsupported = source?.cause === 'native-schema-unsupported';
  return source?.kind === 'dispatch-failure' && text(source.detail) && (source.providerSetupExhaustion === undefined || setupExhaustion)
    ? {
        kind: 'dispatch-failure', detail: source.detail,
        ...(setupExhaustion ? { providerSetupExhaustion: setupExhaustion } : {}),
        ...(invalidStructuredResult ? { cause: 'invalid-structured-result' as const, rejection: invalidStructuredResult } : {}),
        ...(nativeSchemaUnsupported ? { cause: 'native-schema-unsupported' as const } : {}),
      }
    : undefined;
}
