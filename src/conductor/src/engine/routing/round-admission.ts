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
import { assertNever, isLegalRoundPhaseTransition, parseRoundId, type RouteRecord, type RoundId } from './route-types.js';
import { completeRerouteSync } from './prerequisite-claim.js';
import { publishedStackRefusal } from '../stack-publication.js';
import { advanceRound } from './routed-exit.js';
import { readRevalidationQueue } from './route-record-store.js';
import { childBranchFor } from '../feature-branch-identity.js';
import { switchToChild } from '../child-lifecycle.js';
import { ConductorEventEmitter } from '../../ui/events.js';

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
  /** A crash occurred after the host's entry CAS and before it journaled its exit. */
  | { readonly kind: 'resume-exit'; readonly roundId: RoundId; readonly host: ChildId }
  | { readonly kind: 'navigate-host'; readonly roundId: RoundId; readonly host: ChildId }
  /** The current call durably returned from the last host to the leaf. */
  | { readonly kind: 'leaf-returned'; readonly roundId: RoundId }
  /** Route records remain only as closed history; no marker or queue work remains. */
  | { readonly kind: 'quiescent' }
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
          const switched = await switchToChild(worktree, { child: host, position: host, branch: branch.branch }, new ConductorEventEmitter(), undefined, { git });
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
      return deleted.kind === 'updated' ? { kind: 'aborted', roundId: id } : { kind: 'unavailable', detail: `cannot abort prepared routing round: ${deleted.kind}` };
    }
    const builtHost = Object.entries(stored.record.hosts).find(([, state]) => state === 'built');
    if (builtHost) return { kind: 'resume-exit', roundId: id, host: Number(builtHost[0]) as ChildId };
    const activeHost = Object.entries(stored.record.hosts).find(([, state]) => state === 'admitted' || state === 'repairing');
    if (activeHost) return { kind: 'navigate-leaf-to-build', roundId: id, host: Number(activeHost[0]) as ChildId };
    if (stored.record.phase === 'open') {
      const advanced = await advanceRound(worktree, slug, stored, { git });
      switch (advanced.kind) {
        case 'admitted':
          return { kind: 'navigate-host', roundId: id, host: advanced.host };
        case 'leaf-returned':
          return { kind: 'leaf-returned', roundId: id };
        case 'unavailable':
          return { kind: 'unavailable', detail: advanced.detail };
        case 'closed':
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
