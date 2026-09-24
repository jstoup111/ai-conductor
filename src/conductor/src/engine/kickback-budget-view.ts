import type { KickbackGateEntry, PlanGrowth } from './kickback-ledger.js';

export interface KickbackPlanGrowthView extends PlanGrowth {
  cap: number;
  capSource: 'raised' | 'config-derived';
}

export interface KickbackBudgetView {
  gate: string;
  consumed: number;
  limit: number;
  remaining: number;
  latestReason: string;
  adjustments: NonNullable<KickbackGateEntry['adjustments']> | 'unavailable';
  laps?: number;
  lapCap?: number;
  mechanicalFaults?: number;
  planGrowth?: KickbackPlanGrowthView;
}

export function kickbackBudgetView(
  entry: KickbackGateEntry | undefined,
  gate: string,
  fallbackLimit: number,
  planGrowth?: KickbackPlanGrowthView,
): KickbackBudgetView {
  const remediation = gate === 'prd_audit' || gate === 'architecture_review_as_built';
  const limit = remediation ? (entry?.effectiveLapCap ?? fallbackLimit) : (entry?.effectiveLimit ?? fallbackLimit);
  const consumed = remediation ? (entry?.laps ?? 0) : (entry?.cumulative ?? 0);
  return {
    gate, consumed, limit, remaining: Math.max(0, limit - consumed), latestReason: entry?.lastReason ?? '',
    // Current-schema entries stamp `adjustmentsKnown` when they first consume
    // budget, so an absent history is an authoritative empty array. Older
    // entries retain the unavailable diagnostic.
    adjustments: entry?.adjustmentsUnavailable || (
      entry !== undefined && entry.adjustments === undefined &&
      entry.adjustmentsKnown !== true
    ) ? 'unavailable' : (entry?.adjustments ?? []),
    ...(remediation ? { laps: entry?.laps ?? 0, lapCap: limit } : { mechanicalFaults: entry?.mechanicalFaults ?? 0 }),
    ...(planGrowth === undefined ? {} : { planGrowth }),
  };
}

export function renderKickbackBudgetView(
  entry: KickbackGateEntry | undefined,
  gate: string,
  fallbackLimit: number,
  planGrowth?: KickbackPlanGrowthView,
): string {
  const view = kickbackBudgetView(entry, gate, fallbackLimit, planGrowth);
  const history = view.adjustments === 'unavailable' ? 'unavailable' : (view.adjustments ?? []);
  return [
    `Kickback budget (${gate}): ${view.consumed}/${view.limit} consumed; ${view.remaining} remaining`,
    `Latest reason: ${view.latestReason || 'none'}`,
    `Adjustment history: ${history === 'unavailable' ? 'unavailable' : history.length === 0 ? 'none' : history.map((item) => `${item.kind} ${item.id}${item.allowance ? ` (${item.allowance})` : ''}`).join(', ')}`,
    ...(view.planGrowth === undefined ? [] : [
      `Plan growth: ${view.planGrowth.added}/${view.planGrowth.cap} added; ${view.planGrowth.remaining} remaining (${view.planGrowth.capSource} cap)`,
    ]),
    ...(view.mechanicalFaults === undefined ? [] : [`Mechanical faults: ${view.mechanicalFaults}`]),
  ].join('\n');
}
