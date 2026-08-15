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
  /** Includes preflight's eligible-selector-to-removal mapping when present. */
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
    // Preserve the engine-derived eligible-selector-to-removal mapping inside
    // the sealed preflight evidence rather than reducing it to selector names.
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
