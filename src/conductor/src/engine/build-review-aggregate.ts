import type { BuildReviewRubricId } from '../types/config.js';
import {
  parseBuildReviewLapId,
  parseBuildReviewRubricResult,
  type BuildReviewLapId,
  type BuildReviewRubricResult,
} from './build-review-domain.js';
import {
  matchesBuildReviewDisposition,
  type BuildReviewDispositionRecord,
  type BuildReviewFeatureIdentity,
} from './build-review-dispositions.js';
import { canonicalizeBuildReviewFindingIdentity } from './build-review-finding-identity.js';

const AGGREGATE_VERSION = 'v1' as const;
const RUBRICS = ['tautology', 'scope', 'rootCause', 'completeness', 'wiring'] as const;

type Coverage = 'judged' | 'skipped' | 'infrastructure-failure';
type RubricFlags = Record<BuildReviewRubricId, boolean>;
type LegacyFindings = Record<BuildReviewRubricId, string[]>;

/** The sole raw join: five attributable outcomes plus legacy gate fields. */
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
    ? ['kind', 'rubric', 'lapId', 'snapshotDigest', 'contractVersion', 'findings', 'verdict']
    : candidate.kind === 'skipped'
      ? ['kind', 'rubric', 'reason']
      : candidate.kind === 'infrastructure-failure'
        ? ['kind', 'rubric', 'reason', 'detail']
        : [];
  return exactKeys(candidate, keys) ? parseBuildReviewRubricResult(candidate) : undefined;
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
    const result = strictResult(source[rubric]);
    if (!result || result.rubric !== rubric) return undefined;
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
    reasons.push(...findings[name].map((detail) => `[${name}] ${detail}`));
  }
  const aggregate: BuildReviewAggregate = {
    aggregateVersion: AGGREGATE_VERSION, lapId: input.lapId, snapshotDigest: input.snapshotDigest,
    results: input.results, coverage, verdict: aggregateVerdict(input.results),
    rubric, findings, reasons,
    ...(input.codeStamp !== undefined ? { codeStamp: input.codeStamp } : {}),
  };
  const validated = parseBuildReviewAggregate(aggregate);
  if (!validated) throw new Error('build-review aggregate requires five current, valid rubric results');
  return validated;
}

/** Strict parser for the aggregate boundary; legacy top-level fields are cross-checked, never trusted. */
export function parseBuildReviewAggregate(value: unknown): BuildReviewAggregate | undefined {
  const source = record(value);
  if (!source || !exactKeys(source, [
    'aggregateVersion', 'lapId', 'snapshotDigest', 'results', 'coverage', 'verdict', 'rubric', 'findings', 'reasons',
    ...(source.codeStamp === undefined ? [] : ['codeStamp']),
  ]) || source.aggregateVersion !== AGGREGATE_VERSION || !isNonEmptyString(source.snapshotDigest) ||
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
    expectedReasons.push(...expectedFindings[name].map((detail) => `[${name}] ${detail}`));
  }
  const verdict = aggregateVerdict(results);
  if (source.verdict !== verdict || JSON.stringify(coverage) !== JSON.stringify(expectedCoverage) ||
    JSON.stringify(rubric) !== JSON.stringify(expectedRubric) || JSON.stringify(findings) !== JSON.stringify(expectedFindings) ||
    JSON.stringify(source.reasons) !== JSON.stringify(expectedReasons)) return undefined;
  return {
    aggregateVersion: AGGREGATE_VERSION, lapId, snapshotDigest: source.snapshotDigest, results, coverage: expectedCoverage,
    verdict, rubric: expectedRubric, findings: expectedFindings, reasons: expectedReasons,
    ...(source.codeStamp !== undefined ? { codeStamp: source.codeStamp as string | null } : {}),
  };
}

/**
 * Applies only already-verified canonical finding IDs after strict raw join.
 * Legacy objects cannot enter this reducer, and skips/infrastructure failures
 * remain blocking even when every content finding has an accepted ID.
 */
export function deriveEffectiveBuildReviewVerdict(
  value: unknown,
  acceptedFindingIds: ReadonlySet<string> = new Set(),
): BuildReviewEffectiveVerdict | undefined {
  const aggregate = parseBuildReviewAggregate(value);
  if (!aggregate) return undefined;
  const accepted: string[] = [];
  const unresolved: string[] = [];
  const skipped: BuildReviewRubricId[] = [];
  const infrastructure: BuildReviewRubricId[] = [];
  let judgedCount = 0;
  for (const rubric of RUBRICS) {
    const result = aggregate.results[rubric];
    if (result.kind === 'skipped') {
      skipped.push(rubric);
      continue;
    }
    if (result.kind === 'infrastructure-failure') {
      infrastructure.push(rubric);
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
    verdict: judgedCount > 0 && unresolved.length === 0 && infrastructure.length === 0 ? 'PASS' : 'FAIL',
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
  return deriveEffectiveBuildReviewVerdict(aggregate, acceptedIds);
}
