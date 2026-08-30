import {
  MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
  type KickbackBudgetAdjustment,
  type KickbackGateEntry,
} from './kickback-ledger.js';

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
