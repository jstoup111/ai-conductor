import {
  rehydrateBuildReviewAcceptedRiskFinding,
  type BuildReviewDispositionRecord,
} from './build-review-dispositions.js';
import type { RemediationCaseRecord, RemediationCaseStoreReadResult } from './remediation-case-store.js';
import { maskProjectOwnedRegions } from './pr-body-regions.js';
import {
  HALT_PR_BANNER_SENTINEL,
  NEEDS_REMEDIATION_BODY_MARKER,
  PR_BODY_FLOOR_MARKER,
} from './pr-body-engine-markers.js';
import type { BuildReviewSeverity } from './build-review-domain.js';

export const BUILD_REVIEW_ACCEPTED_RISK_START = '<!-- build-review-accepted-risk:start -->';
export const BUILD_REVIEW_ACCEPTED_RISK_END = '<!-- build-review-accepted-risk:end -->';
export const REDUCED_BUILD_REVIEW_COVERAGE_HEADING = '## Reduced build-review coverage';
export const BUILD_REVIEW_ACCEPTED_RISK_HEADING = '## Accepted build-review risk';
export const BUILD_REVIEW_ADVISORY_HEADING = '## Advisory build-review findings';
export const ENGINE_OWNED_PR_BODY_TEXTS = [
  REDUCED_BUILD_REVIEW_COVERAGE_HEADING,
  BUILD_REVIEW_ACCEPTED_RISK_HEADING,
  BUILD_REVIEW_ADVISORY_HEADING,
  BUILD_REVIEW_ACCEPTED_RISK_START,
  BUILD_REVIEW_ACCEPTED_RISK_END,
  PR_BODY_FLOOR_MARKER,
  NEEDS_REMEDIATION_BODY_MARKER,
  HALT_PR_BANNER_SENTINEL,
] as const;
const SECTION = BUILD_REVIEW_ACCEPTED_RISK_HEADING;
const POINTER = "Details are retained in the feature's local build-review disposition store.";

export type BuildReviewAcceptedRiskRenderResult =
  | { readonly ok: true; readonly section: string }
  | { readonly ok: false; readonly message: string };

export type BuildReviewAcceptedRiskUpsertResult =
  | { readonly ok: true; readonly body: string; readonly changed: boolean }
  | { readonly ok: false; readonly message: string };

/** The public PR-body projection of a non-blocking build-review finding. */
export interface BuildReviewAdvisoryFinding {
  readonly id: string;
  readonly rubric: string;
  readonly severity: BuildReviewSeverity;
  readonly origin: 'threshold' | 'adjudicated';
  readonly reviewerSummary: string;
}

function validRecord(value: BuildReviewDispositionRecord): boolean {
  const identity = rehydrateBuildReviewAcceptedRiskFinding(value.finding.canonicalPayload);
  return identity !== undefined && identity.id === value.finding.id && identity.canonicalJson === value.finding.canonicalJson &&
    value.feature.version === 'v1' && value.feature.repository.trim().length > 0 && value.feature.feature.trim().length > 0 &&
    value.sourceLapId.length > 0 && value.summary.trim().length > 0 && value.rationale.trim().length > 0 &&
    value.operator.trim().length > 0 && !Number.isNaN(Date.parse(value.acceptedAt));
}

/**
 * Deterministic publication rendering shared by retained PR and shipped record projections.
 *
 * Published surfaces carry only finding ids and rubrics (#1614). Summaries, rationales,
 * operator identity, and timestamps stay in the local disposition store and MUST NOT be
 * rendered here.
 */
function carriedRiskRows(cases: readonly RemediationCaseRecord[]): readonly string[] {
  return cases.flatMap((caseRecord) => caseRecord.sources
    .filter((source) => source.outcome === 'carried')
    .flatMap((source) => (caseRecord.operatorAcceptance?.origins ?? []).map((origin) => {
      const separator = source.sourceId.indexOf(':');
      const rubric = separator < 0 ? 'unknown' : source.sourceId.slice(0, separator);
      const findingId = separator < 0 ? source.sourceId : source.sourceId.slice(separator + 1);
      return `- Carried finding: \`${findingId}\` — rubric: ${rubric}; carried from: \`${origin.sourceId}\` (lap ${origin.lapId})`;
    })));
}

function operatorResolvedRiskRows(cases: readonly RemediationCaseRecord[]): readonly string[] {
  return cases.flatMap((caseRecord) => caseRecord.operatorResolution === undefined
    ? []
    : [`- Operator-resolved case: \`${caseRecord.id}\` — source ids: ${caseRecord.sources.map((source) => `\`${source.sourceId}\``).join(', ') || 'none'}`]);
}

function caseRiskRows(caseRead: RemediationCaseStoreReadResult | undefined): readonly string[] {
  if (caseRead === undefined) return [];
  if (!caseRead.ok) return ['- Remediation case store: unreadable.'];
  return [...carriedRiskRows(caseRead.state.cases), ...operatorResolvedRiskRows(caseRead.state.cases)];
}

/** Renders only publication-safe reviewer evidence; adjudicator rationale stays local. */
export function renderBuildReviewAdvisoryRegion(
  findings: readonly BuildReviewAdvisoryFinding[],
): readonly string[] {
  if (findings.length === 0) return [];
  return [
    BUILD_REVIEW_ADVISORY_HEADING,
    '',
    ...[...findings]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((finding) => `- Finding: \`${finding.id}\` — rubric: ${finding.rubric}; severity: ${finding.severity}; origin: ${finding.origin}; reviewer summary: ${finding.reviewerSummary}`),
  ];
}

export function renderBuildReviewAcceptedRisk(
  records: readonly BuildReviewDispositionRecord[],
  caseRead?: RemediationCaseStoreReadResult,
  advisoryFindings: readonly BuildReviewAdvisoryFinding[] = [],
): BuildReviewAcceptedRiskRenderResult {
  if (records.some((record) => !validRecord(record))) {
    return { ok: false, message: 'accepted build-review risk contains an unrenderable record' };
  }
  const entries = [...records].sort((left, right) => left.finding.id.localeCompare(right.finding.id));
  const caseRows = caseRiskRows(caseRead);
  const lines = [
    BUILD_REVIEW_ACCEPTED_RISK_START,
    SECTION,
    '',
    `Accepted findings: ${entries.length}`,
    '',
    ...entries.map((record) => `- Finding: \`${record.finding.id}\` — rubric: ${record.finding.canonicalPayload.rubric}`),
    ...(caseRows.length === 0 ? [] : ['', ...caseRows]),
    '',
    POINTER,
    ...(advisoryFindings.length === 0 ? [] : ['', ...renderBuildReviewAdvisoryRegion(advisoryFindings)]),
    BUILD_REVIEW_ACCEPTED_RISK_END,
  ];
  return { ok: true, section: lines.join('\n') };
}

/** Bounds of the marked section, `null` when absent, `undefined` when malformed. */
function existingSectionBounds(body: string): { readonly start: number; readonly after: number } | null | undefined {
  const searchable = maskProjectOwnedRegions(body);
  const start = searchable.indexOf(BUILD_REVIEW_ACCEPTED_RISK_START);
  if (start === -1) return null;
  const end = searchable.indexOf(BUILD_REVIEW_ACCEPTED_RISK_END, start);
  if (end === -1) return undefined;
  return { start, after: end + BUILD_REVIEW_ACCEPTED_RISK_END.length };
}

/**
 * Idempotently inserts, replaces, or removes the marked accepted-risk PR section.
 *
 * An existing section is replaced IN PLACE. Re-appending it moved the section
 * below anything appended after it (the FINISH shipment-plan declaration), so
 * every repeated upsert rewrote the PR body. FINISH binds its prose judgment to
 * that body, so record_outcome's upsert staled the judgment the coordinator had
 * just accepted, re-selected judge_pr_prose, and halted FINISH as non-advancing.
 */
export function upsertBuildReviewAcceptedRisk(
  body: string,
  records: readonly BuildReviewDispositionRecord[],
  caseRead?: RemediationCaseStoreReadResult,
  advisoryFindings: readonly BuildReviewAdvisoryFinding[] = [],
): BuildReviewAcceptedRiskUpsertResult {
  const bounds = existingSectionBounds(body);
  if (bounds === undefined) return { ok: false, message: 'accepted build-review risk section is malformed' };
  const caseRows = caseRiskRows(caseRead);
  if (records.length === 0 && caseRows.length === 0 && advisoryFindings.length === 0) {
    if (bounds === null) return { ok: true, body, changed: false };
    const next = `${body.slice(0, bounds.start).trimEnd()}${body.slice(bounds.after).trimStart() ? '\n\n' : ''}${body.slice(bounds.after).trimStart()}`.trimEnd();
    return { ok: true, body: next, changed: next !== body };
  }
  const rendered = renderBuildReviewAcceptedRisk(records, caseRead, advisoryFindings);
  if (!rendered.ok) return rendered;
  const next = bounds !== null
    ? `${body.slice(0, bounds.start)}${rendered.section}${body.slice(bounds.after)}`
    : body.trim().length === 0 ? rendered.section : `${body}\n\n${rendered.section}`;
  return { ok: true, body: next, changed: next !== body };
}
