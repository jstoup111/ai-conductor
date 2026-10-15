import { makeGitRunner, type GitRunner } from '../rebase.js';
import { journalRefFor, readRestackJournal } from '../restack/restack-journal.js';
import { parseCommitSha, type CommitSha } from '../restack/restack-types.js';
import { repairMarkerRefFor, revalidationQueueRefFor, routeRecordRefFor } from './routing-refs.js';
import {
  MAX_ROUTE_ROUNDS,
  isLegalHostTransition,
  parseRepairMarker,
  parseRoundId,
  parseRevalidationQueueRecord,
  parseRouteRecord,
  type RepairMarker,
  type RevalidationQueueRecord,
  type RouteRecord,
  type RoundId,
} from './route-types.js';
import type { ConductorEvent } from '../../types/events.js';
import { routedRepairPhaseEvent, withOutboxEvent } from './routing-events.js';

export type StoredRouteRecord = { readonly kind: 'record'; readonly slug: string; readonly blob: CommitSha; readonly record: RouteRecord };
export type ReadRouteRecordResult = { readonly kind: 'absent' } | { readonly kind: 'unreadable'; readonly blob?: CommitSha } | StoredRouteRecord;
export type ReadRepairMarkerResult = { readonly kind: 'absent' } | { readonly kind: 'unreadable'; readonly blob?: CommitSha } | { readonly kind: 'marker'; readonly slug: string; readonly blob: CommitSha; readonly marker: RepairMarker };
export type ReadRevalidationQueueResult = { readonly kind: 'absent' } | { readonly kind: 'unreadable'; readonly blob?: CommitSha } | { readonly kind: 'queue'; readonly slug: string; readonly blob: CommitSha; readonly queue: RevalidationQueueRecord };
export type WriteRouteRecordResult = { readonly kind: 'updated' } | { readonly kind: 'cas-failed' } | { readonly kind: 'restack-journal-open' } | { readonly kind: 'unavailable' };
export type NextRoundIdResult = RoundId | { readonly kind: 'round-limit' } | { readonly kind: 'unavailable' };

const ZERO_SHA = '0'.repeat(40);
export type RoutingTransactionOp =
  | { readonly kind: 'create-record'; readonly record: RouteRecord }
  | { readonly kind: 'update-record'; readonly previous: StoredRouteRecord; readonly record: RouteRecord }
  | { readonly kind: 'delete-record'; readonly previous: StoredRouteRecord }
  | { readonly kind: 'create-marker'; readonly marker: RepairMarker };

export interface RouteRecordStoreDependencies { readonly git?: GitRunner }
export type PersistOutboxEvent = (event: ConductorEvent) => Promise<'persisted' | 'duplicate'>;
export type DrainOutboxResult = { readonly kind: 'drained' } | { readonly kind: 'persist-failed' } | { readonly kind: 'retry' } | { readonly kind: 'unavailable' };

async function readBlob(ref: string, git: GitRunner): Promise<{ readonly kind: 'absent' } | { readonly kind: 'unreadable' } | { readonly blob: CommitSha; readonly content: string }> {
  try {
    const refResult = await git(['rev-parse', '-q', '--verify', ref]);
    if (refResult.exitCode === 1) return { kind: 'absent' };
    const blob = refResult.exitCode === 0 ? parseCommitSha(refResult.stdout.trim()) : undefined;
    if (!blob) return { kind: 'unreadable' };
    const content = await git(['cat-file', '-p', blob]);
    return content.exitCode === 0 ? { blob, content: content.stdout } : { kind: 'unreadable' };
  } catch { return { kind: 'unreadable' }; }
}

export async function readRouteRecord(worktree: string, slug: string, roundId: RoundId, dependencies: RouteRecordStoreDependencies = {}): Promise<ReadRouteRecordResult> {
  const value = await readBlob(routeRecordRefFor(slug, roundId), dependencies.git ?? makeGitRunner(worktree));
  if ('blob' in value) { const record = parseRouteRecord(value.content); return record ? { kind: 'record', slug, blob: value.blob, record } : { kind: 'unreadable', blob: value.blob }; }
  return { kind: value.kind };
}

export async function readRepairMarker(worktree: string, slug: string, dependencies: RouteRecordStoreDependencies = {}): Promise<ReadRepairMarkerResult> {
  const value = await readBlob(repairMarkerRefFor(slug), dependencies.git ?? makeGitRunner(worktree));
  if ('blob' in value) { const marker = parseRepairMarker(value.content); return marker ? { kind: 'marker', slug, blob: value.blob, marker } : { kind: 'unreadable', blob: value.blob }; }
  return { kind: value.kind };
}

export async function readRevalidationQueue(worktree: string, slug: string, dependencies: RouteRecordStoreDependencies = {}): Promise<ReadRevalidationQueueResult> {
  const value = await readBlob(revalidationQueueRefFor(slug), dependencies.git ?? makeGitRunner(worktree));
  if ('blob' in value) { const queue = parseRevalidationQueueRecord(value.content); return queue ? { kind: 'queue', slug, blob: value.blob, queue } : { kind: 'unreadable', blob: value.blob }; }
  return { kind: value.kind };
}

/** Allocates the next route namespace segment without mutating any ref. */
export async function nextRoundId(worktree: string, slug: string, dependencies: RouteRecordStoreDependencies = {}): Promise<NextRoundIdResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const prefix = `refs/conductor/${slug}/routes/`;
  try {
    const listed = await git(['for-each-ref', '--format=%(refname)', prefix]);
    if (listed.exitCode !== 0) return { kind: 'unavailable' };
    let max = 0;
    for (const ref of listed.stdout.split('\n').filter(Boolean)) {
      const roundId = parseRoundId(ref.slice(prefix.length));
      if (!roundId) return { kind: 'unavailable' };
      max = Math.max(max, Number(roundId.slice(1)));
    }
    if (max === MAX_ROUTE_ROUNDS) return { kind: 'round-limit' };
    const next = parseRoundId(`r${max + 1}`);
    return next ?? { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function writeRouteRecord(worktree: string, previous: StoredRouteRecord, next: RouteRecord, dependencies: RouteRecordStoreDependencies = {}): Promise<WriteRouteRecordResult> {
  return writeRoutingTransaction(worktree, previous.slug, [{ kind: 'update-record', previous, record: next }], dependencies);
}

/**
 * The only writer for route records and repair markers.  The journal verify is
 * deliberately in the same update-ref transaction as every routing mutation:
 * a restack beginning after the read wins the race rather than interleaving.
 */
export async function writeRoutingTransaction(
  worktree: string,
  slug: string,
  ops: readonly RoutingTransactionOp[],
  dependencies: RouteRecordStoreDependencies = {},
): Promise<WriteRouteRecordResult> {
  if (!slug || ops.length === 0) return { kind: 'unavailable' };
  const git = dependencies.git ?? makeGitRunner(worktree);
  const journal = await readRestackJournal(worktree, slug, { git });
  if (journal.kind === 'unreadable') return { kind: 'unavailable' };
  if (journal.kind === 'journal' &&
    (journal.journal.state !== 'applied' && journal.journal.state !== 'aborted' ||
      (journal.journal.state === 'applied' && journal.journal.followOnCause !== undefined))) {
    return { kind: 'restack-journal-open' };
  }
  try {
    const lines = ['start'];
    for (const op of ops) {
      switch (op.kind) {
        case 'create-record': {
          const blobResult = await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(op.record) });
          const blob = blobResult.exitCode === 0 ? parseCommitSha(blobResult.stdout.trim()) : undefined;
          if (!blob) return { kind: 'unavailable' };
          // `update … <zero>` is Git's CAS-create form.  Unlike the
          // porcelain-looking `create` command it accepts an explicit old
          // value, so the transaction proves the ref was absent at commit.
          lines.push(`update ${routeRecordRefFor(slug, op.record.roundId)} ${blob} ${ZERO_SHA}`);
          break;
        }
        case 'update-record': {
          if (op.previous.slug !== slug || op.previous.record.roundId !== op.record.roundId) return { kind: 'unavailable' };
          const blobResult = await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(op.record) });
          const blob = blobResult.exitCode === 0 ? parseCommitSha(blobResult.stdout.trim()) : undefined;
          if (!blob) return { kind: 'unavailable' };
          lines.push(`update ${routeRecordRefFor(slug, op.record.roundId)} ${blob} ${op.previous.blob}`);
          break;
        }
        case 'delete-record':
          if (op.previous.slug !== slug) return { kind: 'unavailable' };
          lines.push(`delete ${routeRecordRefFor(slug, op.previous.record.roundId)} ${op.previous.blob}`);
          break;
        case 'create-marker': {
          const blobResult = await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(op.marker) });
          const blob = blobResult.exitCode === 0 ? parseCommitSha(blobResult.stdout.trim()) : undefined;
          if (!blob) return { kind: 'unavailable' };
          lines.push(`update ${repairMarkerRefFor(slug)} ${blob} ${ZERO_SHA}`);
          break;
        }
      }
    }
    // Keep the ordinary record update first for compatibility with Git's
    // transaction grammar, while retaining the journal fence in this exact
    // atomic transaction before prepare/commit.
    lines.push(`verify ${journalRefFor(slug)} ${journal.kind === 'journal' ? journal.blob : ZERO_SHA}`, 'prepare', 'commit', '');
    const input = lines.join('\n');
    const updated = await git(['update-ref', '--stdin'], { input });
    return updated.exitCode === 0 ? { kind: 'updated' } : { kind: 'cas-failed' };
  } catch { return { kind: 'unavailable' }; }
}

export async function createRouteRecord(
  worktree: string,
  slug: string,
  input: Pick<RouteRecord, 'roundId' | 'kind' | 'items' | 'allocation'>,
  dependencies: RouteRecordStoreDependencies = {},
): Promise<{ readonly kind: 'created'; readonly record: RouteRecord } | Exclude<WriteRouteRecordResult, { readonly kind: 'updated' }>> {
  const hosts = Object.keys(input.allocation).reduce((result, value) => ({ ...result, [value]: 'pending' as const }), {} as Record<string, RouteRecord['hosts'][keyof RouteRecord['hosts']]>);
  if (Object.keys(hosts).length === 0) return { kind: 'unavailable' };
  const record: RouteRecord = { ...input, phase: 'prepared', hosts, currentHostIndex: 0, receipt: {}, outbox: [] };
  const write = await writeRoutingTransaction(worktree, slug, [{ kind: 'create-record', record }], dependencies);
  return write.kind === 'updated' ? { kind: 'created', record } : write;
}

export function transitionHost(
  stored: StoredRouteRecord,
  host: import('../child-context.js').ChildId,
  to: import('./route-types.js').HostState,
  options: { readonly credit: boolean },
): { readonly kind: 'updated'; readonly record: RouteRecord } | { readonly kind: 'illegal-transition' } {
  const from = stored.record.hosts[host];
  if (from === undefined || !isLegalHostTransition(from, to)) return { kind: 'illegal-transition' };
  const record = { ...stored.record, hosts: { ...stored.record.hosts, [host]: to } };
  return { kind: 'updated', record: withOutboxEvent(record, routedRepairPhaseEvent(record.roundId, host, to, options.credit)) };
}


/**
 * At-least-once delivery for a route record. A persistence acknowledgement is
 * intentionally separate from the CAS removal: a crash in that window merely
 * replays the event and the canonical persister removes the duplicate.
 */
export async function drainOutbox(worktree: string, stored: StoredRouteRecord, persist: PersistOutboxEvent, dependencies: RouteRecordStoreDependencies = {}): Promise<DrainOutboxResult> {
  let current = stored;
  while (current.record.outbox.length > 0) {
    const entry = current.record.outbox[0]!;
    // The durable envelope is the identity authority at this replay boundary.
    // Parsing has already proved these values agree with the inner event.
    const event = { ...entry.event, eventId: entry.eventId, occurredAt: entry.occurredAt } as ConductorEvent;
    try { await persist(event); } catch { return { kind: 'persist-failed' }; }
    const next = { ...current.record, outbox: current.record.outbox.slice(1) };
    const wrote = await writeRouteRecord(worktree, current, next, dependencies);
    if (wrote.kind === 'updated') {
      const reread = await readRouteRecord(worktree, current.slug, current.record.roundId, dependencies);
      if (reread.kind !== 'record') return { kind: 'unavailable' };
      // A successful CAS must have consumed this exact head entry. Treat a
      // malformed or unexpectedly non-progressing ref as a retry boundary
      // rather than looping forever and duplicating delivery in one process.
      if (reread.record.outbox.length >= current.record.outbox.length) return { kind: 'retry' };
      current = reread;
    } else if (wrote.kind === 'cas-failed') return { kind: 'retry' };
    else return { kind: 'unavailable' };
  }
  return { kind: 'drained' };
}

/** Enumerates durable route records, never inferring them from a transient marker. */
export async function drainRoutingOutboxes(worktree: string, slug: string, persist: PersistOutboxEvent, dependencies: RouteRecordStoreDependencies = {}): Promise<DrainOutboxResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  try {
    const listed = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
    if (listed.exitCode !== 0) return { kind: 'unavailable' };
    for (const ref of listed.stdout.split('\n').filter(Boolean)) {
      const round = ref.split('/').at(-1);
      const parsed = round === undefined ? undefined : parseRoundId(round);
      if (!parsed) return { kind: 'unavailable' };
      const record = await readRouteRecord(worktree, slug, parsed, { git });
      if (record.kind !== 'record') return { kind: 'unavailable' };
      const drained = await drainOutbox(worktree, record, persist, { git });
      if (drained.kind !== 'drained') return drained;
    }
    return { kind: 'drained' };
  } catch { return { kind: 'unavailable' }; }
}
