import { createHash } from 'node:crypto';

import type { BuildReviewRubricId } from '../types/config.js';
import {
  normalizeBuildReviewFindingVocabularyMember,
  parseBuildReviewCanonicalPathReference,
  parseBuildReviewCanonicalPlanTaskReference,
  parseBuildReviewFindingAnchor,
  parseBuildReviewFindingAnchorClassification,
  parseBuildReviewFindingConcernKind,
  parseBuildReviewRubricContractVersion,
  type BuildReviewFindingAnchor,
  type BuildReviewContentRegionReference,
  type BuildReviewRubricContractVersion,
} from './build-review-domain.js';

export interface BuildReviewFindingIdentityInput {
  readonly rubric: BuildReviewRubricId;
  readonly contractVersion: BuildReviewRubricContractVersion;
  readonly concernKind: string;
  readonly anchor: BuildReviewFindingAnchor;
}

type BuildReviewFindingCanonicalAnchor =
  | { readonly rubric: 'tautology'; readonly changedTest: string | { readonly contentHash: string; readonly path?: string; readonly occurrence?: number }; readonly violationKind: string }
  | { readonly rubric: 'scope'; readonly path: string; readonly relation: string }
  | { readonly rubric: 'rootCause'; readonly locus: string | Omit<BuildReviewContentRegionReference, 'display'>; readonly relation: string }
  | { readonly rubric: 'completeness'; readonly planTask: string; readonly missingSurface: string };

/** The complete, version-bound payload persisted alongside a finding hash. */
export interface BuildReviewFindingCanonicalPayload {
  readonly rubric: BuildReviewRubricId;
  readonly contractVersion: BuildReviewRubricContractVersion;
  readonly concernKind: string;
  readonly anchor: BuildReviewFindingCanonicalAnchor;
}

export interface BuildReviewFindingIdentity {
  readonly id: string;
  readonly canonicalPayload: BuildReviewFindingCanonicalPayload;
  readonly canonicalJson: string;
}

const RUBRICS = new Set<BuildReviewRubricId>(['tautology', 'scope', 'rootCause', 'completeness']);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseRubric(value: unknown): BuildReviewRubricId | undefined {
  return typeof value === 'string' && RUBRICS.has(value as BuildReviewRubricId)
    ? value as BuildReviewRubricId
    : undefined;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

const CANONICAL_CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;

/**
 * Shared validation for the content-addressed half of a canonical region. The
 * canonical form omits `occurrence` whenever it is the first (or only)
 * occurrence, so a persisted `0` is malformed rather than merely redundant.
 */
function canonicalRegionFields(
  source: Record<string, unknown>,
): { readonly contentHash: string; readonly occurrence?: number } | undefined {
  const contentHash = typeof source.contentHash === 'string' && CANONICAL_CONTENT_HASH.test(source.contentHash)
    ? source.contentHash
    : undefined;
  if (!contentHash) return undefined;
  if (!Object.hasOwn(source, 'occurrence')) return { contentHash };
  return typeof source.occurrence === 'number' && Number.isInteger(source.occurrence) && source.occurrence > 0
    ? { contentHash, occurrence: source.occurrence }
    : undefined;
}

/** Canonical `changedTest`: identity-bearing content only; the path is prose-adjacent and dropped. */
function parseCanonicalChangedTestRegion(
  value: unknown,
): { readonly contentHash: string; readonly occurrence?: number } | undefined {
  const source = record(value);
  return source && onlyKeys(source, ['contentHash', 'occurrence']) ? canonicalRegionFields(source) : undefined;
}

/** Canonical `locus`: the path participates in identity, the human display does not. */
function parseCanonicalLocusRegion(
  value: unknown,
): Omit<BuildReviewContentRegionReference, 'display'> | undefined {
  const source = record(value);
  if (!source || !onlyKeys(source, ['path', 'contentHash', 'occurrence'])) return undefined;
  const path = parseBuildReviewCanonicalPathReference(source.path);
  const fields = canonicalRegionFields(source);
  return path && fields ? { path, ...fields } : undefined;
}

/**
 * Validates a canonical anchor on its own terms. This is deliberately NOT
 * `parseBuildReviewFindingAnchor`: that parser validates the wider
 * grader-supplied anchor, which still carries the prose and display fields the
 * canonical form drops. Feeding a canonical anchor to it always fails, which is
 * how an engine-produced identity became unacceptable to the store that had to
 * persist it (#1769). The two parsers accept the same findings; they differ only
 * in which fields survive into identity.
 */
function parseCanonicalAnchor(
  value: unknown,
  rubric: BuildReviewRubricId,
  contractVersion: BuildReviewRubricContractVersion,
  concernKind: string,
): BuildReviewFindingCanonicalAnchor | undefined {
  const source = record(value);
  if (!source || source.rubric !== rubric) return undefined;
  switch (rubric) {
    case 'tautology': {
      if (!exactKeys(source, ['rubric', 'changedTest', 'violationKind'])) return undefined;
      const violationKind = parseBuildReviewFindingAnchorClassification(source.violationKind, rubric, 'violationKind');
      const changedTest = contractVersion === 'v3'
        ? parseCanonicalChangedTestRegion(source.changedTest)
        : parseBuildReviewCanonicalPathReference(source.changedTest);
      return changedTest && violationKind && violationKind === concernKind
        ? { rubric, changedTest, violationKind }
        : undefined;
    }
    case 'scope': {
      if (!exactKeys(source, ['rubric', 'path', 'relation'])) return undefined;
      const relation = parseBuildReviewFindingAnchorClassification(source.relation, rubric, 'relation');
      const path = parseBuildReviewCanonicalPathReference(source.path);
      return path && relation && (contractVersion === 'v1' || relation === 'not-authorized-by-plan')
        ? { rubric, path, relation }
        : undefined;
    }
    case 'rootCause': {
      if (!exactKeys(source, ['rubric', 'locus', 'relation'])) return undefined;
      const relation = parseBuildReviewFindingAnchorClassification(source.relation, rubric, 'relation');
      const locus = contractVersion === 'v3'
        ? parseCanonicalLocusRegion(source.locus)
        : parseBuildReviewCanonicalPathReference(source.locus);
      return locus && relation && relation === concernKind
        ? { rubric, locus, relation }
        : undefined;
    }
    case 'completeness': {
      if (!exactKeys(source, ['rubric', 'planTask', 'missingSurface'])) return undefined;
      const planTask = parseBuildReviewCanonicalPlanTaskReference(source.planTask);
      const missingSurface = parseBuildReviewCanonicalPathReference(source.missingSurface);
      return planTask && missingSurface ? { rubric, planTask, missingSurface } : undefined;
    }
  }
}

function canonicalAnchor(anchor: BuildReviewFindingAnchor): BuildReviewFindingCanonicalAnchor {
  switch (anchor.rubric) {
    case 'tautology':
      return {
        rubric: anchor.rubric,
        changedTest: typeof anchor.changedTest === 'string'
          ? anchor.changedTest
          : {
              contentHash: anchor.changedTest.contentHash,
              ...(anchor.changedTest.occurrence ? { occurrence: anchor.changedTest.occurrence } : {}),
            },
        violationKind: anchor.violationKind,
      };
    case 'scope':
      return { rubric: anchor.rubric, path: anchor.path, relation: anchor.relation };
    case 'rootCause':
      return {
        rubric: anchor.rubric,
        locus: typeof anchor.locus === 'string'
          ? anchor.locus
          : {
              path: anchor.locus.path,
              contentHash: anchor.locus.contentHash,
              ...(anchor.locus.occurrence ? { occurrence: anchor.locus.occurrence } : {}),
            },
        relation: anchor.relation,
      };
    case 'completeness':
      return { rubric: anchor.rubric, planTask: anchor.planTask, missingSurface: anchor.missingSurface };
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  const source = record(value);
  return source
    ? Object.fromEntries(Object.keys(source).sort().map((key) => [key, sortJson(source[key])]))
    : value;
}

/** Stable, sorted serialization of the finding fields that participate in identity. */
export function canonicalBuildReviewFindingJson(payload: BuildReviewFindingCanonicalPayload): string {
  return JSON.stringify(sortJson(payload));
}

function identityFor(canonicalPayload: BuildReviewFindingCanonicalPayload): BuildReviewFindingIdentity {
  const canonicalJson = canonicalBuildReviewFindingJson(canonicalPayload);
  return Object.freeze({
    id: `sha256:${createHash('sha256').update(canonicalJson).digest('hex')}`,
    canonicalPayload: Object.freeze(canonicalPayload),
    canonicalJson,
  });
}

/**
 * Validates an already-canonical payload — the exact shape
 * `canonicalizeBuildReviewFindingIdentity` emits — against the canonical
 * schema. Every consumer that re-derives an identity from stored or
 * round-tripped state MUST use this rather than re-running the grader-facing
 * canonicalizer, which requires prose fields the canonical form drops (#1769).
 */
export function parseBuildReviewFindingCanonicalPayload(value: unknown): BuildReviewFindingCanonicalPayload | undefined {
  const source = record(value);
  if (!source || !exactKeys(source, ['rubric', 'contractVersion', 'concernKind', 'anchor'])) return undefined;
  const rubric = parseRubric(source.rubric);
  const contractVersion = parseBuildReviewRubricContractVersion(source.contractVersion);
  const concernKind = rubric && parseBuildReviewFindingConcernKind(source.concernKind, rubric);
  if (!rubric || !contractVersion || !concernKind) return undefined;
  const anchor = parseCanonicalAnchor(source.anchor, rubric, contractVersion, concernKind);
  return anchor
    ? { rubric, contractVersion, concernKind: normalizeBuildReviewFindingVocabularyMember(concernKind), anchor }
    : undefined;
}

/**
 * Recomputes the hash and JSON of a canonical payload. Feeding this the
 * `canonicalPayload` of any identity the engine produced returns that identity
 * unchanged: the engine's own output is always acceptable to the store that
 * persists it, on every rubric.
 */
export function rehydrateBuildReviewFindingIdentity(value: unknown): BuildReviewFindingIdentity | undefined {
  const canonicalPayload = parseBuildReviewFindingCanonicalPayload(value);
  return canonicalPayload ? identityFor(canonicalPayload) : undefined;
}

/**
 * Validates and hashes only durable finding identity fields. Human-facing prose
 * and evidence locations are deliberately ignored so normal report drift does
 * not create a distinct disposition target.
 */
export function canonicalizeBuildReviewFindingIdentity(value: unknown): BuildReviewFindingIdentity | undefined {
  const source = record(value);
  const rubric = source && parseRubric(source.rubric);
  const contractVersion = source && parseBuildReviewRubricContractVersion(source.contractVersion);
  if (!source || !rubric || !contractVersion) return undefined;

  const concernKind = parseBuildReviewFindingConcernKind(source.concernKind, rubric);
  const anchor = parseBuildReviewFindingAnchor(source.anchor, undefined, contractVersion);
  if (!concernKind || !anchor || anchor.rubric !== rubric ||
    (anchor.rubric === 'tautology' && concernKind !== anchor.violationKind) ||
    (anchor.rubric === 'rootCause' && concernKind !== anchor.relation) ||
    (anchor.rubric === 'completeness' && concernKind !== anchor.missingKind)) return undefined;

  const canonicalPayload: BuildReviewFindingCanonicalPayload = {
    rubric,
    contractVersion,
    concernKind: normalizeBuildReviewFindingVocabularyMember(concernKind),
    anchor: canonicalAnchor(anchor),
  };
  return identityFor(canonicalPayload);
}

/**
 * Canonicalizes a complete grader finding list as one fail-closed operation.
 * A malformed record or duplicate identity invalidates the entire result: it
 * must never be silently dropped before the aggregate is joined.
 */
export function canonicalizeBuildReviewFindingSet(value: unknown): readonly BuildReviewFindingIdentity[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const identities: BuildReviewFindingIdentity[] = [];
  const seenIds = new Map<string, string>();
  for (const candidate of value) {
    const source = record(candidate);
    const identity = canonicalizeBuildReviewFindingIdentity(candidate);
    if (!source || !identity || (source.id !== undefined && source.id !== identity.id)) return undefined;

    const previousPayload = seenIds.get(identity.id);
    if (previousPayload !== undefined) {
      // Both identical duplicates and an impossible hash collision are unsafe:
      // neither can select a disposition target unambiguously.
      return undefined;
    }
    seenIds.set(identity.id, identity.canonicalJson);
    identities.push(identity);
  }
  return Object.freeze(identities);
}
