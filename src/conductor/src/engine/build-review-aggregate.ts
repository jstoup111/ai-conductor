import type { BuildReviewRubricId } from '../types/config.js';
import { DEPRECATED_BUILD_REVIEW_RUBRIC_IDS } from './config.js';
import {
  parseBuildReviewLapId,
  parseBuildReviewRubricResult,
  type BuildReviewFindingAnchor,
  type BuildReviewLapId,
  type BuildReviewRubricContractVersion,
  type BuildReviewInfrastructureFailure,
  type BuildReviewRubricResult,
} from './build-review-domain.js';
import { isRegisteredRubric } from './build-review-registry.js';
import { isRetiredBuildReviewRubric } from './build-review-dispositions.js';
import {
  matchesBuildReviewDisposition,
  matchesBuildReviewReducedCoverageDisposition,
  type BuildReviewDispositionRecord,
  type BuildReviewFeatureIdentity,
  type BuildReviewReducedCoverageDispositionRecord,
} from './build-review-dispositions.js';
import { canonicalizeBuildReviewFindingIdentity } from './build-review-finding-identity.js';

const AGGREGATE_VERSION = 'v1' as const;
const RUBRICS = ['testQuality'] as const;
const RETIRED_REASON_PREFIX = new RegExp(`^\\[(${DEPRECATED_BUILD_REVIEW_RUBRIC_IDS.join('|')})\\]`);

type Coverage = 'judged' | 'skipped' | 'infrastructure-failure';
type RubricFlags = Record<BuildReviewRubricId, boolean>;
type LegacyFindings = Record<BuildReviewRubricId, string[]>;

/** A rejected retired-rubric envelope is infrastructure evidence, never a reviewer FAIL. */
export type BuildReviewVerdictEnvelopeValidation =
  | { readonly kind: 'valid'; readonly result: BuildReviewRubricResult }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'mechanical-fault'; readonly fault: BuildReviewInfrastructureFailure };

/** The sole raw join: four attributable outcomes plus legacy gate fields. */
export interface BuildReviewAggregate {
  readonly aggregateVersion: typeof AGGREGATE_VERSION;
  readonly lapId: BuildReviewLapId;
  readonly snapshotDigest: string;
  readonly results: Readonly<Record<BuildReviewRubricId, BuildReviewRubricResult>>;
  readonly coverage: Readonly<Record<BuildReviewRubricId, Coverage>>;
  readonly verdict: 'PASS' | 'FAIL';
  readonly rubric: Readonly<RubricFlags>;
  readonly findings: Readonly<LegacyFindings>;
  readonly reasons: readonly string[];
  /** Engine-stamped current-lap reduced-coverage evidence, when an allowance was used. */
  readonly reducedCoverageEvidence?: string;
  readonly codeStamp?: string | null;
}

export interface BuildReviewAggregateInput {
  readonly lapId: BuildReviewLapId;
  readonly snapshotDigest: string;
  readonly results: Readonly<Record<BuildReviewRubricId, BuildReviewRubricResult>>;
  readonly codeStamp?: string | null;
}

/** Raw and accepted-risk state remain independently inspectable after join. */
export interface BuildReviewEffectiveVerdict {
  readonly rawVerdict: 'PASS' | 'FAIL';
  readonly verdict: 'PASS' | 'FAIL';
  readonly acceptedFindingIds: readonly string[];
  readonly unresolvedFindingIds: readonly string[];
  readonly skippedRubrics: readonly BuildReviewRubricId[];
  readonly infrastructureFailureRubrics: readonly BuildReviewRubricId[];
}

/** Raw, registry-neutral content preserved by the mechanical aggregate join. */
export interface BuildReviewRawSourceProjection {
  readonly rubric: BuildReviewRubricId;
  readonly findingId: string;
  readonly contractVersion: BuildReviewRubricContractVersion;
  readonly concernKind: string;
  readonly anchor: BuildReviewFindingAnchor;
  readonly summary: string;
  readonly evidenceLocations: readonly string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function strictResult(value: unknown): BuildReviewRubricResult | undefined {
  const candidate = record(value);
  if (!candidate) return undefined;
  const keys = candidate.kind === 'judged'
    ? ['kind', 'rubric', 'lapId', 'snapshotDigest', 'contractVersion', 'findings', ...(candidate.relocationAudit === undefined ? [] : ['relocationAudit']), ...(candidate.counterfactualSensitivity === undefined ? [] : ['counterfactualSensitivity']), 'verdict']
    : candidate.kind === 'skipped'
      ? ['kind', 'rubric', 'reason']
      : candidate.kind === 'infrastructure-failure'
        ? ['kind', 'rubric', 'reason', 'detail']
        : [];
  return exactKeys(candidate, keys) ? parseBuildReviewRubricResult(candidate) : undefined;
}

/**
 * Keep registry membership at the verdict boundary: a retired rubric cannot
 * turn its provider judgement into a semantic feature failure.
 */
export function validateBuildReviewVerdictEnvelope(value: unknown): BuildReviewVerdictEnvelopeValidation {
  const result = strictResult(value);
  if (!result) {
    const candidate = record(value);
    if (candidate?.kind === 'judged' && isNonEmptyString(candidate.rubric) && !isRegisteredRubric(candidate.rubric)) {
      return {
        kind: 'mechanical-fault',
        fault: {
          kind: 'infrastructure-failure',
          // The current aggregate has one registered slot. Preserve the rejected
          // id in detail while routing its bad envelope through that slot's
          // established mechanical-fault lane.
          rubric: 'testQuality',
          reason: 'malformed-artifact',
          detail: `unregistered build-review rubric: ${candidate.rubric}`,
        },
      };
    }
    return { kind: 'invalid' };
  }
  if (result.kind !== 'judged' || isRegisteredRubric(result.rubric)) return { kind: 'valid', result };
  return {
    kind: 'mechanical-fault',
    fault: {
      kind: 'infrastructure-failure',
      rubric: result.rubric,
      reason: 'malformed-artifact',
      detail: `unregistered build-review rubric: ${result.rubric}`,
    },
  };
}

function parseResults(
  value: unknown,
  lapId: BuildReviewLapId,
  snapshotDigest: string,
): Readonly<Record<BuildReviewRubricId, BuildReviewRubricResult>> | undefined {
  const source = record(value);
  if (!source || !exactKeys(source, RUBRICS)) return undefined;
  const results = {} as Record<BuildReviewRubricId, BuildReviewRubricResult>;
  for (const rubric of RUBRICS) {
    const envelope = validateBuildReviewVerdictEnvelope(source[rubric]);
    if (envelope.kind === 'invalid') return undefined;
    const result = envelope.kind === 'mechanical-fault' ? envelope.fault : envelope.result;
    if (envelope.kind === 'valid' && result.rubric !== rubric) return undefined;
    if (result.kind === 'judged' && (result.lapId !== lapId || result.snapshotDigest !== snapshotDigest)) return undefined;
    results[rubric] = result;
  }
  return results;
}

function coverageFor(result: BuildReviewRubricResult): Coverage {
  return result.kind === 'judged' ? 'judged' : result.kind;
}

function legacyFindingDetails(result: BuildReviewRubricResult): string[] {
  switch (result.kind) {
    case 'judged': return result.findings.map((finding) => finding.concernKind);
    case 'skipped': return [`skipped: ${result.reason}`];
    case 'infrastructure-failure': return [`infrastructure failure: ${result.detail}`];
  }
}

function legacyFailure(result: BuildReviewRubricResult): boolean {
  return result.kind === 'infrastructure-failure' || (result.kind === 'judged' && result.findings.length > 0);
}

function aggregateVerdict(results: Readonly<Record<BuildReviewRubricId, BuildReviewRubricResult>>): 'PASS' | 'FAIL' {
  const judgedCount = RUBRICS.filter((name) => results[name].kind === 'judged').length;
  return judgedCount > 0 && !RUBRICS.some((name) => legacyFailure(results[name])) ? 'PASS' : 'FAIL';
}

/** Derives an immutable, backward-compatible aggregate from every raw branch. */
export function joinBuildReviewRubricOutcomes(input: BuildReviewAggregateInput): BuildReviewAggregate {
  const coverage = {} as Record<BuildReviewRubricId, Coverage>;
  const rubric = {} as RubricFlags;
  const findings = {} as LegacyFindings;
  const reasons: string[] = [];
  for (const name of RUBRICS) {
    const result = input.results[name];
    coverage[name] = coverageFor(result);
    rubric[name] = legacyFailure(result);
    findings[name] = legacyFindingDetails(result);
    reasons.push(...findings[name].map((detail) => detail.startsWith('[relocation-audit]') ? detail : `[${name}] ${detail}`));
  }
  const aggregate: BuildReviewAggregate = {
    aggregateVersion: AGGREGATE_VERSION, lapId: input.lapId, snapshotDigest: input.snapshotDigest,
    results: input.results, coverage, verdict: aggregateVerdict(input.results),
    rubric, findings, reasons,
    ...(input.codeStamp !== undefined ? { codeStamp: input.codeStamp } : {}),
  };
  const validated = parseBuildReviewAggregate(aggregate);
  if (!validated) throw new Error('build-review aggregate requires four current, valid rubric results');
  return validated;
}

/** Strict parser for the aggregate boundary; legacy top-level fields are cross-checked, never trusted. */
export function parseBuildReviewAggregate(value: unknown): BuildReviewAggregate | undefined {
  const raw = record(value);
  // In-flight v1 aggregates may still carry the retired branch.  It was
  // informational only, so read it tolerantly while projecting the closed
  // four-rubric contract to every current consumer.
  //
  // Tolerance covers ALL state derived from the retired member, not just its
  // maps: an aggregate whose stored top-level verdict was FAIL solely because
  // Wiring failed or skipped must re-derive its verdict from the surviving
  // four rubrics rather than be rejected as inconsistent. The relaxation is
  // scoped to aggregates that verifiably carried the retired member — a
  // four-rubric aggregate with a mismatched verdict is still corruption.
  const carriedRetiredRubric = !!raw && (
    (['results', 'coverage', 'rubric', 'findings'] as const)
      .some((key) => { const memberMap = record(raw[key]); return !!memberMap && Object.keys(memberMap).some(isRetiredBuildReviewRubric); })
  );
  const source = raw && Object.fromEntries(Object.entries(raw).map(([key, entry]) => {
    const memberMap = key === 'results' || key === 'coverage' || key === 'rubric' || key === 'findings'
      ? record(entry)
      : undefined;
    // A retired Wiring member also contributed legacy reason strings.  Drop
    // those alongside its derived maps before validating the four-rubric view.
    return [key, carriedRetiredRubric && key === 'reasons' && Array.isArray(entry)
      ? entry.filter((reason) => typeof reason !== 'string' || !RETIRED_REASON_PREFIX.test(reason))
      : carriedRetiredRubric && memberMap ? Object.fromEntries(Object.entries(memberMap).filter(([member]) => !isRetiredBuildReviewRubric(member))) : entry];
  }));
  if (!source || !exactKeys(source, [
    'aggregateVersion', 'lapId', 'snapshotDigest', 'results', 'coverage', 'verdict', 'rubric', 'findings', 'reasons',
    ...(source.reducedCoverageEvidence === undefined ? [] : ['reducedCoverageEvidence']),
    ...(source.codeStamp === undefined ? [] : ['codeStamp']),
  ]) || source.aggregateVersion !== AGGREGATE_VERSION || !isNonEmptyString(source.snapshotDigest) ||
    (source.reducedCoverageEvidence !== undefined && !isNonEmptyString(source.reducedCoverageEvidence)) ||
    (source.codeStamp !== undefined && source.codeStamp !== null && !isNonEmptyString(source.codeStamp))) return undefined;
  const lapId = parseBuildReviewLapId(source.lapId);
  if (!lapId) return undefined;
  const results = parseResults(source.results, lapId, source.snapshotDigest);
  const coverage = record(source.coverage);
  const rubric = record(source.rubric);
  const findings = record(source.findings);
  if (!results || !coverage || !rubric || !findings || !Array.isArray(source.reasons) || source.reasons.some((reason) => typeof reason !== 'string') ||
    !exactKeys(coverage, RUBRICS) || !exactKeys(rubric, RUBRICS) || !exactKeys(findings, RUBRICS)) return undefined;
  const expectedCoverage = {} as Record<BuildReviewRubricId, Coverage>;
  const expectedRubric = {} as RubricFlags;
  const expectedFindings = {} as LegacyFindings;
  const expectedReasons: string[] = [];
  for (const name of RUBRICS) {
    if (coverage[name] !== 'judged' && coverage[name] !== 'skipped' && coverage[name] !== 'infrastructure-failure' ||
      typeof rubric[name] !== 'boolean' || !Array.isArray(findings[name]) || findings[name].some((finding) => typeof finding !== 'string')) return undefined;
    expectedCoverage[name] = coverageFor(results[name]);
    expectedRubric[name] = legacyFailure(results[name]);
    expectedFindings[name] = legacyFindingDetails(results[name]);
    expectedReasons.push(...expectedFindings[name].map((detail) => detail.startsWith('[relocation-audit]') ? detail : `[${name}] ${detail}`));
  }
  const verdict = aggregateVerdict(results);
  const verdictTolerated = carriedRetiredRubric && (source.verdict === 'PASS' || source.verdict === 'FAIL');
  if ((source.verdict !== verdict && !verdictTolerated) || JSON.stringify(coverage) !== JSON.stringify(expectedCoverage) ||
    JSON.stringify(rubric) !== JSON.stringify(expectedRubric) || JSON.stringify(findings) !== JSON.stringify(expectedFindings) ||
    JSON.stringify(source.reasons) !== JSON.stringify(expectedReasons)) return undefined;
  return {
    aggregateVersion: AGGREGATE_VERSION, lapId, snapshotDigest: source.snapshotDigest, results, coverage: expectedCoverage,
    verdict, rubric: expectedRubric, findings: expectedFindings, reasons: expectedReasons,
    ...(source.reducedCoverageEvidence !== undefined ? { reducedCoverageEvidence: source.reducedCoverageEvidence as string } : {}),
    ...(source.codeStamp !== undefined ? { codeStamp: source.codeStamp as string | null } : {}),
  };
}

/**
 * Projects every raw adjudicable content finding without changing the stored
 * aggregate shape. Coverage failures are intentionally excluded: they are not
 * semantic sources for the post-join remediate judgement.
 */
export function projectBuildReviewAggregateSources(value: unknown): readonly BuildReviewRawSourceProjection[] | undefined {
  const aggregate = parseBuildReviewAggregate(value);
  if (!aggregate) return undefined;
  const sources: BuildReviewRawSourceProjection[] = [];
  for (const rubric of RUBRICS) {
    const result = aggregate.results[rubric];
    if (result.kind !== 'judged') continue;
    for (const finding of result.findings) {
      const identity = canonicalizeBuildReviewFindingIdentity({
        rubric,
        contractVersion: result.contractVersion,
        concernKind: finding.concernKind,
        anchor: finding.anchor,
      });
      if (!identity) return undefined;
      sources.push(Object.freeze({
        rubric,
        findingId: identity.id,
        contractVersion: result.contractVersion,
        concernKind: finding.concernKind,
        anchor: finding.anchor,
        summary: finding.summary,
        evidenceLocations: Object.freeze([...finding.evidenceLocations]),
      }));
    }
  }
  return Object.freeze(sources);
}

/**
 * Applies only already-verified canonical finding IDs after strict raw join.
 * Legacy objects cannot enter this reducer, and skips/infrastructure failures
 * remain blocking even when every content finding has an accepted ID.
 */
export function deriveEffectiveBuildReviewVerdict(
  value: unknown,
  acceptedFindingIds: ReadonlySet<string> = new Set(),
  reducedCoverage: readonly BuildReviewReducedCoverageDispositionRecord[] = [],
): BuildReviewEffectiveVerdict | undefined {
  const aggregate = parseBuildReviewAggregate(value);
  if (!aggregate) return undefined;
  const accepted: string[] = [];
  const unresolved: string[] = [];
  const skipped: BuildReviewRubricId[] = [];
  const infrastructure: BuildReviewRubricId[] = [];
  let uncoveredInfrastructureCount = 0;
  let judgedCount = 0;
  for (const rubric of RUBRICS) {
    const result = aggregate.results[rubric];
    if (result.kind === 'skipped') {
      skipped.push(rubric);
      continue;
    }
    if (result.kind === 'infrastructure-failure') {
      infrastructure.push(rubric);
      if (!reducedCoverage.some((decision) => matchesBuildReviewReducedCoverageDisposition(
        decision.feature,
        { rubric, reason: result.reason },
        [decision],
      ))) uncoveredInfrastructureCount += 1;
      continue;
    }
    judgedCount += 1;
    for (const finding of result.findings) {
      const identity = canonicalizeBuildReviewFindingIdentity({
        rubric, contractVersion: result.contractVersion, concernKind: finding.concernKind, anchor: finding.anchor,
      });
      if (!identity) return undefined;
      (acceptedFindingIds.has(identity.id) ? accepted : unresolved).push(identity.id);
    }
  }
  return Object.freeze({
    rawVerdict: aggregate.verdict,
    verdict: judgedCount > 0 && unresolved.length === 0 && uncoveredInfrastructureCount === 0 ? 'PASS' : 'FAIL',
    acceptedFindingIds: Object.freeze(accepted), unresolvedFindingIds: Object.freeze(unresolved),
    skippedRubrics: Object.freeze(skipped), infrastructureFailureRubrics: Object.freeze(infrastructure),
  });
}

/**
 * Resolves accepted risk only after strict raw join. Dispositions match the
 * complete canonical payload within their feature; human-facing wording and
 * evidence locations never participate in this comparison.
 */
export function deriveEffectiveBuildReviewVerdictWithDispositions(
  value: unknown,
  feature: BuildReviewFeatureIdentity,
  dispositions: readonly BuildReviewDispositionRecord[],
  reducedCoverage: readonly BuildReviewReducedCoverageDispositionRecord[] = [],
): BuildReviewEffectiveVerdict | undefined {
  const aggregate = parseBuildReviewAggregate(value);
  if (!aggregate) return undefined;
  const acceptedIds = new Set<string>();
  for (const rubric of RUBRICS) {
    const result = aggregate.results[rubric];
    if (result.kind !== 'judged') continue;
    for (const finding of result.findings) {
      const identity = canonicalizeBuildReviewFindingIdentity({
        rubric, contractVersion: result.contractVersion, concernKind: finding.concernKind, anchor: finding.anchor,
      });
      if (!identity) return undefined;
      if (matchesBuildReviewDisposition(feature, identity, dispositions)) acceptedIds.add(identity.id);
    }
  }
  return deriveEffectiveBuildReviewVerdict(
    aggregate,
    acceptedIds,
    reducedCoverage.filter((decision) => decision.kind === 'reduced-coverage' &&
      matchesBuildReviewReducedCoverageDisposition(feature, decision.identity, [decision])),
  );
}
