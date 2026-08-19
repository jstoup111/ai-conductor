import { createHash } from 'node:crypto';

import type { BuildReviewRubricId } from '../types/config.js';
import { parsePlanTaskPaths, TASK_ID_PATTERN } from './plan-task-parse.js';
import type { BuildReviewRubricProjection } from './build-review-projections.js';

/** A validated lap identity; callers cannot accidentally substitute a bare string. */
export type BuildReviewLapId = string & { readonly __brand: 'BuildReviewLapId' };

/** A validated version of the engine-owned rubric result contract. */
export type BuildReviewRubricContractVersion = 'v1' | 'v2' | 'v3';

/** The contract version newly dispatched and emitted by this engine. */
export const CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION = 'v3' as const;

/** The only intentional non-judgement outcomes. */
export type BuildReviewSkipReason = 'disabled';

/** Failures of execution or artifact integrity, deliberately distinct from findings. */
export type BuildReviewInfrastructureFailureReason =
  | 'provider-error'
  | 'retry-exhausted'
  | 'missing-artifact'
  | 'malformed-artifact'
  | 'stale-artifact'
  | 'identity-mismatch'
  | 'preflight-failed'
  | 'artifact-read-failed'
  | 'artifact-write-failed';

/** Every infrastructure-reason token emitted by the build-review coordinator. */
export type BuildReviewCoordinatorFailureReason =
  | 'no-changed-tests'
  | 'no-production-changes'
  | 'missing-scoped-configuration'
  | 'materialization-failed'
  | 'missing-merge-base-file'
  | 'scoped-run-failed'
  | 'scoped-run-launch-failed'
  | 'scoped-run-timeout'
  | 'scoped-run-signaled'
  | 'aborted'
  | 'cleanup-failed'
  | 'cache-read-failed'
  | 'cache-write-failed'
  | 'artifact-write-failed'
  | 'invalid-provider-result'
  | 'provider-error'
  | 'missing-settlement';

/** Closed translation from coordinator diagnostics to persisted infrastructure identity. */
export const mapBuildReviewCoordinatorFailureReason: Readonly<Record<
  BuildReviewCoordinatorFailureReason,
  BuildReviewInfrastructureFailureReason
>> = Object.freeze({
  'no-changed-tests': 'preflight-failed',
  'no-production-changes': 'preflight-failed',
  'missing-scoped-configuration': 'preflight-failed',
  'materialization-failed': 'preflight-failed',
  'missing-merge-base-file': 'preflight-failed',
  'scoped-run-failed': 'preflight-failed',
  'scoped-run-launch-failed': 'preflight-failed',
  'scoped-run-timeout': 'preflight-failed',
  'scoped-run-signaled': 'preflight-failed',
  aborted: 'preflight-failed',
  'cleanup-failed': 'preflight-failed',
  'cache-read-failed': 'artifact-read-failed',
  'cache-write-failed': 'artifact-write-failed',
  'artifact-write-failed': 'artifact-write-failed',
  'invalid-provider-result': 'malformed-artifact',
  'provider-error': 'provider-error',
  'missing-settlement': 'missing-artifact',
});

export type BuildReviewFindingAnchor =
  | { rubric: 'tautology'; changedTest: string | BuildReviewContentRegionReference; exercisedBehavior: string; violationKind: string }
  | { rubric: 'scope'; path: string; relation: string }
  | { rubric: 'rootCause'; statedDefect: string; locus: string | BuildReviewContentRegionReference; relation: string }
  | { rubric: 'completeness'; planTask: string; missingSurface: string; missingOutcome: string; missingKind: string };

/** Immutable projection members that may appear in a finding identity. */
export interface BuildReviewFindingReferenceContext {
  readonly changedTests: readonly string[];
  readonly changedTestRegions?: readonly BuildReviewContentRegionReference[];
  readonly changedPaths: readonly string[];
  readonly planTasks: readonly string[];
  readonly rootCauseLoci?: readonly BuildReviewContentRegionReference[];
  readonly planTaskSurfaces?: Readonly<Record<string, readonly string[]>>;
}

/** The closed content-addressed reference shared by rubric anchor contracts. */
export interface BuildReviewContentRegionReference {
  readonly path: string;
  readonly contentHash: string;
  readonly display: string;
  /**
   * 0-based ordinal among equal-content regions of one path, in projection
   * order. Content-stable (never a coordinate): a rebase line shift cannot
   * change it, only adding/removing an equal-content sibling can. Omitted
   * when 0 so the first (or only) occurrence keeps its unadorned identity.
   */
  readonly occurrence?: number;
}

export const BUILD_REVIEW_FINDING_REFERENCE_KINDS = Object.freeze(['path', 'plan-task', 'content-region'] as const);

export const BUILD_REVIEW_FINDING_REFERENCE_BINDINGS = Object.freeze({
  tautology: Object.freeze({ changedTest: 'content-region' }),
  scope: Object.freeze({ path: 'path' }),
  rootCause: Object.freeze({ locus: 'content-region' }),
  completeness: Object.freeze({ planTask: 'plan-task', missingSurface: 'path' }),
});

function contentRegionReference(path: string, contentHash: string, display: string, occurrence = 0): BuildReviewContentRegionReference {
  return Object.freeze({
    path,
    contentHash,
    display,
    ...(occurrence > 0 ? { occurrence } : {}),
  });
}

/** Stamp occurrence ordinals onto equal-content references sharing one path. */
function withOccurrenceOrdinals(
  references: readonly BuildReviewContentRegionReference[],
): readonly BuildReviewContentRegionReference[] {
  const seen = new Map<string, number>();
  return Object.freeze(references.map((reference) => {
    const key = `${reference.path}\u0000${reference.contentHash}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return contentRegionReference(reference.path, reference.contentHash, reference.display, occurrence);
  }));
}

function contentHashForText(value: string): string {
  return `sha256:${createHash('sha256').update(value.replaceAll(/\s+/g, ' ').trim()).digest('hex')}`;
}

/** Derive the only finding subjects a grader may cite from its frozen projection. */
export function buildReviewFindingReferenceContext(
  projection: BuildReviewRubricProjection,
): BuildReviewFindingReferenceContext {
  const changedPaths = projection.changedFiles.map((file) => file.path);
  if (projection.rubric !== 'completeness') {
    return Object.freeze({
      changedTests: projection.rubric === 'tautology' ? Object.freeze([...projection.changedTestSelectors]) : [],
      changedPaths: Object.freeze(changedPaths),
      planTasks: [],
      ...(projection.rubric === 'tautology'
        ? { changedTestRegions: withOccurrenceOrdinals((projection.changedTestTitles?.length
          ? projection.changedTestTitles
          : projection.changedTestSelectors.map((selector) => ({ selector, titleText: '', staticExtractionFallback: true }))).flatMap((title) => {
          const path = parseBuildReviewCanonicalPathReference(title.selector);
          return path ? [contentRegionReference(
            path,
            contentHashForText(title.staticExtractionFallback ? title.selector : title.titleText),
            title.staticExtractionFallback ? `${path} changed test (static-title fallback)` : title.titleText,
          )] : [];
        })) }
        : {}),
      ...(projection.rubric === 'rootCause'
        ? { rootCauseLoci: withOccurrenceOrdinals(projection.changedFiles.flatMap((file) =>
          file.hunks.map((hunk) => contentRegionReference(file.path, hunk.contentHash, `${file.path} changed region`)))) }
        : {}),
    });
  }
  const taskPaths = parsePlanTaskPaths(projection.planBody);
  return Object.freeze({
    changedTests: [], changedPaths: Object.freeze(changedPaths),
    planTasks: Object.freeze([...taskPaths.keys()]),
    planTaskSurfaces: Object.freeze(Object.fromEntries(
      [...taskPaths.entries()].map(([task, paths]) => [task, Object.freeze([...paths])]),
    )),
  });
}

export interface BuildReviewFinding {
  readonly concernKind: string;
  readonly summary: string;
  readonly evidenceLocations: readonly string[];
  readonly anchor: BuildReviewFindingAnchor;
}

export interface BuildReviewJudgedResult {
  readonly kind: 'judged';
  readonly rubric: BuildReviewRubricId;
  readonly lapId: BuildReviewLapId;
  readonly snapshotDigest: string;
  readonly contractVersion: BuildReviewRubricContractVersion;
  readonly findings: readonly BuildReviewFinding[];
  /** Audit-only evidence for qualifying or measured fixture relocations. */
  readonly relocationAudit?: readonly string[];
  /** Derived, never trusted from a grader-supplied boolean. */
  readonly verdict: 'PASS' | 'FAIL';
}

const RELOCATION_AUDIT = /^\[relocation-audit\] (EXEMPTED|MEASURED): .+ → .+; production hunk\(s\) (do|do not) force the move$/;

function parseRelocationAudit(value: unknown, rubric: BuildReviewRubricId): readonly string[] | undefined {
  if (!Array.isArray(value) || (rubric !== 'tautology' && value.length > 0) ||
    value.some((entry) => typeof entry !== 'string' || !RELOCATION_AUDIT.test(entry))) return undefined;
  return Object.freeze([...value]);
}

export interface BuildReviewSkip {
  readonly kind: 'skipped';
  readonly rubric: BuildReviewRubricId;
  readonly reason: BuildReviewSkipReason;
}

export interface BuildReviewInfrastructureFailure {
  readonly kind: 'infrastructure-failure';
  readonly rubric: BuildReviewRubricId;
  readonly reason: BuildReviewInfrastructureFailureReason;
  readonly detail: string;
}

/** Exhaustive branch-result union used by fan-out, join, cache, and reporting. */
export type BuildReviewRubricResult =
  | BuildReviewJudgedResult
  | BuildReviewSkip
  | BuildReviewInfrastructureFailure;

const RUBRICS = new Set<BuildReviewRubricId>(['tautology', 'scope', 'rootCause', 'completeness']);
const INFRASTRUCTURE_REASONS = new Set<BuildReviewInfrastructureFailureReason>([
  'provider-error', 'retry-exhausted', 'missing-artifact', 'malformed-artifact', 'stale-artifact', 'identity-mismatch', 'preflight-failed', 'artifact-read-failed', 'artifact-write-failed',
]);
const LAP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Closed vocabularies are role-specific.  A concern and its anchor field are
 * deliberately not independently selected from one rubric-wide bag.
 */
export const BUILD_REVIEW_FINDING_VOCABULARIES = Object.freeze({
  scope: Object.freeze({
    members: Object.freeze(['out-of-plan-change', 'not-authorized-by-plan']),
    concernKinds: Object.freeze(['out-of-plan-change']),
    // v1 stored results used the concern token as relation. Preserve parsing
    // compatibility while v2 dispatch renders only the contract role token.
    anchorFields: Object.freeze({ relation: Object.freeze(['not-authorized-by-plan', 'out-of-plan-change']) }),
  }),
  tautology: Object.freeze({
    members: Object.freeze([
      'assertion-insensitive-to-production',
      'test-does-not-exercise-changed-behavior',
      'assertion-derived-from-test-data',
      'source-text-mirror',
    ]),
    concernKinds: Object.freeze([
      'assertion-insensitive-to-production', 'test-does-not-exercise-changed-behavior',
      'assertion-derived-from-test-data', 'source-text-mirror',
    ]),
    anchorFields: Object.freeze({ violationKind: Object.freeze([
      'assertion-insensitive-to-production', 'test-does-not-exercise-changed-behavior',
      'assertion-derived-from-test-data', 'source-text-mirror',
    ]) }),
  }),
  rootCause: Object.freeze({
    members: Object.freeze([
      'root-cause-unaddressed',
      'symptom-only-fix',
      'provenance-sensitive-cache-identity',
    ]),
    concernKinds: Object.freeze([
      'root-cause-unaddressed', 'symptom-only-fix', 'provenance-sensitive-cache-identity',
    ]),
    anchorFields: Object.freeze({ relation: Object.freeze([
      'root-cause-unaddressed', 'symptom-only-fix', 'provenance-sensitive-cache-identity',
    ]) }),
  }),
  completeness: Object.freeze({
    members: Object.freeze(['missing-deliverable']),
    concernKinds: Object.freeze(['missing-deliverable']),
    anchorFields: Object.freeze({ missingKind: Object.freeze(['missing-deliverable']) }),
  }),
});

/** Normalize harmless grader spelling variance before closed-set lookup. */
export function normalizeBuildReviewFindingVocabularyMember(value: string): string {
  const normalized = value.toLowerCase().replaceAll('_', '-');
  return normalized === 'out-of-plan-test-change' ? 'out-of-plan-change' : normalized;
}

function assertUnambiguousBuildReviewFindingVocabularies(): void {
  for (const [rubric, vocabulary] of Object.entries(BUILD_REVIEW_FINDING_VOCABULARIES)) {
    const normalizedMembers = vocabulary.members.map(normalizeBuildReviewFindingVocabularyMember);
    if (new Set(normalizedMembers).size !== normalizedMembers.length) {
      throw new Error(`build-review finding vocabulary for ${rubric} contains colliding normalized members`);
    }
  }
}

assertUnambiguousBuildReviewFindingVocabularies();

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseFindingVocabularyMember(
  value: unknown,
  members: readonly string[],
): string | undefined {
  if (!nonEmptyString(value)) return undefined;
  const normalized = normalizeBuildReviewFindingVocabularyMember(value);
  return members.includes(normalized) ? normalized : undefined;
}

export function parseBuildReviewFindingConcernKind(value: unknown, rubric: BuildReviewRubricId): string | undefined {
  return parseFindingVocabularyMember(value, BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds);
}

/**
 * Resolves an anchor field against its own role vocabulary. Exported so the
 * canonical-payload parser validates anchor classifications through the same
 * closed sets the grader-facing anchor parser uses.
 */
export function parseBuildReviewFindingAnchorClassification(
  value: unknown,
  rubric: BuildReviewRubricId,
  field: 'violationKind' | 'relation' | 'missingKind',
): string | undefined {
  const fields = BUILD_REVIEW_FINDING_VOCABULARIES[rubric].anchorFields as Partial<Record<typeof field, readonly string[]>>;
  return fields[field] ? parseFindingVocabularyMember(value, fields[field]) : undefined;
}

// A segment may begin with a dot: `.docs/`, `.github/`, and `.pipeline/` are
// ordinary repository directories, and `.docs/plans/<slug>.md` is the artifact
// the scope rubric most often has to anchor to. Traversal is refused by the
// two lookaheads, which reject `.` and `..` as whole segments, so the leading
// character class never had to carry that job.
const CANONICAL_PATH_REFERENCE = /^(?!\/)(?!.*(?:^|\/)\.?(?:\/|$))(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9.][A-Za-z0-9._/@+-]*(?:\/[A-Za-z0-9.][A-Za-z0-9._/@+-]*)*$/;
const CANONICAL_PLAN_TASK_REFERENCE = new RegExp(`^${TASK_ID_PATTERN}$`);
const TITLED_PLAN_TASK_REFERENCE = new RegExp(`^Task\\s+(${TASK_ID_PATTERN}):\\s+.+$`);

/** A stable, unformatted path/reference token suitable for a finding identity. */
export function parseBuildReviewCanonicalPathReference(value: unknown): string | undefined {
  return typeof value === 'string' && CANONICAL_PATH_REFERENCE.test(value) ? value : undefined;
}

export function parseBuildReviewCanonicalPlanTaskReference(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.match(TITLED_PLAN_TASK_REFERENCE)?.[1] ??
    (CANONICAL_PLAN_TASK_REFERENCE.test(value) ? value : undefined);
}

function verifiedReference(value: unknown, allowed: readonly string[] | undefined, parser: (value: unknown) => string | undefined): string | undefined {
  const reference = parser(value);
  return reference && (!allowed || allowed.includes(reference)) ? reference : undefined;
}

function evidenceLocation(value: unknown): value is string {
  return nonEmptyString(value) && /^(?:[^\n:]+\/)*[^\n:]+:\d+(?::\d+)?$/.test(value);
}

function rubricId(value: unknown): value is BuildReviewRubricId {
  return typeof value === 'string' && RUBRICS.has(value as BuildReviewRubricId);
}

export function parseBuildReviewLapId(value: unknown): BuildReviewLapId | undefined {
  return typeof value === 'string' && LAP_ID.test(value) ? value as BuildReviewLapId : undefined;
}

export function parseBuildReviewRubricContractVersion(value: unknown): BuildReviewRubricContractVersion | undefined {
  return value === 'v1' || value === 'v2' || value === 'v3' ? value as BuildReviewRubricContractVersion : undefined;
}

function parseContentRegionReference(value: unknown): BuildReviewContentRegionReference | undefined {
  const source = record(value);
  const keyCount = source ? Object.keys(source).length : 0;
  if (!source || keyCount < 3 || keyCount > 4 ||
    !Object.hasOwn(source, 'path') || !Object.hasOwn(source, 'contentHash') || !Object.hasOwn(source, 'display') ||
    (keyCount === 4 && !Object.hasOwn(source, 'occurrence'))) return undefined;
  if (Object.hasOwn(source, 'occurrence') &&
    (typeof source.occurrence !== 'number' || !Number.isInteger(source.occurrence) || source.occurrence < 0)) return undefined;
  const occurrence = typeof source.occurrence === 'number' ? source.occurrence : 0;
  const path = parseBuildReviewCanonicalPathReference(source.path);
  const contentHash = typeof source.contentHash === 'string' && /^sha256:[a-f0-9]{64}$/.test(source.contentHash)
    ? source.contentHash
    : undefined;
  const display = nonEmptyString(source.display) && !/(?:@@\s*-\d|@\d|:\d+(?:[-,:]\d+)?)/.test(source.display)
    ? source.display
    : undefined;
  return path && contentHash && display
    ? { path, contentHash, display, ...(occurrence > 0 ? { occurrence } : {}) }
    : undefined;
}

function matchesContentRegion(
  candidates: readonly BuildReviewContentRegionReference[],
  reference: BuildReviewContentRegionReference,
): boolean {
  return candidates.some((candidate) => candidate.path === reference.path &&
    candidate.contentHash === reference.contentHash &&
    (candidate.occurrence ?? 0) === (reference.occurrence ?? 0));
}

export function parseBuildReviewFindingAnchor(
  value: unknown,
  references?: BuildReviewFindingReferenceContext,
  contractVersion: BuildReviewRubricContractVersion = 'v2',
): BuildReviewFindingAnchor | undefined {
  const source = record(value);
  if (!source || !rubricId(source.rubric)) return undefined;
  switch (source.rubric) {
    case 'tautology': {
      const violationKind = parseBuildReviewFindingAnchorClassification(source.violationKind, source.rubric, 'violationKind');
      const changedTest = contractVersion === 'v3'
        ? parseContentRegionReference(source.changedTest)
        : verifiedReference(source.changedTest, references?.changedTests, parseBuildReviewCanonicalPathReference);
      const matchedChangedTest = !changedTest || typeof changedTest === 'string' || !references?.changedTestRegions
        ? changedTest
        : matchesContentRegion(references.changedTestRegions, changedTest)
          ? changedTest
          : undefined;
      return matchedChangedTest && nonEmptyString(source.exercisedBehavior) && violationKind
        ? { rubric: source.rubric, changedTest: matchedChangedTest, exercisedBehavior: source.exercisedBehavior, violationKind }
        : undefined;
    }
    case 'scope': {
      const relation = parseBuildReviewFindingAnchorClassification(source.relation, source.rubric, 'relation');
      const path = verifiedReference(source.path, references?.changedPaths, parseBuildReviewCanonicalPathReference);
      return path && relation && (contractVersion === 'v1' || relation === 'not-authorized-by-plan')
        ? { rubric: source.rubric, path, relation }
        : undefined;
    }
    case 'rootCause': {
      const relation = parseBuildReviewFindingAnchorClassification(source.relation, source.rubric, 'relation');
      const locus = contractVersion === 'v3'
        ? parseContentRegionReference(source.locus)
        : verifiedReference(source.locus, references?.changedPaths, parseBuildReviewCanonicalPathReference);
      const matchedLocus = !locus || typeof locus === 'string' || !references?.rootCauseLoci
        ? locus
        : matchesContentRegion(references.rootCauseLoci, locus)
          ? locus
          : undefined;
      return nonEmptyString(source.statedDefect) && matchedLocus && relation
        ? { rubric: source.rubric, statedDefect: source.statedDefect, locus: matchedLocus, relation }
        : undefined;
    }
    case 'completeness': {
      const missingKind = source.missingKind === undefined
        ? 'missing-deliverable'
        : parseBuildReviewFindingAnchorClassification(source.missingKind, source.rubric, 'missingKind');
      const planTask = verifiedReference(source.planTask, references?.planTasks, parseBuildReviewCanonicalPlanTaskReference);
      const missingSurface = verifiedReference(
        source.missingSurface,
        planTask && references?.planTaskSurfaces ? references.planTaskSurfaces[planTask] : references?.changedPaths,
        parseBuildReviewCanonicalPathReference,
      );
      return planTask && missingSurface && nonEmptyString(source.missingOutcome) && missingKind
        ? { rubric: source.rubric, planTask, missingSurface, missingOutcome: source.missingOutcome, missingKind }
        : undefined;
    }
  }
}

function parseFindings(
  value: unknown,
  rubric: BuildReviewRubricId,
  references: BuildReviewFindingReferenceContext | undefined,
  contractVersion: BuildReviewRubricContractVersion,
): readonly BuildReviewFinding[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const findings: BuildReviewFinding[] = [];
  for (const candidate of value) {
    const source = record(candidate);
    const anchor = source && parseBuildReviewFindingAnchor(source.anchor, references, contractVersion);
    const concernKind = source && parseBuildReviewFindingConcernKind(source.concernKind, rubric);
    if (!source || !concernKind || !nonEmptyString(source.summary) ||
      !Array.isArray(source.evidenceLocations) || source.evidenceLocations.length === 0 ||
      source.evidenceLocations.some((location) => !evidenceLocation(location)) || !anchor || anchor.rubric !== rubric) return undefined;
    if ((anchor.rubric === 'tautology' && concernKind !== anchor.violationKind) ||
      (anchor.rubric === 'rootCause' && concernKind !== anchor.relation) ||
      (anchor.rubric === 'completeness' && concernKind !== anchor.missingKind)) return undefined;
    findings.push({ concernKind, summary: source.summary, evidenceLocations: Object.freeze([...source.evidenceLocations]), anchor });
  }
  return findings;
}

/**
 * Parses a grader's semantic result at the trust boundary. PASS/FAIL is
 * derived solely from findings, so a contradictory supplied boolean fails
 * closed instead of changing the authoritative result.
 */
export function parseBuildReviewJudgedResult(value: unknown, references?: BuildReviewFindingReferenceContext): BuildReviewJudgedResult | undefined {
  const source = record(value);
  if (!source || source.kind !== 'judged' || !rubricId(source.rubric)) return undefined;
  const lapId = parseBuildReviewLapId(source.lapId);
  const contractVersion = parseBuildReviewRubricContractVersion(source.contractVersion);
  if (!lapId || !contractVersion || !nonEmptyString(source.snapshotDigest)) return undefined;
  const findings = parseFindings(source.findings, source.rubric, references, contractVersion);
  const relocationAudit = source.relocationAudit === undefined
    ? undefined
    : parseRelocationAudit(source.relocationAudit, source.rubric);
  if (!findings || (source.relocationAudit !== undefined && !relocationAudit)) return undefined;
  const verdict = findings.length === 0 ? 'PASS' : 'FAIL';
  if (source.verdict !== undefined && source.verdict !== verdict) return undefined;
  if (source.passed !== undefined && source.passed !== (verdict === 'PASS')) return undefined;
  return {
    kind: 'judged', rubric: source.rubric, lapId, snapshotDigest: source.snapshotDigest, contractVersion, findings,
    ...(relocationAudit === undefined ? {} : { relocationAudit }), verdict,
  };
}

export function parseBuildReviewSkip(value: unknown): BuildReviewSkip | undefined {
  const source = record(value);
  if (!source || source.kind !== 'skipped' || !rubricId(source.rubric)) return undefined;
  if (source.reason === 'disabled') {
    return { kind: 'skipped', rubric: source.rubric, reason: source.reason };
  }
  return undefined;
}

export function parseBuildReviewInfrastructureFailure(value: unknown): BuildReviewInfrastructureFailure | undefined {
  const source = record(value);
  if (!source || source.kind !== 'infrastructure-failure' || !rubricId(source.rubric) ||
    typeof source.reason !== 'string' || !INFRASTRUCTURE_REASONS.has(source.reason as BuildReviewInfrastructureFailureReason) ||
    !nonEmptyString(source.detail)) return undefined;
  return { kind: 'infrastructure-failure', rubric: source.rubric, reason: source.reason as BuildReviewInfrastructureFailureReason, detail: source.detail };
}

export function parseBuildReviewRubricResult(value: unknown): BuildReviewRubricResult | undefined {
  return parseBuildReviewJudgedResult(value) ?? parseBuildReviewSkip(value) ?? parseBuildReviewInfrastructureFailure(value);
}

/** Per-rubric anchor field names; the single source for schema rendering and rejection diagnosis. */
const ANCHOR_FIELDS: Record<BuildReviewRubricId, readonly string[]> = {
  tautology: ['changedTest', 'exercisedBehavior', 'violationKind'],
  scope: ['path', 'relation'],
  rootCause: ['statedDefect', 'locus', 'relation'],
  completeness: ['planTask', 'missingSurface', 'missingOutcome', 'missingKind'],
};

/** The anchor field, if any, whose value shares the rubric's closed vocabulary. */
const CLASSIFICATION_ANCHOR_FIELDS: Partial<Record<BuildReviewRubricId, string>> = {
  tautology: 'violationKind',
  scope: 'relation',
  rootCause: 'relation',
  completeness: 'missingKind',
};

function renderFindingVocabularyMemberShape(members: readonly string[]): string {
  return `<one of: ${members.join(' | ')}>`;
}

function describeFindingVocabularyRejection(members: readonly string[], field: string): string {
  return `${field} must be one of: ${members.join(' | ')}`;
}

/**
 * Render the exact judged-result JSON template for one rubric. This is the
 * machine-owned schema text embedded in every rubric dispatch and repair
 * prompt, so the contract a grader must satisfy is never left to inference
 * from prose (graders have returned `anchors`, `planAnchor`, and flattened
 * top-level fields when the anchor shape was unstated).
 */
export function renderBuildReviewJudgedResultShape(rubric: BuildReviewRubricId): string {
  const classificationAnchorField = CLASSIFICATION_ANCHOR_FIELDS[rubric];
  const anchorFields = ANCHOR_FIELDS[rubric].map((field) =>
    (field === 'locus' && rubric === 'rootCause') || (field === 'changedTest' && rubric === 'tautology')
      ? `"${field}": {"path": "<repository-relative path>", "contentHash": "sha256:<normalized-${field === 'locus' ? 'hunk-content' : 'test-title'}>", "display": "<human-readable non-coordinate label>", "occurrence": <0-based ordinal among equal-content regions in this path; omit when unique>}`
      : `"${field}": "${field === classificationAnchorField
      ? renderFindingVocabularyMemberShape((BUILD_REVIEW_FINDING_VOCABULARIES[rubric].anchorFields as Record<string, readonly string[]>)[field]!.filter((member) => member !== 'out-of-plan-change'))
      : '<canonical projection reference or report string>'}"`,
  ).join(', ');
  return '{"findings": [{"concernKind": "' + renderFindingVocabularyMemberShape(BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds) + '", "summary": "<non-empty actionable string>", ' +
    '"evidenceLocations": ["<path:line or path:line:column>"], ' +
    `"anchor": {"rubric": "${rubric}", ${anchorFields}}}]}`;
}

const MAX_REJECTION_PROBLEMS = 6;
const MAX_REJECTION_VALUE_LENGTH = 63;

function describeRejectionValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length <= MAX_REJECTION_VALUE_LENGTH
      ? JSON.stringify(value)
      : `${JSON.stringify(value.slice(0, MAX_REJECTION_VALUE_LENGTH)).slice(0, -1)}…"`;
  }
  return JSON.stringify(value) ?? `a ${typeof value}`;
}

function anchorReferenceGrammar(
  rubric: BuildReviewRubricId,
  field: string,
): { readonly description: string; readonly parse: (value: unknown) => string | undefined } | undefined {
  if (rubric === 'scope' && field === 'path') {
    return { description: 'canonical repository-relative path', parse: parseBuildReviewCanonicalPathReference };
  }
  if (rubric === 'completeness' && field === 'planTask') {
    return { description: 'canonical plan-task reference', parse: parseBuildReviewCanonicalPlanTaskReference };
  }
  if (rubric === 'completeness' && field === 'missingSurface') {
    return { description: 'canonical repository-relative path', parse: parseBuildReviewCanonicalPathReference };
  }
  if (rubric === 'tautology' && field === 'changedTest') {
    return { description: 'canonical repository-relative path', parse: parseBuildReviewCanonicalPathReference };
  }
  if (rubric === 'rootCause' && field === 'locus') {
    return { description: 'canonical repository-relative path', parse: parseBuildReviewCanonicalPathReference };
  }
  return undefined;
}

/**
 * Diagnose why a candidate fails `parseBuildReviewJudgedResult` (plus the
 * dispatch-time lapId/snapshotDigest echo checks) in bounded, actionable
 * prose. Powers the in-dispatch repair turn and the final diagnostic detail;
 * it never embeds candidate content beyond short field values.
 */
export function describeBuildReviewJudgedResultRejection(
  value: unknown,
  rubric: BuildReviewRubricId,
  expected: { readonly lapId: string; readonly snapshotDigest: string },
  references?: BuildReviewFindingReferenceContext,
): string {
  const source = record(value);
  if (!source) return 'the result is not a single JSON object';
  const problems: string[] = [];
  if (source.kind !== 'judged') problems.push(`top-level "kind" must be exactly the string "judged" (got ${(JSON.stringify(source.kind) ?? 'no kind field').slice(0, 64)})`);
  if (source.rubric !== rubric) problems.push(`"rubric" must be "${rubric}"`);
  if (source.lapId !== expected.lapId) problems.push(`"lapId" must echo the projection's lapId "${expected.lapId}" verbatim`);
  if (source.contractVersion !== CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION) problems.push(`"contractVersion" must be "${CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION}"`);
  if (source.snapshotDigest !== expected.snapshotDigest) problems.push('"snapshotDigest" must echo the projection\'s snapshotDigest verbatim');
  if (!Array.isArray(source.findings)) {
    problems.push('"findings" must be an array (empty when no concern was found)');
  } else {
    source.findings.forEach((finding, index) => {
      const entry = record(finding);
      if (!entry) { problems.push(`findings[${index}] is not an object`); return; }
      if (!nonEmptyString(entry.concernKind)) problems.push(`findings[${index}].concernKind must be a non-empty string (never "kind")`);
      else if (!parseBuildReviewFindingConcernKind(entry.concernKind, rubric)) {
        problems.push(describeFindingVocabularyRejection(BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds, `findings[${index}].concernKind`));
      }
      if (!nonEmptyString(entry.summary)) problems.push(`findings[${index}].summary must be a non-empty string`);
      if (!Array.isArray(entry.evidenceLocations) || entry.evidenceLocations.length === 0 ||
        entry.evidenceLocations.some((location) => !evidenceLocation(location))) {
        problems.push(`findings[${index}].evidenceLocations must be a non-empty array of "path:line" or "path:line:column" strings`);
      }
      const anchor = record(entry.anchor);
      if (!anchor) {
        problems.push(`findings[${index}].anchor is required: a nested object {"rubric": "${rubric}", ` +
          `${ANCHOR_FIELDS[rubric].map((field) => `"${field}": "<string>"`).join(', ')}} — ` +
          'never flattened top-level fields, and never an alternate name such as "anchors"');
      } else {
        if (anchor.rubric !== rubric) problems.push(`findings[${index}].anchor.rubric must be "${rubric}"`);
        for (const field of ANCHOR_FIELDS[rubric]) {
          const contentRegionField = source.contractVersion === 'v3' &&
            ((rubric === 'tautology' && field === 'changedTest') || (rubric === 'rootCause' && field === 'locus'));
          if (contentRegionField) {
            const reference = parseContentRegionReference(anchor[field]);
            const candidates = field === 'changedTest' ? references?.changedTestRegions : references?.rootCauseLoci;
            if (!reference) problems.push(`findings[${index}].anchor.${field} must be a content-region reference`);
            else if (candidates && !matchesContentRegion(candidates, reference)) {
              problems.push(`findings[${index}].anchor.${field} must reference a projected content region`);
            }
            continue;
          }
          const grammar = anchorReferenceGrammar(rubric, field);
          if (!Object.hasOwn(anchor, field)) problems.push(`findings[${index}].anchor.${field} is required`);
          else if (typeof anchor[field] !== 'string') problems.push(`findings[${index}].anchor.${field} must be a string (got ${describeRejectionValue(anchor[field])})`);
          else if (!nonEmptyString(anchor[field])) problems.push(`findings[${index}].anchor.${field} must be a non-empty string`);
          else if (grammar && !grammar.parse(anchor[field])) {
            problems.push(`findings[${index}].anchor.${field} must be a ${grammar.description} (got ${describeRejectionValue(anchor[field])})`);
          }
          else if (field === CLASSIFICATION_ANCHOR_FIELDS[rubric] && !parseBuildReviewFindingAnchorClassification(
            anchor[field], rubric, field as 'violationKind' | 'relation' | 'missingKind',
          )) {
            problems.push(describeFindingVocabularyRejection(
              (BUILD_REVIEW_FINDING_VOCABULARIES[rubric].anchorFields as Record<string, readonly string[]>)[field]!,
              `findings[${index}].anchor.${field}`,
            ));
          }
          else if (rubric === 'scope' && field === 'path') {
            const path = parseBuildReviewCanonicalPathReference(anchor.path);
            if (path && references?.changedPaths && !references.changedPaths.includes(path)) {
              problems.push(`findings[${index}].anchor.path must reference a changed path in the projection`);
            }
          } else if (rubric === 'completeness' && field === 'planTask') {
            const planTask = parseBuildReviewCanonicalPlanTaskReference(anchor.planTask);
            if (planTask && references?.planTasks && !references.planTasks.includes(planTask)) {
              problems.push(`findings[${index}].anchor.planTask must reference a plan task in the projection`);
            }
          } else if (rubric === 'completeness' && field === 'missingSurface') {
            const planTask = parseBuildReviewCanonicalPlanTaskReference(anchor.planTask);
            const surface = parseBuildReviewCanonicalPathReference(anchor.missingSurface);
            const surfaces = planTask && references?.planTaskSurfaces?.[planTask];
            if (surface && surfaces && !surfaces.includes(surface)) {
              problems.push(`findings[${index}].anchor.missingSurface must be owned by the referenced plan task`);
            }
          }
        }
      }
    });
  }
  if (source.relocationAudit !== undefined && parseRelocationAudit(source.relocationAudit, rubric) === undefined) {
    problems.push(rubric === 'tautology'
      ? '"relocationAudit" entries must match "[relocation-audit] (EXEMPTED|MEASURED): old → new; production hunk(s) (do|do not) force the move"'
      : `"relocationAudit" must be absent or empty for rubric ${rubric}`);
  }
  const derivedVerdict = Array.isArray(source.findings)
    ? (source.findings.length === 0 ? 'PASS' : 'FAIL')
    : undefined;
  const hasVerdictContradiction = derivedVerdict !== undefined && (
    (source.verdict !== undefined && source.verdict !== derivedVerdict) ||
    (source.passed !== undefined && source.passed !== (derivedVerdict === 'PASS'))
  );
  if (problems.length === 0 && hasVerdictContradiction) {
    problems.push('a supplied "verdict"/"passed" field contradicts the findings array — omit both; the engine derives the verdict');
  }
  if (problems.length === 0 && parseBuildReviewJudgedResult(source, references) === undefined) {
    problems.push('the result did not satisfy the judged contract and no enumerated check explains why');
  }
  if (problems.length === 0) return 'the result parsed but did not satisfy the judged contract (duplicate finding identities are rejected)';
  const shown = problems.slice(0, MAX_REJECTION_PROBLEMS);
  const remainder = problems.length - shown.length;
  return shown.join('; ') + (remainder > 0 ? `; and ${remainder} more problem(s)` : '');
}

/**
 * In-dispatch report of a provider result that never satisfied the judged
 * contract, produced only after the bounded repair turn also failed. It
 * travels through the coordinator's `dispatchModel` boundary so the rubric's
 * infrastructure failure carries a bounded raw-output excerpt instead of a
 * bare "invalid-provider-result".
 */
export interface BuildReviewDispatchFailure {
  readonly kind: 'dispatch-failure';
  readonly detail: string;
}

export function makeBuildReviewDispatchFailure(detail: string): BuildReviewDispatchFailure {
  return { kind: 'dispatch-failure', detail };
}

export function parseBuildReviewDispatchFailure(value: unknown): BuildReviewDispatchFailure | undefined {
  const source = record(value);
  return source && source.kind === 'dispatch-failure' && nonEmptyString(source.detail)
    ? { kind: 'dispatch-failure', detail: source.detail }
    : undefined;
}
