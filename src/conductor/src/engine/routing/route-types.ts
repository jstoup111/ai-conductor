import { parseChildId, type ChildId } from '../child-context.js';
import { parseCommitSha, type CommitSha } from '../restack/restack-types.js';
import type { StackedPrsConfig } from '../../types/config.js';

/** The explicit round bound used by routing-ref teardown. */
export const MAX_ROUTE_ROUNDS = 999;

/** A validated route-record namespace segment (`r1` through `r999`). */
export type RoundId = string & { readonly __brand: 'RoundId' };

export type HostState =
  | 'pending'
  | 'admitted'
  | 'repairing'
  | 'reroute-moved'
  | 'built'
  | 'restacked'
  | 'done'
  | 'rerouted';

export type RoundPhase = 'prepared' | 'open' | 'closed';

export type RouteKind = 'audit' | 'revalidate';

/** Makes routing-union consumers fail closed when their union gains a member. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled routing value: ${JSON.stringify(value)}`);
}

/** Only ADR decision 6's host-state edges may advance a routed host. */
export function isLegalHostTransition(from: HostState, to: HostState): boolean {
  switch (from) {
    case 'pending':
      switch (to) {
        case 'pending': return false;
        case 'admitted': return true;
        case 'repairing': return false;
        case 'reroute-moved': return false;
        case 'built': return false;
        case 'restacked': return false;
        case 'done': return false;
        case 'rerouted': return false;
      }
      return assertNever(to);
    case 'admitted':
      switch (to) {
        case 'pending': return false;
        case 'admitted': return false;
        case 'repairing': return true;
        case 'reroute-moved': return false;
        case 'built': return false;
        case 'restacked': return false;
        case 'done': return false;
        case 'rerouted': return false;
      }
      return assertNever(to);
    case 'repairing':
      switch (to) {
        case 'pending': return false;
        case 'admitted': return false;
        case 'repairing': return false;
        case 'reroute-moved': return true;
        case 'built': return true;
        case 'restacked': return false;
        case 'done': return true;
        case 'rerouted': return false;
      }
      return assertNever(to);
    case 'reroute-moved':
      switch (to) {
        case 'pending': return false;
        case 'admitted': return false;
        case 'repairing': return false;
        case 'reroute-moved': return false;
        case 'built': return false;
        case 'restacked': return false;
        case 'done': return false;
        case 'rerouted': return true;
      }
      return assertNever(to);
    case 'built':
      switch (to) {
        case 'pending': return false;
        case 'admitted': return false;
        case 'repairing': return false;
        case 'reroute-moved': return false;
        case 'built': return false;
        case 'restacked': return true;
        case 'done': return false;
        case 'rerouted': return false;
      }
      return assertNever(to);
    case 'restacked':
    case 'done':
    case 'rerouted':
      switch (to) {
        case 'pending': return false;
        case 'admitted': return false;
        case 'repairing': return false;
        case 'reroute-moved': return false;
        case 'built': return false;
        case 'restacked': return false;
        case 'done': return false;
        case 'rerouted': return false;
      }
      return assertNever(to);
  }
  return assertNever(from);
}

/** Only ADR decision 6's round-phase edges may advance a routing round. */
export function isLegalRoundPhaseTransition(from: RoundPhase, to: RoundPhase): boolean {
  switch (from) {
    case 'prepared':
      switch (to) {
        case 'prepared': return false;
        case 'open': return true;
        case 'closed': return false;
      }
      return assertNever(to);
    case 'open':
      switch (to) {
        case 'prepared': return false;
        case 'open': return false;
        case 'closed': return true;
      }
      return assertNever(to);
    case 'closed':
      switch (to) {
        case 'prepared': return false;
        case 'open': return false;
        case 'closed': return false;
      }
      return assertNever(to);
  }
  return assertNever(from);
}

/** The dark-launch setting is deliberately false unless explicitly enabled. */
export function routingSettingOn(config: { readonly stacked_prs?: StackedPrsConfig } | undefined): boolean {
  return config?.stacked_prs?.route_whole_feature_fixes === true;
}

/** A caller supplies its cursor; flat and unsliced features are never eligible. */
export function routingEligible(cursor: { readonly kind: string }, config: { readonly stacked_prs?: StackedPrsConfig } | undefined): boolean {
  return routingSettingOn(config) && (cursor.kind === 'active' || cursor.kind === 'repair-pending');
}

export interface RoutedItem {
  readonly findingId: string;
  readonly kind: RouteKind;
  readonly owner: ChildId;
  readonly host: ChildId;
  readonly reason: string;
  readonly fallback: readonly ChildId[];
}

/** The immutable rem-* blocks to append when a host enters its region. */
export interface FrozenHostAllocation {
  readonly remTaskIds: readonly string[];
  readonly blockBodies: readonly string[];
}

/** Frozen rem-* task ids and their exact block bodies, grouped by host child. */
export type FrozenAllocation = Readonly<Record<ChildId, FrozenHostAllocation>>;

/**
 * The receipt schema is deliberately opaque until the budget/settlement group
 * owns it. It must nonetheless be a JSON object so malformed durable blobs
 * fail closed at the record boundary.
 */
export type RoundReceipt = Readonly<Record<string, unknown>>;

/** A complete event waits in the durable route or queue outbox until persisted. */
export interface OutboxEntry {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly event: Readonly<Record<string, unknown>>;
}

export interface RouteRecord {
  readonly roundId: RoundId;
  readonly kind: RouteKind;
  readonly phase: RoundPhase;
  readonly items: readonly RoutedItem[];
  readonly allocation: FrozenAllocation;
  readonly hosts: Readonly<Record<ChildId, HostState>>;
  readonly currentHostIndex: number;
  readonly receipt: RoundReceipt;
  readonly outbox: readonly OutboxEntry[];
}

/** The marker is written before changing the routed host's region state. */
export interface RepairMarker {
  readonly host: ChildId;
  readonly roundId: RoundId;
}

export interface RevalidationQueueEntry {
  readonly child: ChildId;
  readonly closureSha: CommitSha;
  readonly state: string;
}

export interface RevalidationQueueRecord {
  readonly generation: number;
  readonly entries: readonly RevalidationQueueEntry[];
  readonly outbox: readonly OutboxEntry[];
}

const hostStates = new Set<HostState>([
  'pending', 'admitted', 'repairing', 'reroute-moved', 'built', 'restacked', 'done', 'rerouted',
]);
const roundPhases = new Set<RoundPhase>(['prepared', 'open', 'closed']);
const routeKinds = new Set<RouteKind>(['audit', 'revalidate']);
const ROUND_ID = /^r([1-9]\d*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBlob(blob: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(blob);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseChild(value: unknown): ChildId | undefined {
  return typeof value === 'number' ? parseChildId(value) : undefined;
}

function parseHostState(value: unknown): HostState | undefined {
  return typeof value === 'string' && hostStates.has(value as HostState) ? value as HostState : undefined;
}

function parseRouteKind(value: unknown): RouteKind | undefined {
  return typeof value === 'string' && routeKinds.has(value as RouteKind) ? value as RouteKind : undefined;
}

function parseRoundPhase(value: unknown): RoundPhase | undefined {
  return typeof value === 'string' && roundPhases.has(value as RoundPhase) ? value as RoundPhase : undefined;
}

function parseStringArray(value: unknown, predicate: (entry: string) => boolean = () => true): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0 && predicate(entry))
    ? value
    : undefined;
}

function parseOutboxEntry(value: unknown): OutboxEntry | undefined {
  if (!isRecord(value)) return undefined;
  const eventId = nonEmptyString(value.eventId);
  const occurredAt = nonEmptyString(value.occurredAt);
  if (!eventId || !occurredAt || Number.isNaN(Date.parse(occurredAt)) || !isRecord(value.event) || !nonEmptyString(value.event.type)
    || value.event.eventId !== eventId || value.event.occurredAt !== occurredAt) return undefined;
  return { eventId, occurredAt, event: value.event };
}

function parseOutbox(value: unknown): readonly OutboxEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.map(parseOutboxEntry);
  return entries.some((entry) => entry === undefined) ? undefined : entries as OutboxEntry[];
}

function parseRoutedItem(value: unknown): RoutedItem | undefined {
  if (!isRecord(value)) return undefined;
  const findingId = nonEmptyString(value.findingId);
  const kind = parseRouteKind(value.kind);
  const owner = parseChild(value.owner);
  const host = parseChild(value.host);
  const reason = nonEmptyString(value.reason);
  if (!findingId || !kind || !owner || !host || !reason || !Array.isArray(value.fallback)) return undefined;
  const fallback = value.fallback.map(parseChild);
  if (fallback.some((child) => child === undefined)) return undefined;
  return { findingId, kind, owner, host, reason, fallback: fallback as ChildId[] };
}

function parseAllocation(value: unknown): FrozenAllocation | undefined {
  if (!isRecord(value)) return undefined;
  const allocation: Record<ChildId, FrozenHostAllocation> = {} as Record<ChildId, FrozenHostAllocation>;
  for (const [rawChild, rawAllocation] of Object.entries(value)) {
    const child = parseChildId(rawChild);
    if (!child || !isRecord(rawAllocation)) return undefined;
    const remTaskIds = parseStringArray(rawAllocation.remTaskIds, (id) => id.startsWith('rem-'));
    const blockBodies = parseStringArray(rawAllocation.blockBodies);
    if (!remTaskIds || !blockBodies || remTaskIds.length !== blockBodies.length) return undefined;
    allocation[child] = { remTaskIds, blockBodies };
  }
  return allocation;
}

function parseHosts(value: unknown): Readonly<Record<ChildId, HostState>> | undefined {
  if (!isRecord(value)) return undefined;
  const hosts: Record<ChildId, HostState> = {} as Record<ChildId, HostState>;
  for (const [rawChild, rawState] of Object.entries(value)) {
    const child = parseChildId(rawChild);
    const state = parseHostState(rawState);
    if (!child || !state) return undefined;
    hosts[child] = state;
  }
  return hosts;
}

/** Parses exactly the bounded round-id grammar used in route ref names. */
export function parseRoundId(value: string): RoundId | undefined {
  const match = ROUND_ID.exec(value);
  if (!match) return undefined;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) && sequence <= MAX_ROUTE_ROUNDS ? value as RoundId : undefined;
}

/** Parses a durable route-record JSON blob without throwing. */
export function parseRouteRecord(blob: string): RouteRecord | undefined {
  const value = parseBlob(blob);
  if (!value) return undefined;
  const roundId = typeof value.roundId === 'string' ? parseRoundId(value.roundId) : undefined;
  const kind = parseRouteKind(value.kind);
  const phase = parseRoundPhase(value.phase);
  const allocation = parseAllocation(value.allocation);
  const hosts = parseHosts(value.hosts);
  const outbox = parseOutbox(value.outbox);
  const currentHostIndex = value.currentHostIndex;
  if (!roundId || !kind || !phase || !Array.isArray(value.items) || !allocation || !hosts || typeof currentHostIndex !== 'number' || !Number.isInteger(currentHostIndex)
    || currentHostIndex < 0 || currentHostIndex >= Object.keys(hosts).length || !isRecord(value.receipt) || !outbox) return undefined;
  const items = value.items.map(parseRoutedItem);
  if (items.some((item) => item === undefined)) return undefined;
  return {
    roundId,
    kind,
    phase,
    items: items as RoutedItem[],
    allocation,
    hosts,
    currentHostIndex,
    receipt: value.receipt,
    outbox,
  };
}

/** Parses the marker that identifies the routed host before region mutation. */
export function parseRepairMarker(blob: string): RepairMarker | undefined {
  const value = parseBlob(blob);
  if (!value) return undefined;
  const host = parseChild(value.host);
  const roundId = typeof value.roundId === 'string' ? parseRoundId(value.roundId) : undefined;
  return host && roundId ? { host, roundId } : undefined;
}

/** Parses the durable revalidation queue and its at-least-once event outbox. */
export function parseRevalidationQueueRecord(blob: string): RevalidationQueueRecord | undefined {
  const value = parseBlob(blob);
  if (!value || typeof value.generation !== 'number' || !Number.isInteger(value.generation) || value.generation < 0 || !Array.isArray(value.entries)) return undefined;
  const entries = value.entries.map((entry): RevalidationQueueEntry | undefined => {
    if (!isRecord(entry)) return undefined;
    const child = parseChild(entry.child);
    const closureSha = typeof entry.closureSha === 'string' ? parseCommitSha(entry.closureSha) : undefined;
    const state = nonEmptyString(entry.state);
    return child && closureSha && state ? { child, closureSha, state } : undefined;
  });
  const outbox = parseOutbox(value.outbox);
  if (entries.some((entry) => entry === undefined) || !outbox) return undefined;
  return { generation: value.generation, entries: entries as RevalidationQueueEntry[], outbox };
}
