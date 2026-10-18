import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

import type { StackedPrsConfig } from '../../types/config.js';
import type { ChildId } from '../child-context.js';
import {
  readKickbackLedger,
  MAX_KICKBACKS_PER_GATE,
  updateKickbackLedger,
  withKickbackLedgerLease,
  writeKickbackLedgerUnlocked,
  type KickbackLedger,
  type PendingRepairSettlementBudget,
} from '../kickback-ledger.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { parseChildId } from '../child-context.js';
import { readRouteRecord, writeRouteRecord } from './route-record-store.js';
import {
  emptyUnsettledReceipt,
  parseRoundId,
  routingEligible,
  WHOLE_FEATURE_BUDGET_GATES,
  type ReceiptLapCharges,
  type RoundId,
  type RoundReceipt,
  type RouteRecord,
  type SettledRoundReceipt,
  type TasklessReceiptGate,
  type UnsettledRoundReceipt,
} from './route-types.js';

/** The caller-established routing context required before receipt refs are read. */
export interface ReceiptRoutingScope {
  readonly cursor: { readonly kind: string };
  readonly config: { readonly stacked_prs?: StackedPrsConfig } | undefined;
}

type RouteReceiptRecord =
  | { readonly kind: 'ok'; readonly roundId: RoundId; readonly record: RouteRecord }
  | { readonly kind: 'malformed'; readonly ref: string }
  | { readonly kind: 'unreadable'; readonly ref?: string };

/**
 * Read every route receipt through the store after the single routing fence.
 * A route namespace is durable state: a listing, id, or record-read failure is
 * an explicit result for its consumer to settle or halt, never an exception.
 */
async function enumerateRouteReceiptRecords(input: {
  readonly projectRoot: string;
  readonly slug: string;
  readonly routing: ReceiptRoutingScope;
  readonly git: GitRunner;
}): Promise<readonly RouteReceiptRecord[]> {
  if (!routingEligible(input.routing.cursor, input.routing.config)) return [];
  const prefix = `refs/conductor/${input.slug}/routes/`;
  let listed: Awaited<ReturnType<GitRunner>>;
  try {
    listed = await input.git(['for-each-ref', '--format=%(refname)', prefix]);
  } catch {
    return [{ kind: 'unreadable' }];
  }
  if (listed.exitCode !== 0) return [{ kind: 'unreadable' }];

  const records: RouteReceiptRecord[] = [];
  for (const ref of listed.stdout.split('\n').filter(Boolean)) {
    const roundId = parseRoundId(ref.split('/').at(-1) ?? '');
    if (!roundId) {
      records.push({ kind: 'malformed', ref });
      continue;
    }
    try {
      const stored = await readRouteRecord(input.projectRoot, input.slug, roundId, { git: input.git });
      if (stored.kind !== 'record') {
        records.push({ kind: 'unreadable', ref });
      } else if (stored.record.roundId !== roundId) {
        records.push({ kind: 'malformed', ref });
      } else {
        records.push({ kind: 'ok', roundId, record: stored.record });
      }
    } catch {
      records.push({ kind: 'unreadable', ref });
    }
  }
  return records;
}

export interface RoutedRepairCreditInput {
  readonly projectRoot: string;
  readonly child: ChildId;
  readonly roundId: RoundId;
}

type GrantRoutedRepairCreditResult =
  | { readonly kind: 'granted' }
  | { readonly kind: 'already-granted' }
  | { readonly kind: 'refused'; readonly detail: string };

/** Persist the single cumulative-bound allowance attached to a routed repair. */
export async function grantRoutedRepairCredit(
  input: RoutedRepairCreditInput,
): Promise<{ readonly kind: 'granted' | 'already-granted' | 'refused'; readonly detail?: string }> {
  return updateKickbackLedger<GrantRoutedRepairCreditResult>(input.projectRoot, (ledger) => {
    const existing = ledger.routedRepairCredit;
    if (existing?.roundId === input.roundId) {
      // Resume observes a prior spend; it must not turn a converged round
      // into a new admission refusal or mint another allowance.
      return { result: { kind: 'already-granted' } };
    }
    // Credits are scoped by round.  An unspent prior round must never deny a
    // later admitted repair its own allowance.
    return {
      ledger: { ...ledger, routedRepairCredit: { roundId: input.roundId } },
      result: { kind: 'granted' },
    };
  }, undefined, input.child);
}

/** Spend the routed repair's single extra cumulative build-review lap. */
export async function consumeRoutedRepairCredit(input: RoutedRepairCreditInput): Promise<boolean> {
  return updateKickbackLedger(input.projectRoot, (ledger) => {
    const credit = ledger.routedRepairCredit;
    if (credit?.roundId !== input.roundId || credit.consumed === true) return { result: false };
    return {
      ledger: { ...ledger, routedRepairCredit: { ...credit, consumed: true } },
      result: true,
    };
  }, undefined, input.child);
}

/** Result of charging a routed round at the final BUILD dispatch boundary. */
export type RoundSettlementResult =
  | { readonly kind: 'settled'; readonly settlementId: string }
  | { readonly kind: 'acknowledged'; readonly settlementId: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly reason: 'not-current-host' }
  | { readonly kind: 'exhausted'; readonly gate: string; readonly allowance: 'laps' | 'growth' }
  | { readonly kind: 'halted'; readonly reason: string };

export interface SettleRoundAtDispatchInput {
  readonly projectRoot: string;
  readonly slug: string;
  readonly roundId: RoundId;
  readonly dispatchingChild: ChildId;
  /** The already-resolved feature allowances. */
  readonly budgets: readonly PendingRepairSettlementBudget[];
  readonly routing: ReceiptRoutingScope;
  readonly git?: GitRunner;
}

function orderedHosts(record: RouteRecord): ChildId[] {
  return Object.keys(record.hosts).map((value) => parseChildId(value)).filter((value): value is ChildId => value !== undefined)
    .sort((a, b) => a - b);
}

function currentHost(record: RouteRecord): ChildId | undefined {
  return orderedHosts(record)[record.currentHostIndex];
}

function receiptSettlementId(roundId: RoundId, receipt: RouteRecord['receipt']): string {
  const stable = JSON.stringify({ laps: receipt.laps ?? {}, growth: receipt.growth ?? 0, taskless: receipt.taskless ?? {}, echo: receipt.echo ?? {} });
  return `${roundId}-${createHash('sha256').update(stable).digest('hex').slice(0, 16)}`;
}

function defaultGateEntry() {
  return { count: 0, cumulative: 0, treeHash: null, lastReason: '', priorVerdict: true, resolvedBefore: 0, adjustmentsKnown: true };
}

function receiptCharges(record: RouteRecord): { laps: ReceiptLapCharges; growth: number } {
  // A route records its originating charges at admission. An empty receipt is
  // an existing-task/no-allocation round, never an implicit prd_audit charge.
  const laps = record.receipt.laps;
  const allocated = Object.values(record.allocation).reduce((count, allocation) => count + allocation.remTaskIds.length, 0);
  // The record parser normalizes an empty receipt to `growth: 0`; that is a
  // legacy placeholder, not an authorization to make frozen rem blocks free.
  // A genuine existing-task repair has no allocation, so it still charges 0.
  const growth = allocated > 0 && record.receipt.growth === 0
    ? allocated
    : record.receipt.growth;
  return { laps, growth };
}

function withTasklessCharge(receipt: RoundReceipt, gate: TasklessReceiptGate): RoundReceipt {
  const taskless = { ...receipt.taskless, [gate]: 1 };
  if (receipt.settlementId === undefined) {
    const unsettled: UnsettledRoundReceipt = { ...emptyUnsettledReceipt(), ...receipt, taskless };
    return unsettled;
  }
  const settled: SettledRoundReceipt = { ...receipt, taskless };
  return settled;
}

/** Apply the durable accounting carried by one already-settled round receipt. */
function applySettledReceiptToLedger(ledger: KickbackLedger, record: RouteRecord): KickbackLedger {
  if (record.receipt.settlementId === undefined) return ledger;
  const settlementId = record.receipt.settlementId;
  const charges = receiptCharges(record);
  const gates = { ...ledger.gates };
  for (const gate of WHOLE_FEATURE_BUDGET_GATES) {
    const laps = charges.laps[gate];
    if (laps === undefined) continue;
    const entry = gates[gate] ?? defaultGateEntry();
    gates[gate] = { ...entry, laps: (entry.laps ?? 0) + laps };
  }
  const prior = ledger.growth ?? { authored: record.sealedAuthored ?? 0, added: 0, byGate: {} };
  // A joined round charges its single growth value once. The owner is the first
  // charged gate in budget-gate order (prd_audit before as-built), never the
  // receipt's key order, so the ledger attribution is deterministic.
  const owner = WHOLE_FEATURE_BUDGET_GATES.find((gate) => charges.laps[gate] !== undefined) ?? 'prd_audit';
  const growth = {
    authored: prior.authored,
    added: prior.added + charges.growth,
    byGate: { ...prior.byGate, [owner]: (prior.byGate[owner] ?? 0) + charges.growth },
  };
  return {
    ...ledger,
    gates,
    growth,
    settlementReceipts: { ...(ledger.settlementReceipts ?? {}), [settlementId]: { gates: Object.keys(charges.laps) } },
  };
}

function nextLedgerForReceipt(
  ledger: KickbackLedger,
  record: RouteRecord,
  budgets: readonly PendingRepairSettlementBudget[],
): { readonly ledger: KickbackLedger; readonly exhausted?: { gate: string; allowance: 'laps' | 'growth' } } {
  const charges = receiptCharges(record);
  const budgetByGate = new Map(budgets.map((budget) => [budget.gate, budget]));
  const next = applySettledReceiptToLedger(ledger, record);
  for (const gate of WHOLE_FEATURE_BUDGET_GATES) {
    const laps = charges.laps[gate];
    if (laps === undefined) continue;
    const budget = budgetByGate.get(gate);
    if (!budget) return { ledger, exhausted: { gate, allowance: 'laps' } };
    const entry = next.gates[gate] ?? defaultGateEntry();
    const lapCap = entry.effectiveLapCap ?? budget.lapCap;
    if ((entry.laps ?? 0) > lapCap) return { ledger, exhausted: { gate, allowance: 'laps' } };
  }
  const growthCap = next.effectiveGrowthCap ?? budgets[0]?.growthCap;
  if ((next.growth?.added ?? 0) > (growthCap ?? 0)) {
    return { ledger, exhausted: { gate: Object.keys(charges.laps)[0] ?? 'prd_audit', allowance: 'growth' } };
  }
  return { ledger: next };
}

/**
 * Replays a settled record whose process crashed after the route-ref CAS and
 * before writing the feature ledger.  The settlement id is the idempotency
 * boundary; replaying it twice therefore leaves the ledger byte-stable.
 */
export async function reconcileReceiptLedgerUnlocked(
  projectRoot: string,
  slug: string,
  routing: ReceiptRoutingScope,
  git: GitRunner = makeGitRunner(projectRoot),
): Promise<{ readonly kind: 'reconciled' | 'malformed' | 'unreadable' }> {
  const records = await enumerateRouteReceiptRecords({ projectRoot, slug, routing, git });
  let ledger = await readKickbackLedger(projectRoot);
  let changed = false;
  for (const item of records) {
    if (item.kind !== 'ok') return { kind: item.kind };
    if (item.record.receipt.settlementId === undefined || ledger.settlementReceipts?.[item.record.receipt.settlementId]) continue;
    // Reconciliation deliberately uses the receipt's durable numbers rather
    // than current caps: the admission was already settled by the ref CAS.
    ledger = applySettledReceiptToLedger(ledger, item.record);
    changed = true;
  }
  if (changed) await writeKickbackLedgerUnlocked(projectRoot, ledger);
  return { kind: 'reconciled' };
}

export async function reconcileReceiptLedger(projectRoot: string, slug: string, routing: ReceiptRoutingScope, git?: GitRunner): Promise<void> {
  const result = await withKickbackLedgerLease(projectRoot, () => reconcileReceiptLedgerUnlocked(projectRoot, slug, routing, git));
  if (result.kind !== 'reconciled') throw new Error(`route receipt reconciliation is ${result.kind}`);
}

/** Settle exactly once at the current routed host's BUILD dispatch. */
export async function settleRoundAtDispatch(input: SettleRoundAtDispatchInput): Promise<RoundSettlementResult> {
  const git = input.git ?? makeGitRunner(input.projectRoot);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await withKickbackLedgerLease(input.projectRoot, async () => {
      const stored = await readRouteRecord(input.projectRoot, input.slug, input.roundId, { git });
      // A malformed route receipt is a budget-boundary refusal.  Returning an
      // exhausted result lets the conductor persist the normal, flat cap
      // evidence and halt before a provider receives BUILD; a generic error
      // would otherwise bypass that evidence path.
      if (stored.kind !== 'record') return { kind: 'exhausted', gate: 'prd_audit', allowance: 'laps' } as const;
      if (currentHost(stored.record) !== input.dispatchingChild) return { kind: 'refused', reason: 'not-current-host' } as const;
      const reconciled = await reconcileReceiptLedgerUnlocked(input.projectRoot, input.slug, input.routing, git);
      if (reconciled.kind !== 'reconciled') return { kind: 'exhausted', gate: 'prd_audit', allowance: 'laps' } as const;
      const receipt = stored.record.receipt;
      if (receipt.settlementId !== undefined) {
        if (receipt.acks[input.dispatchingChild]) return { kind: 'acknowledged', settlementId: receipt.settlementId } as const;
        const acknowledgedReceipt: SettledRoundReceipt = {
          ...receipt,
          acks: { ...receipt.acks, [input.dispatchingChild]: true },
        };
        const wrote = await writeRouteRecord(input.projectRoot, stored, { ...stored.record, receipt: acknowledgedReceipt }, { git });
        return wrote.kind === 'updated' ? { kind: 'acknowledged', settlementId: receipt.settlementId } as const : wrote.kind === 'restack-journal-open' ? { kind: 'halted', reason: `routing round ${input.roundId} has an open restack journal` } as const : { kind: 'retry' as const };
      }
      const settlementId = receiptSettlementId(input.roundId, receipt);
      const settledReceipt: SettledRoundReceipt = {
        ...receipt,
        settlementId,
        acks: { [input.dispatchingChild]: true },
      };
      const settledRecord = {
        ...stored.record,
        receipt: settledReceipt,
      };
      const ledger = await readKickbackLedger(input.projectRoot);
      const next = nextLedgerForReceipt(ledger, settledRecord, input.budgets);
      if (next.exhausted) return { kind: 'exhausted', ...next.exhausted } as const;
      const wrote = await writeRouteRecord(input.projectRoot, stored, settledRecord, { git });
      if (wrote.kind === 'restack-journal-open') return { kind: 'halted', reason: `routing round ${input.roundId} has an open restack journal` } as const;
      if (wrote.kind !== 'updated') return { kind: 'retry' as const };
      await writeKickbackLedgerUnlocked(input.projectRoot, next.ledger);
      return { kind: 'settled', settlementId } as const;
    });
    if (result.kind !== 'retry') return result;
  }
  return { kind: 'halted', reason: `routing round ${input.roundId} settlement lost compare-and-swap three times` };
}

/** Task ids in open, uncharged frozen allocations are not authored-plan work. */
export async function pendingAllocationTaskIds(projectRoot: string, slug: string, routing: ReceiptRoutingScope, git: GitRunner = makeGitRunner(projectRoot)): Promise<string[]> {
  const records = await enumerateRouteReceiptRecords({ projectRoot, slug, routing, git });
  const ids = new Set<string>();
  for (const item of records) {
    if (item.kind !== 'ok') throw new Error(`route receipt ${item.kind}`);
    if (!item.record.receipt.settlementId) for (const allocation of Object.values(item.record.allocation)) for (const taskId of allocation.remTaskIds) ids.add(taskId);
  }
  return [...ids].sort();
}

/**
 * Charge the one taskless manual-test admission on its route receipt.  This
 * intentionally does not touch the feature ledger: taskless retries are
 * reconstructed from route receipts and retain the legacy self-heal cap.
 */
export async function chargeTasklessAtAdmission(input: {
  readonly projectRoot: string;
  readonly slug: string;
  readonly roundId: RoundId;
  readonly gate: TasklessReceiptGate;
  readonly routing: ReceiptRoutingScope;
  readonly git?: GitRunner;
}): Promise<{ readonly kind: 'charged'; readonly count: number } | { readonly kind: 'exhausted'; readonly count: number } | { readonly kind: 'halted'; readonly reason: string }> {
  const git = input.git ?? makeGitRunner(input.projectRoot);
  const capacity = await tasklessAdmissionCapacity({ ...input, git });
  if (capacity.kind !== 'available') return capacity;
  const count = capacity.count;
  const current = await readRouteRecord(input.projectRoot, input.slug, input.roundId, { git });
  if (current.kind !== 'record') return { kind: 'halted', reason: `route receipt ${input.roundId} is unreadable` };
  const present = current.record.receipt.taskless[input.gate] ?? 0;
  if (present > 0) return { kind: 'charged', count };
  const receipt = current.record.receipt;
  const wrote = await writeRouteRecord(input.projectRoot, current, {
    ...current.record,
    receipt: withTasklessCharge(receipt, input.gate),
  }, { git });
  return wrote.kind === 'updated'
    ? { kind: 'charged', count: count + 1 }
    : { kind: 'halted', reason: `taskless receipt write refused: ${wrote.kind}` };
}

/**
 * Read the taskless budget before a caller creates its route record.  This
 * makes an exhausted admission side-effect free: no prepared route ref is
 * left behind merely to discover that the legacy self-heal allowance is gone.
 */
export async function tasklessAdmissionCapacity(input: {
  readonly projectRoot: string;
  readonly slug: string;
  readonly gate: TasklessReceiptGate;
  readonly routing: ReceiptRoutingScope;
  readonly git?: GitRunner;
}): Promise<{ readonly kind: 'available'; readonly count: number } | { readonly kind: 'exhausted'; readonly count: number } | { readonly kind: 'halted'; readonly reason: string }> {
  const git = input.git ?? makeGitRunner(input.projectRoot);
  const records = await enumerateRouteReceiptRecords({ ...input, git });
  let count = 0;
  for (const item of records) {
    if (item.kind !== 'ok') return { kind: 'halted', reason: `route receipt is ${item.kind}` };
    count += item.record.receipt.taskless[input.gate] ?? 0;
  }
  // Keep this numeric literal local to routing so taskless admission doesn't
  // import the legacy self-heal machinery and accidentally bump its ledger.
  return count >= MAX_KICKBACKS_PER_GATE ? { kind: 'exhausted', count } : { kind: 'available', count };
}

/** Recreate only receipt-derived accounting after a disposable worktree loss. */
export async function rebuildLedgerFromReceipts(
  projectRoot: string,
  slug: string,
  routing: ReceiptRoutingScope,
  git: GitRunner = makeGitRunner(projectRoot),
): Promise<{ readonly kind: 'rebuilt' | 'present' | 'unreadable' }> {
  const exists = await access(join(projectRoot, '.pipeline', 'kickback-ledger.json')).then(() => true).catch(() => false);
  if (exists) return { kind: 'present' };
  return withKickbackLedgerLease(projectRoot, async () => {
    const records = await enumerateRouteReceiptRecords({ projectRoot, slug, routing, git });
    let sealedAuthored: number | undefined;
    let ledger: KickbackLedger = {
      version: 1,
      gates: {},
      growth: { authored: 0, added: 0, byGate: {} },
      settlementReceipts: {},
    };
    for (const item of records) {
      if (item.kind !== 'ok') return { kind: 'unreadable' } as const;
      if (item.record.sealedAuthored !== undefined) {
        if (sealedAuthored !== undefined && sealedAuthored !== item.record.sealedAuthored) return { kind: 'unreadable' } as const;
        sealedAuthored = item.record.sealedAuthored;
        if (ledger.growth?.authored === 0) ledger = { ...ledger, growth: { ...ledger.growth!, authored: sealedAuthored } };
      }
      const receipt = item.record.receipt;
      for (const [gate, amount] of Object.entries(receipt.taskless ?? {})) {
        const entry = ledger.gates[gate] ?? defaultGateEntry();
        ledger = { ...ledger, gates: { ...ledger.gates, [gate]: { ...entry, count: entry.count + amount } } };
      }
      if (!receipt.settlementId) continue;
      ledger = applySettledReceiptToLedger(ledger, item.record);
    }
    // A receipt reconstruction without the sealed denominator would turn a
    // lost worktree into free growth.  Refuse rather than persist a zero
    // placeholder that later readers could mistake for authority.
    if (sealedAuthored === undefined) return { kind: 'unreadable' } as const;
    await writeKickbackLedgerUnlocked(projectRoot, ledger);
    return { kind: 'rebuilt' } as const;
  });
}

/** The sealed authored denominator is route state, never a checkout projection. */
export async function routedSealedAuthored(
  projectRoot: string,
  slug: string,
  routing: ReceiptRoutingScope,
  git: GitRunner = makeGitRunner(projectRoot),
): Promise<number | undefined> {
  const records = await enumerateRouteReceiptRecords({ projectRoot, slug, routing, git });
  let sealed: number | undefined;
  for (const item of records) {
    if (item.kind !== 'ok') throw new Error(`route receipt ${item.kind}`);
    if (item.record.sealedAuthored === undefined) continue;
    if (sealed !== undefined && sealed !== item.record.sealedAuthored) throw new Error('route receipts disagree on sealed authored denominator');
    sealed = item.record.sealedAuthored;
  }
  return sealed;
}

export async function pendingAsBuiltFindingsFromRoutes(
  projectRoot: string,
  slug: string,
  routing: ReceiptRoutingScope,
  git: GitRunner = makeGitRunner(projectRoot),
): Promise<NonNullable<RouteRecord['pendingAsBuiltFindings']>> {
  const records = await enumerateRouteReceiptRecords({ projectRoot, slug, routing, git });
  const findings = new Map<string, NonNullable<RouteRecord['pendingAsBuiltFindings']>[number]>();
  for (const item of records) {
    if (item.kind !== 'ok') throw new Error(`route receipt ${item.kind}`);
    // Settlement charges a round; it does not resolve its as-built finding.
    // Keep findings while their host remains admitted/repairing as well as
    // while the receipt is unsettled.
    if (!Object.values(item.record.hosts).some((state) => state === 'admitted' || state === 'repairing')) continue;
    for (const finding of item.record.pendingAsBuiltFindings ?? []) findings.set(finding.finding, finding);
  }
  return [...findings.values()];
}
