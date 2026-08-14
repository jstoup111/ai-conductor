import { createHash } from 'node:crypto';

import type { BuildReviewRubricId } from '../types/config.js';
import {
  parseBuildReviewRubricContractVersion,
  type BuildReviewFindingAnchor,
} from './build-review-domain.js';

export interface BuildReviewFindingIdentityInput {
  readonly rubric: BuildReviewRubricId;
  readonly contractVersion: 'v1';
  readonly concernKind: string;
  readonly anchor: BuildReviewFindingAnchor;
}

/** The complete, version-bound payload persisted alongside a finding hash. */
export interface BuildReviewFindingCanonicalPayload extends BuildReviewFindingIdentityInput {}

export interface BuildReviewFindingIdentity {
  readonly id: string;
  readonly canonicalPayload: BuildReviewFindingCanonicalPayload;
  readonly canonicalJson: string;
}

const RUBRICS = new Set<BuildReviewRubricId>(['tautology', 'scope', 'rootCause', 'completeness', 'wiring']);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseRubric(value: unknown): BuildReviewRubricId | undefined {
  return typeof value === 'string' && RUBRICS.has(value as BuildReviewRubricId)
    ? value as BuildReviewRubricId
    : undefined;
}

function parseAnchor(value: unknown, rubric: BuildReviewRubricId): BuildReviewFindingAnchor | undefined {
  const source = record(value);
  if (!source || source.rubric !== rubric) return undefined;

  switch (rubric) {
    case 'tautology':
      return nonEmptyString(source.changedTest) && nonEmptyString(source.exercisedBehavior) && nonEmptyString(source.violationKind)
        ? { rubric, changedTest: source.changedTest, exercisedBehavior: source.exercisedBehavior, violationKind: source.violationKind }
        : undefined;
    case 'scope':
      return nonEmptyString(source.path) && nonEmptyString(source.relation)
        ? { rubric, path: source.path, relation: source.relation }
        : undefined;
    case 'rootCause':
      return nonEmptyString(source.statedDefect) && nonEmptyString(source.locus) && nonEmptyString(source.relation)
        ? { rubric, statedDefect: source.statedDefect, locus: source.locus, relation: source.relation }
        : undefined;
    case 'completeness':
      return nonEmptyString(source.planTask) && nonEmptyString(source.missingOutcome)
        ? { rubric, planTask: source.planTask, missingOutcome: source.missingOutcome }
        : undefined;
    case 'wiring':
      return nonEmptyString(source.entryPoint) && nonEmptyString(source.target) && nonEmptyString(source.relation)
        ? { rubric, entryPoint: source.entryPoint, target: source.target, relation: source.relation }
        : undefined;
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
  if (!source || !rubric || !contractVersion || !nonEmptyString(source.concernKind)) return undefined;

  const anchor = parseAnchor(source.anchor, rubric);
  if (!anchor) return undefined;

  const canonicalPayload: BuildReviewFindingCanonicalPayload = {
    rubric,
    contractVersion,
    concernKind: source.concernKind,
    anchor,
  };
  const canonicalJson = canonicalBuildReviewFindingJson(canonicalPayload);
  return Object.freeze({
    id: `sha256:${createHash('sha256').update(canonicalJson).digest('hex')}`,
    canonicalPayload: Object.freeze(canonicalPayload),
    canonicalJson,
  });
}
