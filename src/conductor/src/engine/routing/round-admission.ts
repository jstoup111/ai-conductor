import type { ChildId } from '../child-context.js';
import { makeGitRunner } from '../rebase.js';
import { remediationRoutedEvent, routedRepairPhaseEvent, withOutboxEvent } from './routing-events.js';
import { readRepairMarker, readRouteRecord, writeRoutingTransaction, type RouteRecordStoreDependencies } from './route-record-store.js';
import { parseRoundId, type RouteRecord } from './route-types.js';

export type AdmitRoundResult = { readonly kind: 'admitted'; readonly record: RouteRecord } | { readonly kind: 'refused'; readonly detail: string };

/** Atomically records the first host marker and the corresponding event outbox. */
export async function admitRound(
  worktree: string,
  slug: string,
  record: RouteRecord,
  firstHost: ChildId,
  dependencies: RouteRecordStoreDependencies = {},
): Promise<AdmitRoundResult> {
  const marker = await readRepairMarker(worktree, slug, dependencies);
  if (marker.kind !== 'absent') return { kind: 'refused', detail: marker.kind === 'marker' ? `routing round ${marker.marker.roundId} is already open` : 'routing marker is unreadable' };
  const stored = await readRouteRecord(worktree, slug, record.roundId, dependencies);
  if (stored.kind !== 'record') return { kind: 'refused', detail: 'routing record is unavailable before admission' };
  if (stored.record.phase !== 'prepared' || stored.record.hosts[firstHost] !== 'pending') return { kind: 'refused', detail: `routing round ${record.roundId} is not prepared for host ${firstHost}` };
  let next: RouteRecord = { ...stored.record, phase: 'open', hosts: { ...stored.record.hosts, [firstHost]: 'admitted' } };
  next = withOutboxEvent(next, remediationRoutedEvent(next));
  next = withOutboxEvent(next, routedRepairPhaseEvent(next.roundId, firstHost, 'admitted', false));
  const wrote = await writeRoutingTransaction(worktree, slug, [
    { kind: 'update-record', previous: stored, record: next },
    { kind: 'create-marker', marker: { host: firstHost, roundId: record.roundId } },
  ], dependencies);
  return wrote.kind === 'updated' ? { kind: 'admitted', record: next } : { kind: 'refused', detail: `routing admission refused: ${wrote.kind}` };
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
