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
  /** The placement judgement is durable context for the host. */
  readonly rationale?: string;
  /** Existing-task work is represented, but must not be re-staged. */
  readonly restage?: boolean;
  /** Authored task bindings for an existing-task repair. */
  readonly taskIds?: readonly string[];
  /** The durable routed-obligation boundary, written at host region entry. */
  readonly obligation?: RoutedObligation;
}

/** The routed obligation is the durable authority for its engine-state projection. */
export interface RoutedObligation {
  readonly branch: string;
  readonly head: CommitSha;
  readonly tree: CommitSha;
}

/** The base and tree captured before a host region can mutate its branch. */
export interface HostEntry {
  /** The only host permitted to consume this entry baseline. */
  readonly host: ChildId;
  readonly pinnedBase: CommitSha;
  readonly tree: CommitSha;
}

/** The immutable rem-* blocks to append when a host enters its region. */
export interface FrozenHostAllocation {
  readonly remTaskIds: readonly string[];
  readonly blockBodies: readonly string[];
  readonly retryHint?: string;
}

/** Frozen rem-* task ids and their exact block bodies, grouped by host child. */
export type FrozenAllocation = Readonly<Record<ChildId, FrozenHostAllocation>>;

/** The only whole-feature remediation gates that can consume a route lap. */
export const WHOLE_FEATURE_BUDGET_GATES = ['prd_audit', 'architecture_review_as_built'] as const;
export type WholeFeatureBudgetGate = typeof WHOLE_FEATURE_BUDGET_GATES[number];

/** A taskless retry is deliberately separate from whole-feature lap charges. */
export type TasklessReceiptGate = 'manual_test';

/** A configured custom step's durable counter echo. */
export type CustomStepReceiptGate = string & { readonly __brand: 'CustomStepReceiptGate' };

/** Per-gate charges and durable counter echoes, keyed by their closed domain. */
export type ReceiptCharges<Key extends string> = Readonly<Partial<Record<Key, number>>>;
export type ReceiptLapCharges = ReceiptCharges<WholeFeatureBudgetGate>;
export type ReceiptTasklessCharges = ReceiptCharges<TasklessReceiptGate>;
export type ReceiptEchoCharges = ReceiptCharges<CustomStepReceiptGate>;

/** Fields shared by settled and unsettled routing-round receipts. */
interface RoundReceiptCharges {
  readonly laps?: ReceiptLapCharges;
  readonly growth?: number;
  readonly taskless?: ReceiptTasklessCharges;
  readonly echo?: ReceiptEchoCharges;
}

/** A receipt before settlement cannot carry an acknowledgement. */
export type UnsettledRoundReceipt = RoundReceiptCharges & {
  readonly settlementId?: never;
  /** Omitted preserves the legacy `{}` durable representation. */
  readonly acks?: Readonly<Record<string, never>>;
};

/** A receipt after settlement has both its idempotency key and host acknowledgements. */
export type SettledRoundReceipt = RoundReceiptCharges & {
  readonly settlementId: string;
  readonly acks: Readonly<Record<ChildId, true>>;
};

/** The durable settlement state for a routing round. */
export type RoundReceipt = UnsettledRoundReceipt | SettledRoundReceipt;

/** One verified upward reroute retained as durable audit context. */
export interface RouteFallback {
  readonly from: ChildId;
  readonly to: ChildId;
  readonly evidence: readonly string[];
  readonly branch: string;
  readonly head: CommitSha;
}

/** The sync inputs persisted while a reroute is between ref move and tree sync. */
export interface ReroutePhase {
  readonly sourceBranch: string;
  readonly rejectedTip: CommitSha;
  readonly resetTip: CommitSha;
  readonly destination: ChildId;
}

/** The source and destination proven by a parsed in-progress reroute. */
export interface ValidatedReroute {
  readonly source: ChildId;
  readonly destination: ChildId;
}

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
  /** The current host's pre-mutation review and no-op baseline. */
  readonly entry?: HostEntry;
  /** Verified upward movements, in the order they happened. */
  readonly fallback?: readonly RouteFallback[];
  /** Present only while a rerouted worktree still needs tree synchronization. */
  readonly reroute?: ReroutePhase;
  readonly outbox: readonly OutboxEntry[];
}

/**
 * Returns the reroute endpoints only from a record whose parser has proven
 * that its latest fallback movement and in-progress reroute agree.
 */
export function validatedReroute(record: RouteRecord): ValidatedReroute | undefined {
  if (!record.reroute) return undefined;
  const fallback = record.fallback?.at(-1);
  if (!fallback || fallback.to !== record.reroute.destination) return undefined;
  const sourceState = record.hosts[fallback.from];
  if (sourceState !== 'reroute-moved' && sourceState !== 'rerouted') return undefined;
  return { source: fallback.from, destination: record.reroute.destination };
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

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parseReceiptCharges<Key extends string>(
  value: unknown,
  allowed: readonly Key[] | undefined,
): ReceiptCharges<Key> | undefined {
  if (!isRecord(value)) return undefined;
  const charges: Partial<Record<Key, number>> = {};
  for (const [gate, count] of Object.entries(value)) {
    const parsed = nonNegativeInteger(count);
    if (!nonEmptyString(gate) || parsed === undefined || (allowed !== undefined && !allowed.includes(gate as Key))) return undefined;
    charges[gate as Key] = parsed;
  }
  return charges;
}

function parseReceipt(value: unknown): RoundReceipt | undefined {
  if (!isRecord(value)) return undefined;
  if (Object.keys(value).length === 0) {
    return {};
  }
  const laps = parseReceiptCharges(value.laps, WHOLE_FEATURE_BUDGET_GATES);
  const growth = nonNegativeInteger(value.growth);
  const taskless = parseReceiptCharges(value.taskless, ['manual_test'] as const);
  const echo = parseReceiptCharges<CustomStepReceiptGate>(value.echo, undefined);
  if (!laps || growth === undefined || !taskless || !echo || !isRecord(value.acks)) return undefined;
  const acks: Record<ChildId, true> = {} as Record<ChildId, true>;
  for (const [rawChild, acknowledged] of Object.entries(value.acks)) {
    const child = parseChildId(rawChild);
    if (!child || acknowledged !== true) return undefined;
    acks[child] = true;
  }
  const settlementId = value.settlementId === undefined ? undefined : nonEmptyString(value.settlementId);
  if (value.settlementId !== undefined && settlementId === undefined) return undefined;
  if (settlementId === undefined && Object.keys(acks).length > 0) return undefined;
  // Preserve the durable record's serialized field order: route blobs are
  // compared as bytes by recovery callers as well as parsed structurally.
  const parsed: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    switch (key) {
      case 'laps': parsed.laps = laps; break;
      case 'growth': parsed.growth = growth; break;
      case 'taskless': parsed.taskless = taskless; break;
      case 'echo': parsed.echo = echo; break;
      case 'settlementId': if (settlementId !== undefined) parsed.settlementId = settlementId; break;
      case 'acks': parsed.acks = acks; break;
      default: return undefined;
    }
  }
  return settlementId === undefined
    ? parsed as unknown as UnsettledRoundReceipt
    : parsed as unknown as SettledRoundReceipt;
}

/** Mirrors the reject conditions of `git check-ref-format --branch` without a subprocess. */
function validBranchName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value !== '@' && !value.startsWith('-')
    && !value.startsWith('/') && !value.endsWith('/') && !value.endsWith('.')
    && !value.includes('..') && !value.includes('@{') && !value.includes('//')
    && !/[\x00-\x20\x7f ~^:?*[\\]/.test(value)
    && value.split('/').every((component) => component.length > 0 && !component.startsWith('.'));
}

function parseHostEntry(value: unknown): HostEntry | undefined {
  if (!isRecord(value)) return undefined;
  const host = parseChild(value.host);
  const pinnedBase = typeof value.pinnedBase === 'string' ? parseCommitSha(value.pinnedBase) : undefined;
  const tree = typeof value.tree === 'string' ? parseCommitSha(value.tree) : undefined;
  return host && pinnedBase && tree ? { host, pinnedBase, tree } : undefined;
}

function parseRoutedObligation(value: unknown): RoutedObligation | undefined {
  if (!isRecord(value) || !validBranchName(value.branch)) return undefined;
  const head = typeof value.head === 'string' ? parseCommitSha(value.head) : undefined;
  const tree = typeof value.tree === 'string' ? parseCommitSha(value.tree) : undefined;
  return head && tree ? { branch: value.branch, head, tree } : undefined;
}

function parseRouteFallback(value: unknown): RouteFallback | undefined {
  if (!isRecord(value) || !validBranchName(value.branch)) return undefined;
  const from = parseChild(value.from);
  const to = parseChild(value.to);
  const evidence = parseStringArray(value.evidence);
  const head = typeof value.head === 'string' ? parseCommitSha(value.head) : undefined;
  return from && to && evidence && head ? { from, to, evidence, branch: value.branch, head } : undefined;
}

function parseReroutePhase(value: unknown): ReroutePhase | undefined {
  if (!isRecord(value) || !validBranchName(value.sourceBranch)) return undefined;
  const rejectedTip = typeof value.rejectedTip === 'string' ? parseCommitSha(value.rejectedTip) : undefined;
  const resetTip = typeof value.resetTip === 'string' ? parseCommitSha(value.resetTip) : undefined;
  const destination = parseChild(value.destination);
  return rejectedTip && resetTip && destination
    ? { sourceBranch: value.sourceBranch, rejectedTip, resetTip, destination }
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
  if (value.rationale !== undefined && typeof value.rationale !== 'string') return undefined;
  if (value.restage !== undefined && typeof value.restage !== 'boolean') return undefined;
  const taskIds = value.taskIds === undefined ? undefined : parseStringArray(value.taskIds);
  const obligation = value.obligation === undefined ? undefined : parseRoutedObligation(value.obligation);
  if ((value.taskIds !== undefined && (!taskIds || taskIds.length === 0)) || (value.obligation !== undefined && !obligation)
    || (value.restage === false && taskIds === undefined) || (obligation !== undefined && taskIds === undefined)) return undefined;
  return {
    findingId, kind, owner, host, reason, fallback: fallback as ChildId[],
    ...(value.rationale === undefined ? {} : { rationale: value.rationale }),
    ...(value.restage === undefined ? {} : { restage: value.restage }),
    ...(taskIds === undefined ? {} : { taskIds }),
    ...(obligation === undefined ? {} : { obligation }),
  };
}

function parseAllocation(value: unknown): FrozenAllocation | undefined {
  if (!isRecord(value)) return undefined;
  const allocation: Record<ChildId, FrozenHostAllocation> = {} as Record<ChildId, FrozenHostAllocation>;
  for (const [rawChild, rawAllocation] of Object.entries(value)) {
    const child = parseChildId(rawChild);
    if (!child || !isRecord(rawAllocation)) return undefined;
    const remTaskIds = parseStringArray(rawAllocation.remTaskIds, (id) => id.startsWith('rem-'));
    const blockBodies = parseStringArray(rawAllocation.blockBodies);
    if (!remTaskIds || !blockBodies || remTaskIds.length !== blockBodies.length ||
      (rawAllocation.retryHint !== undefined && typeof rawAllocation.retryHint !== 'string')) return undefined;
    allocation[child] = { remTaskIds, blockBodies, ...(rawAllocation.retryHint === undefined ? {} : { retryHint: rawAllocation.retryHint }) };
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
  const receipt = parseReceipt(value.receipt);
  const entry = value.entry === undefined ? undefined : parseHostEntry(value.entry);
  const fallback = value.fallback === undefined ? undefined : Array.isArray(value.fallback) ? value.fallback.map(parseRouteFallback) : undefined;
  const reroute = value.reroute === undefined ? undefined : parseReroutePhase(value.reroute);
  const currentHostIndex = value.currentHostIndex;
  if (!roundId || !kind || !phase || !Array.isArray(value.items) || !allocation || !hosts || typeof currentHostIndex !== 'number' || !Number.isInteger(currentHostIndex)
    || currentHostIndex < 0 || currentHostIndex >= Object.keys(hosts).length || !receipt || !outbox
    || (value.entry !== undefined && (!entry || hosts[entry.host] === undefined)) || (fallback?.some((item) => item === undefined) ?? false)
    || (value.fallback !== undefined && fallback === undefined) || (value.reroute !== undefined && !reroute)) return undefined;
  const items = value.items.map(parseRoutedItem);
  if (items.some((item) => item === undefined)) return undefined;
  const record: RouteRecord = {
    roundId,
    kind,
    phase,
    items: items as RoutedItem[],
    allocation,
    hosts,
    currentHostIndex,
    receipt,
    ...(entry === undefined ? {} : { entry }),
    ...(fallback === undefined ? {} : { fallback: fallback as RouteFallback[] }),
    ...(reroute === undefined ? {} : { reroute }),
    outbox,
  };
  if (reroute && !validatedReroute(record)) return undefined;
  return record;
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
