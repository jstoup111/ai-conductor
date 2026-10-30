import { parseChildId, type ChildId } from './child-context.js';
import { resolveCliFeatureWorktree, resolveMachineOperatorIdentity } from './cli-operator-authority.js';
import { loadConfig } from './config.js';
import { acquireFeatureDispatchLease, formatFeatureDispatchLeaseRefusal } from './feature-dispatch-lease.js';
import { resolveMainRepoRoot } from './park-marker.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { hasDurableChildState } from './slice-topology.js';
import type { StackRoundsDispatch } from '../types/cli.js';
import {
  readRepairMarker,
  readRouteRecord,
  writeRoutingTransaction,
  type ReadRepairMarkerResult,
  type ReadRouteRecordResult,
} from './routing/route-record-store.js';
import { routingRoundSupersededEvent, withOutboxEvent } from './routing/routing-events.js';
import { assertNever, parseRoundId, routingSettingOn, type RoundId } from './routing/route-types.js';

export interface DescribedRoutingRound {
  readonly roundId: RoundId;
  readonly stored: ReadRouteRecordResult;
}

export interface RoutingRoundsDescription {
  readonly rounds: readonly DescribedRoutingRound[];
  readonly marker: ReadRepairMarkerResult;
  readonly readable: boolean;
}

export interface DescribeRoutingRoundsDependencies {
  readonly git?: GitRunner;
  readonly readRouteRecord?: typeof readRouteRecord;
  readonly readRepairMarker?: typeof readRepairMarker;
}

export type RoundSupersessionCheck =
  | {
    readonly kind: 'supersedable';
    readonly stored: Extract<ReadRouteRecordResult, { readonly kind: 'record' }>;
    readonly supersededBy: RoundId;
    readonly droppedHosts: readonly [ChildId, ...ChildId[]];
    readonly findingIds: readonly string[];
  }
  | { readonly kind: 'refused'; readonly detail: string };

export interface SupersedeRoundInput {
  readonly worktree: string;
  readonly slug: string;
  readonly checked: Extract<RoundSupersessionCheck, { readonly kind: 'supersedable' }>;
  readonly reason: string;
  readonly operator: string;
  readonly git?: GitRunner;
}

export type SupersedeRoundResult =
  | { readonly kind: 'superseded'; readonly event: Extract<import('../types/events.js').ConductorEvent, { readonly type: 'routing_round_superseded' }> }
  | { readonly kind: 'refused'; readonly detail: string };

/** Close one already-checked audit round with its durable occurrence in one CAS. */
export async function supersedeRound(input: SupersedeRoundInput): Promise<SupersedeRoundResult> {
  const { worktree, slug, checked } = input;
  const hosts = Object.fromEntries(Object.entries(checked.stored.record.hosts).map(([host, state]) => [
    host,
    state === 'pending' ? 'done' : state,
  ])) as typeof checked.stored.record.hosts;
  const event = routingRoundSupersededEvent(
    checked.stored.record,
    checked.supersededBy,
    checked.droppedHosts,
    checked.findingIds,
    input.reason.trim(),
    input.operator.trim(),
  );
  const record = withOutboxEvent({ ...checked.stored.record, phase: 'closed', hosts }, event);
  const wrote = await writeRoutingTransaction(worktree, slug, [
    { kind: 'update-record', previous: checked.stored, record },
  ], { ...(input.git === undefined ? {} : { git: input.git }) });
  if (wrote.kind === 'updated') return { kind: 'superseded', event };
  const detail = wrote.kind === 'cas-failed'
    ? `contested write for routing round ${checked.stored.record.roundId}`
    : `failed write for routing round ${checked.stored.record.roundId} (${wrote.kind})`;
  return { kind: 'refused', detail };
}

export interface StackRoundsCliDeps extends DescribeRoutingRoundsDependencies {
  readonly cwd?: string;
  readonly print?: (message: string) => void;
  readonly resolveMainRoot?: (cwd: string) => Promise<string>;
  readonly resolveWorktree?: (slug: string) => Promise<string | undefined>;
  readonly loadConfig?: typeof loadConfig;
  readonly hasDurableChildState?: typeof hasDurableChildState;
  readonly resolveOperator?: (root: string) => Promise<string | undefined>;
  readonly acquireLease?: typeof acquireFeatureDispatchLease;
  readonly checkSupersession?: typeof checkRoundSupersession;
  readonly supersede?: typeof supersedeRound;
}

type StackRoundsEligibility = { readonly kind: 'eligible' } | { readonly kind: 'refused'; readonly detail: string };

async function checkStackRoundsEligibility(worktree: string, slug: string, deps: StackRoundsCliDeps): Promise<StackRoundsEligibility> {
  const config = await (deps.loadConfig ?? loadConfig)(worktree);
  if (!routingSettingOn(config.ok ? config.config : undefined)) {
    return { kind: 'refused', detail: 'Routing is disabled by stacked_prs.route_whole_feature_fixes; enable it before using stack rounds.' };
  }
  const durable = await (deps.hasDurableChildState ?? hasDurableChildState)(worktree, slug);
  if (durable === 'git-error') return { kind: 'refused', detail: 'Cannot determine durable child state; refusing stack rounds.' };
  if (!durable) return { kind: 'refused', detail: `Feature ${slug} is not a stacked feature; stack rounds is unavailable.` };
  return { kind: 'eligible' };
}

function refused(print: (message: string) => void, detail: string): number {
  print(`stack rounds: refused — ${detail}`);
  return 1;
}

/**
 * Read-only first pass for closing an old audit round. Refusal detail is
 * deliberately expanded by the next task; this task establishes the admitted
 * audit shape and the complete host-state classification seam.
 */
export async function checkRoundSupersession(
  worktree: string,
  slug: string,
  roundId: RoundId,
  dependencies: DescribeRoutingRoundsDependencies = {},
): Promise<RoundSupersessionCheck> {
  if (parseRoundId(roundId) === undefined) {
    return { kind: 'refused', detail: `routing round id ${roundId} is invalid` };
  }
  const git = dependencies.git ?? makeGitRunner(worktree);
  const readRecord = dependencies.readRouteRecord ?? readRouteRecord;
  const stored = await readRecord(worktree, slug, roundId, { git });
  if (stored.kind !== 'record') {
    return {
      kind: 'refused',
      detail: `routing round ${roundId} is ${stored.kind === 'absent' ? 'missing' : 'unreadable'}`,
    };
  }

  if (stored.record.phase !== 'open') {
    return { kind: 'refused', detail: `routing round ${roundId} is ${stored.record.phase}, not open` };
  }
  if (stored.record.kind !== 'audit') {
    // ai-conductor:session-command-context=operator-only
    const abandon = stored.record.kind === 'operator'
      ? `; use ai-conductor stack land --slug ${slug} --abandon`
      : '';
    // /ai-conductor:session-command-context
    return {
      kind: 'refused',
      detail: `routing round ${roundId} is ${stored.record.kind}; only audit rounds can be superseded${abandon}`,
    };
  }
  if (stored.record.reroute !== undefined) {
    return { kind: 'refused', detail: `routing round ${roundId} has an in-progress reroute` };
  }

  const droppedHosts: ChildId[] = [];
  for (const [host, state] of Object.entries(stored.record.hosts)) {
    const child = parseChildId(Number(host));
    if (child === undefined) return { kind: 'refused', detail: `routing round ${roundId} has invalid host ${host}` };
    switch (state) {
      case 'pending':
        droppedHosts.push(child);
        continue;
      case 'restacked':
      case 'done':
      case 'rerouted':
        continue;
      case 'admitted':
      case 'repairing':
      case 'reroute-moved':
      case 'built':
      case 'abandoning':
      case 'abandoned':
        return { kind: 'refused', detail: `routing round ${roundId} host ${host} is ${state}` };
    }
    assertNever(state);
  }
  if (droppedHosts.length === 0) {
    return { kind: 'refused', detail: `routing round ${roundId} has no pending hosts to drop` };
  }

  const readMarker = dependencies.readRepairMarker ?? readRepairMarker;
  const marker = await readMarker(worktree, slug, { git });
  if (marker.kind === 'unreadable') {
    return { kind: 'refused', detail: `routing round ${roundId}: repair marker is unreadable` };
  }
  if (marker.kind === 'marker' && marker.marker.roundId === roundId) {
    return { kind: 'refused', detail: `routing round ${roundId}: marker holds ${roundId}` };
  }

  const listed = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
  if (listed.exitCode !== 0) return { kind: 'refused', detail: `could not list routing rounds for ${slug}` };
  const roundIds = listed.stdout.split('\n')
    .filter(Boolean)
    .map((ref) => parseRoundId(ref.slice(`refs/conductor/${slug}/routes/`.length)))
    .filter((id): id is RoundId => id !== undefined)
    .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
  let supersededBy: RoundId | undefined;
  for (const otherRoundId of roundIds) {
    if (otherRoundId === roundId) continue;
    const other = await readRecord(worktree, slug, otherRoundId, { git });
    if (other.kind !== 'record') {
      return { kind: 'refused', detail: `other routing round ${otherRoundId} is ${other.kind === 'absent' ? 'missing' : 'unreadable'}` };
    }
    if (supersededBy === undefined && other.record.phase !== 'closed') supersededBy = otherRoundId;
  }
  if (supersededBy === undefined) {
    return { kind: 'refused', detail: `closing sole non-closed round ${roundId} would skip the leaf return` };
  }

  droppedHosts.sort((left, right) => left - right);
  const nonemptyDroppedHosts = droppedHosts as [ChildId, ...ChildId[]];
  const dropped = new Set(droppedHosts);
  return {
    kind: 'supersedable',
    stored,
    supersededBy,
    droppedHosts: nonemptyDroppedHosts,
    findingIds: stored.record.items.filter((item) => dropped.has(item.host)).map((item) => item.findingId),
  };
}

/**
 * Reads the durable routing namespace without acquiring a lease or touching
 * feature state.  Listing first means one malformed record never hides the
 * rounds that remain useful to an operator.
 */
export async function describeRoutingRounds(
  worktree: string,
  slug: string,
  dependencies: DescribeRoutingRoundsDependencies = {},
): Promise<RoutingRoundsDescription> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const readRecord = dependencies.readRouteRecord ?? readRouteRecord;
  const readMarker = dependencies.readRepairMarker ?? readRepairMarker;
  let roundIds: RoundId[] = [];
  let listedReadable = true;
  try {
    const listed = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
    if (listed.exitCode !== 0) {
      listedReadable = false;
    } else {
      roundIds = listed.stdout.split('\n')
        .filter(Boolean)
        .map((ref) => parseRoundId(ref.slice(`refs/conductor/${slug}/routes/`.length)))
        .filter((roundId): roundId is RoundId => roundId !== undefined)
        .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
    }
  } catch {
    listedReadable = false;
  }

  const rounds = await Promise.all(roundIds.map(async (roundId) => ({
    roundId,
    stored: await readRecord(worktree, slug, roundId, { git }),
  })));
  const marker = await readMarker(worktree, slug, { git });
  return {
    rounds,
    marker,
    readable: listedReadable && rounds.every((round) => round.stored.kind === 'record')
      && (marker.kind === 'absent' || marker.kind === 'marker'),
  };
}

function receiptState(receipt: { readonly settlementId?: string }): 'settled' | 'unsettled' {
  return receipt.settlementId === undefined ? 'unsettled' : 'settled';
}

function currentHost(record: Extract<ReadRouteRecordResult, { readonly kind: 'record' }>['record']): string {
  return Object.keys(record.hosts)[record.currentHostIndex] ?? 'unknown';
}

function wedges(slug: string, description: RoutingRoundsDescription): readonly string[] {
  if (description.marker.kind !== 'marker') return [];
  const marker = description.marker.marker;
  const active = new Set(['admitted', 'repairing', 'built', 'reroute-moved', 'abandoning', 'abandoned']);
  return description.rounds.flatMap(({ roundId, stored }) => {
    if (stored.kind !== 'record' || stored.record.phase !== 'open' || roundId === marker.roundId) return [];
    if (Object.values(stored.record.hosts).some((state) => active.has(state))) return [];
    const pending = Object.entries(stored.record.hosts).find(([, state]) => state === 'pending');
    // ai-conductor:session-command-context=operator-only
    return pending === undefined
      ? []
      : [`wedge: ${roundId} host ${pending[0]} pending unadmitted behind marker ${marker.roundId}; ai-conductor stack rounds --slug ${slug} --close ${roundId} --reason <text>`];
    // /ai-conductor:session-command-context
  });
}

/** Pure, human-readable projection of the read-only routing model. */
export function renderRoutingRounds(slug: string, description: RoutingRoundsDescription): string {
  if (description.rounds.length === 0 && description.marker.kind === 'absent') {
    return `Feature ${slug} has no routed rounds and no repair marker.`;
  }
  const lines = description.rounds.map(({ roundId, stored }) => {
    if (stored.kind === 'record') {
      const hosts = Object.entries(stored.record.hosts).map(([host, state]) => `${host}:${state}`).join(', ');
      return `${roundId} ${stored.record.kind} ${stored.record.phase} hosts ${hosts} current host ${currentHost(stored.record)} ${receiptState(stored.record.receipt)} outbox ${stored.record.outbox.length}`;
    }
    return `${roundId} ${stored.kind}${stored.kind === 'unreadable' && stored.blob !== undefined ? ` ${stored.blob}` : ''}`;
  });
  switch (description.marker.kind) {
    case 'marker': lines.push(`repair marker: host ${description.marker.marker.host} round ${description.marker.marker.roundId}`); break;
    case 'absent': lines.push('repair marker: absent'); break;
    case 'unreadable': lines.push(`repair marker: unreadable${description.marker.blob === undefined ? '' : ` ${description.marker.blob}`}`); break;
  }
  lines.push(...wedges(slug, description));
  return lines.join('\n');
}

/**
 * Dispatch the operator-facing routed-rounds commands. Inspection deliberately
 * has no lease; the close path takes one only after all read-only refusals.
 */
export async function dispatchStackRoundsCommand(
  command: StackRoundsDispatch,
  deps: StackRoundsCliDeps = {},
): Promise<number> {
  const print = deps.print ?? ((message: string) => process.stderr.write(`${message}\n`));
  const cwd = deps.cwd ?? process.cwd();
  const root = await (deps.resolveMainRoot ?? resolveMainRepoRoot)(cwd);
  const worktree = await (deps.resolveWorktree ?? ((slug) => resolveCliFeatureWorktree(slug, {
    cwd,
    resolveMainRoot: deps.resolveMainRoot,
  })))(command.slug);
  if (worktree === undefined) return refused(print, `feature '${command.slug}' is unavailable.`);

  const eligibility = await checkStackRoundsEligibility(worktree, command.slug, deps);
  if (eligibility.kind === 'refused') return refused(print, eligibility.detail);

  if (command.kind === 'stack-rounds-inspect') {
    const described = await describeRoutingRounds(worktree, command.slug, deps);
    print(renderRoutingRounds(command.slug, described));
    return described.readable ? 0 : 1;
  }

  const operator = await (deps.resolveOperator ?? resolveMachineOperatorIdentity)(root);
  if (!operator?.trim()) return refused(print, 'no approved operator identity is available.');
  const reason = command.reason.trim();
  if (!reason) return refused(print, 'a non-empty --reason is required.');
  const roundId = parseRoundId(command.roundId);
  if (roundId === undefined) return refused(print, `routing round id ${command.roundId} is invalid`);
  const checked = await (deps.checkSupersession ?? checkRoundSupersession)(worktree, command.slug, roundId, deps);
  if (checked.kind === 'refused') return refused(print, checked.detail);

  const acquired = await (deps.acquireLease ?? acquireFeatureDispatchLease)(root, command.slug, 'stack rounds --close');
  if (acquired.kind !== 'acquired') return refused(print, formatFeatureDispatchLeaseRefusal(acquired));
  try {
    const result = await (deps.supersede ?? supersedeRound)({
      worktree,
      slug: command.slug,
      checked,
      reason,
      operator: operator.trim(),
      ...(deps.git === undefined ? {} : { git: deps.git }),
    });
    if (result.kind === 'refused') return refused(print, result.detail);
    // ai-conductor:session-command-context=operator-only
    print(`stack rounds: closed ${roundId}; dropped hosts ${checked.droppedHosts.join(', ') || 'none'}; finding ids ${checked.findingIds.join(', ') || 'none'}; reason ${reason}. Clear any HALT with ai-conductor halt clear before the daemon resumes.`);
    // /ai-conductor:session-command-context
    return 0;
  } catch (error) {
    return refused(print, error instanceof Error ? error.message : String(error));
  } finally {
    const released = await acquired.lease.release();
    if (!released.ok) print(`stack rounds: refused — ${released.message}`);
  }
}
