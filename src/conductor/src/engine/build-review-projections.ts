import { createHash } from 'node:crypto';

import type { BuildReviewRubricId } from '../types/config.js';
import type { BuildReviewLapId } from './build-review-domain.js';
import type { BuildReviewFrozenInputs } from './build-review-inputs.js';
import { getBuildReviewRubricDescriptor } from './build-review-registry.js';

export type BuildReviewProjectionJson =
  | null
  | boolean
  | number
  | string
  | readonly BuildReviewProjectionJson[]
  | { readonly [key: string]: BuildReviewProjectionJson };

export interface BuildReviewTautologyProjectionInput {
  readonly changedTestSelectors: readonly string[];
  readonly revertedProductionPatch: string;
  readonly preflightEvidence: BuildReviewProjectionJson;
}

/** The complete engine-owned source from which the four closed projections are derived. */
export interface BuildReviewProjectionSource {
  readonly lapId: BuildReviewLapId;
  readonly inputs: BuildReviewFrozenInputs;
  readonly tautology: BuildReviewTautologyProjectionInput;
}

interface CommonProjection<Rubric extends BuildReviewRubricId> {
  readonly rubric: Rubric;
  readonly contractVersion: 'v1';
  readonly projectionVersion: 'v1';
  readonly lapId: BuildReviewLapId;
  readonly snapshotDigest: string;
  readonly digest: string;
  readonly diff: string;
}

export interface TautologyProjection extends CommonProjection<'tautology'> {
  readonly changedTestSelectors: readonly string[];
  readonly testSuiteProof: BuildReviewProjectionJson;
  readonly revertedProductionPatch: string;
  readonly preflightEvidence: BuildReviewProjectionJson;
  /** Rebase-repair evidence is visible only to the closed Tautology contract. */
  readonly repairContext: readonly BuildReviewProjectionJson[];
}

export interface ScopeProjection extends CommonProjection<'scope'> {
  readonly planBody: string;
  readonly repairContext: readonly BuildReviewProjectionJson[];
  readonly acceptedWidenings: readonly BuildReviewProjectionJson[];
  readonly operatorReseals: readonly NonNullable<BuildReviewFrozenInputs['sourceSnapshot']['operatorReseals']>[number][];
}

export interface RootCauseProjection extends CommonProjection<'rootCause'> {
  readonly planBody: string;
  readonly repairContext: readonly BuildReviewProjectionJson[];
}

export interface CompletenessProjection extends CommonProjection<'completeness'> {
  readonly planBody: string;
}

export type BuildReviewRubricProjection =
  | TautologyProjection
  | ScopeProjection
  | RootCauseProjection
  | CompletenessProjection;

export type BuildReviewRubricProjections = {
  readonly tautology: TautologyProjection;
  readonly scope: ScopeProjection;
  readonly rootCause: RootCauseProjection;
  readonly completeness: CompletenessProjection;
};

function canonicalize(value: BuildReviewProjectionJson): BuildReviewProjectionJson {
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  }
  if (value !== null && typeof value === 'object') {
    const object = value as { readonly [key: string]: BuildReviewProjectionJson };
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalize(object[key]!)]));
  }
  return value;
}

/** Stable serialization for cache identity: object keys and unordered evidence arrays are sorted. */
export function canonicalJson(value: BuildReviewProjectionJson): string {
  return JSON.stringify(canonicalize(value));
}

/** Version-bound digest of a closed projection (with its digest field excluded). */
export function projectionDigest(projection: Omit<BuildReviewRubricProjection, 'digest'> | BuildReviewRubricProjection): string {
  const { digest: _ignored, ...withoutDigest } = projection as BuildReviewRubricProjection;
  return `sha256:${createHash('sha256').update(canonicalJson(withoutDigest as BuildReviewProjectionJson)).digest('hex')}`;
}

function json(value: unknown): BuildReviewProjectionJson {
  return value as BuildReviewProjectionJson;
}

function canonicalArray(value: readonly BuildReviewProjectionJson[]): readonly BuildReviewProjectionJson[] {
  return canonicalize([...value]) as readonly BuildReviewProjectionJson[];
}

function common<Rubric extends BuildReviewRubricId>(source: BuildReviewProjectionSource, rubric: Rubric): Omit<CommonProjection<Rubric>, 'digest'> {
  const descriptor = getBuildReviewRubricDescriptor(rubric);
  return {
    rubric,
    contractVersion: descriptor.contractVersion,
    projectionVersion: descriptor.projectionVersion,
    lapId: source.lapId,
    snapshotDigest: source.inputs.sourceSnapshot.digest,
    diff: source.inputs.sourceSnapshot.diff,
  };
}

function seal<Projection extends Omit<BuildReviewRubricProjection, 'digest'>>(projection: Projection): Projection & { readonly digest: string } {
  return Object.freeze({ ...projection, digest: projectionDigest(projection) });
}

/** Build every rubric's closed, versioned projection from one frozen source snapshot. */
export function deriveBuildReviewRubricProjections(source: BuildReviewProjectionSource): BuildReviewRubricProjections {
  const inputs = source.inputs;
  const tautology = seal({
    ...common(source, 'tautology'),
    changedTestSelectors: canonicalArray(source.tautology.changedTestSelectors) as readonly string[],
    testSuiteProof: canonicalize(json(inputs.testSuiteProof)),
    revertedProductionPatch: source.tautology.revertedProductionPatch,
    preflightEvidence: canonicalize(source.tautology.preflightEvidence),
    repairContext: canonicalArray(inputs.sourceSnapshot.repairContext as unknown as readonly BuildReviewProjectionJson[]),
  }) as TautologyProjection;
  const scope = seal({
    ...common(source, 'scope'), planBody: inputs.sourceSnapshot.planBody,
    repairContext: canonicalArray(inputs.sourceSnapshot.repairContext as unknown as readonly BuildReviewProjectionJson[]),
    acceptedWidenings: canonicalArray(inputs.sourceSnapshot.acceptedWidenings as unknown as readonly BuildReviewProjectionJson[]),
    operatorReseals: inputs.sourceSnapshot.operatorReseals ?? [],
  }) as ScopeProjection;
  const rootCause = seal({
    ...common(source, 'rootCause'), planBody: inputs.sourceSnapshot.planBody,
    repairContext: canonicalArray(inputs.sourceSnapshot.repairContext as unknown as readonly BuildReviewProjectionJson[]),
  }) as RootCauseProjection;
  const completeness = seal({
    ...common(source, 'completeness'), planBody: inputs.sourceSnapshot.planBody,
  }) as CompletenessProjection;
  return Object.freeze({ tautology, scope, rootCause, completeness });
}

const KEYS: Record<BuildReviewRubricId, readonly string[]> = {
  tautology: ['rubric', 'contractVersion', 'projectionVersion', 'lapId', 'snapshotDigest', 'digest', 'diff', 'changedTestSelectors', 'testSuiteProof', 'revertedProductionPatch', 'preflightEvidence', 'repairContext'],
  scope: ['rubric', 'contractVersion', 'projectionVersion', 'lapId', 'snapshotDigest', 'digest', 'diff', 'planBody', 'repairContext', 'acceptedWidenings', 'operatorReseals'],
  rootCause: ['rubric', 'contractVersion', 'projectionVersion', 'lapId', 'snapshotDigest', 'digest', 'diff', 'planBody', 'repairContext'],
  completeness: ['rubric', 'contractVersion', 'projectionVersion', 'lapId', 'snapshotDigest', 'digest', 'diff', 'planBody'],
};

/** Strict parser for persisted/cached projections: unknown fields fail closed. */
export function parseBuildReviewRubricProjection(value: unknown): BuildReviewRubricProjection | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const rubric = candidate.rubric;
  if (typeof rubric !== 'string' || !(rubric in KEYS)) return undefined;
  const expected = KEYS[rubric as BuildReviewRubricId];
  if (Object.keys(candidate).length !== expected.length || Object.keys(candidate).some((key) => !expected.includes(key))) return undefined;
  if (candidate.contractVersion !== 'v1' || candidate.projectionVersion !== 'v1' ||
    typeof candidate.lapId !== 'string' || typeof candidate.snapshotDigest !== 'string' || typeof candidate.diff !== 'string' ||
    typeof candidate.digest !== 'string') return undefined;
  if (rubric === 'scope' && !isOperatorReseals(candidate.operatorReseals)) return undefined;
  const projection = candidate as unknown as BuildReviewRubricProjection;
  return projection.digest === projectionDigest(projection) ? projection : undefined;
}

function isOperatorReseals(value: unknown): boolean {
  return Array.isArray(value) && value.every((reseal) => {
    if (typeof reseal !== 'object' || reseal === null || Array.isArray(reseal)) return false;
    const candidate = reseal as Record<string, unknown>;
    return Object.keys(candidate).length === 4 &&
      ['fromCommit', 'toCommit', 'paths', 'reason'].every((key) => key in candidate) &&
      typeof candidate.fromCommit === 'string' &&
      typeof candidate.toCommit === 'string' &&
      typeof candidate.reason === 'string' &&
      Array.isArray(candidate.paths) && candidate.paths.every((path: unknown) => typeof path === 'string');
  });
}
