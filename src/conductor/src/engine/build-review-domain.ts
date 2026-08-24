import { createHash } from 'node:crypto';

import type { BuildReviewRubricId } from '../types/config.js';
import type { BuildReviewRubricProjection } from './build-review-projections.js';

export type BuildReviewLapId = string & { readonly __brand: 'BuildReviewLapId' };
export type BuildReviewRubricContractVersion = 'v1' | 'v2' | 'v3';
export const CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION = 'v3' as const;
export type BuildReviewSkipReason = 'disabled';
export type BuildReviewInfrastructureFailureReason = 'provider-error' | 'retry-exhausted' | 'missing-artifact' | 'malformed-artifact' | 'stale-artifact' | 'identity-mismatch' | 'preflight-failed' | 'artifact-read-failed' | 'artifact-write-failed';
export const mapBuildReviewCoordinatorFailureReason = Object.freeze({
  'no-changed-tests': 'preflight-failed', 'no-production-changes': 'preflight-failed', 'missing-scoped-configuration': 'preflight-failed', 'materialization-failed': 'preflight-failed', 'missing-merge-base-file': 'preflight-failed', 'scoped-run-failed': 'preflight-failed', 'scoped-run-launch-failed': 'preflight-failed', 'scoped-run-timeout': 'preflight-failed', 'scoped-run-signaled': 'preflight-failed', aborted: 'preflight-failed', 'cleanup-failed': 'preflight-failed', 'cache-read-failed': 'artifact-read-failed', 'cache-write-failed': 'artifact-write-failed', 'artifact-write-failed': 'artifact-write-failed', 'projection-rubric-mismatch': 'malformed-artifact', 'invalid-provider-result': 'malformed-artifact', 'provider-error': 'provider-error', 'missing-settlement': 'missing-artifact',
} satisfies Record<string, BuildReviewInfrastructureFailureReason>);
export type BuildReviewCoordinatorFailureReason = keyof typeof mapBuildReviewCoordinatorFailureReason;
export function deriveBuildReviewInfrastructureFailureReason(branch: { readonly reason: BuildReviewCoordinatorFailureReason }): BuildReviewInfrastructureFailureReason { return mapBuildReviewCoordinatorFailureReason[branch.reason]; }

export interface BuildReviewContentRegionReference { readonly path: string; readonly contentHash: string; readonly display: string; readonly occurrence?: number; }
export type BuildReviewFindingAnchor = { readonly rubric: 'testQuality'; readonly locus: BuildReviewContentRegionReference };
export interface BuildReviewFindingReferenceContext { readonly changedTests: readonly string[]; readonly changedTestRegions?: readonly BuildReviewContentRegionReference[]; readonly changedPaths: readonly string[]; readonly planTasks: readonly string[]; }
export interface BuildReviewFinding { readonly concernKind: string; readonly summary: string; readonly evidenceLocations: readonly string[]; readonly anchor: BuildReviewFindingAnchor; }
export interface BuildReviewJudgedResult { readonly kind: 'judged'; readonly rubric: BuildReviewRubricId; readonly lapId: BuildReviewLapId; readonly snapshotDigest: string; readonly contractVersion: BuildReviewRubricContractVersion; readonly findings: readonly BuildReviewFinding[]; readonly verdict: 'PASS' | 'FAIL'; }
export interface BuildReviewSkip { readonly kind: 'skipped'; readonly rubric: BuildReviewRubricId; readonly reason: BuildReviewSkipReason; }
export interface BuildReviewInfrastructureFailure { readonly kind: 'infrastructure-failure'; readonly rubric: BuildReviewRubricId; readonly reason: BuildReviewInfrastructureFailureReason; readonly detail: string; }
export type BuildReviewRubricResult = BuildReviewJudgedResult | BuildReviewSkip | BuildReviewInfrastructureFailure;
export const BUILD_REVIEW_FINDING_VOCABULARIES = Object.freeze({
  testQuality: Object.freeze({
    members: Object.freeze(['test-insensitive']),
    concernKinds: Object.freeze(['test-insensitive']),
    anchorFields: Object.freeze({}),
  }),
});
export function normalizeBuildReviewFindingVocabularyMember(value: string): string { return value.toLowerCase().replaceAll('_', '-'); }
export function parseBuildReviewFindingConcernKind(value: unknown, rubric: BuildReviewRubricId): string | undefined {
  const normalized = typeof value === 'string' ? normalizeBuildReviewFindingVocabularyMember(value) : '';
  return BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds.includes(normalized)
    ? normalized
    : undefined;
}

const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9.][A-Za-z0-9._/@+-]*(?:\/[A-Za-z0-9.][A-Za-z0-9._/@+-]*)*$/;
const LAP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function object(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
export function parseBuildReviewCanonicalPathReference(value: unknown): string | undefined { return typeof value === 'string' && PATH.test(value) ? value : undefined; }
export function parseBuildReviewLapId(value: unknown): BuildReviewLapId | undefined { return typeof value === 'string' && LAP.test(value) ? value as BuildReviewLapId : undefined; }
export function parseBuildReviewRubricContractVersion(value: unknown): BuildReviewRubricContractVersion | undefined { return value === 'v1' || value === 'v2' || value === 'v3' ? value : undefined; }
// `occurrence` is the 0-based ordinal among equal-content regions in one path;
// 0 is the unique/first region and normalizes away so identities never differ
// on an explicit-versus-omitted zero.
function region(value: unknown): BuildReviewContentRegionReference | undefined { const source = object(value); if (!source || !text(source.path) || !PATH.test(source.path) || !text(source.contentHash) || !text(source.display) || (source.occurrence !== undefined && (!Number.isInteger(source.occurrence) || (source.occurrence as number) < 0))) return undefined; return contentRegionReference(source.path, source.contentHash, source.display, source.occurrence as number | undefined); }
function contentRegionReference(path: string, contentHash: string, display: string, occurrence = 0): BuildReviewContentRegionReference { return { path, contentHash, display, ...(occurrence > 0 ? { occurrence } : {}) }; }
/** Stamp occurrence ordinals onto equal-content references sharing one path, in projection order. */
function withOccurrenceOrdinals(references: readonly BuildReviewContentRegionReference[]): readonly BuildReviewContentRegionReference[] { const seen = new Map<string, number>(); return references.map((reference) => { const key = `${reference.path}\u0000${reference.contentHash}`; const occurrence = seen.get(key) ?? 0; seen.set(key, occurrence + 1); return contentRegionReference(reference.path, reference.contentHash, reference.display, occurrence); }); }
function sameRegion(left: BuildReviewContentRegionReference, right: BuildReviewContentRegionReference): boolean { return left.path === right.path && left.contentHash === right.contentHash && left.occurrence === right.occurrence; }
export function buildReviewFindingReferenceContext(projection: BuildReviewRubricProjection): BuildReviewFindingReferenceContext { const regions = projection.changedTestTitles?.flatMap((title) => { const path = parseBuildReviewCanonicalPathReference(title.selector); return path ? [{ path, contentHash: `sha256:${createHash('sha256').update(title.staticExtractionFallback ? title.selector : title.titleText).digest('hex')}`, display: title.titleText || `${path} changed test` }] : []; }) ?? []; return { changedTests: projection.changedTestSelectors, changedTestRegions: withOccurrenceOrdinals(regions), changedPaths: projection.changedFiles.map((file) => file.path), planTasks: [] }; }
export function parseBuildReviewFindingAnchor(value: unknown, references?: BuildReviewFindingReferenceContext): BuildReviewFindingAnchor | undefined { const source = object(value); const locus = source && region(source.locus); return source?.rubric === 'testQuality' && locus && (!references?.changedTestRegions || references.changedTestRegions.some((candidate) => sameRegion(candidate, locus))) ? { rubric: 'testQuality', locus } : undefined; }
function finding(value: unknown, references?: BuildReviewFindingReferenceContext): BuildReviewFinding | undefined { const source = object(value); const anchor = source && parseBuildReviewFindingAnchor(source.anchor, references); if (!source || !anchor || parseBuildReviewFindingConcernKind(source.concernKind, 'testQuality') === undefined || !text(source.summary) || !Array.isArray(source.evidenceLocations) || source.evidenceLocations.length === 0 || source.evidenceLocations.some((item) => !text(item))) return undefined; return { concernKind: 'test-insensitive', summary: source.summary, evidenceLocations: Object.freeze([...source.evidenceLocations] as string[]), anchor }; }
export function parseBuildReviewJudgedResult(value: unknown, references?: BuildReviewFindingReferenceContext): BuildReviewJudgedResult | undefined { const source = object(value); if (!source || source.kind !== 'judged' || source.rubric !== 'testQuality' || !parseBuildReviewLapId(source.lapId) || !text(source.snapshotDigest) || !parseBuildReviewRubricContractVersion(source.contractVersion) || !Array.isArray(source.findings)) return undefined; const findings = source.findings.map((entry) => finding(entry, references)); if (findings.some((entry) => !entry)) return undefined; return { kind: 'judged', rubric: 'testQuality', lapId: source.lapId as BuildReviewLapId, snapshotDigest: source.snapshotDigest, contractVersion: source.contractVersion as BuildReviewRubricContractVersion, findings: Object.freeze(findings as BuildReviewFinding[]), verdict: findings.length ? 'FAIL' : 'PASS' }; }
export function parseBuildReviewSkip(value: unknown): BuildReviewSkip | undefined { const source = object(value); return source?.kind === 'skipped' && source.rubric === 'testQuality' && source.reason === 'disabled' ? { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' } : undefined; }
export function parseBuildReviewInfrastructureFailure(value: unknown): BuildReviewInfrastructureFailure | undefined { const source = object(value); return source?.kind === 'infrastructure-failure' && source.rubric === 'testQuality' && typeof source.reason === 'string' && (Object.values(mapBuildReviewCoordinatorFailureReason) as string[]).includes(source.reason) && text(source.detail) ? { kind: 'infrastructure-failure', rubric: 'testQuality', reason: source.reason as BuildReviewInfrastructureFailureReason, detail: source.detail } : undefined; }
export function parseBuildReviewRubricResult(value: unknown): BuildReviewRubricResult | undefined { return parseBuildReviewJudgedResult(value) ?? parseBuildReviewSkip(value) ?? parseBuildReviewInfrastructureFailure(value); }
export function renderBuildReviewJudgedResultShape(_rubric: BuildReviewRubricId): string { return '{ kind: "judged", rubric: "testQuality", lapId: string, snapshotDigest: string, contractVersion: "v3", findings: [{ concernKind: "test-insensitive", summary: string, evidenceLocations: string[], anchor: { rubric: "testQuality", locus: { path: string, contentHash: string, display: string } } }] }'; }
const MAX_REJECTION_PROBLEMS = 6;
/**
 * Names every enumerated contract problem in a rejected judged result so the
 * bounded in-session repair turn can tell the grader WHAT to fix, never only
 * that the result was rejected. The predicate that accepts or rejects stays
 * `parseBuildReviewJudgedResult`; this only explains its verdict.
 */
export function describeBuildReviewJudgedResultRejection(value: unknown, rubric: BuildReviewRubricId, expected: { readonly lapId: string; readonly snapshotDigest: string }, references?: BuildReviewFindingReferenceContext): string {
  const source = object(value);
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
    const vocabulary = BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds;
    source.findings.forEach((entry, index) => {
      const item = object(entry);
      if (!item) { problems.push(`findings[${index}] is not an object`); return; }
      if (!text(item.concernKind)) problems.push(`findings[${index}].concernKind must be a non-empty string (never "kind")`);
      else if (parseBuildReviewFindingConcernKind(item.concernKind, rubric) === undefined) problems.push(`findings[${index}].concernKind must be one of ${vocabulary.map((member) => `"${member}"`).join(', ')} (got ${JSON.stringify(item.concernKind).slice(0, 64)})`);
      if (!text(item.summary)) problems.push(`findings[${index}].summary must be a non-empty string`);
      if (!Array.isArray(item.evidenceLocations) || item.evidenceLocations.length === 0 || item.evidenceLocations.some((location) => !text(location))) problems.push(`findings[${index}].evidenceLocations must be a non-empty array of "path:line" strings`);
      const anchor = object(item.anchor);
      if (!anchor) { problems.push(`findings[${index}].anchor is required: a nested object {"rubric": "${rubric}", "locus": {"path", "contentHash", "display"}} — never flattened top-level fields, and never an alternate name such as "anchors"`); return; }
      if (anchor.rubric !== rubric) problems.push(`findings[${index}].anchor.rubric must be "${rubric}"`);
      const locus = region(anchor.locus);
      if (!locus) problems.push(`findings[${index}].anchor.locus must be a content-region reference {"path", "contentHash", "display", "occurrence"?}`);
      else if (references?.changedTestRegions && !references.changedTestRegions.some((candidate) => sameRegion(candidate, locus))) problems.push(`findings[${index}].anchor.locus must reference a projected in-scope content region (path, contentHash, and occurrence must match one)`);
    });
    const duplicates = new Set<string>();
    const seen = new Set<string>();
    for (const entry of source.findings) { const item = object(entry); const anchor = item && object(item.anchor); const locus = anchor && region(anchor.locus); if (!locus || !text(item.concernKind)) continue; const key = `${normalizeBuildReviewFindingVocabularyMember(item.concernKind)}\u0000${locus.path}\u0000${locus.contentHash}\u0000${locus.occurrence ?? 0}`; if (seen.has(key)) duplicates.add(locus.display); seen.add(key); }
    if (duplicates.size > 0) problems.push(`findings must not repeat one concern on one content region (duplicated: ${[...duplicates].map((display) => `"${display}"`).join(', ')}) — merge equivalent findings`);
  }
  if (problems.length === 0) return `the result did not satisfy the judged contract and no enumerated check explains why; it must match ${renderBuildReviewJudgedResultShape(rubric)} and echo the projection lapId and snapshotDigest`;
  const shown = problems.slice(0, MAX_REJECTION_PROBLEMS);
  return shown.join('; ') + (problems.length > shown.length ? `; and ${problems.length - shown.length} more problem(s)` : '');
}
export interface BuildReviewDispatchFailure { readonly kind: 'dispatch-failure'; readonly detail: string; }
export function makeBuildReviewDispatchFailure(detail: string): BuildReviewDispatchFailure { return { kind: 'dispatch-failure', detail }; }
export function parseBuildReviewDispatchFailure(value: unknown): BuildReviewDispatchFailure | undefined { const source = object(value); return source?.kind === 'dispatch-failure' && text(source.detail) ? { kind: 'dispatch-failure', detail: source.detail } : undefined; }
