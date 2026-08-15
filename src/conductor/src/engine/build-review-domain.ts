import type { BuildReviewRubricId } from '../types/config.js';

/** A validated lap identity; callers cannot accidentally substitute a bare string. */
export type BuildReviewLapId = string & { readonly __brand: 'BuildReviewLapId' };

/** A validated version of the engine-owned rubric result contract. */
export type BuildReviewRubricContractVersion = 'v1' & { readonly __brand: 'BuildReviewRubricContractVersion' };

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
  | { rubric: 'completeness'; planTask: string; missingOutcome: string };

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

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
  return value === 'v1' ? value as BuildReviewRubricContractVersion : undefined;
}

function parseAnchor(value: unknown): BuildReviewFindingAnchor | undefined {
  const source = record(value);
  if (!source || !rubricId(source.rubric)) return undefined;
  switch (source.rubric) {
    case 'tautology':
      return nonEmptyString(source.changedTest) && nonEmptyString(source.exercisedBehavior) && nonEmptyString(source.violationKind)
        ? { rubric: source.rubric, changedTest: source.changedTest, exercisedBehavior: source.exercisedBehavior, violationKind: source.violationKind }
        : undefined;
    case 'scope':
      return nonEmptyString(source.path) && nonEmptyString(source.relation)
        ? { rubric: source.rubric, path: source.path, relation: source.relation }
        : undefined;
    case 'rootCause':
      return nonEmptyString(source.statedDefect) && nonEmptyString(source.locus) && nonEmptyString(source.relation)
        ? { rubric: source.rubric, statedDefect: source.statedDefect, locus: source.locus, relation: source.relation }
        : undefined;
    case 'completeness':
      return nonEmptyString(source.planTask) && nonEmptyString(source.missingOutcome)
        ? { rubric: source.rubric, planTask: source.planTask, missingOutcome: source.missingOutcome }
        : undefined;
  }
}

function parseFindings(value: unknown, rubric: BuildReviewRubricId): readonly BuildReviewFinding[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const findings: BuildReviewFinding[] = [];
  for (const candidate of value) {
    const source = record(candidate);
    const anchor = source && parseAnchor(source.anchor);
    if (!source || !nonEmptyString(source.concernKind) || !nonEmptyString(source.summary) ||
      !Array.isArray(source.evidenceLocations) || source.evidenceLocations.length === 0 ||
      source.evidenceLocations.some((location) => !evidenceLocation(location)) || !anchor || anchor.rubric !== rubric) return undefined;
    findings.push({ concernKind: source.concernKind, summary: source.summary, evidenceLocations: Object.freeze([...source.evidenceLocations]), anchor });
  }
  return findings;
}

/**
 * Parses a grader's semantic result at the trust boundary. PASS/FAIL is
 * derived solely from findings, so a contradictory supplied boolean fails
 * closed instead of changing the authoritative result.
 */
export function parseBuildReviewJudgedResult(value: unknown): BuildReviewJudgedResult | undefined {
  const source = record(value);
  if (!source || source.kind !== 'judged' || !rubricId(source.rubric)) return undefined;
  const lapId = parseBuildReviewLapId(source.lapId);
  const contractVersion = parseBuildReviewRubricContractVersion(source.contractVersion);
  if (!lapId || !contractVersion || !nonEmptyString(source.snapshotDigest)) return undefined;
  const findings = parseFindings(source.findings, source.rubric);
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
