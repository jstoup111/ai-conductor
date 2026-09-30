import type { KickbackGateEntry, PlanGrowth } from './kickback-ledger.js';

export interface KickbackPlanGrowthView extends PlanGrowth {
  cap: number;
  capSource: 'raised' | 'config-derived';
}

export interface KickbackResumeAuthorizationView {
  state: 'consumed' | 'awaiting-sweep' | 'stale' | 'pending';
  adjustmentId: string;
  boundHaltGeneration: string;
  liveHaltGeneration: string;
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
  resumeAuthorization?: KickbackResumeAuthorizationView;
}

export function renderKickbackRecoveryHint({
  slug,
  gate,
  allowance,
}: {
  slug?: string;
  gate: string;
  allowance: 'laps' | 'growth';
}): string {
  const allowanceName = allowance === 'growth' ? 'Plan-growth' : 'Lap';
  return `${allowanceName} allowance exhausted. Recover with: ` +
    `ai-conductor kickback-budget raise --feature ${slug ?? '«slug»'} --gate ${gate} --by «N» --rationale "«why»"`;
}

export function kickbackBudgetView(
  entry: KickbackGateEntry | undefined,
  gate: string,
  fallbackLimit: number,
  planGrowth?: KickbackPlanGrowthView,
  liveHaltGeneration?: string,
): KickbackBudgetView {
  const remediation = gate === 'prd_audit' || gate === 'architecture_review_as_built';
  const limit = remediation ? (entry?.effectiveLapCap ?? fallbackLimit) : (entry?.effectiveLimit ?? fallbackLimit);
  const consumed = remediation ? (entry?.laps ?? 0) : (entry?.cumulative ?? 0);
  const authorization = entry?.resumeAuthorization;
  const resumeAuthorization = authorization === undefined ? undefined : {
    state: authorization.consumed
      ? 'consumed'
      : liveHaltGeneration === undefined
        ? 'pending'
        : authorization.haltGeneration === liveHaltGeneration
          ? 'awaiting-sweep'
          : 'stale',
    adjustmentId: authorization.adjustmentId,
    boundHaltGeneration: authorization.haltGeneration,
    liveHaltGeneration: liveHaltGeneration ?? '',
  } as KickbackResumeAuthorizationView;
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
    ...(resumeAuthorization === undefined ? {} : { resumeAuthorization }),
  };
}

export function renderKickbackBudgetView(
  entry: KickbackGateEntry | undefined,
  gate: string,
  fallbackLimit: number,
  planGrowth?: KickbackPlanGrowthView,
  liveHaltGeneration?: string,
): string {
  const view = kickbackBudgetView(entry, gate, fallbackLimit, planGrowth, liveHaltGeneration);
  const history = view.adjustments === 'unavailable' ? 'unavailable' : (view.adjustments ?? []);
  const authorization = view.resumeAuthorization;
  const authorizationLine = authorization === undefined
    ? 'Resume authorization: none'
    : authorization.state === 'consumed'
      ? 'Resume authorization: consumed'
      : authorization.state === 'awaiting-sweep'
        ? 'Resume authorization: awaiting daemon sweep'
        : authorization.state === 'pending'
          ? 'Resume authorization: pending (live halt not read)'
          : `Resume authorization: stale (bound to halt generation ${authorization.boundHaltGeneration}; live halt generation ${authorization.liveHaltGeneration}); the daemon will not consume it`;
  return [
    `Kickback budget (${gate}): ${view.consumed}/${view.limit} consumed; ${view.remaining} remaining`,
    `Latest reason: ${view.latestReason || 'none'}`,
    `Adjustment history: ${history === 'unavailable' ? 'unavailable' : history.length === 0 ? 'none' : history.map((item) => `${item.kind} ${item.id}${item.allowance ? ` (${item.allowance})` : ''}`).join(', ')}`,
    authorizationLine,
    ...(view.planGrowth === undefined ? [] : [
      `Plan growth: ${view.planGrowth.added}/${view.planGrowth.cap} added; ${view.planGrowth.remaining} remaining (${view.planGrowth.capSource} cap)`,
    ]),
    ...(view.mechanicalFaults === undefined ? [] : [`Mechanical faults: ${view.mechanicalFaults}`]),
  ].join('\n');
}
