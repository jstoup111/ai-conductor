import { randomUUID } from 'node:crypto';

import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { resolveFeaturePlanPath } from './artifacts.js';
import { formatProviderExitFacts } from '../execution/provider-diagnostics.js';
import type { ProviderExitFacts } from '../execution/llm-provider.js';

import {
  assembleBuildReviewAdjudicationContext,
  buildReviewAdjudicationSourceId,
  describeBuildReviewAdjudicationContextStop,
  type BuildReviewAdjudicationPlanContract,
  type BuildReviewAdjudicationTaskStatus,
} from './build-review-adjudication-context.js';
import { planContractPointers, readActivePlanPath } from './remediation-context-pointers.js';
import { parsePlanTaskBodies, parsePlanTaskPaths, parsePlanTaskTitles } from './plan-task-parse.js';
import { parsePlanDependencyGraph } from './plan-dependencies.js';
import { canonicalizeBuildReviewFindingIdentity } from './build-review-finding-identity.js';
import { authorizeBuildReviewRemediationActionEffects, orderBuildReviewActionCases, reduceBuildReviewAdjudication, renderBuildReviewAdjudicationTrace, type BuildReviewMechanicalState } from './build-review-adjudication.js';
import { projectBuildReviewAggregateSources, type BuildReviewAggregate, type BuildReviewRawSourceProjection } from './build-review-aggregate.js';
import { persistBuildReviewSuppressions } from './build-review-suppression-history.js';
import { applyBuildReviewActionEffects, applyBuildReviewDeferralEffect, hasReservedOrFailedRemediationEffect, isBuildEligibleActionCase, isBuildReviewDecisionStop, persistBuildReviewDecisionStop, settleStrandedBuildReviewActionReservations, settleStrandedBuildReviewDeferralReservations, resolveAbsentFailedBuildReviewCases, STRANDED_ACTION_RESERVATION_DIAGNOSTIC, STRANDED_DEFERRAL_RESERVATION_DIAGNOSTIC } from './remediation-case-effects.js';
import type { RemediationCaseJudgement } from './remediation-case-artifact.js';
import { classifyRemediationCaseReuse, reconcileRemediationCases, retireOpenBuildReviewCase, retiresOpenBuildReviewCase } from './remediation-case-reconciler.js';
import { resolveRefutationEvidence } from './remediation-refutation-evidence.js';
import { classifyBuildReviewDurableRead, publishBuildReviewWorkOrder, readBuildReviewWorkOrder, readBuildReviewWorkOrderAttemptedCaseIds, type BuildReviewWorkOrderTask } from './build-review-work-order.js';
import { appendRemediationCaseOutbox, BUILD_REVIEW_RECURRENCE_ATTEMPT_LIMIT, buildReviewRecurrenceLineage, buildReviewSeverityThresholdPolicies, classifyBuildReviewRecurrence, currentBuildReviewSourceLinks, drainRemediationCaseOutbox, finalizedBuildReviewSourceIds, RemediationCaseStore, type RemediationCaseOutboxEntry, type RemediationCaseRecord, type RemediationCaseSuppressionEntry, type RemediationCaseTransitionViolation } from './remediation-case-store.js';
import { classifyIndexOnlyAdmission, validateRemediationCaseGraph, type RemediationCaseGraph } from './remediation-case-validator.js';
import type { BuildReviewFeatureIdentity } from './build-review-dispositions.js';
import type { BumpKickbackGateInput, chargeBuildReviewEffectInLedger } from './kickback-ledger.js';
import type { EffectMarkerTrackerClient } from './tracker-client.js';
import type { RemediationCaseDeferralEffect } from './remediation-case-artifact.js';
import type { ConductorEvent } from '../types/events.js';
import type { ChildId } from './child-context.js';

type RemediationCaseLifecycleEvent = Extract<ConductorEvent, {
  type: 'remediation_adjudication_started' | 'remediation_adjudication_completed' | 'remediation_adjudication_failed'
    | 'remediation_case_reconciled' | 'remediation_effect_reserved' | 'remediation_effect_applied'
    | 'remediation_effect_failed' | 'remediation_semantic_repeat_halt' | 'remediation_case_refuted';
}>;

/**
 * A failed provider dispatch is distinct from a successful dispatch whose
 * persisted judgement cannot be read. Its fields are intentionally bounded so
 * provider output never reaches an operator-facing halt.
 */
export class RemediateDispatchError extends Error {
  constructor(
    readonly provider: string,
    readonly exitFacts?: ProviderExitFacts,
  ) {
    super('remediate dispatch failed');
    this.name = 'RemediateDispatchError';
  }
}

type OperatorRetirementTransition = {
  readonly caseId: string;
  readonly retiredEffect?: {
    readonly effectId: string;
    readonly effectKind: 'action' | 'deferral';
    readonly reason: 'retired: every source operator-accepted or no longer raised';
  };
};

/**
 * Selects the complete plan-task contracts which a remediation judgement may
 * admit, while retaining a compact index of every task in the active plan.
 *
 * Matching is deliberately path-exact and plan-text-only: callers normalize
 * evidence locations before this boundary, and no filesystem state is read.
 */
export function selectAdmittedTaskContracts(input: {
  readonly plan: string;
  readonly matchPaths: readonly string[];
  readonly openCaseAdmittedTaskIds: readonly string[];
}): {
  readonly admittedTaskContracts: readonly { readonly id: string; readonly contract: string }[];
  readonly index: readonly { readonly id: string; readonly title: string; readonly dependencies: readonly string[] }[];
} {
  const bodies = parsePlanTaskBodies(input.plan);
  const titles = parsePlanTaskTitles(input.plan);
  const paths = parsePlanTaskPaths(input.plan);
  const dependencies = parsePlanDependencyGraph(input.plan).dependenciesByTaskId;
  const matchPaths = new Set(input.matchPaths);
  const selectedIds = new Set(input.openCaseAdmittedTaskIds.filter((id) => bodies.has(id)));

  for (const [taskId, taskPaths] of paths) {
    if ([...taskPaths].some((path) => matchPaths.has(path))) selectedIds.add(taskId);
  }

  const taskIds = [...bodies.keys()].sort((left, right) => left.localeCompare(right));
  return {
    admittedTaskContracts: taskIds
      .filter((id) => selectedIds.has(id))
      .map((id) => ({ id, contract: bodies.get(id)! })),
    index: taskIds.map((id) => ({
      id,
      title: titles.get(id) ?? '',
      dependencies: dependencies.get(id) ?? [],
    })),
  };
}

export type BuildReviewAdjudicationCoordinatorResult =
  | { readonly ok: true; readonly route: 'pass' | 'build' | 'mechanical-retry' | 'halt'; readonly detail: string; readonly trace: string; readonly remainingMechanical: boolean;
      /** True only when every live source was settled or suppressed before dispatch (D5), so the judge was skipped. */
      readonly dispatchSkipped: boolean;
      /** Durable cases that make this settled-lap route inspectable to its consumer. */
      readonly durable: {
        readonly repairCaseIds: readonly string[];
        readonly decisionStops: readonly { readonly caseId: string; readonly owner?: 'product' | 'plan' | 'architecture'; readonly sourceIds: readonly string[]; readonly rationale: string }[];
      } }
  | { readonly ok: false; readonly detail: string };


/**
 * The case-v1 contract's plan evidence, sourced from the feature worktree.
 *
 * `skills/remediate/SKILL.md` tells the judge to decide admissibility from the
 * supplied `planContract` and to re-audit nothing, so the engine must supply it.
 * An unreadable or unbound plan states `path: null` rather than omitting the
 * field — an absent key would silently drop the case branch.
 */
async function sourcePlanContract(
  projectRoot: string,
  aggregate: BuildReviewAggregate,
  feature: BuildReviewFeatureIdentity,
): Promise<BuildReviewAdjudicationPlanContract> {
  // Engineer/daemon entries can begin at BUILD after DECIDE has already
  // completed, so engine-state has no activePlanPath yet.  Reuse the same
  // feature-scoped plan resolver that the conductor uses for remediation;
  // treating that established plan as absent would make every custom finding
  // unadjudicable despite a valid task-status contract.
  const path = await readActivePlanPath(projectRoot) ?? await resolveFeaturePlanPath(projectRoot, feature.feature);
  if (!path) return { path: null, pointers: [], admittedTaskContracts: [] };
  try {
    const plan = await readFile(isAbsolute(path) ? path : join(projectRoot, path), 'utf-8');
    const findings = Object.values(aggregate.results).flatMap((result) =>
      result.kind === 'judged' ? result.findings : [],
    );
    return {
      path,
      pointers: planContractPointers(findings, plan, path),
      admittedTaskContracts: [...parsePlanTaskBodies(plan).entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, contract]) => ({ id, contract })),
    };
  } catch {
    return { path: null, pointers: [], admittedTaskContracts: [] };
  }
}

function evidencePath(location: string): string {
  return location.replace(/:\d+(?:-\d+)?$/, '');
}

function matchPathsForSources(
  aggregate: BuildReviewAggregate,
  sources: readonly BuildReviewRawSourceProjection[],
): string[] {
  const paths = new Set(sources.flatMap((source) => source.evidenceLocations.map(evidencePath)));
  const sourceKeys = new Set(sources.map((source) => `${source.rubric}:${source.findingId}`));
  for (const [rubric, result] of Object.entries(aggregate.results)) {
    if (result.kind !== 'judged') continue;
    for (const finding of result.findings) {
      const identity = canonicalizeBuildReviewFindingIdentity({
        rubric, contractVersion: result.contractVersion, concernKind: finding.concernKind, anchor: finding.anchor,
      });
      if (identity && sourceKeys.has(`${rubric}:${identity.id}`)) paths.add(finding.anchor.locus.path);
    }
  }
  return [...paths];
}

async function scopedPlanContract(
  projectRoot: string,
  planContract: BuildReviewAdjudicationPlanContract,
  aggregate: BuildReviewAggregate,
  sources: readonly BuildReviewRawSourceProjection[],
  openCaseAdmittedTaskIds: readonly string[],
  expansionTaskIds: readonly string[] = [],
): Promise<BuildReviewAdjudicationPlanContract> {
  if (planContract.path === null) return { ...planContract, admittedTaskContracts: [], index: [] };
  try {
    const plan = await readFile(isAbsolute(planContract.path) ? planContract.path : join(projectRoot, planContract.path), 'utf8');
    const selected = selectAdmittedTaskContracts({
      plan,
      matchPaths: matchPathsForSources(aggregate, sources),
      openCaseAdmittedTaskIds: [...openCaseAdmittedTaskIds, ...expansionTaskIds],
    });
    return { path: planContract.path, pointers: planContract.pointers, ...selected };
  } catch {
    // The injected test seam supplies an already-scoped contract without a
    // worktree plan. Production obtains the text above and never takes this path.
    return { ...planContract, admittedTaskContracts: planContract.admittedTaskContracts ?? [], index: [] };
  }
}

/** Engine-supplied task-status evidence; an unreadable file states `path: null`. */
async function sourceTaskStatus(projectRoot: string): Promise<BuildReviewAdjudicationTaskStatus> {
  const path = '.pipeline/task-status.json';
  try {
    const parsed: unknown = JSON.parse(await readFile(join(projectRoot, path), 'utf-8'));
    const tasks = (parsed as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) return { path: null, tasks: [] };
    return {
      path,
      tasks: tasks.flatMap((task: unknown) => {
        const row = task as { id?: unknown; status?: unknown };
        return typeof row?.id === 'string' && typeof row?.status === 'string'
          ? [{ id: row.id, status: row.status }]
          : [];
      }),
    };
  } catch {
    return { path: null, tasks: [] };
  }
}

/**
 * Provider-facing work is deliberately a dependency. The coordinator owns all
 * identity, completeness, effects, and transition legality after that one
 * judgement returns.
 */
export interface BuildReviewAdjudicationCoordinatorInput {
  readonly projectRoot: string;
  readonly feature: BuildReviewFeatureIdentity;
  /** Child whose review lap owns this case history. */
  readonly child?: ChildId;
  readonly aggregate: BuildReviewAggregate;
  readonly operatorResolvedFindingIds: ReadonlySet<string>;
  /** Engine-owned sub-floor identities; never written to the operator store. */
  readonly suppressedFindingIds?: ReadonlySet<string>;
  /** Threshold-advisory findings are history, not remediate sources. */
  readonly advisoryFindingIds?: ReadonlySet<string>;
  readonly declaredSeverityThresholds?: Readonly<Partial<Record<string, import('./build-review-domain.js').BuildReviewSeverity>>>;
  readonly suppressions?: readonly RemediationCaseSuppressionEntry[];
  /** Re-reads the separate operator authority before every provider boundary. */
  readonly resolveOperatorResolvedFindingIds?: () => Promise<ReadonlySet<string>>;
  /**
   * The current disposition view is deliberately separate from current-lap
   * acceptance.  Origins normally belong to an earlier finding id, so asking
   * only whether today's findings are accepted would revoke a still-valid
   * acceptance on every re-raise.
   */
  readonly resolveEffectiveAcceptedSourceIds?: () => Promise<ReadonlySet<string>>;
  readonly mechanical: BuildReviewMechanicalState;
  /** A covered review fault is not evidence that absent sources disappeared. */
  readonly absenceRetirementMechanicallyHealthy?: boolean;
  readonly judge: (context: unknown) => Promise<RemediationCaseJudgement>;
  readonly chargeInput: BumpKickbackGateInput;
  /** Injectable only at the charge boundary; production retains the ledger adapter. */
  readonly chargeEffect?: typeof chargeBuildReviewEffectInLedger;
  readonly tracker?: EffectMarkerTrackerClient;
  readonly repo?: string;
  readonly fileIssue?: (input: { title: string; body: string; priority: 'critical' | 'high' | 'medium' | 'low' }) => Promise<{ issueUrl: string }>;
  /** Injected in tests; production sources both from the feature worktree. */
  readonly readPlanContract?: () => Promise<BuildReviewAdjudicationPlanContract>;
  readonly readTaskStatus?: () => Promise<BuildReviewAdjudicationTaskStatus>;
  readonly generateId?: () => string;
  readonly emit?: (event: RemediationCaseLifecycleEvent) => void | Promise<void>;
  /** Canonical event-spine delivery for durable outbox occurrences. */
  readonly emitOrThrow?: (event: ConductorEvent) => Promise<unknown>;
}

/**
 * The repairs a BUILD route carries: those covering a current source, else the
 * published work BUILD never attempted that the reducer routed on its own.
 */
function buildRouteRepairCaseIds(cases: readonly RemediationCaseRecord[], currentSourceSet: ReadonlySet<string>): string[] {
  const eligible = cases.filter(isBuildEligibleActionCase);
  const current = eligible.filter((record) => record.sources.some((source) => currentSourceSet.has(source.sourceId)));
  return (current.length > 0 ? current : eligible).map((record) => record.id);
}

function describeInvalidRemediationJudgement(
  reason: string,
  rejection?: { readonly indexOnlyTaskIds: readonly string[]; readonly absentTaskIds: readonly string[] },
): string {
  if (reason !== 'unknown-admission-task' || rejection === undefined) {
    return `invalid remediation judgement ${reason}`;
  }
  const details = [
    rejection.indexOnlyTaskIds.length === 0 ? undefined : `index-only task ids: ${rejection.indexOnlyTaskIds.join(', ')}`,
    rejection.absentTaskIds.length === 0 ? undefined : `absent from plan: ${rejection.absentTaskIds.join(', ')}`,
  ].filter((detail): detail is string => detail !== undefined);
  return details.length === 0
    ? `invalid remediation judgement ${reason}`
    : `invalid remediation judgement ${reason} (${details.join('; ')})`;
}

export async function coordinateBuildReviewAdjudication(input: BuildReviewAdjudicationCoordinatorInput): Promise<BuildReviewAdjudicationCoordinatorResult> {
  // Legacy direct coordinator callers did not carry the distinct signal. The
  // conductor always supplies it; retain the historical value for those tests
  // and integrations until they adopt the new boundary input.
  const absenceRetirementMechanicallyHealthy = input.absenceRetirementMechanicallyHealthy ?? input.mechanical === 'healthy';
  const store = new RemediationCaseStore(input.projectRoot, input.feature, {
    ...(input.child === undefined ? {} : { child: input.child }),
  });
  const drainOutbox = async (): Promise<void> => {
    if (input.emitOrThrow) await drainRemediationCaseOutbox(store, input.emitOrThrow);
    else if (input.emit) await drainRemediationCaseOutbox(store, async (event) => input.emit!(event as RemediationCaseLifecycleEvent));
  };
  await drainOutbox();
  const sources = projectBuildReviewAggregateSources(input.aggregate);
  if (!sources) {
    await drainOutbox();
    return { ok: false, detail: 'invalid raw aggregate source projection' };
  }
  const operatorResolvedFindingIds = async (): Promise<ReadonlySet<string>> =>
    input.resolveOperatorResolvedFindingIds ? input.resolveOperatorResolvedFindingIds() : input.operatorResolvedFindingIds;
  const effectiveAcceptedSourceIds = async (): Promise<ReadonlySet<string>> =>
    input.resolveEffectiveAcceptedSourceIds
      ? input.resolveEffectiveAcceptedSourceIds()
      : new Set(sources
        .filter((source) => input.operatorResolvedFindingIds.has(source.findingId))
        .map(buildReviewAdjudicationSourceId));
  /**
   * Whether operator authority now covers every current source.
   *
   * Deliberately a PREDICATE and not a route. It used to return a finished
   * result computed from `cases: []` — an answer derived from pretending no
   * durable case existed — and four separate exits used it to report a healthy
   * route while leftover work they never looked at stayed live. Answering the
   * question is this helper's whole job; choosing a route belongs to `finalize`,
   * which reads the store first.
   */
  const nonActionable = (findingId: string): boolean => input.suppressedFindingIds?.has(findingId) === true || input.advisoryFindingIds?.has(findingId) === true;
  const allOperatorResolved = (accepted: ReadonlySet<string>): boolean =>
    sources.every((source) => accepted.has(source.findingId) || nonActionable(source.findingId));
  /** Settlement is per rubric-namespaced SOURCE; see `finalizedBuildReviewSourceIds`. */
  const finalizedSourceIds = (cases: readonly RemediationCaseRecord[]) => finalizedBuildReviewSourceIds(cases, buildReviewSeverityThresholdPolicies(input.declaredSeverityThresholds ?? {}));
  const fail = async (
    detail: string,
    rejectedTransition?: RemediationCaseTransitionViolation,
  ): Promise<BuildReviewAdjudicationCoordinatorResult> => {
    await drainOutbox();
    await input.emit?.({
      type: 'remediation_adjudication_failed', domain: 'build_review', lapId: input.aggregate.lapId, reason: detail,
      ...(rejectedTransition === undefined ? {} : { rejectedTransition }),
    });
    await drainOutbox();
    return { ok: false, detail };
  };
  const failStore = async (
    prefix: string,
    failure: { readonly reason: string; readonly violation?: RemediationCaseTransitionViolation },
  ): Promise<BuildReviewAdjudicationCoordinatorResult> => {
    if (failure.reason === 'rejected-transition' && failure.violation !== undefined) {
      const { invariant, caseIds, sourceIds } = failure.violation;
      const feature = input.feature.feature;
      // ai-conductor:session-command-context=operator-only
      return fail(
        `case transition rejected: ${invariant} (cases ${caseIds.join(', ')}; sources ${sourceIds.join(', ')})\n` +
        'persisted case history is valid and unchanged\n' +
        `Inspect with ai-conductor build-review findings --feature ${feature}, then clear with ` +
        `ai-conductor halt clear --feature ${feature} --rationale "<why>" once the proposed transition is admissible ` +
        '(an engine admits it or a judgement no longer proposes it).',
        failure.violation,
      );
      // /ai-conductor:session-command-context
    }
    return fail(`${prefix} ${failure.reason}`);
  };
  const suppressionStore = new RemediationCaseStore(input.projectRoot, input.feature);
  // Not a second writer: the same seam the effective-verdict path already ran
  // for this lap. Its upsert is keyed by finding id, so re-running it here is a
  // no-op refresh rather than a duplicate row.
  const persisted = await persistBuildReviewSuppressions({
    projectRoot: input.projectRoot,
    feature: input.feature,
    suppressions: input.suppressions ?? [],
    store: suppressionStore,
  });
  if (!persisted.ok) return failStore('suppression store', persisted);
  const suppressionHistory = await suppressionStore.read();
  if (!suppressionHistory.ok) return failStore('suppression store', suppressionHistory);
  // A reservation an earlier lap never published can never be applied, and
  // the reducer halts on it every lap. Settle it before any exit routes from
  // the store. Only a mechanically complete lap's absence is evidence the
  // case's finding is gone; an operator-accepted source stays "live" here so
  // `finalize` retires it under operator attribution instead.
  if (input.mechanical === 'healthy') {
    const strandedLiveSourceIds = new Set(sources
      .filter((source) => !nonActionable(source.findingId))
      .map(buildReviewAdjudicationSourceId));
    const strandedSettlement = await settleStrandedBuildReviewActionReservations({
      store,
      liveSourceIds: strandedLiveSourceIds,
      mechanicallyHealthy: absenceRetirementMechanicallyHealthy,
      effectiveAcceptedSourceIds: await effectiveAcceptedSourceIds(),
      lapId: input.aggregate.lapId,
      readPublishedCaseIds: async (actionEffectIds) => {
        const order = await readBuildReviewWorkOrder(input.projectRoot, input.feature, actionEffectIds);
        if (order.ok) return new Set(order.workOrder.cases.map((row) => row.caseId));
        return classifyBuildReviewDurableRead(order) === 'absent' ? new Set() : undefined;
      },
    });
    if (!strandedSettlement.ok) return failStore('case store', strandedSettlement);
    await drainOutbox();
    for (const { caseId, effectId } of strandedSettlement.settled) {
      await input.emit?.({
        type: 'remediation_effect_failed', domain: 'build_review', lapId: input.aggregate.lapId,
        caseId, effectId, effectKind: 'action', reason: STRANDED_ACTION_RESERVATION_DIAGNOSTIC,
      });
    }
    const absentFailed = await resolveAbsentFailedBuildReviewCases({
      store, liveSourceIds: strandedLiveSourceIds, lapId: input.aggregate.lapId,
      mechanicallyHealthy: absenceRetirementMechanicallyHealthy,
    });
    if (!absentFailed.ok) return failStore('case store', absentFailed);
    await drainOutbox();
    const strandedDeferrals = await settleStrandedBuildReviewDeferralReservations({ store, liveSourceIds: strandedLiveSourceIds, lapId: input.aggregate.lapId });
    if (!strandedDeferrals.ok) return failStore('case store', strandedDeferrals);
    await drainOutbox();
    for (const { caseId, effectId } of strandedDeferrals.settled) {
      await input.emit?.({
        type: 'remediation_effect_failed', domain: 'build_review', lapId: input.aggregate.lapId,
        caseId, effectId, effectKind: 'deferral', reason: STRANDED_DEFERRAL_RESERVATION_DIAGNOSTIC,
      });
    }
  }
  // Before the judge is dispatched there is no frozen dispatch set, so live ids
  // are computed against the raw join. The two agree for every all-accepted lap,
  // and this is reassigned to the frozen set once one exists.
  let liveSourceIdsFor = (accepted: ReadonlySet<string>): ReadonlySet<string> =>
    new Set(sources.filter((source) => !accepted.has(source.findingId) && !nonActionable(source.findingId)).map(buildReviewAdjudicationSourceId));
  /**
   * The single terminal exit: settle durable state, then choose a route from
   * what actually survived.
   *
   * Every path that can leave this coordinator AFTER reconciliation has
   * persisted cases and reserved effects must come through here. An
   * all-operator-resolved shortcut that returned directly bypassed the only
   * neutralization path, so a lap could take its healthy route while leaving
   * accepted cases open and their reserved effects live — durable state that a
   * later BUILD entry would then replay.
   *
   * `republishWorkOrder` is false for that acceptance-terminal path: it applied
   * no action this lap, so it has no tasks to publish and must leave an
   * unrelated surviving case's existing order exactly as it found it.
   */
  const finalize = async (options: {
    readonly tasksByCaseId: ReadonlyMap<string, readonly { readonly title: string }[]>;
    readonly republishWorkOrder: boolean;
    /**
     * Supplied only by the acceptance-terminal path, which just read authority
     * and applies no effect before arriving here — so a second read could not
     * observe anything new, and charging one would be pure duplicate work.
     */
    readonly resolvedAtEntry?: ReadonlySet<string>;
    /**
     * Set by every exit taken BEFORE this lap's reconciliation ran. Those
     * exits used to skip the attempt-evidence read and the reconciler, so a
     * prior attempted action case absent from the current sources survived
     * open with an applied effect: the reducer answered PASS while BUILD
     * recovery still replayed its work order. Settling against the empty
     * admitted graph here resolves exactly that absent attempted history,
     * through the same reconciler and shared effect-status test the main
     * path uses.
     */
    readonly settleAbsentAttempted?: boolean;
    /** A delivered failure remains this lap's one terminal lifecycle event. */
    readonly terminalFailureEmitted?: boolean;
    /** Set only by the D5 exit: the judge was skipped because nothing live remained. */
    readonly dispatchSkipped?: boolean;
  }): Promise<BuildReviewAdjudicationCoordinatorResult> => {
    if (options.settleAbsentAttempted) {
      const exitAttemptEvidence = await readBuildReviewWorkOrderAttemptedCaseIds(input.projectRoot, input.feature);
      if (!exitAttemptEvidence.ok && classifyBuildReviewDurableRead(exitAttemptEvidence) === 'invalid') {
        return fail(`build-review work order ${exitAttemptEvidence.reason}`);
      }
      const absentSettled = await reconcileRemediationCases(store, {
        graph: { sourceOutcomes: [], cases: [] }, recordedAt: new Date().toISOString(),
        generateId: input.generateId ?? randomUUID,
        attemptedCaseIds: exitAttemptEvidence.ok ? exitAttemptEvidence.attemptedCaseIds : [],
        lapId: input.aggregate.lapId,
        effectiveAcceptedSourceIds: new Set(),
        mechanicallyHealthy: absenceRetirementMechanicallyHealthy,
        liveSourceIds: new Set(sources.map(buildReviewAdjudicationSourceId)),
        resolveAbsentOpenNonActionCases: true,
        allowAppliedByAbsence: true,
      });
      if (!absentSettled.ok) {
        return absentSettled.reason === 'store-failure'
          ? failStore('case store', { reason: absentSettled.storeReason, violation: absentSettled.violation })
          : fail(`case reconciliation ${absentSettled.reason}`);
      }
      await drainOutbox();
    }
    const settled = await store.read();
    if (!settled.ok) return failStore('case store', settled);
    // The settlement above awaited durable work, so even an entry snapshot
    // taken moments ago can be stale. Every terminal decision below derives
    // from an authority read that FOLLOWS the last awaited operation: settle
    // under the current read, and if a newer read shows more acceptances,
    // settle again (the retirement mutation is idempotent) before routing.
    let exitResolved: ReadonlySet<string>;
    try { exitResolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
    if (options.resolvedAtEntry) exitResolved = new Set([...options.resolvedAtEntry, ...exitResolved]);
    // Each additional round requires a strictly larger accepted set (`grew`),
    // and that set is a subset of the finite source list — itself bounded at
    // 512 by the aggregate projection — so one round per source plus the
    // initial round is the real settlement bound. The previous hard-coded 3
    // was unrelated to it: a lap that was still growing hit the cap, took the
    // terminal branch anyway, and routed from an exit set that predated the
    // acceptance it had just observed.
    const maxSettleRounds = sources.length + 1;
    let settleRounds = 0;
    let completedEmitted = false;
    const settledCases: RemediationCaseRecord[] = [];
    const settledRetirements: OperatorRetirementTransition[] = [];
    for (;;) {
    settleRounds += 1;
    const acceptedSourceIds = new Set(sources
      .filter((source) => exitResolved.has(source.findingId) && !nonActionable(source.findingId))
      .map(buildReviewAdjudicationSourceId));
    // Operator disposition remains its own authority. This leased mutation only
    // retires autonomous rows it covers, then keeps the published order bound to
    // a surviving applied action effect.
    const neutralized = await store.mutate<
      | {
        readonly ok: true;
        readonly cases: readonly RemediationCaseRecord[];
        readonly retirementTransitions: readonly OperatorRetirementTransition[];
      }
      | { readonly ok: false; readonly reason: string }
    >(async (state) => {
      const retirementTransitions: OperatorRetirementTransition[] = [];
      const retirementOutbox: RemediationCaseOutboxEntry[] = [];
      const cases = state.cases.map((record) => {
        const newOrigins = record.sources
          .filter((source) => acceptedSourceIds.has(source.sourceId) && source.outcome !== 'carried')
          .filter((source) => !record.operatorAcceptance?.origins.some((origin) => origin.sourceId === source.sourceId))
          .map((source) => ({ sourceId: source.sourceId, lapId: input.aggregate.lapId }));
        const withOrigins = newOrigins.length === 0
          ? record
          : {
            ...record,
            operatorAcceptance: {
              origins: [...(record.operatorAcceptance?.origins ?? []), ...newOrigins],
            },
          };
        if (!retiresOpenBuildReviewCase(withOrigins, {
          liveSourceIds: new Set(sources.map(buildReviewAdjudicationSourceId)),
          effectiveAcceptedSourceIds: acceptedSourceIds,
          mechanicallyHealthy: absenceRetirementMechanicallyHealthy,
        })) return withOrigins;
        const retired = retireOpenBuildReviewCase(withOrigins);
        const retiredEffect = retired.effect.kind !== 'none' && retired.effect.status === 'failed'
          && withOrigins.effect.kind !== 'none' && withOrigins.effect.status === 'reserved'
          ? { effectId: retired.effect.id, effectKind: retired.effect.kind, reason: 'retired: every source operator-accepted or no longer raised' as const }
          : undefined;
        retirementTransitions.push({ caseId: withOrigins.id, ...(retiredEffect ? { retiredEffect } : {}) });
        const eventId = randomUUID();
        retirementOutbox.push({ eventId, occurredAt: new Date().toISOString(), event: {
          type: 'remediation_case_reconciled', eventId, domain: 'build_review', lapId: input.aggregate.lapId,
          caseId: withOrigins.id, resolution: 'resolved',
        } });
        return retired;
      });
      const nextState = (): import('./remediation-case-store.js').RemediationCaseStoreState => {
        if (retirementOutbox.length === 0) return { ...state, cases };
        const upgraded = appendRemediationCaseOutbox(state, retirementOutbox[0]!);
        return { ...upgraded, cases, outbox: [...upgraded.outbox, ...retirementOutbox.slice(1)] };
      };
      const eligible = cases.filter(isBuildEligibleActionCase);
      if (eligible.length === 0 || !options.republishWorkOrder) {
        return { value: { ok: true as const, cases, retirementTransitions }, nextState: nextState() };
      }
      const workOrderCases = [] as Array<{ caseId: string; priority: 'critical' | 'high' | 'medium' | 'low'; tasks: readonly { readonly title: string }[] }>;
      for (const record of eligible) {
        const tasks = options.tasksByCaseId.get(record.id);
        if (!tasks || tasks.length === 0) {
          return { value: { ok: false as const, reason: `action case ${record.id} has no work-order tasks` } };
        }
        workOrderCases.push({ caseId: record.id, priority: record.priority, tasks });
      }
      const orderedCases = orderBuildReviewActionCases(workOrderCases);
      const primary = eligible.find((record) => record.id === orderedCases[0]!.caseId)!;
      const published = await publishBuildReviewWorkOrder(input.projectRoot, {
        version: 'v1', domain: 'build_review', feature: input.feature, effectId: primary.effect.id, cases: orderedCases,
      });
      if (!published.ok) return { value: { ok: false as const, reason: `work-order ${published.reason}` } };
      return { value: { ok: true as const, cases, retirementTransitions }, nextState: nextState() };
    });
    if (!neutralized.ok) return failStore('case store', neutralized);
    if (!neutralized.value.ok) return fail(neutralized.value.reason);
    await drainOutbox();
    settledCases.splice(0, settledCases.length, ...neutralized.value.cases);
    for (const retirement of neutralized.value.retirementTransitions) {
      settledRetirements.push(retirement);
      // This retirement is itself a durable reserved->failed transition, so it
      // emits unconditionally: operator acceptance changes who owns the
      // follow-up, never whether the durable failure occurred.
      if (retirement.retiredEffect) {
        await input.emit?.({
          type: 'remediation_effect_failed', domain: 'build_review', lapId: input.aggregate.lapId,
          caseId: retirement.caseId, ...retirement.retiredEffect,
        });
      }
    }
    // Adjacent to the exit: the mutation and the emissions above were awaited,
    // so read authority again. Anything newly accepted settles in one more
    // round; an unchanged read means this round's state is the routed state.
    let latest: ReadonlySet<string>;
    try { latest = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
    const grew = [...latest].some((findingId) => !exitResolved.has(findingId));
    if (!grew || settleRounds >= maxSettleRounds) {
      // Derive the exit set HERE rather than at the top of the round: this is
      // the read the route is taken from, so it can never predate the
      // authority the round just settled under.
      const exitSourceIds = [...liveSourceIdsFor(exitResolved)];
      const transition = reduceBuildReviewAdjudication({
        currentSourceIds: exitSourceIds,
        feature: input.feature.feature,
        child: input.child,
        cases: settledCases,
        mechanical: input.mechanical,
      });
      const currentSourceSet = new Set(exitSourceIds);
      const durable = {
        repairCaseIds: transition.route === 'build'
          ? buildRouteRepairCaseIds(settledCases, currentSourceSet)
          : [],
        decisionStops: settledCases.filter((record) => isBuildReviewDecisionStop(record) && record.sources.some((source) => currentSourceSet.has(source.sourceId)))
          .map((record) => ({
            caseId: record.id,
            ...(record.escalation === undefined ? {} : { owner: record.escalation.owner }),
            sourceIds: record.consistencyStop?.sourceIds ?? record.sources.map((source) => source.sourceId),
            rationale: record.consistencyStop?.rationale ?? record.rationale,
          })),
      };
      if (!completedEmitted && !options.terminalFailureEmitted) {
        completedEmitted = true;
        await input.emit?.({
          type: 'remediation_adjudication_completed', domain: 'build_review', lapId: input.aggregate.lapId,
          caseIds: settledCases.map((record) => record.id),
          effectIds: options.dispatchSkipped === true ? [] : settledCases.flatMap((record) => record.effect.kind === 'none' ? [] : [record.effect.id]),
          ...(durable.decisionStops.length === 0 ? {} : { decisionStops: durable.decisionStops }),
        });
      }
      // The completion emission is itself awaited, so it is one more window in
      // which an exact acceptance can land. Read authority after it: this is the
      // last act before the caller's terminal BUILD, HALT, or PASS, so nothing
      // separates the routed authority from the route. A grown read settles in
      // one more round (the emission is not repeated); the cap still bounds it.
      let atExit: ReadonlySet<string>;
      try { atExit = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
      if ([...atExit].some((findingId) => !exitResolved.has(findingId)) && settleRounds < maxSettleRounds) {
        exitResolved = new Set([...exitResolved, ...atExit]);
        continue;
      }
      await drainOutbox();
      return {
        ok: true, route: transition.route, detail: transition.reason,
        trace: `route: ${transition.route}\n${renderBuildReviewAdjudicationTrace(settledCases)}`,
        remainingMechanical: transition.remainingMechanical,
        dispatchSkipped: options.dispatchSkipped === true,
        durable,
      };
    }
    exitResolved = new Set([...exitResolved, ...latest]);
    }
  };
  /**
   * A content-specific failure that follows awaited work. The work may have
   * outlasted an exact operator acceptance, in which case the failure's HALT
   * would be obsolete: re-read authority once and, if every source is now
   * accepted, take the acceptance-terminal exit instead. Infrastructure
   * failures (unavailable disposition state, case store faults) never come
   * here — they fail closed regardless of authority.
   */
  const failUnlessAccepted = async (
    detail: string,
    options: {
      readonly settleAbsentAttempted: boolean;
      /**
       * A content failure can belong to one case while another source remains
       * autonomous. A delivery-window acceptance retires that failing case;
       * `finalize` then derives the surviving sibling's route.
       */
      readonly caseSourceIds?: readonly ReadonlySet<string>[];
    },
  ): Promise<BuildReviewAdjudicationCoordinatorResult> => {
    let latest: ReadonlySet<string>;
    try { latest = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
    if (allOperatorResolved(latest)) {
      return finalize({ tasksByCaseId: new Map(), republishWorkOrder: false, resolvedAtEntry: latest, settleAbsentAttempted: options.settleAbsentAttempted });
    }
    // `fail` AWAITS the failure emission, so delivery is one more window in
    // which an exact acceptance can land — and the caller writes its
    // needs-human HALT straight from this result with no read of its own.
    // Read authority once more after that await. The emitted failure stands
    // (the content failure did occur, exactly as a retired reserved effect
    // still emits its durable transition); only the obsolete HALT is avoided.
    const failed = await fail(detail);
    let afterDelivery: ReadonlySet<string>;
    try { afterDelivery = await operatorResolvedFindingIds(); } catch { return failed; }
    const liveAfterDelivery = liveSourceIdsFor(afterDelivery);
    const failingCaseWasAccepted = options.caseSourceIds
      ? options.caseSourceIds.some((sourceIds) => [...sourceIds].every((sourceId) => !liveAfterDelivery.has(sourceId)))
      : liveAfterDelivery.size === 0;
    if (failingCaseWasAccepted) {
      return finalize({
        tasksByCaseId: new Map(), republishWorkOrder: false,
        resolvedAtEntry: afterDelivery, settleAbsentAttempted: options.settleAbsentAttempted,
        terminalFailureEmitted: true,
      });
    }
    await drainOutbox();
    return failed;
  };
  let resolved: ReadonlySet<string>;
  try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
  // Operator authority is terminal for an all-resolved content lap, but it is
  // not evidence that nothing is outstanding: an earlier lap's case can still
  // be open with a live work order. Settle durable state and route from what
  // survives, rather than reporting a route no one checked.
  if (allOperatorResolved(resolved)) {
    return finalize({ tasksByCaseId: new Map(), republishWorkOrder: false, resolvedAtEntry: resolved, settleAbsentAttempted: true });
  }
  let currentSources = sources.filter((source) => !resolved.has(source.findingId) && !nonActionable(source.findingId));
  const prior = await store.read();
  if (!prior.ok) return failStore('case store', prior);
  // An exact source bound to a refutation with unfinished durable follow-up
  // is not new content for the judge. The reducer names that effect and
  // blocks PASS below.
  const unfinishedRefutedSourceIds = new Set(prior.state.cases.flatMap((record) =>
    record.disposition === 'refute' && hasReservedOrFailedRemediationEffect(record)
      ? record.sources.map((source) => source.sourceId)
      : [],
  ));
  // Durable BUILD-attempt evidence, read from the published work order rather
  // than process memory. Without it an attempted case is indistinguishable from
  // an interrupted one, so a repeat could take a second free route and an
  // absent repaired case could never resolve.
  const attemptEvidence = await readBuildReviewWorkOrderAttemptedCaseIds(input.projectRoot, input.feature);
  if (!attemptEvidence.ok && classifyBuildReviewDurableRead(attemptEvidence) === 'invalid') {
    return fail(`build-review work order ${attemptEvidence.reason}`);
  }
  const attemptedCaseIds = attemptEvidence.ok ? attemptEvidence.attemptedCaseIds : [];
  const attempted = new Set(attemptedCaseIds);
  // An open, applied action case from an earlier lap that BUILD never attempted
  // (the feature halted first) keeps its tasks only in the published order. A
  // lap that does not re-admit its source has no tasks for it, so both order
  // writers below would drop it and every re-kick would halt on "no work-order
  // tasks". Snapshot those unattempted rows before anything republishes; an
  // attempted absent case is instead resolved by reconciliation.
  const publishedOrder = await readBuildReviewWorkOrder(input.projectRoot, input.feature,
    prior.state.cases.flatMap((record) => record.effect.kind === 'action' ? [record.effect.id] : []));
  const carriedTasksByCaseId = new Map<string, readonly BuildReviewWorkOrderTask[]>(publishedOrder.ok
    ? publishedOrder.workOrder.cases
      .filter((row) => !attempted.has(row.caseId) && row.tasks.length > 0)
      .map((row) => [row.caseId, row.tasks])
    : []);
  const planContract = await (input.readPlanContract ?? (() => sourcePlanContract(input.projectRoot, input.aggregate, input.feature)))();
  const taskStatus = await (input.readTaskStatus ?? (() => sourceTaskStatus(input.projectRoot)))();
  const openCaseIds = new Set(prior.state.cases.filter((record) => record.resolution === 'open').map((record) => record.id));
  const openCaseAdmittedTaskIds = publishedOrder.ok
    ? publishedOrder.workOrder.cases
      .filter((row) => openCaseIds.has(row.caseId))
      .flatMap((row) => row.tasks.flatMap((task) => 'admittedTaskIds' in task ? task.admittedTaskIds : []))
    : [];
  // Context must expose the same carry-eligible cases that the later
  // classifier consumes; invalidated dispositions are excluded by the source.
  const carryInput = {
    currentLapId: input.aggregate.lapId,
    effectiveAcceptedSourceIds: await effectiveAcceptedSourceIds(),
  };
  const context = assembleBuildReviewAdjudicationContext({
    aggregate: input.aggregate, priorCases: prior.state.cases, suppressions: suppressionHistory.state.suppressions, declaredSeverityThresholds: input.declaredSeverityThresholds, operatorResolvedFindingIds: resolved, carryInput,
    excludedSourceIds: new Set(sources.filter((source) => nonActionable(source.findingId)).map(buildReviewAdjudicationSourceId)),
    planContract: await scopedPlanContract(input.projectRoot, planContract, input.aggregate, currentSources, openCaseAdmittedTaskIds), taskStatus, attemptedCaseIds,
  });
  if (!context.ok) return failUnlessAccepted(`adjudication context ${describeBuildReviewAdjudicationContextStop(context.stop)}`, { settleAbsentAttempted: true });
  // A disposition arriving while the case store was read wins before the one
  // provider dispatch.  Rebuild the complete projection rather than letting
  // the provider see an obsolete source.
  try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
  if (allOperatorResolved(resolved)) {
    return finalize({ tasksByCaseId: new Map(), republishWorkOrder: false, resolvedAtEntry: resolved, settleAbsentAttempted: true });
  }
  // A decision stop has no settled semantic answer: its source must remain
  // eligible for a later judgement to converge on that owner, or to surface a
  // different-owner conflict. `finalizedBuildReviewSourceIds` deliberately
  // serves broader terminal dispositions, so narrow it at this coordinator
  // boundary for the stop re-evaluation lane.
  const decisionStopSourceIds = new Set(prior.state.cases
    .filter(isBuildReviewDecisionStop)
    .flatMap((record) => record.sources.map((source) => source.sourceId)));
  // An operator resolution settles the effective verdict immediately, but its
  // next raised source still has to pass through the sole carry writer so the
  // durable link and occurrence explain why the finding was accepted. Other
  // finalized links remain outside the judge's source set as before.
  const authoritativeLinks = currentBuildReviewSourceLinks(prior.state.cases);
  const settledSourceIds = new Set([...finalizedSourceIds(prior.state.cases)]
    .filter((sourceId) => {
      const current = authoritativeLinks.get(sourceId);
      return !decisionStopSourceIds.has(sourceId) &&
        (current?.record.operatorResolution === undefined || current.link.outcome === 'carried');
    }));
  currentSources = sources.filter((source) =>
    !resolved.has(source.findingId) && !nonActionable(source.findingId) &&
    !settledSourceIds.has(buildReviewAdjudicationSourceId(source)) &&
    !unfinishedRefutedSourceIds.has(buildReviewAdjudicationSourceId(source)),
  );
  liveSourceIdsFor = (accepted: ReadonlySet<string>): ReadonlySet<string> =>
    new Set(sources.filter((source) =>
      !accepted.has(source.findingId) && !nonActionable(source.findingId) &&
      !settledSourceIds.has(buildReviewAdjudicationSourceId(source)) &&
      !unfinishedRefutedSourceIds.has(buildReviewAdjudicationSourceId(source)),
    ).map(buildReviewAdjudicationSourceId));
  if (currentSources.length === 0) {
    liveSourceIdsFor = () => new Set();
    return finalize({ tasksByCaseId: new Map(), republishWorkOrder: false, settleAbsentAttempted: true, dispatchSkipped: true });
  }
  // Frozen at dispatch: the exact source set the judge was asked about. Every
  // later authority read is a delta against this, never against the raw join.
  const dispatchSources = currentSources;
  const dispatchSourceIds = dispatchSources.map(buildReviewAdjudicationSourceId);
  liveSourceIdsFor = (accepted: ReadonlySet<string>): ReadonlySet<string> =>
    new Set(dispatchSources.filter((source) => !accepted.has(source.findingId)).map(buildReviewAdjudicationSourceId));
  const freshContext = assembleBuildReviewAdjudicationContext({
    aggregate: input.aggregate, priorCases: prior.state.cases, suppressions: suppressionHistory.state.suppressions,
    operatorResolvedFindingIds: resolved, carryInput, declaredSeverityThresholds: input.declaredSeverityThresholds, excludedSourceIds: new Set([...settledSourceIds, ...sources.filter((source) => nonActionable(source.findingId)).map(buildReviewAdjudicationSourceId)]),
    planContract: await scopedPlanContract(input.projectRoot, planContract, input.aggregate, dispatchSources, openCaseAdmittedTaskIds), taskStatus, attemptedCaseIds,
  });
  if (!freshContext.ok) return failUnlessAccepted(`adjudication context ${describeBuildReviewAdjudicationContextStop(freshContext.stop)}`, { settleAbsentAttempted: true });
  let dispatchContext = freshContext.context;
  let expansionTaskIds: readonly string[] | undefined;
  let accepted: { readonly judgement: RemediationCaseJudgement; readonly validation: { readonly ok: true; readonly graph: RemediationCaseGraph } } | undefined;
  for (let round = 0; round < 2; round += 1) {
    await input.emit?.({
      type: 'remediation_adjudication_started', domain: 'build_review', lapId: input.aggregate.lapId,
      ...(expansionTaskIds === undefined ? {} : { expansionTaskIds }),
    });
    let judgement: RemediationCaseJudgement;
    try {
      judgement = await input.judge(dispatchContext);
    } catch (error) {
      const detail = error instanceof RemediateDispatchError
        ? `remediate judgement failed: ${formatProviderExitFacts(error.provider, error.exitFacts ?? {})}${round === 1 ? ' (expansion round)' : ''}`
        : `remediate judgement failed: ${error instanceof Error ? error.message : String(error)}`;
      return failUnlessAccepted(detail, { settleAbsentAttempted: true });
    }
    // The context, not the judge, selects the case contract.  A custom lap's
    // case-v2 consistency decision and admission evidence cannot be shed by
    // answering in the older mode, whose acts would all be authorized.
    // The stricter v2 answer to a v1 request keeps every gate and stays valid.
    if (dispatchContext.mode === 'case-v2' && judgement.mode !== 'case-v2') {
      return failUnlessAccepted(`remediation judgement mode mismatch: requested ${dispatchContext.mode}, received ${String(judgement.mode)}`, { settleAbsentAttempted: true });
    }
    const graph = validateRemediationCaseGraph(dispatchSourceIds, judgement, {
      existingCaseIds: prior.state.cases.map((record) => record.id),
      admittedTaskIds: dispatchContext.planContract.admittedTaskContracts?.map((task) => task.id) ?? [],
      planTaskIds: dispatchContext.planContract.index?.map((task) => task.id) ?? [],
      sourceRubrics: Object.fromEntries(dispatchSources.map((source) => [
        buildReviewAdjudicationSourceId(source), source.rubric,
      ])),
      sourceReviewerSeverities: Object.fromEntries(dispatchSources.flatMap((source) =>
        source.severity === undefined
          ? []
          : [[buildReviewAdjudicationSourceId(source), source.severity] as const],
      )),
      declaredSeverityThresholds: input.declaredSeverityThresholds,
    });
    if (graph.ok) {
      accepted = { judgement, validation: graph };
      break;
    }
    const classification = dispatchContext.mode === 'case-v2' && graph.reason === 'unknown-admission-task'
      ? classifyIndexOnlyAdmission(dispatchSourceIds, judgement, {
        existingCaseIds: prior.state.cases.map((record) => record.id),
        admittedTaskIds: dispatchContext.planContract.admittedTaskContracts?.map((task) => task.id) ?? [],
        planTaskIds: dispatchContext.planContract.index?.map((task) => task.id) ?? [],
        sourceRubrics: Object.fromEntries(dispatchSources.map((source) => [
          buildReviewAdjudicationSourceId(source), source.rubric,
        ])),
        sourceReviewerSeverities: Object.fromEntries(dispatchSources.flatMap((source) =>
          source.severity === undefined
            ? []
            : [[buildReviewAdjudicationSourceId(source), source.severity] as const],
        )),
        declaredSeverityThresholds: input.declaredSeverityThresholds,
      }, graph)
      : undefined;
    if (round === 0 && classification?.kind === 'index-only') {
      expansionTaskIds = [...classification.taskIds].sort((left, right) => left.localeCompare(right));
      const expandedContext = assembleBuildReviewAdjudicationContext({
        aggregate: input.aggregate, priorCases: prior.state.cases, suppressions: suppressionHistory.state.suppressions,
        operatorResolvedFindingIds: resolved, carryInput, declaredSeverityThresholds: input.declaredSeverityThresholds, excludedSourceIds: new Set([...settledSourceIds, ...sources.filter((source) => nonActionable(source.findingId)).map(buildReviewAdjudicationSourceId)]),
        planContract: await scopedPlanContract(input.projectRoot, planContract, input.aggregate, dispatchSources, openCaseAdmittedTaskIds, expansionTaskIds), taskStatus, attemptedCaseIds,
      });
      if (!expandedContext.ok) return failUnlessAccepted(`adjudication context ${describeBuildReviewAdjudicationContextStop(expandedContext.stop)}`, { settleAbsentAttempted: true });
      dispatchContext = expandedContext.context;
      continue;
    }
    return failUnlessAccepted(describeInvalidRemediationJudgement(
      classification?.kind === 'other' ? classification.reason : graph.reason,
      graph.reason === 'unknown-admission-task' ? graph : undefined,
    ), { settleAbsentAttempted: true });
  }
  if (!accepted) return failUnlessAccepted('invalid remediation judgement unknown-admission-task', { settleAbsentAttempted: true });
  const { judgement, validation: graph } = accepted;
  // Do not reconcile or effect a provider result after a late exact operator
  // acceptance made every source non-autonomous.
  try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
  if (allOperatorResolved(resolved)) {
    return finalize({ tasksByCaseId: new Map(), republishWorkOrder: false, resolvedAtEntry: resolved, settleAbsentAttempted: true });
  }
  // The judgement is validated against exactly the sources the judge was handed.
  // An acceptance that landed while it was thinking suppresses only its own
  // source: its case is dropped before reservation, and every sibling case is
  // still reconciled, effected, and routed. Failing the whole lap closed here
  // is what made any pre-existing acceptance un-adjudicable.
  // The v2 consistency/escalation gate is an effect authority, not advisory
  // context: no partial action set survives a blocked or escalated judgement.
  const liveSourceIds = liveSourceIdsFor(resolved);
  const liveProposals = graph.graph.cases.filter((proposed) =>
    proposed.sources.some((source) => liveSourceIds.has(source.sourceId)));
  // Escalations have no effect id and use Task 31's dedicated durable owner
  // stop writer. The general reconciler owns ordinary case/effect transitions;
  // routing a stop through it would manufacture a deferral-shaped effect.
  // Carry is decided only by an explicit existingCaseId binding.  Classify it
  // before *any* disposition-specific split, otherwise an escalation reaches
  // the decision-stop writer and a deferral reserves an effect before the
  // carry lane gets a chance to settle it.
  const priorCasesBeforeReconcile = new Map(prior.state.cases.map((record) => [record.id, record]));
  const carriedCaseRefs = new Set(liveProposals.flatMap((proposed) => {
    const existing = proposed.case.existingCaseId
      ? priorCasesBeforeReconcile.get(proposed.case.existingCaseId)
      : undefined;
    return existing && classifyRemediationCaseReuse(existing, attempted, carryInput) === 'carry'
      ? [proposed.case.caseRef]
      : [];
  }));
  const carriedSourceIds = new Set(liveProposals
    .filter((proposed) => carriedCaseRefs.has(proposed.case.caseRef))
    .flatMap((proposed) => proposed.sources.map((source) => source.sourceId)));
  // Carry is a durable operator-owned lane. Derive the one remaining
  // consistency authority after removing it, then use that exact value for
  // both action authorization and any persisted stop. A carried-only block is
  // therefore consistent for this lap rather than a phantom stop.
  const effectiveConsistency = judgement.mode === 'case-v2' && judgement.consistency.verdict === 'blocked'
    ? (() => {
        const sourceIds = judgement.consistency.sourceIds.filter((sourceId) => !carriedSourceIds.has(sourceId));
        const caseRefs = judgement.consistency.caseRefs.filter((caseRef) => !carriedCaseRefs.has(caseRef));
        return sourceIds.length === 0
          ? { ...judgement.consistency, verdict: 'consistent' as const, sourceIds: [], caseRefs: [] }
          : { ...judgement.consistency, sourceIds, caseRefs };
      })()
    : judgement.mode === 'case-v2'
      ? judgement.consistency
      : undefined;
  const actionEffectJudgement = judgement.mode === 'case-v2'
    ? {
      ...judgement,
      sourceOutcomes: judgement.sourceOutcomes.filter((source) => !carriedSourceIds.has(source.sourceId)),
      cases: judgement.cases.filter((caseRow) => !carriedCaseRefs.has(caseRow.caseRef)),
      consistency: effectiveConsistency!,
    }
    : {
      ...judgement,
      sourceOutcomes: judgement.sourceOutcomes.filter((source) => !carriedSourceIds.has(source.sourceId)),
      cases: judgement.cases.filter((caseRow) => !carriedCaseRefs.has(caseRow.caseRef)),
    };
  const actionEffectGraph = {
    ...graph.graph,
    sourceOutcomes: graph.graph.sourceOutcomes.filter((source) => !carriedSourceIds.has(source.sourceId)),
    cases: graph.graph.cases.filter((proposed) => !carriedCaseRefs.has(proposed.case.caseRef)),
  };
  const authorizedActionRefs = new Set(authorizeBuildReviewRemediationActionEffects({
    judgement: actionEffectJudgement,
    validation: { ...graph, graph: actionEffectGraph },
  }));
  const admitted = liveProposals.filter((proposed) =>
    carriedCaseRefs.has(proposed.case.caseRef) || proposed.case.disposition !== 'act' || authorizedActionRefs.has(proposed.case.caseRef),
  );
  for (const proposed of admitted) {
    if (carriedCaseRefs.has(proposed.case.caseRef) || proposed.case.disposition !== 'refute') continue;
    const evidence = await resolveRefutationEvidence({ projectRoot: input.projectRoot, refutation: proposed.case.refutation! });
    if (!evidence.ok) return failUnlessAccepted(evidence.reason, { settleAbsentAttempted: true });
  }
  const ordinaryCases = admitted.filter((proposed) =>
    proposed.case.disposition !== 'escalate' || carriedCaseRefs.has(proposed.case.caseRef));
  const escalationCases = admitted.filter((proposed) =>
    proposed.case.disposition === 'escalate' && !carriedCaseRefs.has(proposed.case.caseRef));
  // A reuse halt is still durable evidence: the newly bound source must be
  // attached to the named case so an operator can accept that precise halt and
  // a later explicit binding has an origin to carry from.  Reconciliation is
  // the sole source-link writer; this helper deliberately makes no routing or
  // eligibility decision.
  const recordHaltingBinding = async (proposed: typeof admitted[number]): Promise<BuildReviewAdjudicationCoordinatorResult | undefined> => {
    const linked = await reconcileRemediationCases(store, {
      graph: {
        sourceOutcomes: graph.graph.sourceOutcomes.filter((source) => source.caseRef === proposed.case.caseRef),
        cases: [proposed],
      },
      recordedAt: new Date().toISOString(),
      generateId: input.generateId ?? randomUUID,
      attemptedCaseIds: [],
    });
    if (linked.ok) return undefined;
    return linked.reason === 'store-failure'
      ? failStore('case store', { reason: linked.storeReason, violation: linked.violation })
      : fail(`case reconciliation ${linked.reason}`);
  };
  // An unbound action over a resolved action owner is deliberately not an
  // ordinary regression: it is a fresh concern at that anchor. Its lineage,
  // however, still owns the finite number of BUILD attempts. Bind the source
  // back to its authoritative owner before reporting the halt so a later
  // operator acceptance can address this exact occurrence.
  for (const proposed of admitted) {
    if (proposed.case.existingCaseId !== undefined || proposed.case.disposition !== 'act') continue;
    if (proposed.sources.every((source) => !liveSourceIds.has(source.sourceId))) continue;
    const recurrence = classifyBuildReviewRecurrence(
      prior.state.cases,
      proposed.sources.map((source) => source.sourceId),
      proposed.case.distinctFrom ?? [],
    );
    if (recurrence.recurrenceOf.length === 0) continue;
    const lineage = buildReviewRecurrenceLineage(prior.state.cases, recurrence.recurrenceOf);
    if (lineage.appliedAttempts < BUILD_REVIEW_RECURRENCE_ATTEMPT_LIMIT) continue;
    const caseId = recurrence.recurrenceOf.at(-1)!;
    const owner = priorCasesBeforeReconcile.get(caseId)!;
    const linkFailure = await recordHaltingBinding({
      ...proposed,
      case: { ...proposed.case, existingCaseId: caseId },
    });
    if (linkFailure) return linkFailure;
    await input.emit?.({
      type: 'remediation_semantic_repeat_halt', domain: 'build_review', lapId: input.aggregate.lapId,
      caseId, ...(owner.effect.kind === 'none' ? {} : { effectId: owner.effect.id }),
      reason: 'recurrence-limit', lineageCaseIds: [...lineage.caseIds],
    });
    return failUnlessAccepted(
      `semantic remediation case recurrence limit ${caseId}: lineage ${lineage.caseIds.join(', ')} has ${lineage.appliedAttempts} applied attempts (limit ${BUILD_REVIEW_RECURRENCE_ATTEMPT_LIMIT})`,
      { settleAbsentAttempted: false, caseSourceIds: [new Set(proposed.sources.map((source) => source.sourceId))] },
    );
  }
  // Carry removes a case from every autonomous effect and escalation lane.
  // The action authority above already derives consistency from that filtered
  // judgement; use the same projection for the stop writer so a consistency
  // verdict concerning only carried sources cannot manufacture a new owner
  // stop after the action lane correctly proceeds.
  const blockedConsistency = effectiveConsistency?.verdict === 'blocked'
    ? {
      sourceIds: effectiveConsistency.sourceIds.filter((sourceId) => liveSourceIds.has(sourceId)),
      rationale: effectiveConsistency.rationale,
    }
    : undefined;
  // A judgement that explicitly reuses a prior case the classifier halts on
  // must stop BEFORE reconciliation: reconciliation reserves sibling action
  // effects, and a halt between reservation and application strands them as
  // reserved forever (no later lap can apply them — their tasks live only in
  // this judgement), so every following lap halts on an unfinished effect.
  // Convergence never binds a resolved case, so explicit reuse is the only way
  // to reach a regression; a converged repeat is still caught after reconciling.
  // Only an `act` proposal repeats an action: any other disposition transforms
  // the reused case (a refutation settles it) and reconciliation owns that.
  for (const proposed of admitted) {
    if (proposed.case.disposition !== 'act') continue;
    if (proposed.sources.every((source) => !liveSourceIds.has(source.sourceId))) continue;
    const record = proposed.case.existingCaseId ? priorCasesBeforeReconcile.get(proposed.case.existingCaseId) : undefined;
    if (!record) continue;
    const reuse = classifyRemediationCaseReuse(record, attempted, carryInput);
    if (reuse === 'halt-regression' || reuse === 'halt-repeat') {
      const linkFailure = await recordHaltingBinding(proposed);
      if (linkFailure) return linkFailure;
      await input.emit?.({
        type: 'remediation_semantic_repeat_halt', domain: 'build_review', lapId: input.aggregate.lapId,
        caseId: record.id, ...(record.effect.kind === 'none' ? {} : { effectId: record.effect.id }),
        reason: reuse === 'halt-repeat' ? 'already-attempted' : 'regressed',
      });
      return failUnlessAccepted(reuse === 'halt-repeat'
        ? `semantic remediation case repeat ${record.id}`
        : `semantic remediation case regression ${record.id}`, {
          settleAbsentAttempted: false,
          // A reused case's own sources belong to the lap that resolved it and
          // are not live now, so only the reusing proposal's sources can show
          // that an acceptance retired this failure.
          caseSourceIds: [new Set([...record.sources, ...proposed.sources].map((source) => source.sourceId))],
        });
    }
  }
  const recordedAt = new Date().toISOString();
  const generateId = input.generateId ?? randomUUID;
  const reconciled = await reconcileRemediationCases(store, {
    graph: { ...graph.graph, cases: ordinaryCases }, recordedAt, generateId,
    attemptedCaseIds,
    lapId: input.aggregate.lapId,
    ...(carriedCaseRefs.size === 0 ? {} : { carry: { caseRefs: [...carriedCaseRefs], lapId: input.aggregate.lapId } }),
    // A mechanically complete lap saw every finding this join could report, so a
    // prior open non-action case absent from it is decided by that absence — the
    // same evidence the exit paths settle on. Leaving it open let stale history
    // feed a later adjudication as an unresolved prior. A mechanically incomplete
    // lap proves nothing by absence, so it still leaves that history open.
    // An escalation is the explicit re-evaluation lane for an existing owner
    // stop. Do not ask reconciliation to settle that stop by absence before
    // its durable replay/persistence path sees the proposed escalation.
    effectiveAcceptedSourceIds: await effectiveAcceptedSourceIds(),
    mechanicallyHealthy: absenceRetirementMechanicallyHealthy && escalationCases.length === 0,
    resolveAbsentOpenNonActionCases: absenceRetirementMechanicallyHealthy && escalationCases.length === 0,
    allowAppliedByAbsence: true,
  });
  if (!reconciled.ok) {
    // A store fault stays fail-closed; a rejected graph is content-specific
    // and, like every failure above, may be obsolete under a late acceptance.
    if (reconciled.reason === 'store-failure') {
      return failStore('case store', { reason: reconciled.storeReason, violation: reconciled.violation });
    }
    if (reconciled.reason === 'refutation-repeat') {
      const repeatedCaseId = admitted.find((proposed) => proposed.case.disposition === 'refute')?.case.existingCaseId;
      return failUnlessAccepted(`refutation repeat ${repeatedCaseId ?? 'unknown'}`, { settleAbsentAttempted: false });
    }
    return failUnlessAccepted(`case reconciliation ${reconciled.reason}`, { settleAbsentAttempted: true });
  }

  // Reconciliation owns durable identity, so it reports the caseRef -> case-id
  // map itself. Deriving it here from array positions could not see a replayed
  // judgement converging on an already-stamped case.
  const caseIdsByRef = new Map(reconciled.caseIdsByRef);
  await drainOutbox();
  let persistedConsistencyStop = false;
  for (const proposed of escalationCases) {
    const caseId = proposed.case.existingCaseId ?? generateId();
    const ownsBlockedConsistency: boolean = blockedConsistency !== undefined && !persistedConsistencyStop &&
      proposed.sources.some((source) => blockedConsistency.sourceIds.includes(source.sourceId));
    const persistedStop = await persistBuildReviewDecisionStop({
      store,
      record: {
        id: caseId, domain: 'build_review', disposition: 'escalate', priority: proposed.case.priority,
        rationale: proposed.case.rationale, confidence: proposed.case.confidence, resolution: 'open',
        sources: proposed.sources.map((source) => ({ sourceId: source.sourceId, outcome: source.outcome, recordedAt })),
        effect: { kind: 'none' }, escalation: proposed.case.escalation!,
        ...(ownsBlockedConsistency ? { consistencyStop: blockedConsistency } : {}),
      },
    });
    if (!persistedStop.ok) return failStore('decision stop', persistedStop);
    persistedConsistencyStop ||= ownsBlockedConsistency;
    caseIdsByRef.set(proposed.case.caseRef, persistedStop.caseId);
  }
  if (blockedConsistency && !persistedConsistencyStop) {
    const sources = graph.graph.sourceOutcomes
      .filter((source) => blockedConsistency.sourceIds.includes(source.sourceId))
      .map((source) => ({ sourceId: source.sourceId, outcome: source.outcome, recordedAt }));
    const persistedStop = await persistBuildReviewDecisionStop({
      store,
      record: {
        id: `consistency-stop-${input.aggregate.lapId}`, domain: 'build_review', disposition: 'escalate', priority: 'high',
        rationale: blockedConsistency.rationale, confidence: 'high', resolution: 'open', sources,
        effect: { kind: 'none' }, consistencyStop: blockedConsistency,
      },
    });
    if (!persistedStop.ok) return failStore('blocked consistency stop', persistedStop);
  }
  await drainOutbox();
  const durableState = await store.read();
  if (!durableState.ok) return failStore('case store', durableState);
  const reconciledCasesById = new Map(durableState.state.cases.map((record) => [record.id, record]));
  const priorCasesById = new Map(prior.state.cases.map((record) => [record.id, record]));
  // Reconciler retirement entries are appended in its mutation and delivered
  // by the drain above.  Do not emit a second, non-idempotent lifecycle event
  // from this read-side projection.
  for (const caseId of caseIdsByRef.values()) {
    const record = reconciledCasesById.get(caseId);
    if (!record) return fail(`reconciled case ${caseId} is unavailable`);
    // Opening a case is the coordinator's existing lifecycle signal. Resolved
    // transitions are deliberately omitted here: their event-id'd outbox entry
    // was committed with the retirement and drained above.
    if (record.resolution === 'open') await input.emit?.({
      type: 'remediation_case_reconciled', domain: 'build_review', lapId: input.aggregate.lapId,
      caseId, resolution: 'open',
      ...(record.recurrenceOf === undefined ? {} : { recurrenceOf: record.recurrenceOf }),
      ...(record.distinctFrom === undefined ? {} : { distinctFrom: record.distinctFrom }),
    });
    const priorEffect = priorCasesById.get(caseId)?.effect;
    const wasReserved = priorEffect?.kind !== 'none' && priorEffect?.status === 'reserved';
    if (record.effect.kind !== 'none' && record.effect.status === 'reserved' && !wasReserved) {
      await input.emit?.({
        type: 'remediation_effect_reserved', domain: 'build_review', lapId: input.aggregate.lapId,
        caseId, effectId: record.effect.id, effectKind: record.effect.kind,
      });
    }
  }
  for (const proposed of admitted) {
    if (proposed.case.disposition !== 'refute' || carriedCaseRefs.has(proposed.case.caseRef)) continue;
    const caseId = caseIdsByRef.get(proposed.case.caseRef);
    const record = caseId ? reconciledCasesById.get(caseId) : undefined;
    if (!caseId || !record) return fail('refuted case identity was not reconciled');
    await input.emit?.({
      type: 'remediation_case_refuted', domain: 'build_review', lapId: input.aggregate.lapId,
      caseId, ...(record.effect.kind === 'none' ? {} : { residualEffectId: record.effect.id }),
    });
  }

  // Reconciliation awaited durable work, so its earlier authority snapshot
  // cannot decide a content-specific HALT. Re-read once at this boundary and
  // skip only the case whose complete source set is no longer autonomous.
  // The frozen dispatch projection remains the one authority for source ids.
  try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
  if (allOperatorResolved(resolved)) {
    return finalize({ tasksByCaseId: new Map(), republishWorkOrder: false, resolvedAtEntry: resolved });
  }
  const liveSourceIdsBeforeRepeat = liveSourceIdsFor(resolved);
  for (const proposed of admitted) {
    if (proposed.sources.every((source) => !liveSourceIdsBeforeRepeat.has(source.sourceId))) continue;
    const caseId = caseIdsByRef.get(proposed.case.caseRef);
    const record = caseId ? reconciledCasesById.get(caseId) : undefined;
    if (!caseId || !record) {
      if (proposed.case.existingCaseId) return fail('existing case identity was not reconciled');
      continue;
    }
    if (!priorCasesById.has(caseId)) continue;
    const reuse = classifyRemediationCaseReuse(record, attempted, carryInput);
    if (reuse === 'halt-regression' || reuse === 'halt-repeat') {
      const linkFailure = await recordHaltingBinding(proposed);
      if (linkFailure) return linkFailure;
      await input.emit?.({
        type: 'remediation_semantic_repeat_halt', domain: 'build_review', lapId: input.aggregate.lapId,
        caseId, ...(record.effect.kind === 'none' ? {} : { effectId: record.effect.id }),
        reason: reuse === 'halt-repeat' ? 'already-attempted' : 'regressed',
      });
      // The emission was awaited; the HALT decision reads authority after it.
      return failUnlessAccepted(reuse === 'halt-repeat'
        ? `semantic remediation case repeat ${caseId}`
        : `semantic remediation case regression ${caseId}`, {
          settleAbsentAttempted: false,
          // A reused case's own sources belong to the lap that resolved it and
          // are not live now, so only the reusing proposal's sources can show
          // that an acceptance retired this failure.
          caseSourceIds: [new Set([...record.sources, ...proposed.sources].map((source) => source.sourceId))],
        });
    }
  }

  // The action reservation is an irreversible boundary: publishing the order
  // and charging its stable effect happen under its lease. Re-read operator
  // authority immediately before entering it so a finding accepted while case
  // reconciliation was settling cannot consume a route or a budget.
  try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
  // Reconciliation has already persisted cases and reserved their effects, so
  // an acceptance arriving here cannot take the bare shortcut: it must settle
  // that durable state first and choose its route from what survives.
  if (sources.every((source) => resolved.has(source.findingId))) {
    return finalize({ tasksByCaseId: new Map(), republishWorkOrder: false, resolvedAtEntry: resolved });
  }
  const liveSourceIdsBeforeAction = liveSourceIdsFor(resolved);
  const tasksByCaseId = new Map<string, readonly { readonly title: string }[]>();
  for (const proposed of admitted) {
    if (proposed.case.disposition !== 'act') continue;
    // A carried action was reconciled as settled history.  It has no newly
    // reserved effect, so it must never enter the irreversible charge/order
    // boundary merely because its provider proposal happened to say `act`.
    if (carriedCaseRefs.has(proposed.case.caseRef)) continue;
    if (proposed.sources.every((source) => !liveSourceIdsBeforeAction.has(source.sourceId))) continue;
    const caseId = caseIdsByRef.get(proposed.case.caseRef);
    if (!caseId || proposed.case.effect.kind !== 'action') return fail('action case identity was not reconciled');
    tasksByCaseId.set(caseId, proposed.case.effect.tasks);
  }
  // This lap's tasks win; carried rows only fill cases the lap did not admit.
  const workOrderTasksByCaseId = new Map([...carriedTasksByCaseId, ...tasksByCaseId]);
  if (tasksByCaseId.size > 0) {
    const pendingActionEffects = reconciled.state.cases.filter((record) =>
      record.effect.kind === 'action' && record.effect.status === 'reserved' && tasksByCaseId.has(record.id),
    );
    const action = await applyBuildReviewActionEffects({
      projectRoot: input.projectRoot, feature: input.feature, store, tasksByCaseId: workOrderTasksByCaseId, chargeInput: input.chargeInput,
      ...(input.child === undefined ? {} : { child: input.child }),
      ...(input.chargeEffect === undefined ? {} : { chargeEffect: input.chargeEffect }),
    });
    if (!action.ok) {
      // The effect boundary itself awaited durable work. A late acceptance can
      // retire only the covered case before this content-specific failure is
      // surfaced; a remaining sibling still reduces to the normal HALT route.
      try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
      const liveSourceIdsAfterActionFailure = liveSourceIdsFor(resolved);
      const retiredByAcceptance = new Set(pendingActionEffects
        .filter((record) => record.sources.every((source) => !liveSourceIdsAfterActionFailure.has(source.sourceId)))
        .map((record) => record.id));
      // The effect executor settled these reservations to a durable failed
      // status under its own lease and reports exactly that set from the same
      // mutation. Every durable reserved->failed transition emits, retired or
      // not — only a case whose reservation is still untouched leaves its
      // emission to the exit retirement path in `finalize`. Re-reading the
      // store here instead treated a read failure as "nothing failed" and
      // dropped the occurrence for a case accepted during the boundary.
      const durablyFailedCaseIds = new Set(action.failedCaseIds ?? []);
      for (const record of pendingActionEffects) {
        if (record.effect.kind !== 'action') continue;
        if (retiredByAcceptance.has(record.id) && !durablyFailedCaseIds.has(record.id)) continue;
        await input.emit?.({
          type: 'remediation_effect_failed', domain: 'build_review', lapId: input.aggregate.lapId,
          caseId: record.id, effectId: record.effect.id, effectKind: 'action', reason: action.reason,
        });
      }
      // The emissions were awaited; the BUILD/HALT decision reads authority
      // after them, so an acceptance landing during delivery is not missed.
      try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
      const liveSourceIdsAtActionExit = liveSourceIdsFor(resolved);
      const retiredAtExit = pendingActionEffects.some((record) =>
        record.sources.every((source) => !liveSourceIdsAtActionExit.has(source.sourceId)));
      if (retiredAtExit) {
        return finalize({ tasksByCaseId, republishWorkOrder: false, resolvedAtEntry: resolved });
      }
      return failUnlessAccepted(action.reason, {
        settleAbsentAttempted: false,
        caseSourceIds: pendingActionEffects.map((record) => new Set(record.sources.map((source) => source.sourceId))),
      });
    }
    if (action.status === 'applied') {
      for (const record of pendingActionEffects) {
        if (record.effect.kind !== 'action') continue;
        await input.emit?.({
          type: 'remediation_effect_applied', domain: 'build_review', lapId: input.aggregate.lapId,
          caseId: record.id, effectId: record.effect.id, effectKind: 'action',
        });
      }
    }
  }
  if (input.tracker && input.repo && input.fileIssue) {
    let deferredFailureRetiredByAcceptance = false;
    for (const proposed of admitted) {
      if (carriedCaseRefs.has(proposed.case.caseRef)) continue;
      if (
        (proposed.case.disposition !== 'defer' && proposed.case.disposition !== 'refute') ||
        proposed.case.effect.kind !== 'deferral'
      ) continue;
      // Deferral reservation files a real tracker issue, and every iteration
      // awaits that external work — so operator authority is re-read before
      // EACH reservation, never from a pre-loop snapshot: an acceptance
      // landing during an earlier successful intake must suppress a later
      // covered case's obsolete issue create.
      try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
      if (proposed.sources.every((source) => !liveSourceIdsFor(resolved).has(source.sourceId))) continue;
      const caseId = caseIdsByRef.get(proposed.case.caseRef);
      if (!caseId) return fail('deferral case identity was not reconciled');
      const deferred = await applyBuildReviewDeferralEffect({
        projectRoot: input.projectRoot, feature: input.feature, store, caseId, effect: proposed.case.effect as RemediationCaseDeferralEffect,
        repo: input.repo, tracker: input.tracker, fileIssue: input.fileIssue,
      });
      const record = reconciledCasesById.get(caseId);
      if (!record || record.effect.kind !== 'deferral') return fail('deferral case effect was not reconciled');
      if (!deferred.ok) {
        // A tracker call is external work: re-read the exact operator authority
        // beside the failure exit, not at the earlier reservation boundary.
        try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
        const liveSourceIdsAfterDeferralFailure = liveSourceIdsFor(resolved);
        const retiredByAcceptance = record.sources.every((source) =>
          !liveSourceIdsAfterDeferralFailure.has(source.sourceId),
        );
        if (retiredByAcceptance) {
          // The executor already durably recorded the tracker failure. An
          // acceptance changes the route, not whether this occurrence happened.
          await input.emit?.({
            type: 'remediation_effect_failed', domain: 'build_review', lapId: input.aggregate.lapId,
            caseId, effectId: record.effect.id, effectKind: 'deferral', reason: deferred.reason,
          });
          deferredFailureRetiredByAcceptance = true;
          continue;
        }
        await input.emit?.({
          type: 'remediation_effect_failed', domain: 'build_review', lapId: input.aggregate.lapId,
          caseId, effectId: record.effect.id, effectKind: 'deferral', reason: deferred.reason,
        });
        // The emission was awaited; decide from an authority read after it.
        try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
        const liveSourceIdsAtDeferralExit = liveSourceIdsFor(resolved);
        const retiredAtExit = record.sources.every((source) => !liveSourceIdsAtDeferralExit.has(source.sourceId));
        if (deferredFailureRetiredByAcceptance || retiredAtExit) {
          return finalize({ tasksByCaseId, republishWorkOrder: false, resolvedAtEntry: resolved });
        }
        return failUnlessAccepted(deferred.reason, {
          settleAbsentAttempted: false,
          caseSourceIds: [new Set(record.sources.map((source) => source.sourceId))],
        });
      }
      if (deferred.status === 'applied') {
        await input.emit?.({
          type: 'remediation_effect_applied', domain: 'build_review', lapId: input.aggregate.lapId,
          caseId, effectId: record.effect.id, effectKind: 'deferral',
        });
      }
    }
    if (deferredFailureRetiredByAcceptance) {
      return finalize({ tasksByCaseId: workOrderTasksByCaseId, republishWorkOrder: true, resolvedAtEntry: resolved });
    }
  }
  return finalize({ tasksByCaseId: workOrderTasksByCaseId, republishWorkOrder: true });
}
