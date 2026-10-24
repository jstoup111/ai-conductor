import { CHILD_REGION_STEPS, type ChildId } from '../child-context.js';
import { makeGitRunner } from '../rebase.js';
import type { GitRunner } from '../rebase.js';
import { ConductorEventEmitter } from '../../ui/events.js';
import { EventPersister } from '../event-persister.js';
import { resolveActiveChild, resolveSealedLeaf } from '../child-cursor.js';
import { runRestack, type RunRestackResult } from '../restack/restack-executor.js';
import { haltRestack } from '../restack/restack-move.js';
import { writeHaltMarker } from '../halt-marker.js';
import { publishedStackRefusal } from '../stack-publication.js';
import {
  drainOutbox,
  drainQueueOutbox,
  readRevalidationQueue,
  readRepairMarker,
  readRouteRecord,
  transitionHost,
  writeRoutingTransaction,
  type PersistOutboxEvent,
  type StoredRouteRecord,
} from './route-record-store.js';
import { resolveGitRef } from './git-ref-resolver.js';
import { closureRefFor } from './routing-refs.js';
import { assertNever, type HostState, type RevalidationQueueRecord, type RouteRecord, type RoundId } from './route-types.js';
import { leafBranchFor } from '../feature-branch-identity.js';
import { switchToChild } from '../child-lifecycle.js';
import { applyStateChanges, readState } from '../state.js';
import { acknowledgeQueueEntry } from './revalidation-queue.js';
import { loadConfig } from '../config.js';
import { buildStepRegistry } from '../steps.js';
import { writeVerdict } from '../gate-verdicts.js';
import type { StepName } from '../../types/index.js';

export type NextHostSelection =
  | { readonly kind: 'child-host'; readonly host: ChildId; readonly index: number }
  | { readonly kind: 'queue' }
  | { readonly kind: 'leaf-host'; readonly host: ChildId; readonly index: number }
  | { readonly kind: 'settled' };

export type AdvanceRoundResult =
  | { readonly kind: 'admitted'; readonly host: ChildId }
  | { readonly kind: 'queue' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'unavailable'; readonly detail: string };

function pendingHost(state: HostState): boolean {
  switch (state) {
    case 'pending':
      return true;
    case 'admitted':
    case 'repairing':
    case 'reroute-moved':
    case 'built':
    case 'restacked':
    case 'done':
    case 'rerouted':
      return false;
  }
  return assertNever(state);
}

/**
 * Selects the next durable return target, preserving the recorded host order.
 * The last host is the leaf, so it waits for both child hosts and revalidation.
 */
export async function selectNextHost(
  worktree: string,
  record: Pick<RouteRecord, 'hosts' | 'currentHostIndex'>,
  queue: Pick<RevalidationQueueRecord, 'entries'>,
  options: { readonly leaf?: ChildId } = {},
): Promise<NextHostSelection> {
  const hosts = Object.keys(record.hosts)
    .map(Number)
    .sort((left, right) => left - right) as ChildId[];
  const leaf = options.leaf ?? await resolveSealedLeaf(worktree);
  if (leaf === undefined) return { kind: 'settled' };
  const leafIndex = hosts.indexOf(leaf);
  // A round can be opened before its leaf is allocated into its host map.
  // Treat every allocated position below the durable sealed leaf as a child;
  // the leaf remains the final return target, not the final map entry.
  const childEnd = leafIndex === -1 ? hosts.length : leafIndex;

  for (let index = record.currentHostIndex + 1; index < childEnd; index += 1) {
    const host = hosts[index]!;
    if (pendingHost(record.hosts[host]!)) return { kind: 'child-host', host, index };
  }

  if (queue.entries.length > 0) return { kind: 'queue' };

  if (leafIndex !== -1 && pendingHost(record.hosts[leaf]!)) return { kind: 'leaf-host', host: leaf, index: leafIndex };
  return { kind: 'settled' };
}

/**
 * Advances a completed routed host from the persisted record.  The marker and
 * next admission are deliberately one compare-and-swap so a resume cannot
 * admit a second host after a crash.
 */
export async function advanceRound(
  worktree: string,
  slug: string,
  stored: StoredRouteRecord,
  options: { readonly git?: GitRunner; readonly queue?: Pick<RevalidationQueueRecord, 'entries'> } = {},
): Promise<AdvanceRoundResult> {
  const git = options.git ?? makeGitRunner(worktree);
  const queued = options.queue === undefined ? await readRevalidationQueue(worktree, slug, { git }) : undefined;
  if (queued !== undefined && queued.kind !== 'queue' && queued.kind !== 'absent') {
    return { kind: 'unavailable', detail: 'revalidation queue is unreadable' };
  }
  const entries = options.queue?.entries ?? (queued?.kind === 'queue' ? queued.queue.entries : []);
  const next = await selectNextHost(worktree, stored.record, { entries });
  if (next.kind === 'queue') {
    const everyHostSettled = Object.values(stored.record.hosts)
      .every((state) => state === 'restacked' || state === 'done' || state === 'rerouted');
    if (!everyHostSettled) return { kind: 'queue' };
    const wrote = await writeRoutingTransaction(worktree, slug, [
      { kind: 'update-record', previous: stored, record: { ...stored.record, phase: 'closed' as const } },
    ], { git });
    return wrote.kind === 'updated' ? { kind: 'closed' } : { kind: 'unavailable', detail: `round close ${wrote.kind}` };
  }
  if (next.kind === 'settled') {
    const otherOpen = await hasOtherOpenRound(worktree, slug, stored.record.roundId, git);
    if (otherOpen === undefined) return { kind: 'unavailable', detail: 'cannot inspect other routed rounds' };
    if (entries.length > 0 || otherOpen) {
      const wrote = await writeRoutingTransaction(worktree, slug, [
        { kind: 'update-record', previous: stored, record: { ...stored.record, phase: 'closed' as const } },
      ], { git });
      return wrote.kind === 'updated' ? { kind: 'closed' } : { kind: 'unavailable', detail: `round close ${wrote.kind}` };
    }
    return returnToLeaf(worktree, slug, stored, { git });
  }
  const admitted = transitionHost(stored, next.host, 'admitted', { credit: false });
  if (admitted.kind !== 'updated') return { kind: 'unavailable', detail: `cannot admit routed host ${next.host}` };
  const record = { ...admitted.record, currentHostIndex: next.index };
  const wrote = await writeRoutingTransaction(worktree, slug, [
    { kind: 'update-record', previous: stored, record },
    { kind: 'create-marker', marker: { host: next.host, roundId: stored.record.roundId } },
  ], { git });
  return wrote.kind === 'updated'
    ? { kind: 'admitted', host: next.host }
    : { kind: 'unavailable', detail: `round advance ${wrote.kind}` };
}

async function hasOtherOpenRound(worktree: string, slug: string, roundId: RoundId, git: GitRunner): Promise<boolean | undefined> {
  const listed = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
  if (listed.exitCode !== 0) return undefined;
  for (const ref of listed.stdout.split('\n').filter(Boolean)) {
    const id = ref.split('/').at(-1);
    if (!id || id === roundId) continue;
    const other = await readRouteRecord(worktree, slug, id as RoundId, { git });
    if (other.kind !== 'record') return undefined;
    if (other.record.phase !== 'closed') return true;
  }
  return false;
}

async function restageLeafGates(worktree: string): Promise<string | undefined> {
  const statePath = `${worktree}/.pipeline/conduct-state.json`;
  const state = await readState(statePath);
  if (!state.ok) return state.error.message;
  const config = await loadConfig(worktree);
  if (!config.ok) return config.error.message;
  const registry = buildStepRegistry(config.config);
  const buildReview = registry.findIndex((step) => step.name === 'build_review');
  const finish = registry.findIndex((step) => step.name === 'finish');
  if (buildReview < 0 || finish < 0) return 'cannot resolve routed leaf gate order';
  const builtins = new Set(['prd_audit', 'architecture_review_as_built', 'manual_test']);
  const postRegion = registry.slice(buildReview + 1, finish)
    .map((step) => step.name)
    .filter((name) => !builtins.has(name) && !CHILD_REGION_STEPS.includes(name as never));
  const gates = ['prd_audit', 'architecture_review_as_built', 'manual_test', ...postRegion] as StepName[];
  const result = await applyStateChanges(statePath, state.value, Object.fromEntries(gates.map((gate) => [gate, 'pending'])), 're-pend leaf gates after routed return');
  if ('message' in result) return result.message;
  try {
    await Promise.all(gates.map((gate) => writeVerdict(worktree, gate, {
      satisfied: false,
      reason: 'routed leaf return requires fresh whole-feature validation',
      checkedAt: Date.now(),
    })));
  } catch (error) {
    return `cannot invalidate leaf gate verdicts: ${error instanceof Error ? error.message : String(error)}`;
  }
  return undefined;
}

/** Return to the leaf and record that return before the route can close. */
export async function returnToLeaf(
  worktree: string,
  slug: string,
  stored: StoredRouteRecord,
  options: { readonly git?: GitRunner; readonly events?: ConductorEventEmitter } = {},
): Promise<Extract<AdvanceRoundResult, { readonly kind: 'closed' | 'unavailable' }>> {
  const git = options.git ?? makeGitRunner(worktree);
  if (stored.record.phase === 'closed') return { kind: 'closed' };
  const otherOpen = await hasOtherOpenRound(worktree, slug, stored.record.roundId, git);
  if (otherOpen === undefined) return { kind: 'unavailable', detail: 'cannot inspect other routed rounds before leaf return' };
  if (otherOpen) return { kind: 'unavailable', detail: 'cannot return to leaf while another routed round is open' };
  const queue = await readRevalidationQueue(worktree, slug, { git });
  if (queue.kind === 'unreadable') return { kind: 'unavailable', detail: 'cannot inspect revalidation queue before leaf return' };
  if (queue.kind === 'queue' && queue.queue.entries.length > 0) return { kind: 'unavailable', detail: 'cannot return to leaf while revalidation queue has entries' };
  const leaf = await resolveSealedLeaf(worktree);
  if (leaf === undefined) return { kind: 'unavailable', detail: 'cannot resolve sealed leaf before routed return' };
  const branch = leafBranchFor(slug);
  const current = await git(['symbolic-ref', '--short', 'HEAD']);
  if (current.exitCode !== 0) return { kind: 'unavailable', detail: 'cannot determine branch before leaf return' };
  if (current.stdout.trim() !== branch) {
    const switched = await switchToChild(worktree, { child: leaf, position: leaf, branch }, options.events ?? new ConductorEventEmitter(), undefined, { git });
    if (switched.kind !== 'completed') return { kind: 'unavailable', detail: 'reason' in switched ? switched.reason : 'cannot switch to leaf branch' };
  }
  const resolved = await resolveGitRef(git, 'HEAD');
  if (typeof resolved !== 'string') return { kind: 'unavailable', detail: 'cannot resolve leaf return head' };
  let currentStored = stored;
  if (stored.record.leafReturn === undefined) {
    const returned = { ...stored.record, leafReturn: { branch, head: resolved } };
    const wrote = await writeRoutingTransaction(worktree, slug, [{ kind: 'update-record', previous: stored, record: returned }], { git });
    if (wrote.kind !== 'updated') return { kind: 'unavailable', detail: `leaf return ${wrote.kind}` };
    const reread = await readRouteRecord(worktree, slug, stored.record.roundId, { git });
    if (reread.kind !== 'record') return { kind: 'unavailable', detail: 'cannot reread leaf return record' };
    currentStored = reread;
  }
  const restageFailure = await restageLeafGates(worktree);
  if (restageFailure !== undefined) return { kind: 'unavailable', detail: restageFailure };
  const closed = { ...currentStored.record, phase: 'closed' as const };
  const closedWrite = await writeRoutingTransaction(worktree, slug, [{ kind: 'update-record', previous: currentStored, record: closed }], { git });
  if (closedWrite.kind !== 'updated') return { kind: 'unavailable', detail: `round close ${closedWrite.kind}` };
  return { kind: 'closed' };
}

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

  // The leaf is already the whole-feature branch.  Its successful BUILD
  // region settles the marker in one CAS; replaying it would carry the fix
  // above the stack it is meant to return to.
  const closure = await resolveGitRef(git, closureRefFor(input.slug, input.host));
  if (typeof closure !== 'string') {
    const done = transitionHost(stored, input.host, 'done', { credit: false });
    if (done.kind !== 'updated') return halted(`routed exit host ${input.host}: cannot mark leaf host done`);
    const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
      { kind: 'update-record', previous: stored, record: done.record },
      { kind: 'delete-marker', old: marker.blob },
    ], { git });
    return wrote.kind === 'updated'
      ? { kind: 'no-commit-done' }
      : halted(`routed exit host ${input.host}: leaf compare-and-swap ${wrote.kind}`);
  }

  const evidence = await hostNoOpEvidence(input.worktree, input.slug, stored, input.host);
  if (evidence.kind === 'unavailable') return halted(evidence.detail);

  // Equality of the entry tree is not enough: an empty metadata commit is
  // still work that must be carried.  Only the exact closure tip is a no-op.
  if (evidence.tipEqualsClosure) {
    if (state === 'built') return halted(`routed exit host ${input.host}: built host cannot take no-commit exit`);
    if (stored.record.entry?.host === input.host && stored.record.entry.revalidation !== undefined) {
      const acknowledged = await acknowledgeQueueEntry(input.worktree, input.slug, stored, input.host, { git });
      if (acknowledged.kind !== 'acknowledged') return halted(`routed exit host ${input.host}: queue acknowledgement ${acknowledged.kind}`);
      const queue = await readRevalidationQueue(input.worktree, input.slug, { git });
      if (queue.kind === 'queue') {
        const persister = new EventPersister(`${input.worktree}/.pipeline/events.jsonl`, input.events ?? new ConductorEventEmitter());
        const persisted = input.persist ?? ((event) => persister.persistDurably(event));
        // Queue delivery is replay-safe; leave the durable envelope if this process dies here.
        const drained = await drainQueueOutbox(input.worktree, queue, persisted, { git });
        if (drained.kind !== 'drained') return halted(`routed exit host ${input.host}: queue outbox ${drained.kind}`);
      }
      return { kind: 'no-commit-done' };
    }
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
