import {
  MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
  mutateKickbackLedger,
  type KickbackBudgetAdjustment,
  type KickbackGateEntry,
} from './kickback-ledger.js';
import { appendKickbackBudgetAuthorization } from './closeout-events.js';
import { randomUUID } from 'node:crypto';

export type KickbackBudgetMutation = { kind: 'reset' } | { kind: 'raise'; amount: number };
export type KickbackBudgetMutationResult =
  | { ok: true; adjustment: KickbackBudgetAdjustment }
  | { ok: false; message: string };

/**
 * Applies one already-authorized recovery to the exact exhausted build-review
 * generation.  The pending record makes an event-write interruption
 * inspectable; a retry with the same adjustment id is idempotent at the event
 * boundary and the final ledger update is serialized by the ledger lease.
 */
export async function applyKickbackBudgetMutation(
  projectRoot: string,
  feature: string,
  operator: string,
  rationale: string,
  mutation: KickbackBudgetMutation,
  expectedGeneration: string,
  adjustmentId = randomUUID(),
): Promise<KickbackBudgetMutationResult> {
  let adjustment: KickbackBudgetAdjustment | undefined;
  const staged = await mutateKickbackLedger(projectRoot, (ledger) => {
    const entry = ledger.gates.build_review;
    const evidence = entry?.exhaustedEvidence;
    if (!entry || !evidence || evidence.generation !== expectedGeneration || entry.cumulative !== evidence.count ||
      (entry.effectiveLimit ?? MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW) !== evidence.limit) {
      throw new Error('the current cumulative-cap evidence no longer matches this recovery request');
    }
    const beforeLimit = entry.effectiveLimit ?? MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW;
    const afterLimit = mutation.kind === 'raise' ? beforeLimit + mutation.amount : beforeLimit;
    if (!Number.isSafeInteger(afterLimit) || afterLimit <= 0) throw new Error('the requested allowance is unsafe');
    adjustment = {
      id: adjustmentId, kind: mutation.kind, beforeCount: entry.cumulative,
      afterCount: mutation.kind === 'reset' ? 0 : entry.cumulative,
      beforeLimit, afterLimit, operator, rationale, at: new Date().toISOString(),
    };
    entry.pendingAdjustment = { ...adjustment, generation: expectedGeneration };
  });
  if (!staged.ok || !adjustment) return { ok: false, message: staged.ok ? 'unable to stage recovery' : staged.message };

  const appended = await appendKickbackBudgetAuthorization(projectRoot, {
    type: 'kickback_budget_adjustment_authorized', adjustmentId: adjustment.id, feature, gate: 'build_review',
    kind: adjustment.kind, beforeCount: adjustment.beforeCount, afterCount: adjustment.afterCount,
    beforeLimit: adjustment.beforeLimit, afterLimit: adjustment.afterLimit, operator, rationale, at: adjustment.at,
  });
  if (!appended.ok) return { ok: false, message: appended.message };

  const committed = await mutateKickbackLedger(projectRoot, (ledger) => {
    const entry = ledger.gates.build_review;
    if (!entry?.pendingAdjustment || entry.pendingAdjustment.id !== adjustment!.id) {
      throw new Error('the staged recovery is no longer current');
    }
    entry.cumulative = adjustment!.afterCount;
    entry.effectiveLimit = adjustment!.afterLimit;
    entry.adjustments = [...(entry.adjustments ?? []), adjustment!];
    delete entry.pendingAdjustment;
    delete entry.exhaustedEvidence;
    entry.resumeAuthorization = { adjustmentId: adjustment!.id, gate: 'build_review', haltClass: 'needs-human', generation: expectedGeneration };
  });
  return committed.ok ? { ok: true, adjustment } : { ok: false, message: committed.message };
}

/** Finish an interrupted staged adjustment only when its same-schema event can
 * be recorded idempotently.  A conflicting or unreadable event leaves the
 * protective pending state intact for a later operator investigation. */
export async function reconcilePendingKickbackBudgetAdjustment(
  projectRoot: string,
  feature: string,
): Promise<KickbackBudgetMutationResult | undefined> {
  let pending: KickbackBudgetAdjustment & { generation: string } | undefined;
  const snapshot = await mutateKickbackLedger(projectRoot, (ledger) => {
    pending = ledger.gates.build_review?.pendingAdjustment;
  });
  if (!snapshot.ok) return { ok: false, message: snapshot.message };
  if (!pending) return undefined;
  const appended = await appendKickbackBudgetAuthorization(projectRoot, {
    type: 'kickback_budget_adjustment_authorized', adjustmentId: pending.id, feature, gate: 'build_review',
    kind: pending.kind, beforeCount: pending.beforeCount, afterCount: pending.afterCount,
    beforeLimit: pending.beforeLimit, afterLimit: pending.afterLimit,
    operator: pending.operator, rationale: pending.rationale, at: pending.at,
  });
  if (!appended.ok) return { ok: false, message: appended.message };
  const committed = await mutateKickbackLedger(projectRoot, (ledger) => {
    const entry = ledger.gates.build_review;
    if (!entry?.pendingAdjustment || entry.pendingAdjustment.id !== pending!.id) {
      throw new Error('the pending recovery changed during reconciliation');
    }
    entry.cumulative = pending!.afterCount;
    entry.effectiveLimit = pending!.afterLimit;
    entry.adjustments = [...(entry.adjustments ?? []), pending!];
    entry.resumeAuthorization = { adjustmentId: pending!.id, gate: 'build_review', haltClass: 'needs-human', generation: pending!.generation };
    delete entry.pendingAdjustment;
    delete entry.exhaustedEvidence;
  });
  return committed.ok ? { ok: true, adjustment: pending } : { ok: false, message: committed.message };
}

export interface KickbackBudgetAdjustmentsView {
  availability: 'available' | 'unavailable';
  entries: readonly KickbackBudgetAdjustment[];
}

export interface KickbackBudgetMechanicalFaultsView {
  count: number;
  excludedFromSemanticBudget: true;
  lastFault: KickbackGateEntry['lastMechanicalFault'];
}

/** The one read-only representation used by every kickback-budget output format. */
export interface KickbackBudgetView {
  feature: string;
  gate: 'build_review';
  count: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  latestReason: string;
  mechanicalFaults: KickbackBudgetMechanicalFaultsView;
  adjustments: KickbackBudgetAdjustmentsView;
}

/**
 * Derives the semantic build-review budget without treating separately counted
 * mechanical faults or legacy prose as semantic history.
 */
export function deriveKickbackBudgetView(
  feature: string,
  entry: Pick<
    KickbackGateEntry,
    'cumulative' | 'effectiveLimit' | 'lastReason' | 'mechanicalFaults' | 'lastMechanicalFault' | 'adjustments'
  >,
): KickbackBudgetView {
  const count = entry.cumulative;
  const limit = entry.effectiveLimit ?? MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW;
  const adjustments = entry.adjustments === undefined
    ? { availability: 'unavailable' as const, entries: [] }
    : {
      availability: 'available' as const,
      entries: [...entry.adjustments].sort((left, right) => left.at.localeCompare(right.at)),
    };

  return {
    feature,
    gate: 'build_review',
    count,
    limit,
    remaining: Math.max(0, limit - count),
    exhausted: count > limit,
    latestReason: entry.lastReason,
    mechanicalFaults: {
      count: entry.mechanicalFaults ?? 0,
      excludedFromSemanticBudget: true,
      lastFault: entry.lastMechanicalFault,
    },
    adjustments,
  };
}

/** Renders the canonical budget view for an interactive operator. */
export function renderKickbackBudgetViewHuman(view: KickbackBudgetView): string {
  const adjustmentLines = view.adjustments.availability === 'unavailable'
    ? ['Adjustment history: unavailable']
    : [
      `Adjustment history: ${view.adjustments.entries.length} recorded`,
      ...view.adjustments.entries.map((adjustment) => [
        `- ${adjustment.id}: ${adjustment.kind} at ${adjustment.at}`,
        `  Count: ${adjustment.beforeCount} → ${adjustment.afterCount}; limit: ${adjustment.beforeLimit} → ${adjustment.afterLimit}`,
        `  Operator: ${adjustment.operator}; rationale: ${adjustment.rationale}`,
      ].join('\n')),
    ];

  return [
    `Feature: ${view.feature}`,
    `Gate: ${view.gate}`,
    `Count: ${view.count}`,
    `Limit: ${view.limit}`,
    `Remaining: ${view.remaining}`,
    `Exhausted: ${view.exhausted}`,
    `Latest reason: ${view.latestReason}`,
    `Mechanical faults (excluded from semantic budget): ${view.mechanicalFaults.count}`,
    ...adjustmentLines,
  ].join('\n');
}

/** Renders the canonical budget view for machine consumers without a second schema. */
export function renderKickbackBudgetViewJson(view: KickbackBudgetView): string {
  return JSON.stringify(view, null, 2);
}
