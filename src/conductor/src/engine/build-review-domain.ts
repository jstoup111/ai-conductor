import type { BuildReviewRubricId } from '../types/config.js';
import { parsePlanTaskPaths } from './plan-task-parse.js';
import type { BuildReviewRubricProjection } from './build-review-projections.js';

/** A validated lap identity; callers cannot accidentally substitute a bare string. */
export type BuildReviewLapId = string & { readonly __brand: 'BuildReviewLapId' };

/** A validated version of the engine-owned rubric result contract. */
export type BuildReviewRubricContractVersion = 'v1' | 'v2';

/** The contract version newly dispatched and emitted by this engine. */
export const CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION = 'v2' as const;

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
  | 'artifact-read-failed';

export type BuildReviewFindingAnchor =
  | { rubric: 'tautology'; changedTest: string; exercisedBehavior: string; violationKind: string }
  | { rubric: 'scope'; path: string; relation: string }
  | { rubric: 'rootCause'; statedDefect: string; locus: string; relation: string }
  | { rubric: 'completeness'; planTask: string; missingSurface: string; missingOutcome: string; missingKind: string };

/** Immutable projection members that may appear in a finding identity. */
export interface BuildReviewFindingReferenceContext {
  readonly changedTests: readonly string[];
  readonly changedPaths: readonly string[];
  readonly planTasks: readonly string[];
  readonly planTaskSurfaces?: Readonly<Record<string, readonly string[]>>;
}

/** Derive the only finding subjects a grader may cite from its frozen projection. */
export function buildReviewFindingReferenceContext(
  projection: BuildReviewRubricProjection,
): BuildReviewFindingReferenceContext {
  const changedPaths = projection.changedFiles.map((file) => file.path);
  if (projection.rubric !== 'completeness') {
    return Object.freeze({
      changedTests: projection.rubric === 'tautology'
        ? projection.changedFiles.map((file) => file.path).filter((path) => /(?:^|\/)test(?:\/|$)|\.test\.[^.]+$/.test(path))
        : [],
      changedPaths: Object.freeze(changedPaths),
      planTasks: [],
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
  'provider-error', 'retry-exhausted', 'missing-artifact', 'malformed-artifact', 'stale-artifact', 'identity-mismatch', 'preflight-failed', 'artifact-read-failed',
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

function parseAnchorClassification(
  value: unknown,
  rubric: BuildReviewRubricId,
  field: 'violationKind' | 'relation' | 'missingKind',
): string | undefined {
  const fields = BUILD_REVIEW_FINDING_VOCABULARIES[rubric].anchorFields as Partial<Record<typeof field, readonly string[]>>;
  return fields[field] ? parseFindingVocabularyMember(value, fields[field]) : undefined;
}

const CANONICAL_PATH_REFERENCE = /^(?!\/)(?!.*(?:^|\/)\.?(?:\/|$))(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/@+-]*(?:\/[A-Za-z0-9][A-Za-z0-9._/@+-]*)*$/;
const CANONICAL_PLAN_TASK_REFERENCE = /^[1-9][0-9]*$/;

/** A stable, unformatted path/reference token suitable for a finding identity. */
export function parseBuildReviewCanonicalPathReference(value: unknown): string | undefined {
  return typeof value === 'string' && CANONICAL_PATH_REFERENCE.test(value) ? value : undefined;
}

export function parseBuildReviewCanonicalPlanTaskReference(value: unknown): string | undefined {
  return typeof value === 'string' && CANONICAL_PLAN_TASK_REFERENCE.test(value) ? value : undefined;
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
  return value === 'v1' || value === 'v2' ? value as BuildReviewRubricContractVersion : undefined;
}

export function parseBuildReviewFindingAnchor(value: unknown, references?: BuildReviewFindingReferenceContext, allowLegacyV1 = false): BuildReviewFindingAnchor | undefined {
  const source = record(value);
  if (!source || !rubricId(source.rubric)) return undefined;
  switch (source.rubric) {
    case 'tautology': {
      const violationKind = parseAnchorClassification(source.violationKind, source.rubric, 'violationKind');
      const changedTest = verifiedReference(source.changedTest, references?.changedTests, parseBuildReviewCanonicalPathReference);
      return changedTest && nonEmptyString(source.exercisedBehavior) && violationKind
        ? { rubric: source.rubric, changedTest, exercisedBehavior: source.exercisedBehavior, violationKind }
        : undefined;
    }
    case 'scope': {
      const relation = parseAnchorClassification(source.relation, source.rubric, 'relation');
      const path = verifiedReference(source.path, references?.changedPaths, parseBuildReviewCanonicalPathReference);
      return path && relation && (allowLegacyV1 || relation === 'not-authorized-by-plan')
        ? { rubric: source.rubric, path, relation }
        : undefined;
    }
    case 'rootCause': {
      const relation = parseAnchorClassification(source.relation, source.rubric, 'relation');
      const locus = verifiedReference(source.locus, references?.changedPaths, parseBuildReviewCanonicalPathReference);
      return nonEmptyString(source.statedDefect) && locus && relation
        ? { rubric: source.rubric, statedDefect: source.statedDefect, locus, relation }
        : undefined;
    }
    case 'completeness': {
      const missingKind = source.missingKind === undefined
        ? 'missing-deliverable'
        : parseAnchorClassification(source.missingKind, source.rubric, 'missingKind');
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

function parseFindings(value: unknown, rubric: BuildReviewRubricId, references?: BuildReviewFindingReferenceContext, allowLegacyV1 = false): readonly BuildReviewFinding[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const findings: BuildReviewFinding[] = [];
  for (const candidate of value) {
    const source = record(candidate);
    const anchor = source && parseBuildReviewFindingAnchor(source.anchor, references, allowLegacyV1);
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
  const findings = parseFindings(source.findings, source.rubric, references, contractVersion === 'v1');
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
    `"${field}": "${field === classificationAnchorField
      ? renderFindingVocabularyMemberShape((BUILD_REVIEW_FINDING_VOCABULARIES[rubric].anchorFields as Record<string, readonly string[]>)[field]!.filter((member) => member !== 'out-of-plan-change'))
      : '<canonical projection reference or report string>'}"`,
  ).join(', ');
  return '{"kind": "judged", "rubric": "' + rubric + '", "contractVersion": "v2", ' +
    '"lapId": "<echo the projection lapId verbatim>", "snapshotDigest": "<echo the projection snapshotDigest verbatim>", ' +
    `"findings": [{"concernKind": "${renderFindingVocabularyMemberShape(BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds)}", "summary": "<non-empty actionable string>", ` +
    '"evidenceLocations": ["<path:line or path:line:column>"], ' +
    `"anchor": {"rubric": "${rubric}", ${anchorFields}}}]}`;
}

const MAX_REJECTION_PROBLEMS = 6;

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
): string {
  const source = record(value);
  if (!source) return 'the result is not a single JSON object';
  const problems: string[] = [];
  if (source.kind !== 'judged') problems.push(`top-level "kind" must be exactly the string "judged" (got ${(JSON.stringify(source.kind) ?? 'no kind field').slice(0, 64)})`);
  if (source.rubric !== rubric) problems.push(`"rubric" must be "${rubric}"`);
  if (source.lapId !== expected.lapId) problems.push(`"lapId" must echo the projection's lapId "${expected.lapId}" verbatim`);
  if (source.contractVersion !== CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION) problems.push('"contractVersion" must be "v2"');
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
          if (!nonEmptyString(anchor[field])) problems.push(`findings[${index}].anchor.${field} must be a non-empty string`);
          else if (field === CLASSIFICATION_ANCHOR_FIELDS[rubric] && !parseAnchorClassification(
            anchor[field], rubric, field as 'violationKind' | 'relation' | 'missingKind',
          )) {
            problems.push(describeFindingVocabularyRejection(
              (BUILD_REVIEW_FINDING_VOCABULARIES[rubric].anchorFields as Record<string, readonly string[]>)[field]!,
              `findings[${index}].anchor.${field}`,
            ));
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
  if (problems.length === 0 && parseBuildReviewJudgedResult(source) === undefined) {
    problems.push('a supplied "verdict"/"passed" field contradicts the findings array — omit both; the engine derives the verdict');
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
