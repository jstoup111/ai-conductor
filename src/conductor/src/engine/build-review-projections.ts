import { createHash } from 'node:crypto';

import type { BuildReviewRubricId } from '../types/config.js';
import type {
  BuildReviewInfrastructureFailure,
  BuildReviewLapId,
} from './build-review-domain.js';
import type { BuildReviewReducedCoverageDispositionRecord } from './build-review-dispositions.js';
import type { BuildReviewFrozenInputs, BuildReviewSourceSnapshot } from './build-review-inputs.js';
import { getBuildReviewRubricDescriptor } from './build-review-registry.js';
import type {
  RevertedProductionFileReference,
  TestQualityPreflightEvidence,
} from './build-review-test-quality-preflight.js';

export type { RevertedProductionFileReference } from './build-review-test-quality-preflight.js';

export type BuildReviewProjectionJson =
  | null
  | boolean
  | number
  | string
  | readonly BuildReviewProjectionJson[]
  | { readonly [key: string]: BuildReviewProjectionJson };

export interface BuildReviewTestQualityProjectionInput {
  readonly changedTestSelectors: readonly string[];
  /**
   * Content-free identity of each reverted production file. The grader
   * recovers any file's merge-base bytes with `git show <mergeBase>:<path>`;
   * file content itself never travels in a projection.
   */
  readonly revertedProductionManifest: readonly RevertedProductionFileReference[];
  /** Typed counterfactual evidence; never an engine-derived finding. */
  readonly preflight: TestQualityPreflightEvidence;
}

/** The complete engine-owned source from which the closed projection is derived. */
export interface BuildReviewProjectionSource {
  readonly lapId: BuildReviewLapId;
  readonly inputs: BuildReviewFrozenInputs;
  readonly testQuality: BuildReviewTestQualityProjectionInput;
}

/** One hunk's line-range header from a unified diff (`@@ -old +new @@`). */
export interface DiffHunkRange {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  /** SHA-256 of normalized added and removed lines; raw diff text stays out of projections. */
  readonly contentHash: string;
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
  readonly contractVersion: 'v3';
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
}

export interface TestQualityProjection extends CommonProjection<'testQuality'> {
  readonly changedTestSelectors: readonly string[];
  /** Frozen declared title chains, with an explicit selector-hash fallback marker. */
  readonly changedTestTitles: BuildReviewSourceSnapshot['changedTestTitles'];
  readonly testSuiteProof: BuildReviewProjectionJson;
  /** By-reference reverted-production identity; never embedded file content. */
  readonly revertedProductionManifest: readonly RevertedProductionFileReference[];
  readonly preflight: TestQualityPreflightEvidence;
}

export type BuildReviewRubricProjection = TestQualityProjection;

export type BuildReviewRubricProjections = {
  readonly testQuality: TestQualityProjection;
};

/** One current-lap reduced-coverage stamp, shared by every reader-facing surface. */
export interface BuildReviewReducedCoverageEntry {
  readonly rubric: BuildReviewRubricId;
  readonly cause: BuildReviewInfrastructureFailure['reason'];
  readonly diagnostic: string;
  readonly operator: string;
  readonly rationale: string;
  readonly decisionTime: string;
}

export type BuildReviewReducedCoverageEvidenceInput =
  | { readonly state: 'absent' | 'unreadable' }
  | {
      readonly state: 'known';
      readonly records: readonly BuildReviewReducedCoverageDispositionRecord[];
      readonly currentFailures: readonly BuildReviewInfrastructureFailure[];
    };

export type BuildReviewReducedCoverageEvidenceRenderResult =
  | { readonly ok: true; readonly section: string | undefined }
  | { readonly ok: false; readonly message: string };

function validReducedCoverageRecord(record: BuildReviewReducedCoverageDispositionRecord): boolean {
  return record.kind === 'reduced-coverage' && record.version === 'v1' &&
    record.feature.version === 'v1' && record.feature.repository.trim().length > 0 && record.feature.feature.trim().length > 0 &&
    record.rationale.trim().length > 0 && record.operator.trim().length > 0 &&
    !Number.isNaN(Date.parse(record.acceptedAt));
}

/**
 * Render the closed reduced-coverage publication contract from durable
 * operator state plus the fault actually present on this lap.  Both retained
 * PR and shipped-record writers consume this exact section rather than
 * independently formatting a decision.  State that cannot be read is not a
 * decision and therefore invents no reader-facing evidence; known malformed
 * state fails closed.
 */
export function renderBuildReviewReducedCoverageEvidence(
  input: BuildReviewReducedCoverageEvidenceInput,
): BuildReviewReducedCoverageEvidenceRenderResult {
  if (input.state !== 'known') return { ok: true, section: undefined };
  if (input.records.some((record) => !validReducedCoverageRecord(record))) {
    return { ok: false, message: 'reduced build-review coverage contains an unrenderable decision' };
  }

  const entries: BuildReviewReducedCoverageEntry[] = [];
  for (const failure of input.currentFailures) {
    const decision = input.records.find((record) =>
      record.identity.rubric === failure.rubric && record.identity.reason === failure.reason,
    );
    if (!decision) continue;
    if (failure.detail.trim().length === 0) {
      return { ok: false, message: 'reduced build-review coverage contains an unrenderable current diagnostic' };
    }
    entries.push({
      rubric: failure.rubric,
      cause: failure.reason,
      diagnostic: failure.detail,
      operator: decision.operator,
      rationale: decision.rationale,
      decisionTime: decision.acceptedAt,
    });
  }
  if (entries.length === 0) return { ok: true, section: undefined };
  entries.sort((left, right) => `${left.rubric}\u0000${left.cause}`.localeCompare(`${right.rubric}\u0000${right.cause}`));
  return {
    ok: true,
    section: [
      '## Reduced build-review coverage',
      '',
      ...entries.flatMap((entry) => [
        `- Rubric: \`${entry.rubric}\``,
        `  Cause: \`${entry.cause}\``,
        `  Current diagnostic: ${entry.diagnostic}`,
        `  Operator: ${entry.operator}`,
        `  Rationale: ${entry.rationale}`,
        `  Decision time: ${entry.decisionTime}`,
      ]),
    ].join('\n'),
  };
}

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

/**
 * The closed provenance vocabulary: every key whose value is commit/blob
 * addressing, execution timing, a run transcript, or cache/record bookkeeping
 * rather than the meaning of the evidence. Cache identity digests semantic
 * content only, so these keys are dropped from the digested view recursively —
 * at any nesting depth — which closes the class by construction: a provenance
 * field can never hide inside a nested record again. The excluded values stay
 * on the projection itself as non-digested anchors for grader reads.
 * Semantic fields (paths, rationales, reasons, classifications, verdicts,
 * selectors, exitCode, fingerprints, diagnostics) MUST stay digest-sensitive.
 */
export const BUILD_REVIEW_PROVENANCE_KEYS = Object.freeze([
  // Commit and blob addressing (rebase-volatile identities of the same content).
  'sha',
  'commitSha',
  'blobSha',
  'mergeBaseBlobSha',
  'headSha',
  'mergeBase',
  'baseRef',
  'fromCommit',
  'toCommit',
  'provenanceHeadSha',
  'sourceIdentities',
  'lapId',
  'snapshotDigest',
  // Execution timing (rerun-volatile, meaning-free).
  'startedAt',
  'endedAt',
  'executedAt',
  'durationMs',
  'observedAt',
  'rebaseInvalidatedAt',
  // Run transcripts (environment- and rerun-volatile output logs).
  'stdout',
  'stderr',
  // Cache and record bookkeeping (per-instance identity, not evidence meaning).
  'cacheProvenance',
  'cacheable',
  'id',
] as const);

const PROVENANCE_KEY_SET: ReadonlySet<string> = new Set(BUILD_REVIEW_PROVENANCE_KEYS);

/** Recursively drop every provenance-vocabulary key from a JSON value, at any depth. */
function withoutProvenance(value: BuildReviewProjectionJson): BuildReviewProjectionJson {
  if (Array.isArray(value)) return value.map(withoutProvenance);
  if (value !== null && typeof value === 'object') {
    const object = value as { readonly [key: string]: BuildReviewProjectionJson };
    return Object.fromEntries(
      Object.keys(object)
        .filter((key) => !PROVENANCE_KEY_SET.has(key))
        .map((key) => [key, withoutProvenance(object[key]!)]),
    );
  }
  return value;
}

/** Version-bound digest of a closed projection, excluding rebase-only provenance. */
export function projectionDigest(projection: Omit<BuildReviewRubricProjection, 'digest'> | BuildReviewRubricProjection): string {
  // `digest` is the value being derived, never an input to itself. Every other
  // exclusion is the recursive provenance vocabulary applied at any depth.
  const { digest: _ignoredDigest, ...digestibleProjection } = projection as BuildReviewRubricProjection;
  const contentIdentity = withoutProvenance(digestibleProjection as unknown as BuildReviewProjectionJson);
  return `sha256:${createHash('sha256').update(canonicalJson(contentIdentity)).digest('hex')}`;
}

function json(value: unknown): BuildReviewProjectionJson {
  return value as BuildReviewProjectionJson;
}

function canonicalArray(value: readonly BuildReviewProjectionJson[]): readonly BuildReviewProjectionJson[] {
  return canonicalize([...value]) as readonly BuildReviewProjectionJson[];
}

function contentHashForHunk(lines: readonly string[]): string {
  const normalized = lines
    .filter((line) => line.startsWith('-') || line.startsWith('+'))
    .map((line) => line.slice(1))
    .join('\n')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
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
    const hunkHeaders = [...chunk.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)];
    const hunks: DiffHunkRange[] = [];
    for (const [index, match] of hunkHeaders.entries()) {
      const nextHeader = hunkHeaders[index + 1];
      const hunkBody = chunk.slice(match.index! + match[0].length, nextHeader?.index);
      hunks.push({
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        contentHash: contentHashForHunk(hunkBody.split('\n')),
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
  // The legacy stored projection envelope still has four keys during the
  // registry migration, but its one live descriptor is testQuality.
  const descriptor = getBuildReviewRubricDescriptor('testQuality');
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
  };
}

function seal<Projection extends Omit<BuildReviewRubricProjection, 'digest'>>(projection: Projection): Projection & { readonly digest: string } {
  return Object.freeze({ ...projection, digest: projectionDigest(projection) });
}

/** Build every rubric's closed, versioned projection from one frozen source snapshot. */
export function deriveBuildReviewRubricProjections(source: BuildReviewProjectionSource): BuildReviewRubricProjections {
  const inputs = source.inputs;
  const testQuality = seal({
    ...common(source, 'testQuality'),
    changedTestSelectors: canonicalArray(source.testQuality.changedTestSelectors) as readonly string[],
    changedTestTitles: inputs.sourceSnapshot.changedTestTitles,
    testSuiteProof: canonicalize(json(inputs.testSuiteProof)),
    revertedProductionManifest: canonicalArray(
      source.testQuality.revertedProductionManifest as unknown as readonly BuildReviewProjectionJson[],
    ) as unknown as readonly RevertedProductionFileReference[],
    preflight: source.testQuality.preflight,
  }) as TestQualityProjection;
  return Object.freeze({ testQuality });
}
