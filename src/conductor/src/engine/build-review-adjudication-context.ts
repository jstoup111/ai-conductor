import type { BuildReviewAggregate, BuildReviewRawSourceProjection } from './build-review-aggregate.js';
import { projectBuildReviewAggregateSources } from './build-review-aggregate.js';
import type { RemediationCaseEffect, RemediationCaseRecord, RemediationCaseSourceLink } from './remediation-case-store.js';

export const BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS = Object.freeze({
  maxCurrentSources: 512,
  maxPriorCases: 128,
  maxSourcesPerCase: 512,
  maxEvidenceLocations: 64,
  maxReferenceBytes: 256,
  maxTextBytes: 8_000,
  maxSerializedBytes: 128 * 1024,
});

export interface BuildReviewAdjudicationCurrentSource extends BuildReviewRawSourceProjection {
  readonly sourceId: string;
}

export interface BuildReviewAdjudicationPriorCase {
  readonly id: string;
  readonly disposition: RemediationCaseRecord['disposition'];
  readonly priority: RemediationCaseRecord['priority'];
  readonly rationale: string;
  readonly confidence: RemediationCaseRecord['confidence'];
  readonly resolution: RemediationCaseRecord['resolution'];
  readonly sources: readonly RemediationCaseSourceLink[];
  readonly effect: RemediationCaseEffect;
}

/** The complete input to one post-join remediate judgement. */
export interface BuildReviewAdjudicationContext {
  readonly version: 'v1';
  readonly domain: 'build_review';
  readonly lapId: string;
  readonly snapshotDigest: string;
  readonly currentSources: readonly BuildReviewAdjudicationCurrentSource[];
  readonly priorCases: readonly BuildReviewAdjudicationPriorCase[];
}

export interface AssembleBuildReviewAdjudicationContextInput {
  readonly aggregate: BuildReviewAggregate;
  readonly priorCases: readonly RemediationCaseRecord[];
  /** Exact accepted-risk identities only; no summary or rubric-wide matching. */
  readonly operatorResolvedFindingIds?: ReadonlySet<string>;
}

export type BuildReviewAdjudicationContextStop =
  | { readonly code: 'invalid-aggregate' }
  | { readonly code: 'field-overflow'; readonly subject: 'current-source' | 'prior-case'; readonly field: string; readonly limit: number; readonly actual: number; readonly caseId?: string }
  | { readonly code: 'unrepresentable-prior-case'; readonly caseId: string; readonly field: string }
  | { readonly code: 'serialized-byte-overflow'; readonly limit: number; readonly actual: number };

export type AssembleBuildReviewAdjudicationContextResult =
  | { readonly ok: true; readonly context: BuildReviewAdjudicationContext }
  | { readonly ok: false; readonly stop: BuildReviewAdjudicationContextStop };

const LIMITS = BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS;
const OUTCOMES = new Set(['acted', 'deferred', 'rejected', 'merged']);

function bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function boundedString(
  value: unknown,
  max: number,
  subject: 'current-source' | 'prior-case',
  field: string,
  caseId?: string,
): BuildReviewAdjudicationContextStop | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return subject === 'prior-case'
      ? { code: 'unrepresentable-prior-case', caseId: caseId ?? 'unknown', field }
      : { code: 'invalid-aggregate' };
  }
  const actual = bytes(value);
  return actual > max ? { code: 'field-overflow', subject, field, limit: max, actual, ...(caseId === undefined ? {} : { caseId }) } : undefined;
}

function validateCurrent(source: BuildReviewRawSourceProjection): BuildReviewAdjudicationContextStop | undefined {
  const fields: readonly [string, unknown, number][] = [
    ['rubric', source.rubric, LIMITS.maxReferenceBytes],
    ['findingId', source.findingId, LIMITS.maxReferenceBytes],
    ['contractVersion', source.contractVersion, LIMITS.maxReferenceBytes],
    ['concernKind', source.concernKind, LIMITS.maxReferenceBytes],
    ['summary', source.summary, LIMITS.maxTextBytes],
  ];
  for (const [field, value, limit] of fields) {
    const stop = boundedString(value, limit, 'current-source', field);
    if (stop) return stop;
  }
  if (!Array.isArray(source.evidenceLocations) || source.evidenceLocations.length > LIMITS.maxEvidenceLocations) {
    return { code: 'field-overflow', subject: 'current-source', field: 'evidenceLocations', limit: LIMITS.maxEvidenceLocations, actual: Array.isArray(source.evidenceLocations) ? source.evidenceLocations.length : Number.POSITIVE_INFINITY };
  }
  for (const location of source.evidenceLocations) {
    const stop = boundedString(location, LIMITS.maxReferenceBytes, 'current-source', 'evidenceLocations[]');
    if (stop) return stop;
  }
  return undefined;
}

function validateEffect(caseRecord: RemediationCaseRecord): BuildReviewAdjudicationContextStop | undefined {
  const effect = caseRecord.effect;
  if (caseRecord.disposition === 'reject') {
    return effect.kind === 'none' ? undefined : { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'effect' };
  }
  const expectedKind = caseRecord.disposition === 'act' ? 'action' : 'deferral';
  if (effect.kind !== expectedKind || !('status' in effect)) return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'effect' };
  const effectId = boundedString(effect.id, LIMITS.maxReferenceBytes, 'prior-case', 'effect.id', caseRecord.id);
  if (effectId) return effectId;
  if (!['reserved', 'applied', 'failed'].includes(effect.status)) return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'effect.status' };
  if (effect.status === 'applied') {
    const reference = effect.kind === 'action' ? effect.workOrderId : effect.issueUrl;
    return boundedString(reference, effect.kind === 'action' ? LIMITS.maxReferenceBytes : LIMITS.maxTextBytes, 'prior-case', effect.kind === 'action' ? 'effect.workOrderId' : 'effect.issueUrl', caseRecord.id);
  }
  if (effect.status === 'failed') return boundedString(effect.diagnostic, LIMITS.maxTextBytes, 'prior-case', 'effect.diagnostic', caseRecord.id);
  return undefined;
}

function validatePriorCase(caseRecord: RemediationCaseRecord): BuildReviewAdjudicationContextStop | undefined {
  for (const [field, value, limit] of [
    ['id', caseRecord.id, LIMITS.maxReferenceBytes],
    ['rationale', caseRecord.rationale, LIMITS.maxTextBytes],
  ] as const) {
    const stop = boundedString(value, limit, 'prior-case', field, caseRecord.id);
    if (stop) return stop;
  }
  if (caseRecord.domain !== 'build_review' || !['act', 'defer', 'reject'].includes(caseRecord.disposition) ||
    !['critical', 'high', 'medium', 'low'].includes(caseRecord.priority) ||
    !['high', 'medium', 'low'].includes(caseRecord.confidence) || !['open', 'resolved'].includes(caseRecord.resolution)) {
    return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'case' };
  }
  if (!Array.isArray(caseRecord.sources) || caseRecord.sources.length === 0 || caseRecord.sources.length > LIMITS.maxSourcesPerCase) {
    return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'sources' };
  }
  const sourceIds = new Set<string>();
  for (const source of caseRecord.sources) {
    const sourceId = boundedString(source.sourceId, LIMITS.maxReferenceBytes, 'prior-case', 'sources[].sourceId', caseRecord.id);
    if (sourceId) return sourceId;
    if (!OUTCOMES.has(source.outcome) || Number.isNaN(Date.parse(source.recordedAt)) || sourceIds.has(source.sourceId)) {
      return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'sources' };
    }
    sourceIds.add(source.sourceId);
  }
  return validateEffect(caseRecord);
}

function freezePriorCase(caseRecord: RemediationCaseRecord): BuildReviewAdjudicationPriorCase {
  const sources = [...caseRecord.sources].sort((left, right) =>
    `${left.recordedAt}\u0000${left.sourceId}`.localeCompare(`${right.recordedAt}\u0000${right.sourceId}`),
  ).map((source) => Object.freeze({ ...source }));
  return Object.freeze({
    id: caseRecord.id,
    disposition: caseRecord.disposition,
    priority: caseRecord.priority,
    rationale: caseRecord.rationale,
    confidence: caseRecord.confidence,
    resolution: caseRecord.resolution,
    sources: Object.freeze(sources),
    effect: Object.freeze({ ...caseRecord.effect }) as RemediationCaseEffect,
  });
}

/**
 * Creates one complete deterministic projection. The caller receives every
 * current unresolved source and every prior case, or a typed stop—never a
 * silently truncated provider prompt.
 */
/**
 * The adjudication source identity, in one place.
 *
 * The judge is handed these ids and returns them verbatim, and the coordinator
 * validates its judgement against the set it builds itself. When the two sides
 * derived that identity independently they drifted — the context stamped
 * `<rubric>:<findingId>` while the coordinator passed the bare `findingId`, so
 * every contract-following judgement failed closed as `unknown-source` and no
 * lap could ever settle. Both sides call this now.
 *
 * The rubric prefix is load-bearing for post-join adjudication: two rubrics may
 * legitimately raise the same `findingId`, and a bare id cannot tell them apart.
 */
export function buildReviewAdjudicationSourceId(
  source: Pick<BuildReviewRawSourceProjection, 'rubric' | 'findingId'>,
): string {
  return `${source.rubric}:${source.findingId}`;
}

export function assembleBuildReviewAdjudicationContext(
  input: AssembleBuildReviewAdjudicationContextInput,
): AssembleBuildReviewAdjudicationContextResult {
  const rawSources = projectBuildReviewAggregateSources(input.aggregate);
  if (!rawSources) return { ok: false, stop: { code: 'invalid-aggregate' } };
  const unresolvedSources = rawSources.filter((source) => !input.operatorResolvedFindingIds?.has(source.findingId));
  if (unresolvedSources.length > LIMITS.maxCurrentSources) {
    return { ok: false, stop: { code: 'field-overflow', subject: 'current-source', field: 'currentSources', limit: LIMITS.maxCurrentSources, actual: unresolvedSources.length } };
  }
  const currentSources: BuildReviewAdjudicationCurrentSource[] = [];
  for (const source of unresolvedSources) {
    const stop = validateCurrent(source);
    if (stop) return { ok: false, stop };
    currentSources.push(Object.freeze({ ...source, sourceId: buildReviewAdjudicationSourceId(source) }));
  }
  currentSources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  if (input.priorCases.length > LIMITS.maxPriorCases) {
    return { ok: false, stop: { code: 'field-overflow', subject: 'prior-case', field: 'priorCases', limit: LIMITS.maxPriorCases, actual: input.priorCases.length } };
  }
  const caseIds = new Set<string>();
  const priorCases: BuildReviewAdjudicationPriorCase[] = [];
  for (const caseRecord of input.priorCases) {
    const stop = validatePriorCase(caseRecord);
    if (stop) return { ok: false, stop };
    if (caseIds.has(caseRecord.id)) return { ok: false, stop: { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'duplicate-id' } };
    caseIds.add(caseRecord.id);
    priorCases.push(freezePriorCase(caseRecord));
  }
  priorCases.sort((left, right) => left.id.localeCompare(right.id));

  const context: BuildReviewAdjudicationContext = Object.freeze({
    version: 'v1', domain: 'build_review', lapId: input.aggregate.lapId, snapshotDigest: input.aggregate.snapshotDigest,
    currentSources: Object.freeze(currentSources), priorCases: Object.freeze(priorCases),
  });
  const actual = bytes(JSON.stringify(context));
  if (actual > LIMITS.maxSerializedBytes) {
    return { ok: false, stop: { code: 'serialized-byte-overflow', limit: LIMITS.maxSerializedBytes, actual } };
  }
  return { ok: true, context };
}
