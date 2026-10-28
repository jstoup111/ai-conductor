import { readFile as readFileDefault, realpath as realpathDefault } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';

import { deriveEffectiveBuildReviewVerdictWithDispositions, parseBuildReviewAggregate, projectBuildReviewAggregateSources } from './build-review-aggregate.js';
import { BuildReviewDispositionStore, matchesBuildReviewReducedCoverageDisposition, rehydrateBuildReviewAcceptedRiskFinding, type BuildReviewDispositionAppendResult, type BuildReviewDispositionListResult, type BuildReviewDispositionRecord, type BuildReviewFeatureIdentity, type BuildReviewReducedCoverageAppendResult, type BuildReviewReducedCoverageListResult, type BuildReviewReducedCoverageDispositionRecord } from './build-review-dispositions.js';
import { canonicalizeBuildReviewFindingIdentity } from './build-review-finding-identity.js';
import { deriveBuildReviewScopeIncompleteFault, parseBuildReviewLapId, type BuildReviewInfrastructureFailureReason } from './build-review-domain.js';
import { buildReviewConfidenceFloors, buildReviewSeverityThresholds, resolveBuildReviewFeatureIdentity, resolveEffectiveBuildReviewVerdict } from './build-review-effective.js';
import type { BuildReviewCustomDeclaration, BuildReviewCustomInfrastructureFailureReason } from './build-review-artifacts.js';
import { BUILD_REVIEW_RECURRENCE_ATTEMPT_LIMIT, buildReviewRecurrenceLineage, currentBuildReviewSourceLinks, RemediationCaseStore, type RemediationCaseOutboxEntry, type RemediationCaseRecord, type RemediationCaseStoreReadResult } from './remediation-case-store.js';
import { resolveMainRepoRoot } from './park-marker.js';
import { resolveCliFeatureWorktree } from './cli-operator-authority.js';
import { appendCloseoutEvent, type BuildReviewExternalEvent } from './closeout-events.js';
import { MAX_MECHANICAL_FAULTS_BUILD_REVIEW, isUnreadableKickbackGate, readKickbackLedger, type KickbackGateEntry } from './kickback-ledger.js';
import { loadConfig as loadConfigDefault, type ConfigResult } from './config.js';
import { resolveBuildReviewConfig } from './resolved-config.js';
import type { BuildReviewRubricId } from '../types/config.js';
import { isRegisteredRubric } from './build-review-registry.js';
import { parseChildId, pipelinePathFor, type ChildId } from './child-context.js';

export interface BuildReviewFindingsCommand {
  readonly kind: 'findings';
  readonly feature: string;
  readonly child?: string;
  readonly format: 'human' | 'json';
}

export interface BuildReviewFindingsDeps {
  readonly cwd?: string;
  readonly resolveMainRoot?: (cwd: string) => Promise<string>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly readFile?: (path: string) => Promise<string>;
  /** Reads the exact diff named by a persisted lap scope for shared verdict resolution. */
  readonly readCurrentLapChangedFiles?: import('./build-review-effective.js').BuildReviewEffectiveResolverDeps['readCurrentLapChangedFiles'];
  readonly createStore?: (worktree: string) => DispositionStore;
  readonly createCaseStore?: (worktree: string, feature: BuildReviewFeatureIdentity, child?: ChildId) => RemediationCaseStoreReader;
  readonly readKickbackGateEntry?: (worktree: string, child?: ChildId) => Promise<Pick<KickbackGateEntry, 'mechanicalFaults' | 'lastMechanicalFault'> | undefined>;
  readonly readMechanicalFaults?: (worktree: string, child?: ChildId) => Promise<number | undefined>;
  readonly loadConfig?: (worktree: string) => Promise<ConfigResult>;
  readonly print?: (output: string) => void;
}

export interface BuildReviewAcceptCommand {
  readonly kind: 'accept';
  readonly feature: string;
  readonly lapId: string;
  readonly findingId: string;
  readonly rationale: string;
}

export interface BuildReviewRecordReducedCoverageCommand {
  readonly kind: 'record-reduced-coverage';
  readonly feature: string;
  readonly lapId: string;
  readonly rubric: string;
  readonly rationale: string;
}

export interface BuildReviewResolveCaseCommand {
  readonly kind: 'resolve-case';
  readonly feature: string;
  readonly caseId: string;
  readonly rationale: string;
  readonly child?: string;
}

type DispositionStore = {
  list(feature: unknown): Promise<BuildReviewDispositionListResult>;
  listReducedCoverage?(feature: unknown): Promise<BuildReviewReducedCoverageListResult>;
  append(input: Parameters<BuildReviewDispositionStore['append']>[0]): Promise<BuildReviewDispositionAppendResult>;
  appendIfCurrent?: BuildReviewDispositionStore['appendIfCurrent'];
};

type RemediationCaseStoreReader = {
  read(): Promise<RemediationCaseStoreReadResult>;
};

type RemediationCaseStoreResolver = {
  resolveByOperator(input: {
    readonly caseId: string;
    readonly operator: string;
    readonly rationale: string;
    readonly resolvedAt: string;
  }): ReturnType<RemediationCaseStore['resolveByOperator']>;
};

type ReducedCoverageDispositionStore = {
  appendReducedCoverageIfCurrent(input: Parameters<BuildReviewDispositionStore['appendReducedCoverageIfCurrent']>[0], validate: Parameters<BuildReviewDispositionStore['appendReducedCoverageIfCurrent']>[1]): Promise<BuildReviewReducedCoverageAppendResult>;
};

export interface BuildReviewAcceptDeps extends BuildReviewFindingsDeps {
  readonly isInteractive?: boolean;
  readonly resolveOperator?: () => string | undefined;
  readonly resolveRepository?: (root: string) => string | undefined;
  readonly createStore?: (worktree: string) => DispositionStore;
  /** Same-schema external-process event writer (exceptions A/B of the event spine). */
  readonly appendEvent?: (worktree: string, event: Extract<BuildReviewExternalEvent, { type: 'build_review_disposition_accepted' | 'build_review_disposition_refused' }>) => void;
}

export interface BuildReviewRecordReducedCoverageDeps extends Omit<BuildReviewFindingsDeps, 'createStore'> {
  readonly isInteractive?: boolean;
  readonly resolveOperator?: () => string | undefined;
  readonly createStore?: (worktree: string) => ReducedCoverageDispositionStore;
  readonly readMechanicalFaults?: (worktree: string) => Promise<number | undefined>;
  readonly appendEvent?: (worktree: string, event: Extract<BuildReviewExternalEvent, { type: 'build_review_reduced_coverage_accepted' | 'build_review_disposition_refused' }>) => void;
}

export interface BuildReviewResolveCaseDeps extends Pick<BuildReviewFindingsDeps, 'cwd' | 'resolveMainRoot' | 'realpath' | 'print'> {
  readonly isInteractive?: boolean;
  readonly resolveOperator?: () => string | undefined;
  readonly createCaseStore?: (worktree: string, feature: BuildReviewFeatureIdentity, child?: ChildId) => RemediationCaseStoreResolver;
  readonly now?: () => Date;
}

function isBuildReviewRubricId(value: string): value is BuildReviewRubricId {
  return isRegisteredRubric(value);
}

type AcceptedDisposition = {
  readonly findingId: string;
  readonly disposition: BuildReviewDispositionRecord;
};

type ExhaustedMechanicalFault = {
  readonly rubric: string;
  readonly cause: BuildReviewInfrastructureFailureReason | BuildReviewCustomInfrastructureFailureReason;
  readonly diagnostic: string;
};

type CurrentReducedCoverageFault = {
  readonly rubric: string;
  readonly cause: BuildReviewInfrastructureFailureReason | BuildReviewCustomInfrastructureFailureReason;
  readonly diagnostic: string;
  readonly declaration?: BuildReviewCustomDeclaration;
};

/** The closed faults an operator may cover after the existing allowance is exhausted. */
function reducedCoverageFault(result: NonNullable<ReturnType<typeof parseBuildReviewAggregate>>['results'][BuildReviewRubricId]): ExhaustedMechanicalFault | undefined {
  if (result.kind === 'infrastructure-failure') {
    return { rubric: result.rubric, cause: result.reason, diagnostic: result.detail };
  }
  const scopeFault = result.kind === 'judged' ? deriveBuildReviewScopeIncompleteFault(result) : undefined;
  return scopeFault && { rubric: scopeFault.rubric, cause: scopeFault.reason, diagnostic: scopeFault.detail };
}

/** Selects a reducible subject from validated, current aggregate state only. */
function currentReducedCoverageFault(
  aggregate: NonNullable<ReturnType<typeof parseBuildReviewAggregate>>,
  rubric: string,
): CurrentReducedCoverageFault | undefined {
  if (isBuildReviewRubricId(rubric)) return reducedCoverageFault(aggregate.results[rubric]);
  if (!aggregate.currentCustomRubrics?.includes(rubric)) return undefined;
  const member = aggregate.customResults?.[rubric];
  return member?.result.kind === 'infrastructure-failure' && member.declaration !== undefined
    ? { rubric, cause: member.result.reason, diagnostic: member.result.detail, declaration: member.declaration }
    : undefined;
}

type CurrentFinding = {
  readonly summary: string;
  readonly identity: NonNullable<ReturnType<typeof rehydrateBuildReviewAcceptedRiskFinding>>;
};

type AdvisoryFindingProjection = {
  readonly id: string;
  readonly rubric: string;
  readonly severity: import('./build-review-domain.js').BuildReviewSeverity;
  readonly threshold: import('./build-review-domain.js').BuildReviewSeverity;
  readonly origin: 'threshold' | 'adjudicated';
  readonly summary: string;
  /** The autonomous adjudicator's reasoning is local CLI evidence, never machine output. */
  readonly adjudicatorRationale?: string;
};

/**
 * The effective reducer identifies advisory and settled findings by id; this
 * projection restores their current source metadata without reopening either
 * source of truth.  Advisory cases are otherwise absent from
 * `advisoryFindingIds`, because their finalized ids are deliberately removed
 * from the actionable set before the CLI reports it.
 */
function advisoryFindings(
  aggregate: NonNullable<ReturnType<typeof parseBuildReviewAggregate>>,
  effective: NonNullable<ReturnType<typeof deriveEffectiveBuildReviewVerdictWithDispositions>>,
  cases: readonly RemediationCaseRecord[],
  thresholds: Partial<Record<string, import('./build-review-domain.js').BuildReviewSeverity>>,
): readonly AdvisoryFindingProjection[] | undefined {
  const sources = projectBuildReviewAggregateSources(aggregate);
  if (!sources) return undefined;
  const thresholdAdvisories = new Set(effective.advisoryFindingIds ?? []);
  const settled = new Set(effective.settledFindingIds ?? []);
  const adjudicated = new Map<string, {
    readonly severity: import('./build-review-domain.js').BuildReviewSeverity;
    readonly rationale: string;
  }>();
  for (const [sourceId, { record, link }] of currentBuildReviewSourceLinks(cases)) {
    if (record.disposition !== 'advisory' || record.adjudicatedSeverity === undefined ||
      (link.outcome !== 'advisory' && link.outcome !== 'merged')) continue;
    adjudicated.set(sourceId, { severity: record.adjudicatedSeverity, rationale: record.rationale });
  }
  const projected: AdvisoryFindingProjection[] = [];
  for (const source of sources) {
    const threshold = thresholds[source.rubric];
    if (thresholdAdvisories.has(source.findingId) && source.severity !== undefined && threshold !== undefined) {
      projected.push({ id: source.findingId, rubric: source.rubric, severity: source.severity, threshold, origin: 'threshold', summary: source.summary });
      continue;
    }
    const adjudicatedFinding = adjudicated.get(`${source.rubric}:${source.findingId}`);
    if (settled.has(source.findingId) && adjudicatedFinding !== undefined && threshold !== undefined) {
      projected.push({
        id: source.findingId, rubric: source.rubric, severity: adjudicatedFinding.severity, threshold, origin: 'adjudicated',
        summary: source.summary, adjudicatorRationale: adjudicatedFinding.rationale,
      });
    }
  }
  return Object.freeze(projected);
}

/** Adjudicator downgrades are local human evidence, never JSON output. */
function jsonCases(cases: readonly RemediationCaseRecord[]): readonly object[] {
  return cases.map((caseRecord) => {
    if (caseRecord.disposition !== 'advisory') return caseRecord;
    const { rationale: _rationale, ...projected } = caseRecord;
    return projected;
  });
}

/** Rehydrates the stamped custom identity rather than accepting a CLI supplied payload. */
function currentFindings(aggregate: NonNullable<ReturnType<typeof parseBuildReviewAggregate>>): readonly CurrentFinding[] {
  const builtin = Object.values(aggregate.results).flatMap((result) => result.kind === 'judged'
    ? result.findings.flatMap((finding) => {
      const identity = canonicalizeBuildReviewFindingIdentity({
        rubric: result.rubric, contractVersion: result.contractVersion, concernKind: finding.concernKind, anchor: finding.anchor,
      });
      return identity ? [{ summary: finding.summary, identity }] : [];
    })
    : []);
  const custom = (aggregate.currentCustomRubrics ?? []).flatMap((rubric) => {
    const result = aggregate.customResults?.[rubric]?.result;
    if (result?.kind !== 'judged') return [];
    return result.findings.flatMap((finding) => {
      const value = typeof finding === 'object' && finding !== null && !Array.isArray(finding)
        ? finding as Record<string, unknown>
        : undefined;
      const identity = rehydrateBuildReviewAcceptedRiskFinding(
        typeof value?.identity === 'object' && value.identity !== null
          ? (value.identity as Record<string, unknown>).canonicalPayload
          : undefined,
      );
      return identity && typeof value?.summary === 'string' && value.summary.length > 0
        ? [{ summary: value.summary, identity }]
        : [];
    });
  });
  return [...builtin, ...custom];
}

/** Deterministic refusals are terminal; other mechanical faults become terminal only after exhaustion. */
function exhaustedMechanicalFaults(
  aggregate: NonNullable<ReturnType<typeof parseBuildReviewAggregate>>,
  mechanicalFaults: number,
): readonly ExhaustedMechanicalFault[] {
  const builtin = Object.values(aggregate.results).flatMap((result) => {
    const fault = reducedCoverageFault(result);
    return fault && (fault.cause === 'projection-oversized' || fault.cause === 'read-only-review-unavailable' || mechanicalFaults >= MAX_MECHANICAL_FAULTS_BUILD_REVIEW)
      ? [fault]
      : [];
  });
  const custom = (aggregate.currentCustomRubrics ?? []).flatMap((rubric): ExhaustedMechanicalFault[] => {
    const result = aggregate.customResults?.[rubric]?.result;
    return result?.kind === 'infrastructure-failure'
      && (result.reason === 'projection-oversized' || result.reason === 'read-only-review-unavailable' || mechanicalFaults >= MAX_MECHANICAL_FAULTS_BUILD_REVIEW)
      ? [{ rubric, cause: result.reason, diagnostic: result.detail }]
      : [];
  });
  return [...builtin, ...custom];
}

function acceptedDispositions(
  aggregate: NonNullable<ReturnType<typeof parseBuildReviewAggregate>>,
  feature: BuildReviewFeatureIdentity,
  effective: NonNullable<ReturnType<typeof deriveEffectiveBuildReviewVerdictWithDispositions>>,
  records: readonly BuildReviewDispositionRecord[],
): readonly AcceptedDisposition[] {
  const identities = new Map<string, NonNullable<ReturnType<typeof rehydrateBuildReviewAcceptedRiskFinding>>>();
  for (const result of Object.values(aggregate.results)) {
    if (result.kind !== 'judged') continue;
    for (const finding of result.findings) {
      const identity = canonicalizeBuildReviewFindingIdentity({
        rubric: result.rubric, contractVersion: result.contractVersion, concernKind: finding.concernKind, anchor: finding.anchor,
      });
      if (identity) identities.set(identity.id, identity);
    }
  }
  for (const member of Object.values(aggregate.customResults ?? {})) {
    if (member.result.kind !== 'judged') continue;
    for (const finding of member.result.findings) {
      const identity = typeof finding === 'object' && finding !== null && 'identity' in finding
        ? rehydrateBuildReviewAcceptedRiskFinding((finding as { identity?: { canonicalPayload?: unknown } }).identity?.canonicalPayload)
        : undefined;
      if (identity) identities.set(identity.id, identity);
    }
  }
  return effective.acceptedFindingIds.flatMap((findingId) => {
    const identity = identities.get(findingId);
    const disposition = identity && records.find((record) =>
      record.feature.version === feature.version && record.feature.repository === feature.repository && record.feature.feature === feature.feature &&
      record.finding.id === identity.id && record.finding.canonicalJson === identity.canonicalJson,
    );
    return disposition ? [{ findingId, disposition }] : [];
  });
}

function renderCase(caseRecord: RemediationCaseRecord, cases: readonly RemediationCaseRecord[]): string {
  const effect = caseRecord.effect.kind === 'none'
    ? 'none'
    : `${caseRecord.effect.kind}/${caseRecord.effect.status}`;
  const assertions = caseRecord.refutation?.assertions
    .map((assertion) => `${assertion.assertion} (${assertion.verdict})`).join('; ') ?? 'none';
  const distinctFrom = caseRecord.distinctFrom?.map(({ caseId, reason }) => `distinct from ${caseId}: ${reason}`) ?? [];
  const recurrence = caseRecord.recurrenceOf === undefined ? [] : (() => {
    const lineage = buildReviewRecurrenceLineage(cases, [caseRecord.id]);
    return [`recurs from ${caseRecord.recurrenceOf.join(', ')}; ${lineage.appliedAttempts} of ${BUILD_REVIEW_RECURRENCE_ATTEMPT_LIMIT} applied attempts`];
  })();
  const declaredDistinct = cases.flatMap((other) => other.distinctFrom
    ?.filter(({ caseId }) => caseId === caseRecord.id)
    .map(({ reason }) => `declared distinct by ${other.id}: ${reason}`) ?? []);
  return [
    `Autonomous case outcome: ${caseRecord.id}; disposition: ${caseRecord.disposition}; resolution: ${caseRecord.resolution}; source ids: ${caseRecord.sources.map((source) => source.sourceId).join(', ') || 'none'}; effect: ${effect}; claim: ${caseRecord.refutation?.claim ?? 'none'}; assertions: ${assertions}; rationale: ${caseRecord.rationale}`,
    ...distinctFrom,
    ...recurrence,
    ...declaredDistinct,
  ].join('\n');
}

type CarriedSourceFinding = {
  readonly sourceId: string;
  readonly caseId: string;
  readonly originSourceIds: readonly string[];
  readonly originLapIds: readonly string[];
  readonly originDispositions: readonly {
    readonly sourceId: string;
    readonly lapId: string;
    readonly operator?: string;
    readonly rationale?: string;
  }[];
};

type OperatorResolvedCaseFinding = {
  readonly caseId: string;
  readonly sourceIds: readonly string[];
  readonly operator: string;
  readonly rationale: string;
  readonly resolvedAt: string;
};

function findingIdForSource(sourceId: string): string | undefined {
  const delimiter = sourceId.indexOf(':');
  return delimiter < 1 || delimiter === sourceId.length - 1 ? undefined : sourceId.slice(delimiter + 1);
}

function carriedSourceFindings(
  cases: readonly RemediationCaseRecord[],
  records: readonly BuildReviewDispositionRecord[],
): readonly CarriedSourceFinding[] {
  return cases.flatMap((caseRecord) => caseRecord.sources
    .filter((source) => source.outcome === 'carried')
    .map((source) => {
      const origins = caseRecord.operatorAcceptance?.origins ?? [];
      return {
        sourceId: source.sourceId,
        caseId: caseRecord.id,
        originSourceIds: origins.map((origin) => origin.sourceId),
        originLapIds: origins.map((origin) => origin.lapId),
        originDispositions: origins.map((origin) => {
          const findingId = findingIdForSource(origin.sourceId);
          const disposition = findingId === undefined
            ? undefined
            : records.find((record) => `${record.finding.canonicalPayload.rubric}:${record.finding.id}` === origin.sourceId);
          return {
            sourceId: origin.sourceId,
            lapId: origin.lapId,
            ...(disposition === undefined ? {} : { operator: disposition.operator, rationale: disposition.rationale }),
          };
        }),
      };
    }));
}

function operatorResolvedCaseFindings(cases: readonly RemediationCaseRecord[]): readonly OperatorResolvedCaseFinding[] {
  return cases.flatMap((caseRecord) => caseRecord.operatorResolution === undefined
    ? []
    : [{
      caseId: caseRecord.id,
      sourceIds: caseRecord.sources.map((source) => source.sourceId),
      operator: caseRecord.operatorResolution.operator,
      rationale: caseRecord.operatorResolution.rationale,
      resolvedAt: caseRecord.operatorResolution.resolvedAt,
    }]);
}

function renderHuman(feature: string, aggregate: NonNullable<ReturnType<typeof parseBuildReviewAggregate>>, effective: NonNullable<ReturnType<typeof deriveEffectiveBuildReviewVerdictWithDispositions>>, accepted: readonly AcceptedDisposition[], cases: readonly RemediationCaseRecord[], advisories: readonly AdvisoryFindingProjection[], carriedSources: readonly CarriedSourceFinding[], operatorResolvedCases: readonly OperatorResolvedCaseFinding[], pendingOutbox: readonly RemediationCaseOutboxEntry[], faults: readonly ExhaustedMechanicalFault[], lastMechanicalFault: KickbackGateEntry['lastMechanicalFault']): string {
  return [
    `Build review findings: ${feature}`,
    `Lap: ${aggregate.lapId}`,
    `Raw verdict: ${effective.rawVerdict}`,
    `Effective verdict: ${effective.verdict}`,
    `Accepted findings: ${effective.acceptedFindingIds.join(', ') || 'none'}`,
    `Operator dispositions: ${accepted.length === 0 ? 'none' : ''}`,
    ...accepted.map(({ findingId, disposition }) => `Accepted disposition: ${findingId} (lap ${disposition.sourceLapId}; operator ${disposition.operator}; rationale: ${disposition.rationale})`),
    ...carriedSources.map((source) => `Carried source: ${source.sourceId}; case: ${source.caseId}; origin source ids: ${source.originSourceIds.join(', ') || 'none'}; origin laps: ${source.originLapIds.join(', ') || 'none'}; origin dispositions: ${source.originDispositions.map((origin) => `${origin.operator ?? 'unavailable'} (${origin.rationale ?? 'unavailable'})`).join(', ') || 'none'}`),
    ...operatorResolvedCases.map((caseRecord) => `Operator-resolved case: ${caseRecord.caseId}; source ids: ${caseRecord.sourceIds.join(', ') || 'none'}; operator: ${caseRecord.operator}; rationale: ${caseRecord.rationale}; resolved at: ${caseRecord.resolvedAt}`),
    ...pendingOutbox.map((entry) => `Pending case-store outbox entry: ${entry.eventId}; occurred at: ${entry.occurredAt}; event: ${entry.event.type}`),
    `Autonomous case outcomes: ${cases.length === 0 ? 'none' : ''}`,
    ...cases.map((caseRecord) => renderCase(caseRecord, cases)),
    `Unresolved findings: ${effective.unresolvedFindingIds.join(', ') || 'none'}`,
    `Out-of-delta findings: ${effective.outOfDeltaFindingIds?.join(', ') || 'none'}`,
    `Advisory build-review findings: ${advisories.length === 0 ? 'none' : ''}`,
    ...advisories.map((advisory) => `Advisory finding: ${advisory.id}; rubric: ${advisory.rubric}; severity: ${advisory.severity}; summary: ${advisory.summary}${advisory.adjudicatorRationale === undefined ? '' : `; adjudicator rationale: ${advisory.adjudicatorRationale}`}`),
    `Skipped rubrics: ${effective.skippedRubrics.join(', ') || 'none'}`,
    `Infrastructure failures: ${effective.infrastructureFailureRubrics.join(', ') || 'none'}`,
    ...(lastMechanicalFault === undefined ? [] : [
      `Last mechanical fault: ${lastMechanicalFault.rubric}; cause: ${lastMechanicalFault.reason}; lap: ${lastMechanicalFault.lapId}; diagnostic: ${lastMechanicalFault.detail}`,
    ]),
    ...(faults.length === 0 ? [] : [
      ...(effective.unresolvedFindingIds.length === 0 ? ['Blocked by exhausted mechanical faults, not unresolved findings.'] : []),
      ...faults.map((fault) => `Exhausted mechanical fault: ${fault.rubric}; cause: ${fault.cause}; diagnostic: ${fault.diagnostic}`),
    ]),
  ].join('\n');
}

type ResolvedCliFeature = {
  readonly worktree: string;
  readonly feature: BuildReviewFeatureIdentity;
};

/** Reads the root or selected child's aggregate through the one path constructor. */
async function readCliBuildReviewAggregate(
  worktree: string,
  child: ChildId | undefined,
  readFile: (path: string) => Promise<string>,
): Promise<ReturnType<typeof parseBuildReviewAggregate>> {
  return parseBuildReviewAggregate(JSON.parse(await readFile(pipelinePathFor(worktree, 'build-review.json', child))));
}

async function resolveCliMinConfidence(
  worktree: string,
  deps: Pick<BuildReviewFindingsDeps, 'loadConfig'>,
): Promise<Partial<Record<string, number>>> {
  const loaded = await (deps.loadConfig ?? loadConfigDefault)(worktree);
  if (!loaded.ok) throw new Error(loaded.error.message);
  return buildReviewConfidenceFloors(resolveBuildReviewConfig(loaded.config));
}
async function resolveCliMinSeverity(worktree: string, deps: Pick<BuildReviewFindingsDeps, 'loadConfig'>): Promise<Partial<Record<string, import('./build-review-domain.js').BuildReviewSeverity>>> {
  const loaded = await (deps.loadConfig ?? loadConfigDefault)(worktree);
  if (!loaded.ok) throw new Error(loaded.error.message);
  return buildReviewSeverityThresholds(resolveBuildReviewConfig(loaded.config));
}

/** The CLI and live runner must address the same canonical feature state. */
async function resolveCliFeature(
  command: Pick<BuildReviewFindingsCommand, 'feature'>,
  deps: Pick<BuildReviewFindingsDeps, 'cwd' | 'resolveMainRoot' | 'realpath'>,
): Promise<ResolvedCliFeature | undefined> {
  try {
    const resolveMainRoot = deps.resolveMainRoot ?? resolveMainRepoRoot;
    const realpath = deps.realpath ?? realpathDefault;
    // The shared named-worktree resolution every operator command uses
    // (adr-2026-08-29 D3: factored into a shared module rather than copied).
    const worktree = await resolveCliFeatureWorktree(command.feature, {
      cwd: deps.cwd,
      resolveMainRoot: deps.resolveMainRoot,
      realpath: deps.realpath,
      // `resolveBuildReviewFeatureIdentity` below is this command's existence
      // proof; a separate stat would reject an injected resolution seam.
      verifyDirectory: false,
    });
    if (!worktree) return undefined;
    const feature = await resolveBuildReviewFeatureIdentity(worktree, { resolveMainRoot, realpath });
    return feature?.feature === command.feature ? { worktree, feature } : undefined;
  } catch {
    return undefined;
  }
}

/** Read only current feature artifacts; this deliberately never constructs a pipeline or state lease. */
export async function dispatchBuildReviewFindings(command: BuildReviewFindingsCommand, deps: BuildReviewFindingsDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  try {
    const child = command.child === undefined ? undefined : parseChildId(command.child);
    if (command.child !== undefined && child === undefined) throw new Error('child scope is invalid');
    const resolved = await resolveCliFeature(command, deps);
    if (!resolved) throw new Error('feature identity is unavailable');
    const { worktree, feature } = resolved;
    const readFile = deps.readFile ?? ((path: string) => readFileDefault(path, 'utf8'));
    const aggregate = await readCliBuildReviewAggregate(worktree, child, readFile);
    if (!aggregate) throw new Error('aggregate is malformed');
    const store = (deps.createStore ?? ((projectRoot: string) => new BuildReviewDispositionStore(projectRoot)))(worktree);
    const listed = await store.list(feature);
    if (!listed.ok) throw new Error(listed.message);
    const records = listed.records;
    const caseStore = (deps.createCaseStore ?? ((projectRoot: string, caseFeature: BuildReviewFeatureIdentity, selectedChild?: ChildId) =>
      new RemediationCaseStore(projectRoot, caseFeature, { child: selectedChild })))(worktree, feature, child);
    const caseRead = await caseStore.read();
    if (!caseRead.ok) throw new Error(`remediation case store is ${caseRead.reason}`);
    const cases = caseRead.state.cases;
    const reducedCoverage = store.listReducedCoverage
      ? await store.listReducedCoverage(feature)
      : { ok: true as const, records: [] as BuildReviewReducedCoverageDispositionRecord[] };
    if (!reducedCoverage.ok) throw new Error(reducedCoverage.message);
    const minConfidence = await resolveCliMinConfidence(worktree, deps);
    const minSeverity = await resolveCliMinSeverity(worktree, deps);
    const gateEntry = deps.readKickbackGateEntry
      ? await deps.readKickbackGateEntry(worktree, child)
      : deps.readMechanicalFaults
        ? { mechanicalFaults: await deps.readMechanicalFaults(worktree, child) }
        : await (async () => {
          const ledger = await readKickbackLedger(worktree, child);
          if (isUnreadableKickbackGate(ledger, 'build_review')) {
            throw new Error("kickback ledger gate 'build_review' is unreadable");
          }
          return ledger.gates.build_review;
        })();
    // The shared resolver is the only reader that combines current-lap scope,
    // dispositions, and case settlement.  Keeping this command on that seam
    // prevents a findings report from disagreeing with the live gate.
    const loaded = await (deps.loadConfig ?? loadConfigDefault)(worktree);
    if (!loaded.ok) throw new Error(loaded.error.message);
    const resolution = await resolveEffectiveBuildReviewVerdict(worktree, aggregate, {
      resolveMainRoot: deps.resolveMainRoot,
      realpath: deps.realpath,
      createStore: () => ({
        list: async () => listed,
        listReducedCoverage: async () => reducedCoverage,
      }),
      createCaseStore: deps.createCaseStore,
      minConfidence,
      minSeverity,
      readFile,
      readCurrentLapChangedFiles: deps.readCurrentLapChangedFiles,
      child,
      adjudicationEnabled: resolveBuildReviewConfig(loaded.config).adjudication.enabled,
    });
    if (!resolution.ok) throw new Error(resolution.reason);
    const effective = resolution.effective;
    const accepted = acceptedDispositions(aggregate, feature, effective, records);
    const advisories = advisoryFindings(aggregate, effective, cases, minSeverity);
    if (advisories === undefined) throw new Error('current advisory findings are invalid');
    const carriedSources = carriedSourceFindings(cases, records);
    const operatorResolvedCases = operatorResolvedCaseFindings(cases);
    const pendingOutbox = caseRead.state.version === 'v3' ? caseRead.state.outbox : [];
    const faults = exhaustedMechanicalFaults(aggregate, gateEntry?.mechanicalFaults ?? 0);
    // Uncovered coverage projections are engine-routing-only. The operator
    // already sees coverage through the rendered failures and reduced-coverage
    // decisions, so keep this command's published machine contract byte-stable.
    const {
      uncoveredInfrastructureFailureRubrics: _uncoveredInfrastructure,
      uncoveredScopeIncompleteRubrics: _uncoveredScopeIncomplete,
      // Settlement is already published per case under `cases`.
      settledFindingIds: _settled,
      ...reported
    } = effective;
    const output = {
      feature: command.feature, lapId: aggregate.lapId, snapshotDigest: aggregate.snapshotDigest, ...reported, acceptedDispositions: accepted,
      cases: jsonCases(cases),
      ...(carriedSources.length === 0 ? {} : { carriedSources }),
      ...(operatorResolvedCases.length === 0 ? {} : { operatorResolvedCases }),
      ...(pendingOutbox.length === 0 ? {} : { pendingOutbox }),
      ...(advisories.length === 0 ? {} : { advisoryFindings: advisories.map(({ summary: _summary, adjudicatorRationale: _adjudicatorRationale, ...advisory }) => advisory) }),
      ...(gateEntry?.lastMechanicalFault === undefined ? {} : { lastMechanicalFault: gateEntry.lastMechanicalFault }),
      ...(faults.length > 0 ? { exhaustedMechanicalFaults: faults } : {}),
    };
    print(command.format === 'json' ? JSON.stringify(output) : renderHuman(command.feature, aggregate, effective, accepted, cases, advisories, carriedSources, operatorResolvedCases, pendingOutbox, faults, gateEntry?.lastMechanicalFault));
    return 0;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('remediation case store is ')) {
      print(`build-review findings: ${error.message} for '${command.feature}'.`);
      return 1;
    }
    print(`build-review findings: current feature state is invalid or unavailable for '${command.feature}'.`);
    return 1;
  }
}

/**
 * Accept a single current finding. The TTY and machine-user checks happen
 * before any artifact or store access: provider children and piped scripts
 * cannot turn CLI arguments into an operator disposition.
 */
export async function dispatchBuildReviewAccept(command: BuildReviewAcceptCommand, deps: BuildReviewAcceptDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  // Resolve the feature-owned external-event target before validating any
  // mutable review state. Every refusal can then be observed through the
  // existing same-schema writer, including argument and TTY failures.
  const resolved = await resolveCliFeature(command, deps).catch(() => undefined);
  if (!resolved) {
    print(`build-review accept: refused for '${command.feature}'; the feature worktree could not be resolved.`);
    return 1;
  }
  const { worktree, feature } = resolved;
  const refuse = (reason: string, message: string): number => {
    try {
      (deps.appendEvent ?? appendCloseoutEvent)(worktree, {
        type: 'build_review_disposition_refused', feature: command.feature, reason, ts: new Date().toISOString(),
      });
    } catch {
      // The refusal remains authoritative when best-effort external telemetry cannot append.
    }
    print(message);
    return 1;
  };
  const operator = (deps.resolveOperator ?? (() => userInfo().username))();
  if (!(deps.isInteractive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)) || !operator?.trim()) {
    return refuse('non-interactive-or-unidentified-operator', 'build-review accept: requires an interactive terminal and a verified local operator identity.');
  }
  const requestedLap = parseBuildReviewLapId(command.lapId);
  if (!requestedLap || !command.rationale.trim()) {
    return refuse('invalid-lap-or-blank-rationale', 'build-review accept: requires an exact current lap and non-empty rationale.');
  }
  const readFile = deps.readFile ?? ((path: string) => readFileDefault(path, 'utf8'));
  const readAggregate = async (): Promise<ReturnType<typeof parseBuildReviewAggregate>> => {
    try {
      return parseBuildReviewAggregate(JSON.parse(await readFile(join(worktree, '.pipeline/build-review.json'))));
    } catch {
      return undefined;
    }
  };
  // Each precondition refuses under its own reason. A single catch-all made a
  // stale lap, an unknown finding id, and a store rejection indistinguishable
  // to the operator reading the refusal (#1769).
  const aggregate = await readAggregate();
  if (!aggregate) {
    return refuse('aggregate-unreadable', `build-review accept: refused for '${command.feature}'; the current build-review aggregate is missing or malformed.`);
  }
  if (aggregate.lapId !== requestedLap) {
    return refuse('requested-lap-not-current', `build-review accept: refused for '${command.feature}'; lap '${command.lapId}' is not the current lap ('${aggregate.lapId}').`);
  }
  const currentFinding = currentFindings(aggregate).find((candidate) => candidate.identity.id === command.findingId);
  if (!currentFinding?.identity) {
    return refuse('finding-not-current', `build-review accept: refused for '${command.feature}'; '${command.findingId}' is not a current judged finding on lap '${aggregate.lapId}'.`);
  }
  const identity = currentFinding.identity;
  try {
    const minConfidence = await resolveCliMinConfidence(worktree, deps);
    const store = (deps.createStore ?? ((projectRoot: string) => new BuildReviewDispositionStore(projectRoot)))(worktree);
    const appendInput = { feature, finding: identity, sourceLapId: requestedLap, summary: currentFinding.summary, rationale: command.rationale.trim(), operator: operator.trim() };
    const unchanged = async (): Promise<boolean> => {
      const current = await readAggregate();
      return current !== undefined && current.lapId === requestedLap && current.snapshotDigest === aggregate.snapshotDigest &&
        JSON.stringify(current.results) === JSON.stringify(aggregate.results) &&
        JSON.stringify(current.customResults) === JSON.stringify(aggregate.customResults) &&
        JSON.stringify(current.currentCustomRubrics) === JSON.stringify(aggregate.currentCustomRubrics);
    };
    const appended = store.appendIfCurrent
      ? await store.appendIfCurrent(appendInput, async (records) => {
        if (!await unchanged()) return false;
        const effective = deriveEffectiveBuildReviewVerdictWithDispositions(aggregate, feature, records, [], minConfidence);
        return isRegisteredRubric(identity.canonicalPayload.rubric) && 'concernKind' in identity.canonicalPayload
          ? effective?.unresolvedFindingIds.includes(identity.id) === true
          : !records.some((record) => record.finding.id === identity.id && record.finding.canonicalJson === identity.canonicalJson);
      })
      : await (async () => {
        const listed = await store.list(feature);
        if (!listed.ok) return listed;
        if (!await unchanged()) {
          return { ok: false as const, kind: 'invalid' as const, message: 'current review lap changed while waiting for disposition state' };
        }
        const effective = deriveEffectiveBuildReviewVerdictWithDispositions(aggregate, feature, listed.records, [], minConfidence);
        const actionable = isRegisteredRubric(identity.canonicalPayload.rubric) && 'concernKind' in identity.canonicalPayload
          ? effective?.unresolvedFindingIds.includes(identity.id) === true
          : !listed.records.some((record) => record.finding.id === identity.id && record.finding.canonicalJson === identity.canonicalJson);
        if (!actionable) return { ok: false as const, kind: 'invalid' as const, message: 'finding is already accepted or not actionable' };
        return store.append(appendInput);
      })();
    if (!appended.ok) {
      return refuse(`disposition-store-${appended.kind}`, `build-review accept: refused for '${command.feature}'; the disposition store rejected the acceptance (${appended.kind}): ${appended.message}`);
    }
    try {
      (deps.appendEvent ?? appendCloseoutEvent)(worktree, {
        type: 'build_review_disposition_accepted', feature: command.feature, lapId: requestedLap, findingId: identity.id, operator: operator.trim(), ts: new Date().toISOString(),
      });
    } catch {
      // The disposition is already durable; best-effort telemetry must never
      // report a completed acceptance back to the operator as a refusal.
    }
    print(`build-review accept: accepted ${identity.id} for lap ${requestedLap}.`);
    return 0;
  } catch (error) {
    return refuse('disposition-store-unavailable', `build-review accept: refused for '${command.feature}'; the disposition store could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Resolve one open remediation case from an interactive operator terminal. */
export async function dispatchBuildReviewResolveCase(
  command: BuildReviewResolveCaseCommand,
  deps: BuildReviewResolveCaseDeps = {},
): Promise<number> {
  const print = deps.print ?? console.log;
  const operator = (deps.resolveOperator ?? (() => userInfo().username))();
  if (!(deps.isInteractive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)) || !operator?.trim()) {
    print('build-review resolve-case: requires an interactive terminal and a verified local operator identity.');
    return 1;
  }
  if (!command.rationale.trim()) {
    print('build-review resolve-case: requires a non-empty rationale.');
    return 1;
  }
  const child = command.child === undefined ? undefined : parseChildId(command.child);
  if (command.child !== undefined && child === undefined) {
    print(`build-review resolve-case: invalid child id '${command.child}'.`);
    return 1;
  }
  const resolved = await resolveCliFeature(command, deps).catch(() => undefined);
  if (!resolved) {
    print(`build-review resolve-case: refused for '${command.feature}'; the feature worktree could not be resolved (feature mismatch).`);
    return 1;
  }
  const { worktree, feature } = resolved;
  const caseStore = (deps.createCaseStore ?? ((projectRoot: string, caseFeature: BuildReviewFeatureIdentity, selectedChild?: ChildId) =>
    new RemediationCaseStore(projectRoot, caseFeature, { child: selectedChild })))(worktree, feature, child);
  const resolvedAt = (deps.now ?? (() => new Date()))().toISOString();
  const result = await caseStore.resolveByOperator({
    caseId: command.caseId,
    operator: operator.trim(),
    rationale: command.rationale.trim(),
    resolvedAt,
  });
  if (!result.ok) {
    const reason = result.reason === 'foreign-feature' ? 'feature mismatch' : result.reason;
    print(`build-review resolve-case: refused for '${command.feature}'; ${reason}.`);
    return 1;
  }
  if (result.value.kind === 'unknown-case') {
    print(`build-review resolve-case: refused; unknown case '${command.caseId}'.`);
    return 1;
  }
  if (result.value.kind === 'already-resolved') {
    print(`build-review resolve-case: refused; case '${command.caseId}' is already resolved.`);
    return 1;
  }
  print(`build-review resolve-case: resolved ${command.caseId}.`);
  return 0;
}

/**
 * Records an operator's reduced-coverage decision. Authority is checked
 * before reading the review aggregate or opening the disposition store.
 */
export async function dispatchBuildReviewRecordReducedCoverage(
  command: BuildReviewRecordReducedCoverageCommand,
  deps: BuildReviewRecordReducedCoverageDeps = {},
): Promise<number> {
  const print = deps.print ?? console.log;
  let worktree: string | undefined;
  let feature: BuildReviewFeatureIdentity | undefined;
  try {
    const resolved = await resolveCliFeature(command, deps);
    if (!resolved) throw new Error('feature identity is unavailable');
    worktree = resolved.worktree;
    feature = resolved.feature;
    const refuse = (reason: string, message: string): number => {
      try {
        (deps.appendEvent ?? appendCloseoutEvent)(worktree!, {
          type: 'build_review_disposition_refused', feature: command.feature, reason, ts: new Date().toISOString(),
        });
      } catch {
        // The refusal remains authoritative when best-effort telemetry cannot append.
      }
      print(message);
      return 1;
    };
    const operator = (deps.resolveOperator ?? (() => userInfo().username))();
    if (!(deps.isInteractive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)) || !operator?.trim()) {
      return refuse('non-interactive-or-unidentified-operator', 'build-review record-reduced-coverage: requires an interactive terminal and a verified local operator identity.');
    }
    const requestedLap = parseBuildReviewLapId(command.lapId);
    if (!requestedLap || !command.rationale.trim()) {
      return refuse('invalid-lap-or-blank-rationale', 'build-review record-reduced-coverage: requires an exact current lap and non-empty rationale.');
    }
    const rubric = command.rubric;
    const readFile = deps.readFile ?? ((path: string) => readFileDefault(path, 'utf8'));
    const aggregate = parseBuildReviewAggregate(JSON.parse(await readFile(join(worktree, '.pipeline/build-review.json'))));
    if (!aggregate || aggregate.lapId !== requestedLap) throw new Error('requested lap is not current');
    if (!isBuildReviewRubricId(rubric) && !aggregate.currentCustomRubrics?.includes(rubric)) {
      return refuse('unknown-rubric', `build-review record-reduced-coverage: '${rubric}' is not a known rubric on the current lap.`);
    }
    const fault = currentReducedCoverageFault(aggregate, rubric);
    if (!fault) {
      return refuse('rubric-not-reduced-coverage-fault', `build-review record-reduced-coverage: '${rubric}' has no current infrastructure failure or scope-incomplete fault.`);
    }
    if (!feature) throw new Error('feature identity is unavailable');
    let stateRefusal: string | undefined;
    const readMechanicalFaults = deps.readMechanicalFaults ?? (async (root: string) => {
      const ledger = await readKickbackLedger(root);
      if (isUnreadableKickbackGate(ledger, 'build_review')) {
        throw new Error("kickback ledger gate 'build_review' is unreadable");
      }
      return ledger.gates.build_review?.mechanicalFaults;
    });
    const input = fault.declaration === undefined
      ? { feature, rubric: fault.rubric as BuildReviewRubricId, reason: fault.cause as BuildReviewInfrastructureFailureReason, rationale: command.rationale.trim(), operator: operator.trim() }
      : { feature, declaration: fault.declaration, reason: fault.cause as BuildReviewCustomInfrastructureFailureReason, rationale: command.rationale.trim(), operator: operator.trim() };
    const appended = await (deps.createStore ?? ((projectRoot: string) => new BuildReviewDispositionStore(projectRoot)))(worktree).appendReducedCoverageIfCurrent(input, async (records) => {
      const current = parseBuildReviewAggregate(JSON.parse(await readFile(join(worktree!, '.pipeline/build-review.json'))));
      if (!current || current.lapId !== requestedLap || current.snapshotDigest !== aggregate.snapshotDigest || JSON.stringify(current.results) !== JSON.stringify(aggregate.results)) {
        stateRefusal = 'the inspected review lap changed';
        return false;
      }
      const currentFault = currentReducedCoverageFault(current, rubric);
      if (!currentFault || currentFault.cause !== fault.cause ||
        JSON.stringify(currentFault.declaration) !== JSON.stringify(fault.declaration)) {
        stateRefusal = `the current '${rubric}' reduced-coverage fault changed`;
        return false;
      }
      if (fault.cause !== 'projection-oversized' && fault.cause !== 'read-only-review-unavailable' && ((await readMechanicalFaults(worktree!)) ?? 0) < MAX_MECHANICAL_FAULTS_BUILD_REVIEW) {
        stateRefusal = 'the mechanical-fault allowance remains';
        return false;
      }
      const identity = fault.declaration === undefined
        ? { rubric: fault.rubric as BuildReviewRubricId, reason: fault.cause as BuildReviewInfrastructureFailureReason }
        : { declaration: fault.declaration, reason: fault.cause as BuildReviewCustomInfrastructureFailureReason };
      if (records.some((record) => matchesBuildReviewReducedCoverageDisposition(feature!, identity, [record]))) {
        stateRefusal = `reduced coverage is already recorded for '${rubric}'`;
        return false;
      }
      return true;
    });
    if (!appended.ok) {
      if (stateRefusal) return refuse('current-rubric-lap-or-state-invalid', `build-review record-reduced-coverage: refused because ${stateRefusal}.`);
      throw new Error(appended.message);
    }
    try {
      (deps.appendEvent ?? appendCloseoutEvent)(worktree, {
        type: 'build_review_reduced_coverage_accepted',
        feature: command.feature,
        lapId: requestedLap,
        rubric,
        reason: fault.cause,
        operator: operator.trim(),
        ts: new Date().toISOString(),
      });
    } catch {
      // The reduced-coverage decision is already durable; best-effort telemetry
      // must never turn a committed recovery into a reported refusal. Without
      // this local catch the outer handler reports failure while the record is
      // committed, and the retry the operator is told to make then refuses as a
      // duplicate — leaving the recovery action unusable. Mirrors the finding
      // acceptance path above.
    }
    print(`build-review record-reduced-coverage: recorded ${rubric} for lap ${requestedLap}.`);
    return 0;
  } catch {
    if (worktree) {
      try {
        (deps.appendEvent ?? appendCloseoutEvent)(worktree, {
          type: 'build_review_disposition_refused', feature: command.feature, reason: 'current-rubric-lap-or-state-invalid', ts: new Date().toISOString(),
        });
      } catch {
        // The refusal remains authoritative when best-effort telemetry cannot append.
      }
    }
    print(`build-review record-reduced-coverage: refused for '${command.feature}'; the current rubric, lap, or state could not be verified.`);
    return 1;
  }
}
