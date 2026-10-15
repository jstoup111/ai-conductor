import type { ChildId } from '../child-context.js';
import { makeGitRunner } from '../rebase.js';
import { remediationRoutedEvent, withOutboxEvent } from './routing-events.js';
import {
  drainOutbox,
  readRepairMarker,
  readRouteRecord,
  transitionHost,
  writeRoutingTransaction,
  type PersistOutboxEvent,
  type RouteRecordStoreDependencies,
} from './route-record-store.js';
import { isLegalRoundPhaseTransition, parseRoundId, type RouteRecord } from './route-types.js';

export type AdmitRoundResult = { readonly kind: 'admitted'; readonly record: RouteRecord } | { readonly kind: 'refused'; readonly detail: string };

/** Admission may deliver its durable route occurrences only after its marker transaction commits. */
export type AdmitRoundDependencies = RouteRecordStoreDependencies & {
  readonly persist?: PersistOutboxEvent;
};

/** Atomically records the first host marker and the corresponding event outbox. */
export async function admitRound(
  worktree: string,
  slug: string,
  record: RouteRecord,
  firstHost: ChildId,
  dependencies: AdmitRoundDependencies = {},
): Promise<AdmitRoundResult> {
  const marker = await readRepairMarker(worktree, slug, dependencies);
  if (marker.kind !== 'absent') return { kind: 'refused', detail: marker.kind === 'marker' ? `routing round ${marker.marker.roundId} is already open; cannot admit ${record.roundId}` : 'routing marker is unreadable' };
  const stored = await readRouteRecord(worktree, slug, record.roundId, dependencies);
  if (stored.kind !== 'record') return { kind: 'refused', detail: 'routing record is unavailable before admission' };
  const hostTransition = transitionHost(stored, firstHost, 'admitted', { credit: false });
  if (hostTransition.kind !== 'updated' || !isLegalRoundPhaseTransition(stored.record.phase, 'open')) {
    return { kind: 'refused', detail: `routing round ${record.roundId} is not prepared for host ${firstHost}` };
  }
  let next: RouteRecord = { ...hostTransition.record, phase: 'open' };
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
  | { readonly kind: 'navigate-leaf-to-build'; readonly roundId: string; readonly host: ChildId }
  | { readonly kind: 'deferred' }
  | { readonly kind: 'unavailable'; readonly detail: string };

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
  for (const ref of refs) {
    const id = parseRoundId(ref.split('/').at(-1) ?? '');
    if (!id) return { kind: 'unavailable', detail: 'routing ref has an invalid round id' };
    const stored = await readRouteRecord(worktree, slug, id, { git });
    if (stored.kind !== 'record') return { kind: 'unavailable', detail: `routing record ${id} is unreadable` };
    if (stored.record.phase === 'prepared' && (marker.kind !== 'marker' || marker.marker.roundId !== id)) {
      const deleted = await writeRoutingTransaction(worktree, slug, [{ kind: 'delete-record', previous: stored }], { git });
      return deleted.kind === 'updated' ? { kind: 'aborted', roundId: id } : { kind: 'unavailable', detail: `cannot abort prepared routing round: ${deleted.kind}` };
    }
    const admitted = Object.entries(stored.record.hosts).find(([, state]) => state === 'admitted');
    if (admitted) return { kind: 'navigate-leaf-to-build', roundId: id, host: Number(admitted[0]) as ChildId };
  }
  return { kind: 'deferred' };
}

/** True when routing durability says that automatic base movement would race a round. */
export async function routedRoundOpen(worktree: string, slug: string, dependencies: RouteRecordStoreDependencies = {}): Promise<boolean> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const queue = await git(['rev-parse', '-q', '--verify', `refs/conductor/${slug}/revalidate`]);
  if (queue.exitCode === 0) return true;
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
