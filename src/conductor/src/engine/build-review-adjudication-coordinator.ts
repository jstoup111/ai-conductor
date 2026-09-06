import { randomUUID } from 'node:crypto';

import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import {
  assembleBuildReviewAdjudicationContext,
  buildReviewAdjudicationSourceId,
  type BuildReviewAdjudicationPlanContract,
  type BuildReviewAdjudicationTaskStatus,
} from './build-review-adjudication-context.js';
import { planContractPointers, readActivePlanPath } from './remediation-context-pointers.js';
import { orderBuildReviewActionCases, reduceBuildReviewAdjudication, renderBuildReviewAdjudicationTrace, type BuildReviewMechanicalState } from './build-review-adjudication.js';
import { projectBuildReviewAggregateSources, type BuildReviewAggregate } from './build-review-aggregate.js';
import { applyBuildReviewActionEffects, applyBuildReviewDeferralEffect, isBuildEligibleActionCase } from './remediation-case-effects.js';
import type { RemediationCaseJudgement } from './remediation-case-artifact.js';
import { classifyRemediationCaseReuse, reconcileRemediationCases } from './remediation-case-reconciler.js';
import { classifyBuildReviewDurableRead, publishBuildReviewWorkOrder, readBuildReviewWorkOrderAttemptedCaseIds } from './build-review-work-order.js';
import { RemediationCaseStore, type RemediationCaseRecord } from './remediation-case-store.js';
import { validateRemediationCaseGraph } from './remediation-case-validator.js';
import type { BuildReviewFeatureIdentity } from './build-review-dispositions.js';
import type { BumpKickbackGateInput, chargeBuildReviewEffectInLedger } from './kickback-ledger.js';
import type { EffectMarkerTrackerClient } from './tracker-client.js';
import type { RemediationCaseDeferralEffect } from './remediation-case-artifact.js';
import type { ConductorEvent } from '../types/events.js';

type RemediationCaseLifecycleEvent = Extract<ConductorEvent, {
  type: 'remediation_adjudication_started' | 'remediation_adjudication_completed' | 'remediation_adjudication_failed'
    | 'remediation_case_reconciled' | 'remediation_effect_reserved' | 'remediation_effect_applied'
    | 'remediation_effect_failed' | 'remediation_semantic_repeat_halt';
}>;

type OperatorRetirementTransition = {
  readonly caseId: string;
  readonly retiredEffect?: {
    readonly effectId: string;
    readonly effectKind: 'action' | 'deferral';
    readonly reason: 'retired by operator acceptance';
  };
};

export type BuildReviewAdjudicationCoordinatorResult =
  | { readonly ok: true; readonly route: 'pass' | 'build' | 'mechanical-retry' | 'halt'; readonly detail: string; readonly trace: string; readonly remainingMechanical: boolean }
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
): Promise<BuildReviewAdjudicationPlanContract> {
  const path = await readActivePlanPath(projectRoot);
  if (!path) return { path: null, pointers: [] };
  try {
    const plan = await readFile(isAbsolute(path) ? path : join(projectRoot, path), 'utf-8');
    const findings = Object.values(aggregate.results).flatMap((result) =>
      result.kind === 'judged' ? result.findings : [],
    );
    return { path, pointers: planContractPointers(findings, plan, path) };
  } catch {
    return { path, pointers: [] };
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
export async function coordinateBuildReviewAdjudication(input: {
  readonly projectRoot: string;
  readonly feature: BuildReviewFeatureIdentity;
  readonly aggregate: BuildReviewAggregate;
  readonly operatorResolvedFindingIds: ReadonlySet<string>;
  /** Re-reads the separate operator authority before every provider boundary. */
  readonly resolveOperatorResolvedFindingIds?: () => Promise<ReadonlySet<string>>;
  readonly mechanical: BuildReviewMechanicalState;
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
}): Promise<BuildReviewAdjudicationCoordinatorResult> {
  const sources = projectBuildReviewAggregateSources(input.aggregate);
  if (!sources) return { ok: false, detail: 'invalid raw aggregate source projection' };
  const operatorResolvedFindingIds = async (): Promise<ReadonlySet<string>> =>
    input.resolveOperatorResolvedFindingIds ? input.resolveOperatorResolvedFindingIds() : input.operatorResolvedFindingIds;
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
  const allOperatorResolved = (accepted: ReadonlySet<string>): boolean =>
    sources.every((source) => accepted.has(source.findingId));
  const fail = async (detail: string): Promise<BuildReviewAdjudicationCoordinatorResult> => {
    await input.emit?.({ type: 'remediation_adjudication_failed', domain: 'build_review', lapId: input.aggregate.lapId, reason: detail });
    return { ok: false, detail };
  };
  const store = new RemediationCaseStore(input.projectRoot, input.feature);
  // Before the judge is dispatched there is no frozen dispatch set, so live ids
  // are computed against the raw join. The two agree for every all-accepted lap,
  // and this is reassigned to the frozen set once one exists.
  let liveSourceIdsFor = (accepted: ReadonlySet<string>): ReadonlySet<string> =>
    new Set(sources.filter((source) => !accepted.has(source.findingId)).map(buildReviewAdjudicationSourceId));
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
        // Same semantics as clean-PASS settlement: absent non-action history
        // resolves benignly, while the reconciler's shared effect-status test
        // keeps any reserved or failed effect open as a blocker.
        resolveAbsentOpenNonActionCases: true,
      });
      if (!absentSettled.ok) {
        return fail(absentSettled.reason === 'store-failure' ? `case store ${absentSettled.storeReason}` : `case reconciliation ${absentSettled.reason}`);
      }
      for (const caseId of absentSettled.resolvedAbsentCaseIds) {
        await input.emit?.({
          type: 'remediation_case_reconciled', domain: 'build_review', lapId: input.aggregate.lapId,
          caseId, resolution: 'resolved',
        });
      }
    }
    const settled = await store.read();
    if (!settled.ok) return fail(`case store ${settled.reason}`);
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
      .filter((source) => exitResolved.has(source.findingId))
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
      const cases = state.cases.map((record) => {
        if (record.resolution !== 'open' || record.sources.length === 0 ||
          !record.sources.every((source) => acceptedSourceIds.has(source.sourceId))) return record;
        // An accepted source never completed this reserved effect. Preserve the
        // durable row as a retired failure rather than falsely recording work as
        // applied; the reducer ignores resolved rows through the shared open-case
        // vocabulary.
        let retiredEffect: OperatorRetirementTransition['retiredEffect'];
        const effect = record.effect.kind !== 'none' && record.effect.status === 'reserved'
          ? (() => {
            retiredEffect = {
              effectId: record.effect.id,
              effectKind: record.effect.kind,
              reason: 'retired by operator acceptance',
            };
            return { id: record.effect.id, kind: record.effect.kind, status: 'failed' as const, diagnostic: retiredEffect.reason };
          })()
          : record.effect;
        retirementTransitions.push({ caseId: record.id, ...(retiredEffect ? { retiredEffect } : {}) });
        return { ...record, resolution: 'resolved' as const, effect };
      });
      const eligible = cases.filter(isBuildEligibleActionCase);
      if (eligible.length === 0 || !options.republishWorkOrder) {
        return { value: { ok: true as const, cases, retirementTransitions }, nextState: { ...state, cases } };
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
      return { value: { ok: true as const, cases, retirementTransitions }, nextState: { ...state, cases } };
    });
    if (!neutralized.ok) return fail(`case store ${neutralized.reason}`);
    if (!neutralized.value.ok) return fail(neutralized.value.reason);
    settledCases.splice(0, settledCases.length, ...neutralized.value.cases);
    for (const retirement of neutralized.value.retirementTransitions) {
      settledRetirements.push(retirement);
      await input.emit?.({
        type: 'remediation_case_reconciled', domain: 'build_review', lapId: input.aggregate.lapId,
        caseId: retirement.caseId, resolution: 'resolved',
      });
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
      const transition = reduceBuildReviewAdjudication({ currentSourceIds: exitSourceIds, cases: settledCases, mechanical: input.mechanical });
      if (!completedEmitted) {
        completedEmitted = true;
        await input.emit?.({
          type: 'remediation_adjudication_completed', domain: 'build_review', lapId: input.aggregate.lapId,
          caseIds: settledCases.map((record) => record.id),
          effectIds: settledCases.flatMap((record) => record.effect.kind === 'none' ? [] : [record.effect.id]),
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
      return {
        ok: true, route: transition.route, detail: transition.reason,
        trace: `route: ${transition.route}\n${renderBuildReviewAdjudicationTrace(settledCases)}`,
        remainingMechanical: transition.remainingMechanical,
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
    options: { readonly settleAbsentAttempted: boolean },
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
    if (allOperatorResolved(afterDelivery)) {
      return finalize({ tasksByCaseId: new Map(), republishWorkOrder: false, resolvedAtEntry: afterDelivery, settleAbsentAttempted: options.settleAbsentAttempted });
    }
    return failed;
  };
  let resolved: ReadonlySet<string>;
  try { resolved = await operatorResolvedFindingIds(); } catch { return { ok: false, detail: 'operator disposition state is unavailable' }; }
  // Operator authority is terminal for an all-resolved content lap, but it is
  // not evidence that nothing is outstanding: an earlier lap's case can still
  // be open with a live work order. Settle durable state and route from what
  // survives, rather than reporting a route no one checked.
  if (allOperatorResolved(resolved)) {
    return finalize({ tasksByCaseId: new Map(), republishWorkOrder: false, resolvedAtEntry: resolved, settleAbsentAttempted: true });
  }
  let currentSources = sources.filter((source) => !resolved.has(source.findingId));
  const prior = await store.read();
  if (!prior.ok) return fail(`case store ${prior.reason}`);
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
  const planContract = await (input.readPlanContract ?? (() => sourcePlanContract(input.projectRoot, input.aggregate)))();
  const taskStatus = await (input.readTaskStatus ?? (() => sourceTaskStatus(input.projectRoot)))();
  const contextEvidence = { planContract, taskStatus, attemptedCaseIds };
  const context = assembleBuildReviewAdjudicationContext({
    aggregate: input.aggregate, priorCases: prior.state.cases, operatorResolvedFindingIds: resolved, ...contextEvidence,
  });
  if (!context.ok) return failUnlessAccepted(`adjudication context ${context.stop.code}`, { settleAbsentAttempted: true });
  // A disposition arriving while the case store was read wins before the one
  // provider dispatch.  Rebuild the complete projection rather than letting
  // the provider see an obsolete source.
  try { resolved = await operatorResolvedFindingIds(); } catch { return fail('operator disposition state is unavailable'); }
  if (allOperatorResolved(resolved)) {
    return finalize({ tasksByCaseId: new Map(), republishWorkOrder: false, resolvedAtEntry: resolved, settleAbsentAttempted: true });
  }
  currentSources = sources.filter((source) => !resolved.has(source.findingId));
  // Frozen at dispatch: the exact source set the judge was asked about. Every
  // later authority read is a delta against this, never against the raw join.
  const dispatchSources = currentSources;
  const dispatchSourceIds = dispatchSources.map(buildReviewAdjudicationSourceId);
  liveSourceIdsFor = (accepted: ReadonlySet<string>): ReadonlySet<string> =>
    new Set(dispatchSources.filter((source) => !accepted.has(source.findingId)).map(buildReviewAdjudicationSourceId));
  const freshContext = assembleBuildReviewAdjudicationContext({
    aggregate: input.aggregate, priorCases: prior.state.cases, operatorResolvedFindingIds: resolved, ...contextEvidence,
  });
  if (!freshContext.ok) return failUnlessAccepted(`adjudication context ${freshContext.stop.code}`, { settleAbsentAttempted: true });
  await input.emit?.({ type: 'remediation_adjudication_started', domain: 'build_review', lapId: input.aggregate.lapId });
  let judgement: RemediationCaseJudgement;
  try { judgement = await input.judge(freshContext.context); } catch { return failUnlessAccepted('remediate judgement failed', { settleAbsentAttempted: true }); }
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
  const graph = validateRemediationCaseGraph(dispatchSourceIds, judgement);
  if (!graph.ok) return failUnlessAccepted(`invalid remediation judgement ${graph.reason}`, { settleAbsentAttempted: true });
  const liveSourceIds = liveSourceIdsFor(resolved);
  const admitted = graph.graph.cases.filter((proposed) =>
    proposed.sources.some((source) => liveSourceIds.has(source.sourceId)),
  );
  const reconciled = await reconcileRemediationCases(store, {
    graph: { ...graph.graph, cases: admitted }, recordedAt: new Date().toISOString(), generateId: input.generateId ?? randomUUID,
    attemptedCaseIds,
    // A mechanically complete lap saw every finding this join could report, so a
    // prior open non-action case absent from it is decided by that absence — the
    // same evidence the exit paths settle on. Leaving it open let stale history
    // feed a later adjudication as an unresolved prior. A mechanically incomplete
    // lap proves nothing by absence, so it still leaves that history open.
    resolveAbsentOpenNonActionCases: input.mechanical === 'healthy',
  });
  if (!reconciled.ok) {
    // A store fault stays fail-closed; a rejected graph is content-specific
    // and, like every failure above, may be obsolete under a late acceptance.
    if (reconciled.reason === 'store-failure') return fail(`case store ${reconciled.storeReason}`);
    return failUnlessAccepted(`case reconciliation ${reconciled.reason}`, { settleAbsentAttempted: true });
  }

  // Reconciliation owns durable identity, so it reports the caseRef -> case-id
  // map itself. Deriving it here from array positions could not see a replayed
  // judgement converging on an already-stamped case.
  const caseIdsByRef = reconciled.caseIdsByRef;
  const reconciledCasesById = new Map(reconciled.state.cases.map((record) => [record.id, record]));
  const priorCasesById = new Map(prior.state.cases.map((record) => [record.id, record]));
  const emittedCaseIds = new Set<string>();
  // Every persisted transition gets exactly one occurrence. A prior attempted
  // case absent from this lap's admitted graph is resolved by reconciliation
  // and named by no `caseRef`, so iterating the ref map alone changed durable
  // state with nothing on the event spine.
  for (const caseId of [...caseIdsByRef.values(), ...reconciled.resolvedAbsentCaseIds]) {
    if (emittedCaseIds.has(caseId)) continue;
    emittedCaseIds.add(caseId);
    const record = reconciledCasesById.get(caseId);
    if (!record) return fail(`reconciled case ${caseId} is unavailable`);
    await input.emit?.({
      type: 'remediation_case_reconciled', domain: 'build_review', lapId: input.aggregate.lapId,
      caseId, resolution: record.resolution,
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
    const reuse = classifyRemediationCaseReuse(record, attempted);
    if (reuse === 'halt-regression' || reuse === 'halt-repeat') {
      await input.emit?.({
        type: 'remediation_semantic_repeat_halt', domain: 'build_review', lapId: input.aggregate.lapId,
        caseId, ...(record.effect.kind === 'none' ? {} : { effectId: record.effect.id }),
        reason: reuse === 'halt-repeat' ? 'already-attempted' : 'regressed',
      });
      // The emission was awaited; the HALT decision reads authority after it.
      return failUnlessAccepted(reuse === 'halt-repeat'
        ? `semantic remediation case repeat ${caseId}`
        : `semantic remediation case regression ${caseId}`, { settleAbsentAttempted: false });
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
    if (proposed.sources.every((source) => !liveSourceIdsBeforeAction.has(source.sourceId))) continue;
    const caseId = caseIdsByRef.get(proposed.case.caseRef);
    if (!caseId || proposed.case.effect.kind !== 'action') return fail('action case identity was not reconciled');
    tasksByCaseId.set(caseId, proposed.case.effect.tasks);
  }
  if (tasksByCaseId.size > 0) {
    const pendingActionEffects = reconciled.state.cases.filter((record) =>
      record.effect.kind === 'action' && record.effect.status === 'reserved' && tasksByCaseId.has(record.id),
    );
    const action = await applyBuildReviewActionEffects({
      projectRoot: input.projectRoot, feature: input.feature, store, tasksByCaseId, chargeInput: input.chargeInput,
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
      return fail(action.reason);
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
      if (proposed.case.disposition !== 'defer' || proposed.case.effect.kind !== 'deferral') continue;
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
        return fail(deferred.reason);
      }
      if (deferred.status === 'applied') {
        await input.emit?.({
          type: 'remediation_effect_applied', domain: 'build_review', lapId: input.aggregate.lapId,
          caseId, effectId: record.effect.id, effectKind: 'deferral',
        });
      }
    }
    if (deferredFailureRetiredByAcceptance) {
      return finalize({ tasksByCaseId, republishWorkOrder: true, resolvedAtEntry: resolved });
    }
  }
  return finalize({ tasksByCaseId, republishWorkOrder: true });
}
