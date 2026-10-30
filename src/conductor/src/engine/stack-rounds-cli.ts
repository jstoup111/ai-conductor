import { parseChildId, type ChildId } from './child-context.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import {
  readRepairMarker,
  readRouteRecord,
  type ReadRepairMarkerResult,
  type ReadRouteRecordResult,
} from './routing/route-record-store.js';
import { assertNever, parseRoundId, type RoundId } from './routing/route-types.js';

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
    readonly droppedHosts: readonly ChildId[];
    readonly findingIds: readonly string[];
  }
  | { readonly kind: 'refused'; readonly detail: string };

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
    const abandon = stored.record.kind === 'operator'
      ? `; use ai-conductor stack land --slug ${slug} --abandon`
      : '';
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
        break;
      case 'restacked':
      case 'done':
      case 'rerouted':
        break;
      case 'admitted':
      case 'repairing':
      case 'reroute-moved':
      case 'built':
      case 'abandoning':
      case 'abandoned':
        return { kind: 'refused', detail: `routing round ${roundId} host ${host} is ${state}` };
      default:
        return assertNever(state);
    }
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
  const dropped = new Set(droppedHosts);
  return {
    kind: 'supersedable',
    stored,
    supersededBy,
    droppedHosts,
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
    return pending === undefined
      ? []
      : [`wedge: ${roundId} host ${pending[0]} pending unadmitted behind marker ${marker.roundId}; ai-conductor stack rounds --slug ${slug} --close ${roundId} --reason <text>`];
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
