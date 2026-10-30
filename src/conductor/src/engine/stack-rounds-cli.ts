import { makeGitRunner, type GitRunner } from './rebase.js';
import {
  readRepairMarker,
  readRouteRecord,
  type ReadRepairMarkerResult,
  type ReadRouteRecordResult,
} from './routing/route-record-store.js';
import { parseRoundId, type RoundId } from './routing/route-types.js';

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
