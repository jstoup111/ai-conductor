import type { ChildId } from '../child-context.js';
import { makeGitRunner } from '../rebase.js';
import type { GitRunner } from '../rebase.js';
import { ConductorEventEmitter } from '../../ui/events.js';
import { EventPersister } from '../event-persister.js';
import { resolveActiveChild } from '../child-cursor.js';
import { runRestack, type RunRestackResult } from '../restack/restack-executor.js';
import { haltRestack } from '../restack/restack-move.js';
import { writeHaltMarker } from '../halt-marker.js';
import { publishedStackRefusal } from '../stack-publication.js';
import {
  drainOutbox,
  readRepairMarker,
  readRouteRecord,
  transitionHost,
  writeRoutingTransaction,
  type PersistOutboxEvent,
  type StoredRouteRecord,
} from './route-record-store.js';
import { resolveGitRef } from './git-ref-resolver.js';
import { closureRefFor } from './routing-refs.js';
import type { RoundId } from './route-types.js';

/** The immutable Git comparison facts used to choose a routed host's exit. */
export interface HostNoOpEvidence {
  readonly kind: 'evidence';
  readonly headMoved: boolean;
  readonly treeDiffers: boolean;
  readonly tipEqualsClosure: boolean;
}

/** The host entry baseline cannot be inferred when the durable record lacks it. */
export interface HostNoOpEvidenceUnavailable {
  readonly kind: 'unavailable';
  readonly detail: string;
}

export type HostNoOpEvidenceResult = HostNoOpEvidence | HostNoOpEvidenceUnavailable;

export type RequestRoutedExitResult =
  | { readonly kind: 'noop' }
  | { readonly kind: 'no-commit-done' }
  | { readonly kind: 'restacked' }
  | { readonly kind: 'halted'; readonly detail: string };

export interface RequestRoutedExitInput {
  readonly worktree: string;
  readonly slug: string;
  readonly roundId: RoundId;
  readonly host: ChildId;
  readonly events?: ConductorEventEmitter;
  /** Re-entry after a crash has already durably recorded `built`. */
  readonly skipBuiltCompareAndSwap?: boolean;
  readonly persist?: PersistOutboxEvent;
  readonly git?: GitRunner;
}

/** Reads the durable entry baseline before a routed host selects its exit. */
export async function hostNoOpEvidence(
  worktree: string,
  slug: string,
  stored: StoredRouteRecord,
  host: ChildId,
): Promise<HostNoOpEvidenceResult> {
  const entry = stored.record.entry;
  if (entry?.host !== host) return { kind: 'unavailable', detail: `host ${host} entry baseline is unavailable` };

  const git = makeGitRunner(worktree);
  const head = await resolveGitRef(git, 'HEAD');
  if (typeof head !== 'string') return { kind: 'unavailable', detail: `host ${host} HEAD is unavailable` };
  const tree = await resolveGitRef(git, 'HEAD^{tree}');
  if (typeof tree !== 'string') return { kind: 'unavailable', detail: `host ${host} HEAD tree is unavailable` };
  const closure = await resolveGitRef(git, closureRefFor(slug, host));
  if (typeof closure !== 'string') return { kind: 'unavailable', detail: `host ${host} closure is unavailable` };

  return {
    kind: 'evidence',
    headMoved: head !== entry.pinnedBase,
    treeDiffers: tree !== entry.tree,
    tipEqualsClosure: head === closure,
  };
}

function halted(detail: string): RequestRoutedExitResult {
  return { kind: 'halted', detail };
}

/**
 * Leaves a routed BUILD region.  The route record owns the small entry CAS;
 * the restack journal owns the later route/marker mutation, so a rollback can
 * never accidentally settle a route.
 */
export async function requestRoutedExit(input: RequestRoutedExitInput): Promise<RequestRoutedExitResult> {
  const git = input.git ?? makeGitRunner(input.worktree);
  const stored = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
  if (stored.kind !== 'record') return halted(`routed exit host ${input.host}: route record is unavailable`);
  const state = stored.record.hosts[input.host];
  if (state === 'restacked' || state === 'done') return { kind: 'noop' };
  if (state !== 'repairing' && state !== 'built') return halted(`routed exit host ${input.host}: host is not repairing or built`);

  const marker = await readRepairMarker(input.worktree, input.slug, { git });
  if (marker.kind !== 'marker' || marker.marker.host !== input.host || marker.marker.roundId !== input.roundId) {
    return halted(`routed exit host ${input.host}: repair marker is unavailable or belongs to another round`);
  }

  const evidence = await hostNoOpEvidence(input.worktree, input.slug, stored, input.host);
  if (evidence.kind === 'unavailable') return halted(evidence.detail);

  // Equality of the entry tree is not enough: an empty metadata commit is
  // still work that must be carried.  Only the exact closure tip is a no-op.
  if (evidence.tipEqualsClosure) {
    if (state === 'built') return halted(`routed exit host ${input.host}: built host cannot take no-commit exit`);
    const done = transitionHost(stored, input.host, 'done', { credit: false });
    if (done.kind !== 'updated') return halted(`routed exit host ${input.host}: cannot mark host done`);
    const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
      { kind: 'update-record', previous: stored, record: done.record },
      { kind: 'delete-marker', old: marker.blob },
    ], { git });
    return wrote.kind === 'updated'
      ? { kind: 'no-commit-done' }
      : halted(`routed exit host ${input.host}: no-commit compare-and-swap ${wrote.kind}`);
  }

  if (await publishedStackRefusal(input.worktree, input.slug, { git })) {
    await haltRestack(input.worktree, 'published-stack', input.events, { child: input.host });
    return halted(`routed exit host ${input.host}: published stack`);
  }

  let built = stored;
  if (state === 'repairing' && !input.skipBuiltCompareAndSwap) {
    const transition = transitionHost(stored, input.host, 'built', { credit: false });
    if (transition.kind !== 'updated') return halted(`routed exit host ${input.host}: cannot mark host built`);
    const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
      { kind: 'update-record', previous: stored, record: transition.record },
    ], { git });
    if (wrote.kind !== 'updated') return halted(`routed exit host ${input.host}: built compare-and-swap ${wrote.kind}`);
    const reread = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
    if (reread.kind !== 'record') return halted(`routed exit host ${input.host}: cannot reread built route record`);
    built = reread;
  } else if (state !== 'built') {
    return halted(`routed exit host ${input.host}: built compare-and-swap was skipped before host was built`);
  }

  const persister = new EventPersister(
    `${input.worktree}/.pipeline/events.jsonl`, input.events ?? new ConductorEventEmitter(),
  );
  const persist = input.persist ?? ((event) => persister.persistDurably(event));
  const drained = await drainOutbox(input.worktree, built, persist, { git });
  if (drained.kind !== 'drained') return halted(`routed exit host ${input.host}: routing outbox ${drained.kind}`);
  const drainedRecord = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
  if (drainedRecord.kind !== 'record') return halted(`routed exit host ${input.host}: cannot reread drained route record`);
  built = drainedRecord;

  const cursor = await resolveActiveChild(input.worktree, input.slug, { git });
  if (cursor.kind !== 'repair-pending') return halted(`routed exit host ${input.host}: cannot resolve exit restack cursor (${cursor.kind})`);
  if (cursor.foreignRoundChildren?.length) {
    const child = cursor.foreignRoundChildren[0]!;
    await writeHaltMarker(input.worktree, `routing foreign-round commit: child ${child}\n`, 'needs-human', input.events);
    return halted(`routed exit host ${input.host}: foreign round on child ${child}`);
  }
  const origins = [...new Set([input.host, ...(cursor.coOrigins ?? [])])].sort((left, right) => left - right) as ChildId[];
  const restack = await runRestack({
    worktree: input.worktree,
    slug: input.slug,
    cause: 'feature-repair',
    originatingChildren: origins,
    routed: { roundId: input.roundId, host: input.host, routeOld: built.blob, markerOld: marker.blob },
    ...(input.events === undefined ? {} : { events: input.events }),
    git,
  });
  if (restack.kind !== 'applied') return halted(`routed exit host ${input.host}: ${restackDetail(restack)}`);

  // Applying the routed journal appends the terminal `restacked` occurrence
  // to the same route-record transaction.  Drain that new durable entry before
  // reporting success, just as the pre-restack outbox was drained above.
  const appliedRecord = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
  if (appliedRecord.kind !== 'record') return halted(`routed exit host ${input.host}: cannot reread restacked route record`);
  const appliedDrain = await drainOutbox(input.worktree, appliedRecord, persist, { git });
  return appliedDrain.kind === 'drained'
    ? { kind: 'restacked' }
    : halted(`routed exit host ${input.host}: routing outbox ${appliedDrain.kind}`);
}

function restackDetail(result: Exclude<RunRestackResult, { readonly kind: 'applied' }>): string {
  return result.kind === 'unavailable' ? result.detail : result.kind === 'refused' ? result.reason : result.kind;
}
