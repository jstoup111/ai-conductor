import { CHILD_REGION_STEPS, parseChildId, type ChildId } from '../child-context.js';
import { isValidGitBranchName } from '../git-branch-name.js';
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

interface RoutedItemBase {
  readonly findingId: string;
  readonly kind: RouteKind;
  readonly owner: ChildId;
  readonly host: ChildId;
  readonly reason: string;
  readonly fallback: readonly ChildId[];
  /** Immutable prerequisite inputs admitted with the work order. */
  readonly prerequisitePaths?: readonly string[];
  /** The placement judgement is durable context for the host. */
  readonly rationale?: string;
}

/** An ordinary routed item has no authored-task repair state. */
export type NewTaskRoutedItem = RoutedItemBase & {
  readonly existingTask?: never;
  readonly restage?: never;
  readonly taskIds?: never;
  readonly obligation?: never;
};

/** An existing-task repair owns its non-empty binding and optional entry state. */
export type ExistingTaskRoutedItem = RoutedItemBase & {
  readonly existingTask: true;
  readonly taskIds: readonly [string, ...string[]];
  readonly restage?: false;
  readonly obligation?: RoutedObligation;
};

/** The existing-task flag is the durable discriminator for routed-item state. */
export type RoutedItem = NewTaskRoutedItem | ExistingTaskRoutedItem;

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
  readonly laps: ReceiptLapCharges;
  readonly growth: number;
  readonly taskless: ReceiptTasklessCharges;
  readonly echo: ReceiptEchoCharges;
}

/** A receipt before settlement cannot carry an acknowledgement. */
export type UnsettledRoundReceipt = RoundReceiptCharges & {
  readonly settlementId?: never;
  readonly acks: Readonly<Record<string, never>>;
};

/** A receipt after settlement has both its idempotency key and host acknowledgements. */
export type SettledRoundReceipt = RoundReceiptCharges & {
  readonly settlementId: string;
  readonly acks: Readonly<Record<ChildId, true>>;
};

/** The durable settlement state for a routing round. */
export type RoundReceipt = UnsettledRoundReceipt | SettledRoundReceipt;

/** The canonical unsettled receipt, including all durable accounting fields. */
export function emptyUnsettledReceipt(): UnsettledRoundReceipt {
  return { laps: {}, growth: 0, taskless: {}, echo: {}, acks: {} };
}

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
  /** Immutable authored-task denominator captured when the route was admitted. */
  readonly sealedAuthored?: number;
  /** As-built findings that remain pending while this route is open. */
  readonly pendingAsBuiltFindings?: readonly PendingAsBuiltRouteFinding[];
  /** The current host's pre-mutation review and no-op baseline. */
  readonly entry?: HostEntry;
  /** Verified upward movements, in the order they happened. */
  readonly fallback?: readonly RouteFallback[];
  /** Present only while a rerouted worktree still needs tree synchronization. */
  readonly reroute?: ReroutePhase;
  /** The leaf branch and tip durably recorded before the round is closed. */
  readonly leafReturn?: { readonly branch: string; readonly head: CommitSha };
  readonly outbox: readonly OutboxEntry[];
}

export interface PendingAsBuiltRouteFinding {
  readonly gate: 'architecture_review_as_built';
  readonly finding: string;
  readonly class: 'REMEDIABLE';
  readonly governingClause: string;
  readonly summary: string;
  readonly outcome: 'remediated';
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
  readonly position: ChildId;
  readonly closureSha: CommitSha;
  readonly gates: readonly RegionGate[];
  readonly replay: { readonly oldParent: CommitSha; readonly newParent: CommitSha };
  readonly state: 'queued';
}

export type RegionGate = typeof CHILD_REGION_STEPS[number];

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
const regionGates = new Set<RegionGate>(CHILD_REGION_STEPS);
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

function parseNonEmptyStringArray(value: unknown): readonly [string, ...string[]] | undefined {
  const parsed = parseStringArray(value);
  return parsed !== undefined && parsed.length > 0 ? parsed as readonly [string, ...string[]] : undefined;
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
    return emptyUnsettledReceipt();
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

function parseHostEntry(value: unknown): HostEntry | undefined {
  if (!isRecord(value)) return undefined;
  const host = parseChild(value.host);
  const pinnedBase = typeof value.pinnedBase === 'string' ? parseCommitSha(value.pinnedBase) : undefined;
  const tree = typeof value.tree === 'string' ? parseCommitSha(value.tree) : undefined;
  return host && pinnedBase && tree ? { host, pinnedBase, tree } : undefined;
}

function parseRoutedObligation(value: unknown): RoutedObligation | undefined {
  if (!isRecord(value) || !isValidGitBranchName(value.branch)) return undefined;
  const head = typeof value.head === 'string' ? parseCommitSha(value.head) : undefined;
  const tree = typeof value.tree === 'string' ? parseCommitSha(value.tree) : undefined;
  return head && tree ? { branch: value.branch, head, tree } : undefined;
}

function parseRouteFallback(value: unknown): RouteFallback | undefined {
  if (!isRecord(value) || !isValidGitBranchName(value.branch)) return undefined;
  const from = parseChild(value.from);
  const to = parseChild(value.to);
  const evidence = parseStringArray(value.evidence);
  const head = typeof value.head === 'string' ? parseCommitSha(value.head) : undefined;
  return from && to && evidence && head ? { from, to, evidence, branch: value.branch, head } : undefined;
}

function parseReroutePhase(value: unknown): ReroutePhase | undefined {
  if (!isRecord(value) || !isValidGitBranchName(value.sourceBranch)) return undefined;
  const rejectedTip = typeof value.rejectedTip === 'string' ? parseCommitSha(value.rejectedTip) : undefined;
  const resetTip = typeof value.resetTip === 'string' ? parseCommitSha(value.resetTip) : undefined;
  const destination = parseChild(value.destination);
  return rejectedTip && resetTip && destination
    ? { sourceBranch: value.sourceBranch, rejectedTip, resetTip, destination }
    : undefined;
}

function parseLeafReturn(value: unknown): { readonly branch: string; readonly head: CommitSha } | undefined {
  if (!isRecord(value) || typeof value.branch !== 'string' || !isValidGitBranchName(value.branch)
    || typeof value.head !== 'string') return undefined;
  const head = parseCommitSha(value.head);
  return head === undefined ? undefined : { branch: value.branch, head };
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
  const prerequisitePaths = value.prerequisitePaths === undefined
    ? undefined
    : parseStringArray(value.prerequisitePaths);
  if (value.prerequisitePaths !== undefined && !prerequisitePaths) return undefined;
  const base: RoutedItemBase = {
    findingId, kind, owner, host, reason, fallback: fallback as ChildId[],
    ...(value.rationale === undefined ? {} : { rationale: value.rationale }),
    ...(prerequisitePaths === undefined ? {} : { prerequisitePaths }),
  };
  if (value.existingTask !== true) {
    return value.existingTask === undefined && value.taskIds === undefined && value.obligation === undefined && value.restage === undefined
      ? base
      : undefined;
  }
  if (value.restage !== undefined && value.restage !== false) return undefined;
  const taskIds = parseNonEmptyStringArray(value.taskIds);
  const obligation = value.obligation === undefined ? undefined : parseRoutedObligation(value.obligation);
  if (!taskIds || (value.obligation !== undefined && !obligation)) return undefined;
  return {
    ...base,
    existingTask: true,
    taskIds,
    ...(value.restage === false ? { restage: false as const } : {}),
    ...(obligation === undefined ? {} : { obligation }),
  };
}

function parsePendingAsBuiltRouteFindings(value: unknown): readonly PendingAsBuiltRouteFinding[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const findings: PendingAsBuiltRouteFinding[] = [];
  for (const item of value) {
    if (!isRecord(item) || item.gate !== 'architecture_review_as_built' || item.class !== 'REMEDIABLE' || item.outcome !== 'remediated') return undefined;
    const finding = nonEmptyString(item.finding);
    const governingClause = nonEmptyString(item.governingClause);
    const summary = nonEmptyString(item.summary);
    if (!finding || !governingClause || !summary) return undefined;
    findings.push({ gate: 'architecture_review_as_built', finding, class: 'REMEDIABLE', governingClause, summary, outcome: 'remediated' });
  }
  return findings;
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

/** The current host is indexed by ascending child position in durable records. */
export function currentHostOf(
  record: Pick<RouteRecord, 'hosts' | 'currentHostIndex'>,
): ChildId | undefined {
  const host = Object.keys(record.hosts).map(Number).sort((left, right) => left - right)[record.currentHostIndex];
  return host === undefined ? undefined : parseChildId(host);
}

/** The cross-field lifecycle facts one durable route record must agree on. */
interface RouteLifecycleState {
  readonly phase: RoundPhase;
  readonly hosts: Readonly<Record<ChildId, HostState>>;
  readonly currentHostIndex: number;
  readonly entry: HostEntry | undefined;
  readonly fallback: readonly RouteFallback[] | undefined;
  readonly reroute: ReroutePhase | undefined;
}

/** A host that has entered its region and not yet moved its repair away. */
function isActiveHostState(state: HostState): boolean {
  return state === 'admitted' || state === 'repairing';
}

/** A host whose region work finished in place rather than by moving upward. */
function isCompletedHostState(state: HostState): boolean {
  return state === 'built' || state === 'restacked' || state === 'done';
}

/** A host whose repair was moved to a higher host by a verified reroute. */
function isMovedHostState(state: HostState): boolean {
  return state === 'reroute-moved' || state === 'rerouted';
}

/**
 * Every recorded upward movement names a moved source below a known
 * destination, and every moved host is the source of a recorded movement.
 */
function hasConsistentFallback(
  hosts: Readonly<Record<ChildId, HostState>>,
  fallback: readonly RouteFallback[],
): boolean {
  const sources = new Set<number>();
  for (const movement of fallback) {
    const source = hosts[movement.from];
    if (source === undefined || !isMovedHostState(source) || hosts[movement.to] === undefined || movement.to <= movement.from) return false;
    sources.add(movement.from);
  }
  return Object.entries(hosts).every(([child, state]) => !isMovedHostState(state) || sources.has(Number(child)));
}

/**
 * Validates a route record as ONE lifecycle state.  The writers are
 * creation (`prepared`, every host pending at index 0), admission (`open`,
 * current host admitted), region entry (entry pinned for an admitted or
 * repairing current host), reroute (source `reroute-moved`, the pending
 * destination becomes current with no entry and an in-progress `reroute`),
 * reroute sync (source `rerouted`, destination admitted, no `reroute`), and
 * ADR decision 6's in-place host exits and round close.  Any combination
 * outside those reachable states is malformed.
 */
function hasConsistentRouteLifecycle(state: RouteLifecycleState): boolean {
  const { phase, hosts, currentHostIndex, entry, fallback, reroute } = state;
  const currentHost = currentHostOf({ hosts, currentHostIndex });
  if (currentHost === undefined) return false;
  const current = hosts[currentHost];
  if (current === undefined) return false;
  if (entry !== undefined && entry.host !== currentHost) return false;
  if (fallback !== undefined && !hasConsistentFallback(hosts, fallback)) return false;
  const others = Object.entries(hosts)
    .filter(([child]) => Number(child) !== currentHost)
    .map(([, hostState]) => hostState);
  const movingHosts = Object.values(hosts).filter((hostState) => hostState === 'reroute-moved').length;
  switch (phase) {
    case 'prepared':
      // Creation is the only writer of a prepared round; admission opens it
      // in the same transaction that moves its first host out of pending.
      return currentHostIndex === 0 && Object.values(hosts).every((hostState) => hostState === 'pending')
        && entry === undefined && fallback === undefined && reroute === undefined;
    case 'open':
      // Exactly one host is in flight: no other host may be active.
      if (others.some(isActiveHostState)) return false;
      if (reroute !== undefined) {
        // Between the reroute transaction and its tree sync: one source is
        // moving, and the destination is the pending, unentered current host.
        return movingHosts === 1 && current === 'pending' && entry === undefined
          && reroute.destination === currentHost && fallback !== undefined && fallback.length > 0;
      }
      if (movingHosts > 0) return false;
      return isActiveHostState(current) || isCompletedHostState(current);
    case 'closed':
      // ADR decision 6: a round closes when its last host is restacked, done
      // or rerouted, so no host is in flight, built, or awaiting a reroute sync.
      return reroute === undefined && (current === 'restacked' || current === 'done')
        && others.every((hostState) => hostState === 'restacked' || hostState === 'done' || hostState === 'rerouted');
  }
  return assertNever(phase);
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
  const sealedAuthored = value.sealedAuthored === undefined ? undefined : nonNegativeInteger(value.sealedAuthored);
  const pendingAsBuiltFindings = value.pendingAsBuiltFindings === undefined
    ? undefined
    : parsePendingAsBuiltRouteFindings(value.pendingAsBuiltFindings);
  const entry = value.entry === undefined ? undefined : parseHostEntry(value.entry);
  const fallback = value.fallback === undefined ? undefined : Array.isArray(value.fallback) ? value.fallback.map(parseRouteFallback) : undefined;
  const reroute = value.reroute === undefined ? undefined : parseReroutePhase(value.reroute);
  const leafReturn = value.leafReturn === undefined ? undefined : parseLeafReturn(value.leafReturn);
  const currentHostIndex = value.currentHostIndex;
  if (!roundId || !kind || !phase || !Array.isArray(value.items) || !allocation || !hosts || typeof currentHostIndex !== 'number' || !Number.isInteger(currentHostIndex)
    || currentHostIndex < 0 || currentHostIndex >= Object.keys(hosts).length || !receipt || !outbox
    || (receipt.settlementId !== undefined && (Object.keys(receipt.acks).length === 0 || Object.keys(receipt.acks).some((ack) => hosts[Number(ack) as ChildId] === undefined)))
    || (value.entry !== undefined && !entry) || (fallback?.some((item) => item === undefined) ?? false)
    || (value.fallback !== undefined && fallback === undefined) || (value.reroute !== undefined && !reroute)
    || (value.sealedAuthored !== undefined && sealedAuthored === undefined)
    || (value.pendingAsBuiltFindings !== undefined && pendingAsBuiltFindings === undefined)
    || (value.leafReturn !== undefined && leafReturn === undefined)) return undefined;
  if (!hasConsistentRouteLifecycle({
    phase, hosts, currentHostIndex, entry, fallback: fallback as RouteFallback[] | undefined, reroute,
  })) return undefined;
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
    ...(sealedAuthored === undefined ? {} : { sealedAuthored }),
    ...(pendingAsBuiltFindings === undefined ? {} : { pendingAsBuiltFindings }),
    ...(entry === undefined ? {} : { entry }),
    ...(fallback === undefined ? {} : { fallback: fallback as RouteFallback[] }),
    ...(reroute === undefined ? {} : { reroute }),
    ...(leafReturn === undefined ? {} : { leafReturn }),
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
    const position = parseChild(entry.position);
    const closureSha = typeof entry.closureSha === 'string' ? parseCommitSha(entry.closureSha) : undefined;
    if (!isRecord(entry.replay) || !Array.isArray(entry.gates)) return undefined;
    const oldParent = typeof entry.replay.oldParent === 'string' ? parseCommitSha(entry.replay.oldParent) : undefined;
    const newParent = typeof entry.replay.newParent === 'string' ? parseCommitSha(entry.replay.newParent) : undefined;
    const gates = entry.gates.map((gate): RegionGate | undefined =>
      typeof gate === 'string' && regionGates.has(gate as RegionGate) ? gate as RegionGate : undefined);
    if (!child || !position || !closureSha || !oldParent || !newParent || entry.state !== 'queued' || gates.some((gate) => gate === undefined)) return undefined;
    return { child, position, closureSha, gates: gates as RegionGate[], replay: { oldParent, newParent }, state: 'queued' };
  });
  const outbox = parseOutbox(value.outbox);
  if (entries.some((entry) => entry === undefined) || !outbox) return undefined;
  const parsedEntries = entries as RevalidationQueueEntry[];
  const children = new Set<ChildId>();
  let previousPosition: ChildId | undefined;
  for (const entry of parsedEntries) {
    if (children.has(entry.child) || (previousPosition !== undefined && entry.position <= previousPosition)) return undefined;
    children.add(entry.child);
    previousPosition = entry.position;
  }
  return { generation: value.generation, entries: parsedEntries, outbox };
}
