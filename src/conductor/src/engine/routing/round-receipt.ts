import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

import type { ChildId } from '../child-context.js';
import {
  readKickbackLedger,
  updateKickbackLedger,
  withKickbackLedgerLease,
  writeKickbackLedgerUnlocked,
  type KickbackLedger,
  type PendingRepairSettlementBudget,
  type PlanGrowthRecord,
} from '../kickback-ledger.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { parseChildId } from '../child-context.js';
import { readRouteRecord, writeRouteRecord } from './route-record-store.js';
import { parseRoundId, type RoundId, type RouteRecord } from './route-types.js';

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
      return { result: existing.consumed ? { kind: 'refused', detail: `routed repair credit for ${input.roundId} is already consumed` } : { kind: 'already-granted' } };
    }
    if (existing !== undefined && existing.consumed !== true) {
      return { result: { kind: 'refused', detail: `routed repair credit for ${existing.roundId} is still unused` } };
    }
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

function receiptCharges(record: RouteRecord): { laps: Record<string, number>; growth: number } {
  // New route writers persist gate laps in the receipt at admission.  Keep a
  // conservative fallback for records created by the initial dark launch:
  // those were prd-audit remediation records and must not become free work.
  const laps = { ...(record.receipt.laps ?? {}) };
  if (Object.keys(laps).length === 0 && Object.values(record.allocation).some((allocation) => allocation.remTaskIds.length > 0)) {
    laps.prd_audit = 1;
  }
  const allocated = Object.values(record.allocation).reduce((count, allocation) => count + allocation.remTaskIds.length, 0);
  // The record parser normalizes an empty receipt to `growth: 0`; that is a
  // legacy placeholder, not an authorization to make frozen rem blocks free.
  // A genuine existing-task repair has no allocation, so it still charges 0.
  const growth = allocated > 0 && (record.receipt.growth ?? 0) === 0
    ? allocated
    : record.receipt.growth ?? 0;
  return { laps, growth };
}

/** Apply the durable accounting carried by one already-settled round receipt. */
function applySettledReceiptToLedger(ledger: KickbackLedger, record: RouteRecord): KickbackLedger {
  const settlementId = record.receipt.settlementId;
  if (!settlementId) return ledger;
  const charges = receiptCharges(record);
  const gates = { ...ledger.gates };
  for (const [gate, laps] of Object.entries(charges.laps)) {
    const entry = gates[gate] ?? defaultGateEntry();
    gates[gate] = { ...entry, laps: (entry.laps ?? 0) + laps };
  }
  const prior = ledger.growth ?? { authored: 0, added: 0, byGate: {} };
  const owner = Object.keys(charges.laps)[0] ?? 'prd_audit';
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
  const gates = { ...ledger.gates };
  const baseGrowth = ledger.growth ?? budgets[0]?.growth;
  if (!baseGrowth) return { ledger, exhausted: { gate: 'prd_audit', allowance: 'growth' } };
  const growth: PlanGrowthRecord = { authored: baseGrowth.authored, added: baseGrowth.added, byGate: { ...baseGrowth.byGate } };
  let growthCap = budgets[0]?.growthCap;
  for (const [gate, laps] of Object.entries(charges.laps)) {
    const budget = budgetByGate.get(gate as PendingRepairSettlementBudget['gate']);
    if (!budget) return { ledger, exhausted: { gate, allowance: 'laps' } };
    const entry = gates[gate] ?? defaultGateEntry();
    const lapCap = entry.effectiveLapCap ?? budget.lapCap;
    if ((entry.laps ?? 0) + laps > lapCap) return { ledger, exhausted: { gate, allowance: 'laps' } };
    gates[gate] = { ...entry, laps: (entry.laps ?? 0) + laps };
    growthCap = ledger.effectiveGrowthCap ?? budget.growthCap;
  }
  if (growth.added + charges.growth > (growthCap ?? 0)) return { ledger, exhausted: { gate: Object.keys(charges.laps)[0] ?? 'prd_audit', allowance: 'growth' } };
  if (charges.growth > 0) {
    growth.added += charges.growth;
    const owner = Object.keys(charges.laps)[0] ?? 'prd_audit';
    growth.byGate[owner] = (growth.byGate[owner] ?? 0) + charges.growth;
  }
  return {
    ledger: applySettledReceiptToLedger(ledger, record),
  };
}

/**
 * Replays a settled record whose process crashed after the route-ref CAS and
 * before writing the feature ledger.  The settlement id is the idempotency
 * boundary; replaying it twice therefore leaves the ledger byte-stable.
 */
export async function reconcileReceiptLedgerUnlocked(
  projectRoot: string,
  slug: string,
  git: GitRunner = makeGitRunner(projectRoot),
): Promise<void> {
  const refs = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
  if (refs.exitCode !== 0) throw new Error('cannot enumerate route receipts');
  let ledger = await readKickbackLedger(projectRoot);
  for (const ref of refs.stdout.split('\n').filter(Boolean)) {
    const roundId = parseRoundId(ref.split('/').at(-1) ?? '');
    if (!roundId) throw new Error('route receipt id is malformed');
    const stored = await readRouteRecord(projectRoot, slug, roundId, { git });
    if (stored.kind !== 'record') throw new Error(`route receipt ${roundId} is unreadable`);
    const settlementId = stored.record.receipt.settlementId;
    if (!settlementId || ledger.settlementReceipts?.[settlementId]) continue;
    // Reconciliation deliberately uses the receipt's durable numbers rather
    // than current caps: the admission was already settled by the ref CAS.
    ledger = applySettledReceiptToLedger(ledger, stored.record);
  }
  await writeKickbackLedgerUnlocked(projectRoot, ledger);
}

export async function reconcileReceiptLedger(projectRoot: string, slug: string, git?: GitRunner): Promise<void> {
  await withKickbackLedgerLease(projectRoot, () => reconcileReceiptLedgerUnlocked(projectRoot, slug, git));
}

/** Settle exactly once at the current routed host's BUILD dispatch. */
export async function settleRoundAtDispatch(input: SettleRoundAtDispatchInput): Promise<RoundSettlementResult> {
  const git = input.git ?? makeGitRunner(input.projectRoot);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await withKickbackLedgerLease(input.projectRoot, async () => {
      await reconcileReceiptLedgerUnlocked(input.projectRoot, input.slug, git);
      const stored = await readRouteRecord(input.projectRoot, input.slug, input.roundId, { git });
      if (stored.kind !== 'record') return { kind: 'halted', reason: `routing round ${input.roundId} is unreadable` } as const;
      if (currentHost(stored.record) !== input.dispatchingChild) return { kind: 'refused', reason: 'not-current-host' } as const;
      const receipt = stored.record.receipt;
      if (receipt.settlementId) {
        if (receipt.acks?.[input.dispatchingChild]) return { kind: 'acknowledged', settlementId: receipt.settlementId } as const;
        const wrote = await writeRouteRecord(input.projectRoot, stored, { ...stored.record, receipt: { ...receipt, acks: { ...(receipt.acks ?? {}), [input.dispatchingChild]: true } } }, { git });
        return wrote.kind === 'updated' ? { kind: 'acknowledged', settlementId: receipt.settlementId } as const : wrote.kind === 'restack-journal-open' ? { kind: 'halted', reason: `routing round ${input.roundId} has an open restack journal` } as const : { kind: 'retry' as const };
      }
      const settlementId = receiptSettlementId(input.roundId, receipt);
      const settledRecord = {
        ...stored.record,
        receipt: { ...receipt, settlementId, acks: { ...(receipt.acks ?? {}), [input.dispatchingChild]: true } },
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
export async function pendingAllocationTaskIds(projectRoot: string, slug: string, git: GitRunner = makeGitRunner(projectRoot)): Promise<string[]> {
  const refs = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
  if (refs.exitCode !== 0) throw new Error('cannot enumerate route receipts');
  const ids = new Set<string>();
  for (const ref of refs.stdout.split('\n').filter(Boolean)) {
    const id = parseRoundId(ref.split('/').at(-1) ?? '');
    if (!id) throw new Error('route receipt id is malformed');
    const record = await readRouteRecord(projectRoot, slug, id, { git });
    if (record.kind !== 'record') throw new Error(`route receipt ${id} is unreadable`);
    if (!record.record.receipt.settlementId) for (const allocation of Object.values(record.record.allocation)) for (const taskId of allocation.remTaskIds) ids.add(taskId);
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
  readonly gate: string;
  readonly git?: GitRunner;
}): Promise<{ readonly kind: 'charged'; readonly count: number } | { readonly kind: 'exhausted'; readonly count: number } | { readonly kind: 'halted'; readonly reason: string }> {
  const git = input.git ?? makeGitRunner(input.projectRoot);
  const refs = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${input.slug}/routes/`]);
  if (refs.exitCode !== 0) return { kind: 'halted', reason: 'cannot enumerate route receipts' };
  let count = 0;
  for (const ref of refs.stdout.split('\n').filter(Boolean)) {
    const id = parseRoundId(ref.split('/').at(-1) ?? '');
    if (!id) return { kind: 'halted', reason: 'route receipt id is malformed' };
    const stored = await readRouteRecord(input.projectRoot, input.slug, id, { git });
    if (stored.kind !== 'record') return { kind: 'halted', reason: `route receipt ${id} is unreadable` };
    count += stored.record.receipt.taskless?.[input.gate] ?? 0;
  }
  // Keep this numeric literal local to routing so taskless admission doesn't
  // import the legacy self-heal machinery and accidentally bump its ledger.
  if (count >= 2) return { kind: 'exhausted', count };
  const current = await readRouteRecord(input.projectRoot, input.slug, input.roundId, { git });
  if (current.kind !== 'record') return { kind: 'halted', reason: `route receipt ${input.roundId} is unreadable` };
  const present = current.record.receipt.taskless?.[input.gate] ?? 0;
  if (present > 0) return { kind: 'charged', count };
  const receipt = current.record.receipt;
  const wrote = await writeRouteRecord(input.projectRoot, current, {
    ...current.record,
    receipt: { ...receipt, taskless: { ...(receipt.taskless ?? {}), [input.gate]: 1 } },
  }, { git });
  return wrote.kind === 'updated'
    ? { kind: 'charged', count: count + 1 }
    : { kind: 'halted', reason: `taskless receipt write refused: ${wrote.kind}` };
}

/** Recreate only receipt-derived accounting after a disposable worktree loss. */
export async function rebuildLedgerFromReceipts(projectRoot: string, slug: string, git: GitRunner = makeGitRunner(projectRoot)): Promise<void> {
  const exists = await access(join(projectRoot, '.pipeline', 'kickback-ledger.json')).then(() => true).catch(() => false);
  if (exists) return;
  await withKickbackLedgerLease(projectRoot, async () => {
    const refs = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
    if (refs.exitCode !== 0) throw new Error('cannot enumerate route receipts');
    let ledger: KickbackLedger = {
      version: 1,
      gates: {},
      growth: { authored: 0, added: 0, byGate: {} },
      settlementReceipts: {},
    };
    for (const ref of refs.stdout.split('\n').filter(Boolean)) {
      const id = parseRoundId(ref.split('/').at(-1) ?? '');
      if (!id) throw new Error('route receipt id is malformed');
      const stored = await readRouteRecord(projectRoot, slug, id, { git });
      if (stored.kind !== 'record') throw new Error(`route receipt ${id} is unreadable`);
      const receipt = stored.record.receipt;
      for (const [gate, amount] of Object.entries(receipt.taskless ?? {})) {
        const entry = ledger.gates[gate] ?? defaultGateEntry();
        ledger = { ...ledger, gates: { ...ledger.gates, [gate]: { ...entry, count: entry.count + amount } } };
      }
      if (!receipt.settlementId) continue;
      ledger = applySettledReceiptToLedger(ledger, stored.record);
    }
    await writeKickbackLedgerUnlocked(projectRoot, ledger);
  });
}
