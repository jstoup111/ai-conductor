import type { ChildId } from '../child-context.js';
import type { SliceTopologyMembership } from '../slice-topology.js';
import type { AsBuiltGoverningReference } from '../as-built-contract.js';
import type { CriterionBoundRemediationGap, FrozenHostPlan } from '../remediation-append.js';
import { allocateFrozenBlocks } from '../remediation-append.js';
import type { GitRunner } from '../rebase.js';
import { classifyCitedPaths, selectHost } from './cannot-host.js';
import { deriveTaskBoundOwner } from './owner-derivation.js';
import { resolveResidueOwner, runResidueRoutingCall, type ResidueRoutingJudge } from './residue-routing-call.js';
import type { ExistingTaskRoutedItem, FrozenAllocation, RoutedItem, RoundId } from './route-types.js';

/**
 * The authority that admitted an item.  Proposed remediation tasks describe
 * the repair, not necessarily its owner: ADR-only as-built findings and
 * refusal rework still require the residue judgement (ADR D3).
 */
export type AdmittedFindingProvenance =
  | { readonly kind: 'task-bound' }
  | { readonly kind: 'taskless-obligation' }
  | { readonly kind: 'refusal-rework'; readonly governingEvidence: string }
  | {
    readonly kind: 'as-built';
    readonly reference: AsBuiltGoverningReference;
    readonly summary: string;
  };

export interface AdmittedRoutingItem {
  readonly id: string;
  readonly gap: CriterionBoundRemediationGap;
  readonly gateSource: string;
  readonly provenance: AdmittedFindingProvenance;
  /**
   * The task binding admitted with the finding.  This is deliberately
   * separate from `gap.tasks`: those are proposed repair task ids, whereas
   * ADR D2 assigns task-bound work to the authored (or prior rem) task that
   * authorized its admission.
   */
  readonly ownerTaskIds?: readonly string[];
  /** Immutable path citations admitted from the work order and its owner. */
  readonly citedPaths: readonly string[];
  readonly existingTask?: boolean;
}

export interface RouteAdmittedRoundInput {
  readonly admitted: readonly AdmittedRoutingItem[];
  readonly sliceMembership: SliceTopologyMembership;
  readonly planText: string;
  readonly appendedChildren: Readonly<Record<string, number>>;
  readonly declaredPositions: readonly ChildId[];
  readonly leafTip: string;
  readonly roundId: RoundId;
  readonly judge?: ResidueRoutingJudge;
  readonly git: GitRunner;
  readonly leafPlan?: string;
  readonly hostPlans?: readonly FrozenHostPlan[];
  readonly consolidatedManualTestFail?: readonly string[];
}

export type RoutedRound = {
  readonly kind: 'routed';
  readonly items: readonly RoutedItem[];
  readonly hosts: readonly ChildId[];
  readonly allocation: FrozenAllocation;
  readonly hostHints: Readonly<Record<number, string>>;
};
export type RoutedRoundHalt = { readonly kind: 'halt'; readonly haltClass: 'needs-human'; readonly detail: string };

export function hostOrder(hosts: Iterable<number> | Readonly<Record<number, unknown>>): ChildId[] {
  const raw = Symbol.iterator in Object(hosts) ? [...hosts as Iterable<number>] : Object.keys(hosts).map(Number);
  return [...new Set(raw)].sort((a, b) => a - b) as ChildId[];
}

/**
 * The task ids a routed host may execute.  A round's immutable allocation
 * owns its new remediation tasks; existing authored tasks remain in the
 * route record's item bindings.  Keep this projection here so the hook and
 * task CLI cannot diverge over the same durable record.
 */
export function routedTaskIdsForHost(record: Pick<RoutedRound, 'items' | 'allocation'> | import('./route-types.js').RouteRecord, host: ChildId): readonly string[] {
  const ids = new Set<string>(record.allocation[host]?.remTaskIds ?? []);
  for (const item of record.items) {
    if (item.host !== host) continue;
    for (const taskId of item.taskIds ?? []) ids.add(taskId);
  }
  return [...ids];
}

function isResidue(item: AdmittedRoutingItem): boolean {
  switch (item.provenance.kind) {
    case 'refusal-rework':
      return true;
    case 'as-built':
      return item.provenance.reference.kind === 'adr-decision';
    case 'taskless-obligation':
      return true;
    case 'task-bound':
      return false;
  }
}

function residueJudgeItem(item: AdmittedRoutingItem): import('./residue-routing-call.js').ResidueRoutingItem {
  const common = { itemId: item.id, rationale: item.gap.rationale };
  switch (item.provenance.kind) {
    case 'refusal-rework':
      return { ...common, governingEvidence: item.provenance.governingEvidence };
    case 'as-built':
      return {
        ...common,
        summary: item.provenance.summary,
        governingEvidence: item.provenance.reference,
      };
    case 'taskless-obligation':
      return common;
    case 'task-bound':
      throw new Error(`Task-bound item ${item.id} cannot be projected to the residue judge`);
  }
}

function hintFor(gap: CriterionBoundRemediationGap): string {
  return [gap.rationale, gap.criterion].filter((value): value is string => typeof value === 'string' && value !== '').join('\n');
}

function existingTaskFields(source: AdmittedRoutingItem, mixedRound: boolean): Pick<ExistingTaskRoutedItem, 'existingTask' | 'taskIds' | 'restage'> | undefined {
  if (!source.existingTask) return undefined;
  return {
    existingTask: true,
    taskIds: [...source.ownerTaskIds!].sort() as [string, ...string[]],
    ...(mixedRound ? { restage: false } : {}),
  };
}

/**
 * Places admitted work without mutating refs.  Callers may safely map every
 * halt to a feature halt because no allocation/write happens before ownership
 * and tree readability are known.
 */
export async function routeAdmittedRound(input: RouteAdmittedRoundInput): Promise<RoutedRound | RoutedRoundHalt> {
  const resolved: Array<{ source: AdmittedRoutingItem; item: RoutedItem }> = [];
  const residue: AdmittedRoutingItem[] = [];
  const mixedRound = (input.consolidatedManualTestFail?.length ?? 0) > 0;
  for (const source of input.admitted) {
    if (source.existingTask && (source.ownerTaskIds === undefined || source.ownerTaskIds.length === 0)) {
      return {
        kind: 'halt', haltClass: 'needs-human',
        detail: `Existing-task work ${source.id} has no admitted owner-task binding`,
      };
    }
    if (isResidue(source)) { residue.push(source); continue; }
    if (source.ownerTaskIds === undefined || source.ownerTaskIds.length === 0) {
      return {
        kind: 'halt', haltClass: 'needs-human',
        detail: `Task-bound work ${source.id} has no admitted owner-task binding`,
      };
    }
    const ownership = deriveTaskBoundOwner({
      taskIds: source.ownerTaskIds, sliceMembership: input.sliceMembership,
      planText: input.planText, appendedChildren: input.appendedChildren, declaredPositions: input.declaredPositions,
    });
    if (ownership.kind === 'halt') return { kind: 'halt', haltClass: 'needs-human', detail: ownership.detail };
    const paths = await classifyCitedPaths(source.citedPaths, input.leafTip, input.git);
    if ('kind' in paths) return { kind: 'halt', haltClass: 'needs-human', detail: paths.detail };
    const host = await selectHost({ owner: ownership.owner as ChildId, inputs: paths.inputs, positions: input.declaredPositions, leafTip: input.leafTip, git: input.git });
    if ('kind' in host) return { kind: 'halt', haltClass: 'needs-human', detail: host.detail };
    const base = { findingId: source.id, kind: 'audit' as const, owner: ownership.owner as ChildId, host: host.host, reason: host.reason === 'prerequisite-paths' ? host.reason : ownership.reason, fallback: [], ...(paths.inputs.length === 0 ? {} : { prerequisitePaths: paths.inputs }) };
    const existingTask = existingTaskFields(source, mixedRound);
    const item: RoutedItem = existingTask === undefined ? base : { ...base, ...existingTask };
    resolved.push({ source, item });
  }

  const judged = await runResidueRoutingCall({ items: residue.map(residueJudgeItem), declaredPositions: input.declaredPositions, judge: input.judge });
  if (judged.kind === 'halt') return { kind: 'halt', haltClass: 'needs-human', detail: `Cannot route residue ${judged.itemId}: ${judged.detail}` };
  for (const answer of judged.answers) {
    const source = residue.find((item) => item.id === answer.itemId)!;
    const owner = resolveResidueOwner(answer);
    const paths = await classifyCitedPaths(source.citedPaths, input.leafTip, input.git);
    if ('kind' in paths) return { kind: 'halt', haltClass: 'needs-human', detail: paths.detail };
    const host = await selectHost({ owner: owner.owner as ChildId, inputs: paths.inputs, positions: input.declaredPositions, leafTip: input.leafTip, git: input.git });
    if ('kind' in host) return { kind: 'halt', haltClass: 'needs-human', detail: host.detail };
    const base = { findingId: source.id, kind: 'audit' as const, owner: owner.owner as ChildId, host: host.host, reason: host.reason === 'prerequisite-paths' ? host.reason : owner.reason, rationale: owner.rationale, fallback: [], ...(paths.inputs.length === 0 ? {} : { prerequisitePaths: paths.inputs }) };
    const existingTask = existingTaskFields(source, mixedRound);
    const item: RoutedItem = existingTask === undefined ? base : { ...base, ...existingTask };
    resolved.push({ source, item });
  }

  if (resolved.length === 0) return { kind: 'halt', haltClass: 'needs-human', detail: 'No admitted work can be routed' };
  const hosts = hostOrder(resolved.map(({ item }) => item.host));
  const failRows = input.consolidatedManualTestFail ?? [];
  // FAIL-only joins retain their existing deterministic kickback.  In a mixed
  // round, however, the retry obligation is durable routed work: host it with
  // the lowest task-owned host without ever asking the residue judge or
  // manufacturing another remediation task.
  const taskBoundHosts = hostOrder(
    resolved.filter(({ source }) => !isResidue(source)).map(({ item }) => item.host),
  );
  // A residue item can be hosted below the task work it accompanies.  The
  // mixed FAIL remains taskless, so when residue coexists its durable host is
  // selected only from the mechanically task-bound portion of the round.
  const failHost = residue.length > 0 && taskBoundHosts.length > 0 ? taskBoundHosts[0]! : hosts[0]!;
  const mixedFailItem: RoutedItem | undefined = failRows.length === 0 ? undefined : {
    findingId: 'manual-test-fail', kind: 'audit', owner: failHost, host: failHost,
    reason: 'mixed-round', fallback: [],
  };
  const hints: Record<number, string> = {};
  for (const host of hosts) {
    const own = resolved.filter(({ item }) => item.host === host).map(({ source }) => hintFor(source.gap)).filter(Boolean);
    hints[host] = [...own, ...failRows].join('\n');
  }
  const byHost: Record<number, { gap: CriterionBoundRemediationGap; gateSource: string }[]> = {};
  for (const host of hosts) {
    // Existing-task gaps are durable hint context in a consolidated round,
    // not new rem-* work.  Keep the empty host allocation so the retry hint
    // survives with the route record, while allocating no block for it.
    byHost[host] = resolved
      .filter(({ item, source }) => item.host === host && !source.existingTask)
      .map(({ source }) => ({ gap: source.gap, gateSource: source.gateSource }));
  }
  let allocation: FrozenAllocation;
  try {
    allocation = await allocateFrozenBlocks({ itemsByHost: byHost, leafPlan: input.leafPlan ?? input.planText, hostPlans: input.hostPlans ?? [], roundId: input.roundId, git: input.git });
  } catch (error) { return { kind: 'halt', haltClass: 'needs-human', detail: error instanceof Error ? error.message : String(error) }; }
  allocation = Object.fromEntries(Object.entries(allocation).map(([host, value]) => [host, { ...value, ...(hints[Number(host)] ? { retryHint: hints[Number(host)] } : {}) }])) as FrozenAllocation;
  return {
    kind: 'routed',
    items: [...resolved.map(({ item }) => item), ...(mixedFailItem === undefined ? [] : [mixedFailItem])],
    hosts,
    allocation,
    hostHints: hints,
  };
}
