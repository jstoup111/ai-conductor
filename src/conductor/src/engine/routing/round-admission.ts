import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildId } from '../child-context.js';
import { ConductorEventEmitter } from '../conductor-event-emitter.js';
import { FEATURE_EVENT_LOG_PATH, persistOnActiveEventSpine } from '../event-persister.js';
import { makeGitRunner } from '../rebase.js';
import { operatorRoundEvent, remediationRoutedEvent, withOutboxEvent } from './routing-events.js';
import {
  drainOutbox,
  drainRoutingOutboxes,
  readRepairMarker,
  readRouteRecord,
  transitionHost,
  writeRoutingTransaction,
  type PersistOutboxEvent,
  type RouteRecordStoreDependencies,
} from './route-record-store.js';
import { assertNever, isLegalRoundPhaseTransition, parseRoundId, type HostState, type RegionGate, type RouteRecord, type RoundId } from './route-types.js';
import { completeRerouteSync } from './prerequisite-claim.js';
import { publishedStackRefusal } from '../stack-publication.js';
import { advanceRound, requestRoutedExit, selectNextHost, type RequestRoutedExitInput } from './routed-exit.js';
import { readRevalidationQueue } from './route-record-store.js';
import { childBranchFor } from '../feature-branch-identity.js';

export type AdmitRoundResult = { readonly kind: 'admitted'; readonly record: RouteRecord } | { readonly kind: 'refused'; readonly detail: string; readonly fence?: true };

/** Admission may deliver its durable route occurrences only after its marker transaction commits. */
export type AdmitRoundDependencies = RouteRecordStoreDependencies & {
  readonly persist?: PersistOutboxEvent;
};

export type RoundAdmissionFenceResult = Extract<AdmitRoundResult, { readonly kind: 'refused' }> & { readonly fence: true };

/**
 * Reject a new admission while another active round could still make progress.
 * Revalidation is the sole exception: it may proceed only after every active
 * round has reached its queue handoff under the current durable queue.
 */
export async function checkRoundAdmissionFence(
  worktree: string,
  slug: string,
  record: Pick<RouteRecord, 'roundId' | 'kind'>,
  dependencies: RouteRecordStoreDependencies = {},
): Promise<RoundAdmissionFenceResult | undefined> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const marker = await readRepairMarker(worktree, slug, { git });
  if (marker.kind === 'unreadable') {
    return { kind: 'refused', detail: 'routing marker is unreadable', fence: true };
  }
  const listed = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
  if (listed.exitCode !== 0) {
    return { kind: 'refused', detail: 'cannot enumerate routing rounds for admission', fence: true };
  }
  const queue = record.kind === 'revalidate' ? await readRevalidationQueue(worktree, slug, { git }) : undefined;
  if (queue?.kind === 'unreadable') return { kind: 'refused', detail: 'revalidation queue is unreadable', fence: true };
  const entries = queue?.kind === 'queue' ? queue.queue.entries : [];
  for (const ref of listed.stdout.split('\n').filter(Boolean)) {
    const id = parseRoundId(ref.split('/').at(-1) ?? '');
    if (!id) return { kind: 'refused', detail: `routing ref ${ref} has an invalid round id`, fence: true };
    if (id === record.roundId) continue;
    const other = await readRouteRecord(worktree, slug, id, { git });
    if (other.kind !== 'record') {
      return { kind: 'refused', detail: `routing round ${id} is unreadable`, fence: true };
    }
    const active = other.record.phase === 'open' ||
      (other.record.phase === 'prepared' && marker.kind === 'marker' && marker.marker.roundId === id);
    if (!active) continue;
    if (record.kind === 'audit') {
      return { kind: 'refused', detail: `routing round ${id} is already open; cannot admit ${record.roundId}`, fence: true };
    }
    if (record.kind === 'revalidate') {
      if (Object.values(other.record.hosts).some((state) => state === 'admitted' || state === 'repairing' || state === 'built')) {
        return { kind: 'refused', detail: `routing round ${id} has an active host; cannot admit ${record.roundId}`, fence: true };
      }
      const next = await selectNextHost(worktree, other.record, { entries });
      if (next.kind !== 'queue') {
        return { kind: 'refused', detail: `routing round ${id} is not waiting for revalidation; cannot admit ${record.roundId}`, fence: true };
      }
    }
  }
  return undefined;
}

/** Atomically records the first host marker and the corresponding event outbox. */
export async function admitRound(
  worktree: string,
  slug: string,
  record: RouteRecord,
  firstHost: ChildId,
  dependencies: AdmitRoundDependencies = {},
): Promise<AdmitRoundResult> {
  const fence = await checkRoundAdmissionFence(worktree, slug, record, dependencies);
  if (fence !== undefined) return fence;
  // The conductor performs this check before allocating a route record. Keep
  // the same fence at the durable admission boundary so a publication that
  // lands between route planning and this transaction cannot open the round.
  if (await publishedStackRefusal(worktree, slug, { git: dependencies.git })) {
    return { kind: 'refused', detail: 'routing admission refused: published-stack' };
  }
  const marker = await readRepairMarker(worktree, slug, dependencies);
  if (marker.kind !== 'absent') return { kind: 'refused', detail: marker.kind === 'marker' ? `routing round ${marker.marker.roundId} is already open; cannot admit ${record.roundId}` : 'routing marker is unreadable' };
  const stored = await readRouteRecord(worktree, slug, record.roundId, dependencies);
  if (stored.kind !== 'record') return { kind: 'refused', detail: 'routing record is unavailable before admission' };
  const hostTransition = transitionHost(stored, firstHost, 'admitted', { credit: false });
  if (hostTransition.kind !== 'updated' || !isLegalRoundPhaseTransition(stored.record.phase, 'open')) {
    return { kind: 'refused', detail: `routing round ${record.roundId} is not prepared for host ${firstHost}` };
  }
  let next: RouteRecord = { ...hostTransition.record, phase: 'open' };
  if (next.kind === 'operator' && next.operator !== undefined) {
    next = withOutboxEvent(next, operatorRoundEvent(next.roundId, next.operator, firstHost, 'opened'));
  }
  next = withOutboxEvent(next, remediationRoutedEvent(next));
  const wrote = await writeRoutingTransaction(worktree, slug, [
    { kind: 'update-record', previous: stored, record: next },
    { kind: 'create-marker', marker: { host: firstHost, roundId: record.roundId } },
  ], dependencies);
  if (wrote.kind !== 'updated') return { kind: 'refused', detail: `routing admission refused: ${wrote.kind}` };

  // The outbox is the transaction's durable handoff: do not return a BUILD
  // route until every admission occurrence has reached the canonical spine.
  // A failed or contested removal leaves the event envelope durable for the
  // resume preflight to replay, but refuses this attempt to navigate early.
  if (dependencies.persist !== undefined) {
    const admitted = await readRouteRecord(worktree, slug, record.roundId, dependencies);
    if (admitted.kind !== 'record') {
      return { kind: 'refused', detail: 'routing admission record is unavailable after marker transaction' };
    }
    const drained = await drainOutbox(worktree, admitted, dependencies.persist, dependencies);
    if (drained.kind !== 'drained') {
      return { kind: 'refused', detail: `routing admission event delivery refused: ${drained.kind}` };
    }
  }
  return { kind: 'admitted', record: next };
}

export type ReconcileRoundsResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'aborted'; readonly roundId: string }
  | { readonly kind: 'navigate-leaf-to-build'; readonly roundId: string; readonly host: ChildId; readonly entryStep?: undefined }
  | { readonly kind: 'navigate-leaf-to-build'; readonly roundId: string; readonly host: ChildId; readonly entryStep: RegionGate }
  /** A crash occurred after the host's entry CAS and before it journaled its exit. */
  | { readonly kind: 'resume-exit'; readonly roundId: RoundId; readonly host: ChildId }
  | { readonly kind: 'navigate-host'; readonly roundId: RoundId; readonly host: ChildId }
  /** The current call durably returned from the last host to the leaf. */
  | { readonly kind: 'leaf-returned'; readonly roundId: RoundId }
  /** Route records remain only as closed history; no marker or queue work remains. */
  | { readonly kind: 'quiescent' }
  | { readonly kind: 'deferred' }
  /** A named routing round could not advance without risking durable state. */
  | { readonly kind: 'stalled'; readonly detail: string; readonly rounds: readonly RoundStallEntry[] }
  | { readonly kind: 'unavailable'; readonly detail: string };

/** Durable round context supplied to the bounded routing-stall recorder. */
export type RoundStallEntry =
  | { readonly roundId: RoundId; readonly readable: false }
  | { readonly roundId: RoundId; readonly readable: true; readonly unsettledHosts: Readonly<Record<ChildId, HostState>> };

export interface RecordedRoundStall {
  readonly detail: string;
  readonly haltClass?: 'mechanical';
}

/** Persist a bounded, progress-resetting reconciliation failure on the event spine. */
export async function recordRoundStall(
  worktree: string,
  _slug: string,
  stall: Extract<ReconcileRoundsResult, { readonly kind: 'stalled' }>,
  events: ConductorEventEmitter | undefined,
): Promise<RecordedRoundStall> {
  const rounds = stall.rounds.map((round) => round.readable
    ? { roundId: round.roundId, readable: true as const, unsettledHosts: round.unsettledHosts }
    : { roundId: round.roundId, readable: false as const });
  const key = JSON.stringify(rounds);
  let prior = 0;
  try {
    const lines = (await readFile(join(worktree, FEATURE_EVENT_LOG_PATH), 'utf8')).trim().split('\n').reverse();
    for (const line of lines) {
      let event: unknown;
      try { event = JSON.parse(line); } catch { continue; }
      if (!event || typeof event !== 'object') continue;
      const typed = event as { type?: string; rounds?: unknown };
      if (typed.type === 'routed_repair_phase' || typed.type === 'remediation_routed') break;
      if (typed.type === 'routing_rounds_stalled') {
        // Attempts are for one consecutive identical stall, not every
        // occurrence of that shape in the feature's history. A different
        // round set is progress in the diagnostic state and starts over.
        if (JSON.stringify(typed.rounds) !== key) break;
        prior += 1;
      }
    }
  } catch { /* no earlier feature log is the first attempt */ }
  const attempt = prior + 1;
  const rendered = rounds.map((round) => round.readable
    ? `${round.roundId} (${Object.entries(round.unsettledHosts).map(([host, state]) => `${host}: ${state}`).join(', ')})`
    : `${round.roundId} (unreadable)`)
    .join('; ');
  const detail = `routing rounds stalled: ${rendered}; ${stall.detail}`;
  await events?.emit({ type: 'routing_rounds_stalled', rounds, detail, attempt });
  return attempt <= 2 ? { detail, haltClass: 'mechanical' } : { detail };
}

export type ExitRoutedHostAndReconcileResult =
  | { readonly kind: 'exit-halted'; readonly detail: string }
  | { readonly kind: 'continued'; readonly next: ReconcileRoundsResult };

/** The sole production continuation after a routed host exit. */
export async function exitRoutedHostAndReconcile(
  input: RequestRoutedExitInput & {
    readonly exit?: typeof requestRoutedExit;
    readonly reconcile?: typeof reconcileRounds;
  },
): Promise<ExitRoutedHostAndReconcileResult> {
  const exited = await (input.exit ?? requestRoutedExit)(input);
  if (exited.kind === 'halted') return { kind: 'exit-halted', detail: exited.detail };
  const persist = input.persist ?? (input.events === undefined ? undefined : (event: Parameters<typeof persistOnActiveEventSpine>[1]) => persistOnActiveEventSpine(input.events!, event));
  if (persist !== undefined) {
    const drained = await drainRoutingOutboxes(input.worktree, input.slug, persist, { ...(input.git === undefined ? {} : { git: input.git }) });
    if (drained.kind !== 'drained') return { kind: 'exit-halted', detail: `routing round ${input.roundId} outbox refused: ${drained.kind}` };
  }
  return { kind: 'continued', next: await (input.reconcile ?? reconcileRounds)(input.worktree, input.slug, { ...(input.git === undefined ? {} : { git: input.git }) }) };
}

function unsettledHosts(record: RouteRecord): Readonly<Record<ChildId, HostState>> {
  return Object.fromEntries(Object.entries(record.hosts)
    .filter(([, state]) => state !== 'restacked' && state !== 'done' && state !== 'rerouted' && state !== 'abandoned')
    .map(([host, state]) => [Number(host) as ChildId, state])) as Readonly<Record<ChildId, HostState>>;
}

async function stalledRounds(
  worktree: string,
  slug: string,
  roundIds: readonly RoundId[],
  git: RouteRecordStoreDependencies['git'],
): Promise<readonly RoundStallEntry[]> {
  const rounds: RoundStallEntry[] = [];
  for (const roundId of roundIds) {
    const stored = await readRouteRecord(worktree, slug, roundId, { git });
    if (stored.kind !== 'record') {
      rounds.push({ roundId, readable: false });
    } else if (stored.record.phase !== 'closed') {
      rounds.push({ roundId, readable: true, unsettledHosts: unsettledHosts(stored.record) });
    }
  }
  return rounds;
}

/** Recover the durable record/marker handshake without inferring a round from a branch. */
export async function reconcileRounds(worktree: string, slug: string, dependencies: RouteRecordStoreDependencies = {}): Promise<ReconcileRoundsResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  let refs: string[];
  try {
    const listed = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
    if (listed.exitCode !== 0) return { kind: 'unavailable', detail: 'cannot enumerate route records' };
    refs = listed.stdout.split('\n').filter(Boolean);
  } catch { return { kind: 'unavailable', detail: 'cannot enumerate route records' }; }
  if (refs.length === 0) return { kind: 'none' };
  const marker = await readRepairMarker(worktree, slug, { git });
  if (marker.kind === 'unreadable') return { kind: 'unavailable', detail: 'routing marker is unreadable' };
  const ids: RoundId[] = [];
  for (const ref of refs) {
    const id = parseRoundId(ref.split('/').at(-1) ?? '');
    if (!id) return { kind: 'unavailable', detail: 'routing ref has an invalid round id' };
    ids.push(id);
  }
  const orderedIds = marker.kind === 'marker'
    ? [marker.marker.roundId, ...ids.filter((id) => id !== marker.marker.roundId)]
    : ids;
  const stalled = async (roundId: RoundId, detail: string): Promise<ReconcileRoundsResult> => ({
    kind: 'stalled',
    detail: `routing round ${roundId} stalled: ${detail}`,
    rounds: await stalledRounds(worktree, slug, orderedIds, git),
  });
  for (const id of orderedIds) {
    const stored = await readRouteRecord(worktree, slug, id, { git });
    if (stored.kind !== 'record') return stalled(id, 'routing record is unreadable');
    const abandonHost = Object.entries(stored.record.hosts)
      .find(([, state]) => state === 'abandoning' || state === 'abandoned');
    if (abandonHost !== undefined) {
      if (stored.record.kind !== 'operator' || stored.record.operator?.abandon === undefined) {
        return { kind: 'unavailable', detail: `operator abandon state is unavailable for routing round ${id}` };
      }
      const host = Number(abandonHost[0]) as ChildId;
      let current = stored;
      if (abandonHost[1] === 'abandoning') {
        const branch = childBranchFor(slug, host);
        if (!branch.ok) return { kind: 'unavailable', detail: branch.reason };
        const checkedOut = await git(['symbolic-ref', '--short', 'HEAD']);
        if (checkedOut.exitCode !== 0) return { kind: 'unavailable', detail: `cannot determine operator abandon host ${host} branch` };
        if (checkedOut.stdout.trim() !== branch.branch) {
          const { noOpChildLifecycleEvents, switchToChild } = await import('../child-lifecycle.js');
          const switched = await switchToChild(worktree, { child: host, position: host, branch: branch.branch }, noOpChildLifecycleEvents, undefined, { git });
          if (switched.kind !== 'completed') return { kind: 'unavailable', detail: 'reason' in switched ? switched.reason : `cannot switch to operator abandon host ${host}` };
        }
        // Keep the stage writer in its owning module. The dynamic edge avoids
        // making operator-round's existing admission dependency cyclic at
        // module initialization time.
        const { abandonOperatorRound } = await import('./operator-round.js');
        const abandoned = await abandonOperatorRound({ worktree, slug, roundId: id, host, git });
        if (abandoned.kind !== 'abandoned') return { kind: 'unavailable', detail: abandoned.detail };
        const reread = await readRouteRecord(worktree, slug, id, { git });
        if (reread.kind !== 'record') return { kind: 'unavailable', detail: `cannot reread abandoned operator round ${id}` };
        current = reread;
      }
      const returned = await (await import('./routed-exit.js')).returnToLeaf(worktree, slug, current, { git, abandon: true });
      if (returned.kind === 'unavailable') return returned;
      return returned.kind === 'leaf-returned'
        ? { kind: 'leaf-returned', roundId: id }
        : { kind: 'deferred' };
    }
    if (Object.values(stored.record.hosts).includes('reroute-moved')) {
      const synced = await completeRerouteSync({ worktree, slug, roundId: id, git });
      if (synced.kind === 'refused') return { kind: 'unavailable', detail: synced.detail };
      return { kind: 'deferred' };
    }
    if (stored.record.phase === 'prepared' && (marker.kind !== 'marker' || marker.marker.roundId !== id)) {
      const deleted = await writeRoutingTransaction(worktree, slug, [{ kind: 'delete-record', previous: stored }], { git });
      return deleted.kind === 'updated' ? { kind: 'aborted', roundId: id } : stalled(id, `cannot abort prepared routing round: ${deleted.kind}`);
    }
    const builtHost = Object.entries(stored.record.hosts).find(([, state]) => state === 'built');
    if (builtHost) return { kind: 'resume-exit', roundId: id, host: Number(builtHost[0]) as ChildId };
    const activeHost = Object.entries(stored.record.hosts).find(([, state]) => state === 'admitted' || state === 'repairing');
    if (activeHost) {
      const navigation = { kind: 'navigate-leaf-to-build' as const, roundId: id, host: Number(activeHost[0]) as ChildId };
      return stored.record.kind === 'operator'
        ? { ...navigation, entryStep: stored.record.operator!.entryStep }
        : navigation;
    }
    if (stored.record.phase === 'open') {
      const advanced = await advanceRound(worktree, slug, stored, { git });
      switch (advanced.kind) {
        case 'admitted':
          return { kind: 'navigate-host', roundId: id, host: advanced.host };
        case 'leaf-returned':
          return { kind: 'leaf-returned', roundId: id };
        case 'unavailable':
          return stalled(id, advanced.detail);
        case 'closed':
          continue;
        case 'queue':
          return { kind: 'deferred' };
      }
      return assertNever(advanced);
    }
  }
  return marker.kind === 'absent' ? { kind: 'quiescent' } : { kind: 'deferred' };
}

/** True when routing durability says that automatic base movement would race a round. */
export async function routedRoundOpen(worktree: string, slug: string, dependencies: RouteRecordStoreDependencies = {}): Promise<boolean> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const queue = await readRevalidationQueue(worktree, slug, { git });
  if (queue.kind === 'unreadable') return true;
  if (queue.kind === 'queue' && queue.queue.entries.length > 0) return true;
  const listed = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
  if (listed.exitCode !== 0) return true;
  for (const ref of listed.stdout.split('\n').filter(Boolean)) {
    const id = parseRoundId(ref.split('/').at(-1) ?? '');
    if (!id) return true;
    const record = await readRouteRecord(worktree, slug, id, { git });
    if (record.kind !== 'record' || record.record.phase !== 'closed') return true;
  }
  return false;
}
