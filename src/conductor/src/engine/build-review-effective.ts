import { isRegisteredRubric } from './build-review-registry.js';
import { realpath as realpathDefault } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import {
  deriveEffectiveBuildReviewVerdictWithDispositions,
  parseBuildReviewAggregate,
  type BuildReviewAggregate,
  type BuildReviewEffectiveVerdict,
} from './build-review-aggregate.js';
import {
  BuildReviewDispositionStore,
  isRetiredBuildReviewRubric,
  matchesBuildReviewDisposition,
  rehydrateBuildReviewAcceptedRiskFinding,
  matchesBuildReviewReducedCoverageDisposition,
  type BuildReviewDispositionListResult,
  type BuildReviewDispositionRecord,
  type BuildReviewFeatureIdentity,
  type BuildReviewReducedCoverageListResult,
} from './build-review-dispositions.js';
import { CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION } from './build-review-domain.js';
import { resolveMainRepoRoot } from './park-marker.js';
import type { ConductorEvent } from '../types/events.js';
import { renderBuildReviewReducedCoverageEvidence } from './build-review-projections.js';
import { projectBuildReviewCustomSuppressionSources } from './build-review-suppression-history.js';
import type { ResolvedBuildReviewConfig } from './resolved-config.js';

/** One resolved catalog is the authority for both built-in and custom floors. */
export function buildReviewConfidenceFloors(config: Pick<ResolvedBuildReviewConfig, 'catalog' | 'rubrics'>): Partial<Record<string, number>> {
  return Object.fromEntries([
    ...Object.entries(config.rubrics).map(([id, policy]) => [id, policy.min_confidence]),
    ...config.catalog.filter((entry) => entry.kind === 'custom').map((entry) => [entry.id, entry.policy.min_confidence]),
  ]);
}

type DispositionStore = {
  list(feature: unknown): Promise<BuildReviewDispositionListResult>;
  listReducedCoverage(feature: unknown): Promise<BuildReviewReducedCoverageListResult>;
};

export interface BuildReviewEffectiveResolverDeps {
  readonly resolveMainRoot?: (projectRoot: string) => Promise<string>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly createStore?: (projectRoot: string) => DispositionStore;
  /** Reports durable dispositions that no longer bind the current contract. */
  readonly emit?: (event: Extract<ConductorEvent, { type: 'build_review_disposition_version_invalidated' }>) => void | Promise<void>;
  /** Reports ignored legacy records supplied by a custom disposition store. */
  readonly log?: (message: string) => void;
  /** Resolved operator floors, supplied by the live build-review runner. */
  readonly minConfidence?: Partial<Record<string, number>>;
}

export type BuildReviewEffectiveResolution =
  | {
      readonly ok: true;
      readonly feature: BuildReviewFeatureIdentity;
      readonly effective: BuildReviewEffectiveVerdict;
      /** Exact shared section to stamp into the current lap artifact, if any. */
      readonly reducedCoverageEvidence?: string;
    }
  | { readonly ok: false; readonly reason: string };

function sameFeature(left: BuildReviewFeatureIdentity, right: BuildReviewFeatureIdentity): boolean {
  return left.version === right.version && left.repository === right.repository && left.feature === right.feature;
}

function applyCurrentCustomEffectiveVerdict(
  aggregate: BuildReviewAggregate,
  effective: BuildReviewEffectiveVerdict,
  feature: BuildReviewFeatureIdentity,
  reducedCoverage: readonly import('./build-review-dispositions.js').BuildReviewReducedCoverageDispositionRecord[],
  dispositions: readonly import('./build-review-dispositions.js').BuildReviewDispositionRecord[],
  minConfidence: Partial<Record<string, number>>,
): BuildReviewEffectiveVerdict | undefined {
  const customSources = projectBuildReviewCustomSuppressionSources(aggregate);
  if (!customSources) return undefined;
  const customJudged = (aggregate.currentCustomRubrics ?? []).filter((rubric) =>
    aggregate.customResults?.[rubric]?.result.kind === 'judged',
  ).length;
  const customFailures = (aggregate.currentCustomRubrics ?? []).flatMap((rubric) => {
    const member = aggregate.customResults?.[rubric];
    if (member?.result.kind !== 'infrastructure-failure' || member.declaration === undefined) return [];
    return [{ declaration: member.declaration, reason: member.result.reason }];
  });
  const hasCustomFailure = (aggregate.currentCustomRubrics ?? []).some((rubric) =>
    aggregate.customResults?.[rubric]?.result.kind === 'infrastructure-failure',
  );
  if (customJudged === 0 && !hasCustomFailure) return effective;
  const uncoveredCustomFailure = customFailures.length !== (aggregate.currentCustomRubrics ?? []).filter((rubric) =>
    aggregate.customResults?.[rubric]?.result.kind === 'infrastructure-failure',
  ).length || customFailures.some((member) => !matchesBuildReviewReducedCoverageDisposition(
    feature,
    { declaration: member.declaration, reason: member.reason },
    reducedCoverage,
  ));
  const unresolved = [...effective.unresolvedFindingIds];
  const suppressed = [...effective.suppressedFindingIds];
  const acceptedCustomFindingIds = new Set(Object.values(aggregate.customResults ?? {}).flatMap((member) =>
    member.result.kind !== 'judged' ? [] : member.result.findings.flatMap((finding) => {
      const identity = typeof finding === 'object' && finding !== null && 'identity' in finding
        ? rehydrateBuildReviewAcceptedRiskFinding((finding as { identity?: { canonicalPayload?: unknown } }).identity?.canonicalPayload)
        : undefined;
      return identity && matchesBuildReviewDisposition(feature, identity, dispositions) ? [identity.id] : [];
    }),
  ));
  for (const source of customSources) {
    if (acceptedCustomFindingIds.has(source.findingId)) continue;
    if (source.confidence !== undefined && source.confidence < (minConfidence[source.rubric] ?? 0)) suppressed.push(source.findingId);
    else unresolved.push(source.findingId);
  }
  const builtinJudged = Object.values(aggregate.results).filter((result) => result.kind === 'judged').length;
  return Object.freeze({
    ...effective,
    verdict: builtinJudged + customJudged > 0 && unresolved.length === 0 &&
      effective.uncoveredInfrastructureFailureRubrics.length === 0 &&
      (effective.uncoveredScopeIncompleteRubrics?.length ?? 0) === 0 && !uncoveredCustomFailure
      ? 'PASS'
      : 'FAIL',
    unresolvedFindingIds: Object.freeze(unresolved),
    acceptedFindingIds: Object.freeze([...new Set([...effective.acceptedFindingIds, ...acceptedCustomFindingIds])]),
    suppressedFindingIds: Object.freeze(suppressed),
  });
}

/**
 * The single built-in plus current-custom reduction. The live gate and the
 * operator findings command both call this, so neither can report a verdict
 * the other would not. `dispositions` is the full record list: built-in
 * acceptance is limited to testQuality here, custom acceptance matches by
 * rehydrated identity.
 */
export function deriveComposedBuildReviewEffectiveVerdict(
  aggregate: BuildReviewAggregate,
  feature: BuildReviewFeatureIdentity,
  dispositions: readonly import('./build-review-dispositions.js').BuildReviewDispositionRecord[],
  reducedCoverage: readonly import('./build-review-dispositions.js').BuildReviewReducedCoverageDispositionRecord[],
  minConfidence: Partial<Record<string, number>> = {},
): BuildReviewEffectiveVerdict | undefined {
  const builtinDispositions = dispositions.filter((record) => isRegisteredRubric(record.finding.canonicalPayload.rubric) && 'concernKind' in record.finding.canonicalPayload);
  const builtin = deriveEffectiveBuildReviewVerdictWithDispositions(aggregate, feature, builtinDispositions, reducedCoverage, minConfidence as Partial<Record<import('../types/config.js').BuildReviewRubricId, number>>);
  return builtin === undefined ? undefined : applyCurrentCustomEffectiveVerdict(
    aggregate, builtin, feature, reducedCoverage, dispositions, minConfidence,
  );
}

/**
 * Turns a linked-worktree path into the one identity used by both the CLI and
 * live build-review runner. A main checkout, nested path, or unresolved path
 * cannot accidentally consume another feature's accepted-risk state.
 */
export async function resolveBuildReviewFeatureIdentity(
  projectRoot: string,
  deps: Pick<BuildReviewEffectiveResolverDeps, 'resolveMainRoot' | 'realpath'> = {},
): Promise<BuildReviewFeatureIdentity | undefined> {
  try {
    const mainRoot = await (deps.resolveMainRoot ?? resolveMainRepoRoot)(projectRoot);
    const realpath = deps.realpath ?? realpathDefault;
    const [repository, worktree] = await Promise.all([realpath(mainRoot), realpath(projectRoot)]);
    const feature = relative(join(repository, '.worktrees'), worktree);
    if (!feature || feature === '.' || isAbsolute(feature) || feature === '..' || feature.startsWith(`..${sep}`) || feature.includes(sep)) {
      return undefined;
    }
    return { version: 'v1', repository, feature };
  } catch {
    return undefined;
  }
}

/**
 * The only live join of raw current-lap evidence and operator state. The
 * aggregate is validated before state is read; a state failure is a failed
 * review rather than an implicit absence of accepted findings.
 */
export async function resolveEffectiveBuildReviewVerdict(
  projectRoot: string,
  value: unknown,
  deps: BuildReviewEffectiveResolverDeps = {},
): Promise<BuildReviewEffectiveResolution> {
  const aggregate = parseBuildReviewAggregate(value);
  if (!aggregate) return { ok: false, reason: 'build-review aggregate is invalid' };
  const feature = await resolveBuildReviewFeatureIdentity(projectRoot, deps);
  if (!feature) return { ok: false, reason: 'build-review feature identity is unavailable' };
  let listed: BuildReviewDispositionListResult;
  let reducedCoverage: BuildReviewReducedCoverageListResult;
  try {
    const store = (deps.createStore ?? ((root: string) => new BuildReviewDispositionStore(root)))(projectRoot);
    listed = await store.list(feature);
    reducedCoverage = await store.listReducedCoverage(feature);
  } catch {
    return { ok: false, reason: 'build-review disposition state is unavailable' };
  }
  if (!listed.ok) return { ok: false, reason: `build-review disposition state is unavailable: ${listed.message}` };
  if (!reducedCoverage.ok) return { ok: false, reason: `build-review disposition state is unavailable: ${reducedCoverage.message}` };
  if (listed.records.some((record) => !sameFeature(record.feature, feature))) {
    return { ok: false, reason: 'build-review disposition state returned a foreign feature record' };
  }
  const dispositions = listed.records.filter((record) => {
    const rubric = record?.finding?.canonicalPayload?.rubric;
    if (!isRetiredBuildReviewRubric(rubric)) return true;
    deps.log?.(`ignored retired rubric record: ${rubric}`);
    return false;
  });
  const reducedCoverageRecords = reducedCoverage.records.filter((record) => {
    const rubric = record?.identity?.rubric;
    if (!isRetiredBuildReviewRubric(rubric)) return true;
    deps.log?.(`ignored retired rubric record: ${rubric}`);
    return false;
  });
  for (const record of dispositions) {
    const payload = record.finding.canonicalPayload;
    if (!('contractVersion' in payload)) continue;
    if (payload.contractVersion !== CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION) {
      await deps.emit?.({
        type: 'build_review_disposition_version_invalidated',
        feature: feature.feature,
        findingId: record.finding.id,
        rubric: record.finding.canonicalPayload.rubric,
        contractVersion: payload.contractVersion,
      });
    }
  }
  let effective: BuildReviewEffectiveVerdict | undefined;
  try {
    effective = deriveComposedBuildReviewEffectiveVerdict(aggregate, feature, dispositions, reducedCoverageRecords, deps.minConfidence ?? {});
  } catch {
    return { ok: false, reason: 'build-review disposition state is invalid' };
  }
  if (!effective) return { ok: false, reason: 'build-review disposition state cannot resolve current findings' };
  const renderedReducedCoverage = renderBuildReviewReducedCoverageEvidence({
    state: 'known',
    records: reducedCoverageRecords,
    currentFailures: [
      ...Object.values(aggregate.results).filter((result) => result.kind === 'infrastructure-failure'),
      ...aggregate.scopeIncomplete,
      ...(aggregate.currentCustomRubrics ?? []).flatMap((rubric) => {
        const member = aggregate.customResults?.[rubric];
        return member?.result.kind === 'infrastructure-failure' && member.declaration !== undefined
          ? [{ rubric, reason: member.result.reason, detail: member.result.detail, declaration: member.declaration }]
          : [];
      }),
    ],
  });
  if (!renderedReducedCoverage.ok) return { ok: false, reason: renderedReducedCoverage.message };
  return {
    ok: true,
    feature,
    effective,
    ...(renderedReducedCoverage.section === undefined ? {} : { reducedCoverageEvidence: renderedReducedCoverage.section }),
  };
}

export type { BuildReviewAggregate, BuildReviewEffectiveVerdict, BuildReviewDispositionRecord, BuildReviewFeatureIdentity };
