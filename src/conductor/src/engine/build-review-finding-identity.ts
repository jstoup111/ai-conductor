import { createHash } from 'node:crypto';

import type { BuildReviewRubricId } from '../types/config.js';
import {
  normalizeBuildReviewFindingVocabularyMember,
  parseBuildReviewFindingAnchor,
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
  | { readonly rubric: 'tautology'; readonly changedTest: string | Omit<BuildReviewContentRegionReference, 'display'>; readonly violationKind: string }
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

function canonicalAnchor(anchor: BuildReviewFindingAnchor): BuildReviewFindingCanonicalAnchor {
  switch (anchor.rubric) {
    case 'tautology':
      return {
        rubric: anchor.rubric,
        changedTest: typeof anchor.changedTest === 'string'
          ? anchor.changedTest
          : { path: anchor.changedTest.path, contentHash: anchor.changedTest.contentHash },
        violationKind: anchor.violationKind,
      };
    case 'scope':
      return { rubric: anchor.rubric, path: anchor.path, relation: anchor.relation };
    case 'rootCause':
      return {
        rubric: anchor.rubric,
        locus: typeof anchor.locus === 'string'
          ? anchor.locus
          : { path: anchor.locus.path, contentHash: anchor.locus.contentHash },
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
  const canonicalJson = canonicalBuildReviewFindingJson(canonicalPayload);
  return Object.freeze({
    id: `sha256:${createHash('sha256').update(canonicalJson).digest('hex')}`,
    canonicalPayload: Object.freeze(canonicalPayload),
    canonicalJson,
  });
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
