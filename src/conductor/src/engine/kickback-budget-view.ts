import type { KickbackGateEntry } from './kickback-ledger.js';

export interface KickbackBudgetView {
  gate: string;
  consumed: number;
  limit: number;
  remaining: number;
  latestReason: string;
  adjustments: KickbackGateEntry['adjustments'] | 'unavailable';
  laps?: number;
  lapCap?: number;
  mechanicalFaults?: number;
}

export function kickbackBudgetView(entry: KickbackGateEntry | undefined, gate: string, fallbackLimit: number): KickbackBudgetView {
  const remediation = gate === 'prd_audit' || gate === 'architecture_review_as_built';
  const limit = remediation ? (entry?.effectiveLapCap ?? fallbackLimit) : (entry?.effectiveLimit ?? fallbackLimit);
  const consumed = remediation ? (entry?.laps ?? 0) : (entry?.cumulative ?? 0);
  return {
    gate, consumed, limit, remaining: Math.max(0, limit - consumed), latestReason: entry?.lastReason ?? '',
    adjustments: entry?.adjustments ?? 'unavailable',
    ...(remediation ? { laps: entry?.laps ?? 0, lapCap: limit } : { mechanicalFaults: entry?.mechanicalFaults ?? 0 }),
  };
}

export function renderKickbackBudgetView(entry: KickbackGateEntry | undefined, gate: string, fallbackLimit: number): string {
  const view = kickbackBudgetView(entry, gate, fallbackLimit);
  const history = view.adjustments === 'unavailable' ? 'unavailable' : (view.adjustments ?? []);
  return [
    `Kickback budget (${gate}): ${view.consumed}/${view.limit} consumed; ${view.remaining} remaining`,
    `Latest reason: ${view.latestReason || 'none'}`,
    `Adjustment history: ${history === 'unavailable' ? 'unavailable' : history.length === 0 ? 'none' : history.map((item) => `${item.kind} ${item.id}`).join(', ')}`,
    ...(view.mechanicalFaults === undefined ? [] : [`Mechanical faults: ${view.mechanicalFaults}`]),
  ].join('\n');
}
