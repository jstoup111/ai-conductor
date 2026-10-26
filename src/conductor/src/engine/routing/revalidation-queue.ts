import type { ChildId } from '../child-context.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { childRevalidatedEvent } from './routing-events.js';
import {
  createRouteRecord,
  nextRoundId,
  readRepairMarker,
  readRouteRecord,
  readRevalidationQueue,
  transitionHost,
  writeRoutingTransaction,
  type StoredRouteRecord,
} from './route-record-store.js';
import { admitRound } from './round-admission.js';
import { assertNever, parseRoundId } from './route-types.js';
import type { RevalidationQueueEntry, RevalidationQueueRecord, RoundId } from './route-types.js';

export interface MergeQueueGenerationOptions {
  readonly acknowledge?: ChildId;
}

function mergeEntry(previous: RevalidationQueueEntry, next: RevalidationQueueEntry): RevalidationQueueEntry {
  return {
    ...next,
    gates: [...new Set([...previous.gates, ...next.gates])],
  };
}

/** Creates the next durable queue generation from a restack's produced entries. */
export function mergeQueueGeneration(
  current: RevalidationQueueRecord,
  produced: readonly RevalidationQueueEntry[],
  options: MergeQueueGenerationOptions = {},
): RevalidationQueueRecord {
  const entries = new Map<ChildId, RevalidationQueueEntry>();
  for (const entry of [...current.entries, ...produced]) {
    const previous = entries.get(entry.child);
    entries.set(entry.child, previous === undefined ? entry : mergeEntry(previous, entry));
  }
  if (options.acknowledge !== undefined) entries.delete(options.acknowledge);

  return {
    generation: current.generation + 1,
    entries: [...entries.values()].sort((left, right) => left.position - right.position),
    outbox: current.outbox,
  };
}

export type ConsumeLowestQueuedResult =
  | { readonly kind: 'admitted'; readonly roundId: RoundId; readonly host: ChildId }
  | { readonly kind: 'none' | 'busy' | 'unavailable' };

/** Converts only the queue head into a durable revalidate route. */
export async function consumeLowestQueued(
  worktree: string,
  slug: string,
  options: { readonly git?: GitRunner } = {},
): Promise<ConsumeLowestQueuedResult> {
  const git = options.git ?? makeGitRunner(worktree);
  const marker = await readRepairMarker(worktree, slug, { git });
  if (marker.kind === 'marker') return { kind: 'busy' };
  if (marker.kind === 'unreadable') return { kind: 'unavailable' };
  const queue = await readRevalidationQueue(worktree, slug, { git });
  if (queue.kind === 'absent' || queue.kind === 'queue' && queue.queue.entries.length === 0) return { kind: 'none' };
  if (queue.kind !== 'queue') return { kind: 'unavailable' };
  const entry = queue.queue.entries[0]!;
  const roundId = await nextRoundId(worktree, slug, { git });
  if (typeof roundId !== 'string') return { kind: 'unavailable' };
  const created = await createRouteRecord(worktree, slug, {
    roundId,
    kind: 'revalidate',
    items: [],
    allocation: { [entry.child]: { remTaskIds: [], blockBodies: [] } },
  }, { git });
  if (created.kind !== 'created') return { kind: created.kind === 'cas-failed' ? 'busy' : 'unavailable' };
  const admitted = await admitRound(worktree, slug, created.record, entry.child, { git });
  return admitted.kind === 'admitted' ? { kind: 'admitted', roundId, host: entry.child } : { kind: 'unavailable' };
}

export type AcknowledgeQueueEntryResult =
  | { readonly kind: 'acknowledged'; readonly leavesRoundOpen: boolean }
  | { readonly kind: 'stale' | 'unavailable' };

/** Acknowledges a fresh no-commit revalidation with its queue, marker and route in one CAS. */
export async function acknowledgeQueueEntry(
  worktree: string,
  slug: string,
  stored: StoredRouteRecord,
  host: ChildId,
  options: { readonly git?: GitRunner } = {},
): Promise<AcknowledgeQueueEntryResult> {
  const git = options.git ?? makeGitRunner(worktree);
  const marker = await readRepairMarker(worktree, slug, { git });
  const queue = await readRevalidationQueue(worktree, slug, { git });
  if (marker.kind !== 'marker' || marker.marker.roundId !== stored.record.roundId || marker.marker.host !== host || queue.kind !== 'queue') return { kind: 'stale' };
  const pin = stored.record.entry?.host === host ? stored.record.entry.revalidation : undefined;
  if (!pin || queue.blob !== pin.queueBlob || queue.queue.generation !== pin.generation) return { kind: 'stale' };
  const entry = queue.queue.entries.find((candidate) => candidate.child === host);
  if (entry === undefined) return { kind: 'stale' };
  const closure = await git(['rev-parse', '-q', '--verify', `refs/conductor/${slug}/closed/c${host}`]);
  if (closure.exitCode !== 0 || closure.stdout.trim() !== entry.closureSha || entry.closureSha !== pin.closureSha) return { kind: 'stale' };
  const nextQueue = mergeQueueGeneration(queue.queue, [], { acknowledge: host });
  const event = childRevalidatedEvent(host, nextQueue.generation, entry.closureSha, 'passed');
  const queueWithEvent = { ...nextQueue, outbox: [...nextQueue.outbox, { eventId: event.eventId, occurredAt: event.occurredAt, event }] };
  let otherRoundOpen = false;
  const routes = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
  if (routes.exitCode !== 0) return { kind: 'unavailable' };
  for (const ref of routes.stdout.split('\n').filter(Boolean)) {
    const id = parseRoundId(ref.split('/').at(-1) ?? '');
    if (!id || id === stored.record.roundId) continue;
    const other = await readRouteRecord(worktree, slug, id, { git });
    if (other.kind !== 'record') return { kind: 'unavailable' };
    if (other.record.phase !== 'closed') { otherRoundOpen = true; break; }
  }
  // A revalidate round with no more queue work deliberately stays open for
  // returnToLeaf. Audit rounds, however, retain their recorded host sequence;
  // acknowledging one queued host must never close away a later pending host.
  const leavesRoundOpen = (() => {
    switch (stored.record.kind) {
      case 'revalidate':
        return queueWithEvent.entries.length === 0 && !otherRoundOpen;
      case 'audit':
      case 'operator':
        return false;
      default:
        return assertNever(stored.record.kind);
    }
  })();
  const done = transitionHost(stored, host, 'done', { credit: false });
  if (done.kind !== 'updated') return { kind: 'stale' };
  const record = (() => {
    switch (stored.record.kind) {
      case 'audit':
      case 'operator':
        return done.record;
      case 'revalidate':
        return leavesRoundOpen ? done.record : { ...done.record, phase: 'closed' as const };
      default:
        return assertNever(stored.record.kind);
    }
  })();
  const wrote = await writeRoutingTransaction(worktree, slug, [
    { kind: 'verify-ref', ref: `refs/conductor/${slug}/closed/c${host}`, value: entry.closureSha },
    { kind: 'update-record', previous: stored, record },
    { kind: 'delete-marker', old: marker.blob },
    { kind: 'update-queue', previous: queue, queue: queueWithEvent },
  ], { git });
  return wrote.kind === 'updated'
    ? { kind: 'acknowledged', leavesRoundOpen }
    : wrote.kind === 'cas-failed' ? { kind: 'stale' } : { kind: 'unavailable' };
}
