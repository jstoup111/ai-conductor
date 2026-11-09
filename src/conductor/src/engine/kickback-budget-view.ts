import { projectPendingGrowth, type KickbackGateEntry, type PendingRepair, type PlanGrowth } from './kickback-ledger.js';
import type { ChildId } from './child-context.js';
import type { RemediationLapAllowance, RemediationLapTier } from './remediation-caps.js';

export interface KickbackPlanGrowthView extends PlanGrowth {
  cap: number | null;
  capSource: 'raised' | 'config-derived';
  authoredSource: 'plan' | 'ledger' | 'unresolved';
  pendingGrowth?: {
    total: number;
    byGate: Record<string, number>;
    projected: number;
    minimumRaise?: number;
  };
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
  pendingLaps?: number;
  mechanicalFaults?: number;
  planGrowth?: KickbackPlanGrowthView;
  resumeAuthorization?: KickbackResumeAuthorizationView;
  /** Present only for remediation gates when their resolved allowance is available. */
  tier?: RemediationLapTier | null;
  allowanceSource?: 'default' | 'configured' | 'raised';
}

export function renderKickbackRecoveryHint({
  slug,
  gate,
  allowance,
  by,
}: {
  slug?: string;
  gate: string;
  allowance: 'laps' | 'growth' | 'restacks';
  by?: number;
}): string {
  // ai-conductor:session-command-context=operator-only
  const allowanceName = allowance === 'growth' ? 'Plan-growth' : allowance === 'restacks' ? 'Restack' : 'Lap';
  return `${allowanceName} allowance exhausted. Recover with: ` +
    `ai-conductor kickback-budget raise --feature ${slug ?? '«slug»'} --gate ${gate} --by ${by ?? '«N»'} --rationale "«why»"`;
  // /ai-conductor:session-command-context
}

export function withPendingGrowth(
  view: KickbackPlanGrowthView,
  pendingRepair?: Pick<PendingRepair, 'charges'>,
): KickbackPlanGrowthView {
  const pendingGrowth = projectPendingGrowth(view.added, pendingRepair?.charges, view.cap);
  if (pendingGrowth === undefined || pendingGrowth.total === 0) return view;

  return {
    ...view,
    remaining: Math.max(0, view.remaining - pendingGrowth.total),
    pendingGrowth: {
      total: pendingGrowth.total,
      byGate: pendingGrowth.byGate,
      projected: pendingGrowth.projected,
      ...(pendingGrowth.minimumRaise && pendingGrowth.minimumRaise > 0
        ? { minimumRaise: pendingGrowth.minimumRaise }
        : {}),
    },
  };
}

export function kickbackBudgetView(
  entry: KickbackGateEntry | undefined,
  gate: string,
  fallbackLimit: number,
  planGrowth?: KickbackPlanGrowthView,
  liveHaltGeneration?: string,
  pendingLaps = 0,
  allowance?: RemediationLapAllowance,
): KickbackBudgetView {
  const remediation = gate === 'prd_audit' || gate === 'architecture_review_as_built';
  const restack = gate === 'restack';
  // A restack limit belongs to the originating child named by the live cap
  // evidence: its snapshot, or the raise bound to that halt (#3475).
  const restackLimit = [...(entry?.adjustments ?? [])].reverse()
    .find((item) => item.haltGeneration === entry?.capEvidence?.haltGeneration)
    ?.afterLimit ?? entry?.capEvidence?.limit ?? fallbackLimit;
  const limit = remediation ? (entry?.effectiveLapCap ?? fallbackLimit)
    : restack ? restackLimit : (entry?.effectiveLimit ?? fallbackLimit);
  // Cascade counts are ref-backed by child, not accumulated in the ledger.
  // The cap evidence snapshots the exact count which raised this halt.
  const consumed = restack ? (entry?.capEvidence?.consumed ?? 0) : remediation ? (entry?.laps ?? 0) : (entry?.cumulative ?? 0);
  const authorization = entry?.resumeAuthorization;
  const resumeAuthorization = authorization === undefined ? undefined : {
    state: authorization.consumed
      ? 'consumed'
      : liveHaltGeneration === undefined
        ? 'pending'
        : authorization.haltGeneration === liveHaltGeneration &&
            authorization.haltGeneration === entry?.capEvidence?.haltGeneration
          ? 'awaiting-sweep'
          : 'stale',
    adjustmentId: authorization.adjustmentId,
    boundHaltGeneration: authorization.haltGeneration,
    liveHaltGeneration: liveHaltGeneration ?? '',
  } as KickbackResumeAuthorizationView;
  return {
    gate,
    consumed,
    limit,
    remaining: Math.max(0, limit - consumed - (remediation ? pendingLaps : 0)),
    latestReason: entry?.lastReason || entry?.capEvidence?.latestReason || '',
    // Current-schema entries stamp `adjustmentsKnown` when they first consume
    // budget, so an absent history is an authoritative empty array. Older
    // entries retain the unavailable diagnostic.
    adjustments: entry?.adjustmentsUnavailable || (
      entry !== undefined && entry.adjustments === undefined &&
      entry.adjustmentsKnown !== true
    ) ? 'unavailable' : (entry?.adjustments ?? []),
    ...(remediation
      ? { laps: entry?.laps ?? 0, lapCap: limit, pendingLaps }
      : restack ? {} : { mechanicalFaults: entry?.mechanicalFaults ?? 0 }),
    ...(planGrowth === undefined ? {} : { planGrowth }),
    ...(resumeAuthorization === undefined ? {} : { resumeAuthorization }),
    ...(remediation && allowance !== undefined
      ? {
          tier: allowance.tier ?? null,
          allowanceSource: entry?.effectiveLapCap === undefined ? allowance.source : 'raised' as const,
        }
      : {}),
  };
}

export function renderKickbackBudgetView(
  entry: KickbackGateEntry | undefined,
  gate: string,
  fallbackLimit: number,
  planGrowth?: KickbackPlanGrowthView,
  liveHaltGeneration?: string,
  child?: ChildId,
  pendingLaps = 0,
  allowance?: RemediationLapAllowance,
): string {
  const view = kickbackBudgetView(entry, gate, fallbackLimit, planGrowth, liveHaltGeneration, pendingLaps, allowance);
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
    ...(child === undefined ? [] : [`Child: ${child}`]),
    `Kickback budget (${gate}): ${view.consumed}/${view.limit} consumed; ${view.remaining} remaining${
      view.allowanceSource === undefined
        ? ''
        : ` — tier ${view.tier === null ? 'unrecorded, treated as M; ' : `${view.tier} `}allowance ${view.limit} (${view.allowanceSource === 'raised' ? `raised from ${allowance?.limit}` : view.allowanceSource})`
    }`,
    ...(view.pendingLaps && view.pendingLaps > 0
      ? [`Pending charge: ${view.pendingLaps} ${view.pendingLaps === 1 ? 'lap' : 'laps'} (charged when build dispatches)`]
      : []),
    `Latest reason: ${view.latestReason || 'none'}`,
    `Adjustment history: ${history === 'unavailable' ? 'unavailable' : history.length === 0 ? 'none' : history.map((item) => `${item.kind} ${item.id}${item.allowance ? ` (${item.allowance})` : ''}`).join(', ')}`,
    authorizationLine,
    ...(view.planGrowth === undefined ? [] : [
      view.planGrowth.authoredSource === 'unresolved' && view.planGrowth.cap === null
        ? `Plan growth: plan unresolved; ${view.planGrowth.added} added`
        : `Plan growth: ${view.planGrowth.added}/${view.planGrowth.cap} added; ${view.planGrowth.remaining} remaining (${view.planGrowth.capSource} cap)`,
      ...(view.planGrowth.pendingGrowth === undefined ? [] : [
        `Pending growth: ${view.planGrowth.pendingGrowth.total} (${Object.entries(view.planGrowth.pendingGrowth.byGate).map(([gate, amount]) => `${gate} ${amount}`).join(', ')})` +
          (view.planGrowth.cap === null
            ? ''
            : `; would reach ${view.planGrowth.pendingGrowth.projected}/${view.planGrowth.cap} when build dispatches` +
              (view.planGrowth.pendingGrowth.minimumRaise && view.planGrowth.pendingGrowth.minimumRaise > 0
                ? `; minimum raise ${view.planGrowth.pendingGrowth.minimumRaise}`
                : '')),
      ]),
    ]),
    ...(view.mechanicalFaults === undefined ? [] : [`Mechanical faults: ${view.mechanicalFaults}`]),
  ].join('\n');
}
