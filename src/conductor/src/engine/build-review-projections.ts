import { createHash } from 'node:crypto';

import type { BuildReviewRubricId } from '../types/config.js';
import type { BuildReviewLapId } from './build-review-domain.js';
import type { BuildReviewFrozenInputs, BuildReviewSourceSnapshot } from './build-review-inputs.js';
import { getBuildReviewRubricDescriptor } from './build-review-registry.js';
import type { RevertedProductionFileReference } from './build-review-tautology-preflight.js';

export type { RevertedProductionFileReference } from './build-review-tautology-preflight.js';

export type BuildReviewProjectionJson =
  | null
  | boolean
  | number
  | string
  | readonly BuildReviewProjectionJson[]
  | { readonly [key: string]: BuildReviewProjectionJson };

export interface BuildReviewTautologyProjectionInput {
  readonly changedTestSelectors: readonly string[];
  /**
   * Content-free identity of each reverted production file. The grader
   * recovers any file's merge-base bytes with `git show <mergeBase>:<path>`;
   * file content itself never travels in a projection.
   */
  readonly revertedProductionManifest: readonly RevertedProductionFileReference[];
  /** Includes preflight's eligible-selector-to-removal mapping when present. */
  readonly preflightEvidence: BuildReviewProjectionJson;
}

/** The complete engine-owned source from which the four closed projections are derived. */
export interface BuildReviewProjectionSource {
  readonly lapId: BuildReviewLapId;
  readonly inputs: BuildReviewFrozenInputs;
  readonly tautology: BuildReviewTautologyProjectionInput;
}

/** One hunk's line-range header from a unified diff (`@@ -old +new @@`). */
export interface DiffHunkRange {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
}

/**
 * Compact by-reference identity of one changed file in the graded diff.
 * The grader session runs inside the feature worktree, so it reads the file
 * contents and per-path diffs itself instead of receiving embedded diff text.
 */
export interface ChangedFileReference {
  readonly path: string;
  readonly changeKind: 'added' | 'modified' | 'deleted' | 'renamed';
  readonly previousPath?: string;
  readonly hunks: readonly DiffHunkRange[];
}

interface CommonProjection<Rubric extends BuildReviewRubricId> {
  readonly rubric: Rubric;
  readonly contractVersion: 'v1';
  readonly projectionVersion: 'v2';
  readonly lapId: BuildReviewLapId;
  readonly snapshotDigest: string;
  /** Stable identity of the source content, independent of commit provenance. */
  readonly contentDigest: string;
  readonly digest: string;
  /** Anchors for by-reference reads: `git diff <mergeBase>..HEAD -- <path>`. */
  readonly mergeBase: string;
  readonly headSha: string;
  /** The graded diff by reference — paths, change kinds, and hunk line ranges. */
  readonly changedFiles: readonly ChangedFileReference[];
  /** Diff-derived removal evidence (never an exemption), kept inline because it is compact. */
  readonly removalContext: BuildReviewSourceSnapshot['removalContext'];
}

export interface TautologyProjection extends CommonProjection<'tautology'> {
  readonly changedTestSelectors: readonly string[];
  readonly testSuiteProof: BuildReviewProjectionJson;
  /** By-reference reverted-production identity; never embedded file content. */
  readonly revertedProductionManifest: readonly RevertedProductionFileReference[];
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

function withoutEvidenceProvenanceHeadSha(value: BuildReviewProjectionJson): BuildReviewProjectionJson {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return value;
  const evidence = value as { readonly [key: string]: BuildReviewProjectionJson };
  const { provenanceHeadSha: _ignoredProvenanceHeadSha, ...evidenceContent } = evidence;
  return evidenceContent;
}

/** Tautology preflight records these anchors for readable provenance, not cache identity. */
function withoutPreflightSourceIdentities(value: BuildReviewProjectionJson): BuildReviewProjectionJson {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return value;
  const evidence = value as { readonly [key: string]: BuildReviewProjectionJson };
  const { sourceIdentities: _ignoredSourceIdentities, ...evidenceContent } = evidence;
  return evidenceContent;
}

/** Scope widening SHAs identify the accepting commit for graders, not the widening's meaning. */
function withoutAcceptedWideningCommitShas(value: readonly BuildReviewProjectionJson[]): readonly BuildReviewProjectionJson[] {
  return value.map((widening) => {
    if (widening === null || Array.isArray(widening) || typeof widening !== 'object') return widening;
    const { sha: _ignoredCommitSha, ...wideningContent } = widening as {
      readonly [key: string]: BuildReviewProjectionJson;
    };
    return wideningContent;
  });
}

/** Version-bound digest of a closed projection, excluding rebase-only provenance. */
export function projectionDigest(projection: Omit<BuildReviewRubricProjection, 'digest'> | BuildReviewRubricProjection): string {
  const {
    digest: _ignoredDigest,
    lapId: _ignoredLapId,
    snapshotDigest: _ignoredSnapshotDigest,
    mergeBase: _ignoredMergeBase,
    headSha: _ignoredHeadSha,
    ...digestibleProjection
  } = projection as BuildReviewRubricProjection;
  const contentIdentity = {
    ...digestibleProjection,
    ...('testSuiteProof' in digestibleProjection
      ? { testSuiteProof: withoutEvidenceProvenanceHeadSha(digestibleProjection.testSuiteProof) }
      : {}),
    ...('preflightEvidence' in digestibleProjection
      ? { preflightEvidence: withoutPreflightSourceIdentities(digestibleProjection.preflightEvidence) }
      : {}),
    ...('acceptedWidenings' in digestibleProjection
      ? { acceptedWidenings: withoutAcceptedWideningCommitShas(digestibleProjection.acceptedWidenings) }
      : {}),
  };
  return `sha256:${createHash('sha256').update(canonicalJson(contentIdentity as unknown as BuildReviewProjectionJson)).digest('hex')}`;
}

function json(value: unknown): BuildReviewProjectionJson {
  return value as BuildReviewProjectionJson;
}

function canonicalArray(value: readonly BuildReviewProjectionJson[]): readonly BuildReviewProjectionJson[] {
  return canonicalize([...value]) as readonly BuildReviewProjectionJson[];
}

/**
 * Derive the per-file references from the frozen diff text. Purely mechanical
 * and deterministic: the same diff always yields the same references, and the
 * projection still carries `snapshotDigest` (which digests the full diff), so
 * cache identity changes iff the underlying diff changes even when two diffs
 * would produce identical line ranges.
 */
export function deriveChangedFileReferences(diff: string): readonly ChangedFileReference[] {
  const references: ChangedFileReference[] = [];
  const chunks = diff.split(/^diff --git /m);
  for (const chunk of chunks) {
    const header = /^a\/(.+) b\/(.+)$/m.exec(chunk);
    if (!header) continue;
    const renameFrom = /^rename from (.+)$/m.exec(chunk);
    const renameTo = /^rename to (.+)$/m.exec(chunk);
    const changeKind: ChangedFileReference['changeKind'] = /^new file mode /m.test(chunk)
      ? 'added'
      : /^deleted file mode /m.test(chunk)
        ? 'deleted'
        : renameFrom && renameTo
          ? 'renamed'
          : 'modified';
    const hunks: DiffHunkRange[] = [];
    for (const match of chunk.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
      hunks.push({
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
      });
    }
    references.push({
      path: renameTo ? renameTo[1]! : changeKind === 'deleted' ? header[1]! : header[2]!,
      changeKind,
      ...(renameFrom ? { previousPath: renameFrom[1]! } : {}),
      hunks: Object.freeze(hunks),
    });
  }
  return Object.freeze(references);
}

function common<Rubric extends BuildReviewRubricId>(source: BuildReviewProjectionSource, rubric: Rubric): Omit<CommonProjection<Rubric>, 'digest'> {
  const descriptor = getBuildReviewRubricDescriptor(rubric);
  const snapshot = source.inputs.sourceSnapshot;
  return {
    rubric,
    contractVersion: descriptor.contractVersion,
    projectionVersion: descriptor.projectionVersion,
    lapId: source.lapId,
    snapshotDigest: snapshot.digest,
    contentDigest: snapshot.contentDigest,
    mergeBase: snapshot.mergeBase,
    headSha: snapshot.headSha,
    changedFiles: deriveChangedFileReferences(snapshot.diff),
    removalContext: snapshot.removalContext,
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
    revertedProductionManifest: canonicalArray(
      source.tautology.revertedProductionManifest as unknown as readonly BuildReviewProjectionJson[],
    ) as unknown as readonly RevertedProductionFileReference[],
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
