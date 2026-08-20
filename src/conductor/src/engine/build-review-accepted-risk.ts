import { canonicalizeBuildReviewFindingIdentity } from './build-review-finding-identity.js';
import type { BuildReviewDispositionRecord } from './build-review-dispositions.js';

const START = '<!-- build-review-accepted-risk:start -->';
const END = '<!-- build-review-accepted-risk:end -->';
const SECTION = '## Accepted build-review risk';
const POINTER = "Details are retained in the feature's local build-review disposition store.";

export type BuildReviewAcceptedRiskRenderResult =
  | { readonly ok: true; readonly section: string }
  | { readonly ok: false; readonly message: string };

export type BuildReviewAcceptedRiskUpsertResult =
  | { readonly ok: true; readonly body: string; readonly changed: boolean }
  | { readonly ok: false; readonly message: string };

function validRecord(value: BuildReviewDispositionRecord): boolean {
  const identity = canonicalizeBuildReviewFindingIdentity(value.finding.canonicalPayload);
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
export function renderBuildReviewAcceptedRisk(records: readonly BuildReviewDispositionRecord[]): BuildReviewAcceptedRiskRenderResult {
  if (records.some((record) => !validRecord(record))) {
    return { ok: false, message: 'accepted build-review risk contains an unrenderable record' };
  }
  const entries = [...records].sort((left, right) => left.finding.id.localeCompare(right.finding.id));
  const lines = [
    START,
    SECTION,
    '',
    `Accepted findings: ${entries.length}`,
    '',
    ...entries.map((record) => `- Finding: \`${record.finding.id}\` — rubric: ${record.finding.canonicalPayload.rubric}`),
    '',
    POINTER,
    END,
  ];
  return { ok: true, section: lines.join('\n') };
}

function removeExistingSection(body: string): string | undefined {
  const start = body.indexOf(START);
  if (start === -1) return body;
  const end = body.indexOf(END, start);
  if (end === -1) return undefined;
  const after = end + END.length;
  return `${body.slice(0, start).trimEnd()}${body.slice(after).trimStart() ? '\n\n' : ''}${body.slice(after).trimStart()}`.trimEnd();
}

/** Idempotently inserts, replaces, or removes the marked accepted-risk PR section. */
export function upsertBuildReviewAcceptedRisk(body: string, records: readonly BuildReviewDispositionRecord[]): BuildReviewAcceptedRiskUpsertResult {
  const withoutExisting = removeExistingSection(body);
  if (withoutExisting === undefined) return { ok: false, message: 'accepted build-review risk section is malformed' };
  if (records.length === 0) return { ok: true, body: withoutExisting, changed: withoutExisting !== body };
  const rendered = renderBuildReviewAcceptedRisk(records);
  if (!rendered.ok) return rendered;
  const next = withoutExisting.trim().length === 0 ? rendered.section : `${withoutExisting}\n\n${rendered.section}`;
  return { ok: true, body: next, changed: next !== body };
}
