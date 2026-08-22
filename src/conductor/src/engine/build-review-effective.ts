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
  type BuildReviewDispositionListResult,
  type BuildReviewBeyondDispositionRecord,
  type BuildReviewDispositionRecord,
  type BuildReviewFeatureIdentity,
  type BuildReviewReducedCoverageListResult,
} from './build-review-dispositions.js';
import { CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION } from './build-review-domain.js';
import { resolveMainRepoRoot } from './park-marker.js';
import type { ConductorEvent } from '../types/events.js';
import { renderBuildReviewReducedCoverageEvidence } from './build-review-projections.js';

type DispositionStore = {
  list(feature: unknown): Promise<BuildReviewDispositionListResult>;
  listReducedCoverage(feature: unknown): Promise<BuildReviewReducedCoverageListResult>;
  listBeyond?(feature: unknown): Promise<{ ok: true; records: readonly BuildReviewBeyondDispositionRecord[] } | { ok: false; message: string }>;
};

export interface BuildReviewEffectiveResolverDeps {
  readonly resolveMainRoot?: (projectRoot: string) => Promise<string>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly createStore?: (projectRoot: string) => DispositionStore;
  /** Reports durable dispositions that no longer bind the current contract. */
  readonly emit?: (event: Extract<ConductorEvent, { type: 'build_review_disposition_version_invalidated' }>) => void | Promise<void>;
}

export type BuildReviewEffectiveResolution =
  | {
      readonly ok: true;
      readonly feature: BuildReviewFeatureIdentity;
      readonly effective: BuildReviewEffectiveVerdict;
      /** Exact shared section to stamp into the current lap artifact, if any. */
      readonly reducedCoverageEvidence?: string;
      readonly beyondEvidence?: string;
    }
  | { readonly ok: false; readonly reason: string };

function sameFeature(left: BuildReviewFeatureIdentity, right: BuildReviewFeatureIdentity): boolean {
  return left.version === right.version && left.repository === right.repository && left.feature === right.feature;
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
  let beyond: { ok: true; records: readonly BuildReviewBeyondDispositionRecord[] } | { ok: false; message: string };
  try {
    const store = (deps.createStore ?? ((root: string) => new BuildReviewDispositionStore(root)))(projectRoot);
    listed = await store.list(feature);
    reducedCoverage = await store.listReducedCoverage(feature);
    beyond = store.listBeyond ? await store.listBeyond(feature) : { ok: true, records: [] };
  } catch {
    return { ok: false, reason: 'build-review disposition state is unavailable' };
  }
  if (!listed.ok) return { ok: false, reason: `build-review disposition state is unavailable: ${listed.message}` };
  if (!reducedCoverage.ok) return { ok: false, reason: `build-review disposition state is unavailable: ${reducedCoverage.message}` };
  if (!beyond.ok) return { ok: false, reason: `build-review disposition state is unavailable: ${beyond.message}` };
  if (listed.records.some((record) => !sameFeature(record.feature, feature))) {
    return { ok: false, reason: 'build-review disposition state returned a foreign feature record' };
  }
  for (const record of listed.records) {
    if (record.finding.canonicalPayload.contractVersion !== CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION) {
      await deps.emit?.({
        type: 'build_review_disposition_version_invalidated',
        feature: feature.feature,
        findingId: record.finding.id,
        rubric: record.finding.canonicalPayload.rubric,
        contractVersion: record.finding.canonicalPayload.contractVersion,
      });
    }
  }
  let effective: BuildReviewEffectiveVerdict | undefined;
  try {
    effective = deriveEffectiveBuildReviewVerdictWithDispositions(aggregate, feature, listed.records, reducedCoverage.records);
  } catch {
    return { ok: false, reason: 'build-review disposition state is invalid' };
  }
  if (!effective) return { ok: false, reason: 'build-review disposition state cannot resolve current findings' };
  const renderedReducedCoverage = renderBuildReviewReducedCoverageEvidence({
    state: 'known',
    records: reducedCoverage.records,
    currentFailures: Object.values(aggregate.results).filter((result) => result.kind === 'infrastructure-failure'),
  });
  if (!renderedReducedCoverage.ok) return { ok: false, reason: renderedReducedCoverage.message };
  const beyondEvidence = beyond.records.length === 0 ? undefined : [
    '## Build-review findings beyond plan criteria',
    ...beyond.records.map((record) => `- ${record.findingId}: ${record.summary} (${record.issueUrl ?? record.status})`),
  ].join('\n');
  return {
    ok: true,
    feature,
    effective,
    ...(renderedReducedCoverage.section === undefined ? {} : { reducedCoverageEvidence: renderedReducedCoverage.section }),
    ...(beyondEvidence === undefined ? {} : { beyondEvidence }),
  };
}

export type { BuildReviewAggregate, BuildReviewEffectiveVerdict, BuildReviewDispositionRecord, BuildReviewFeatureIdentity };
