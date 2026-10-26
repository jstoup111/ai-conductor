import type { HarnessConfig } from '../types/config.js';
import {
  MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
  isUnreadableKickbackGate,
  isUnreadableKickbackGrowth,
  isUnreadableKickbackLedger,
  readGrowthAccounting,
  readKickbackLedger,
  type KickbackGateEntry,
  type KickbackLedger,
  type PendingRepairSettlementBudget,
  type PlanGrowth,
} from './kickback-ledger.js';

// Anti-ping-pong: a single gate may be re-opened by kickback at most this many
// times per feature before the loop HALTs for a human.
export const MAX_KICKBACKS_PER_GATE = 2;

export type RemediationLapTier = 'S' | 'M' | 'L';
export type RemediationLapGate = 'prd_audit' | 'architecture_review_as_built';

/** Default remediation laps by feature complexity when configuration omits a cap. */
export const REMEDIATION_LAP_TIER_DEFAULTS: Readonly<Record<RemediationLapTier, number>> = {
  S: 2,
  M: 3,
  L: 4,
};

export interface RemediationLapAllowance {
  limit: number;
  /** Undefined stays visible to renderers as an unrecorded tier treated as M. */
  tier: RemediationLapTier | undefined;
  source: 'configured' | 'default';
}

type RemediationLapConfig = number | Partial<Record<RemediationLapTier, number>>;

function configuredRemediationLapCap(
  gate: RemediationLapGate,
  config: HarnessConfig,
): RemediationLapConfig | undefined {
  const remediationConfig = config as HarnessConfig & {
    prd_audit?: { max_remediation_laps?: RemediationLapConfig };
    architecture_review_as_built?: { max_remediation_laps?: RemediationLapConfig };
  };
  return remediationConfig[gate]?.max_remediation_laps;
}

/** Resolve the configured or tier-default remediation lap allowance for one gate. */
export function resolveRemediationLapAllowance(
  gate: RemediationLapGate,
  config: HarnessConfig,
  tier: RemediationLapTier | undefined,
): RemediationLapAllowance {
  const configured = configuredRemediationLapCap(gate, config);
  if (typeof configured === 'number') return { limit: configured, tier, source: 'configured' };
  const effectiveTier = tier ?? 'M';
  const configuredLimit = configured?.[effectiveTier];
  if (configuredLimit !== undefined) return { limit: configuredLimit, tier, source: 'configured' };
  return { limit: REMEDIATION_LAP_TIER_DEFAULTS[effectiveTier], tier, source: 'default' };
}

/** PRD-audit and as-built review own configured remediation allowances; other gates share the generic cap. */
export function remediationLapCapForGate(
  gate: string,
  config: HarnessConfig,
  genericCap = MAX_KICKBACKS_PER_GATE,
  tier: RemediationLapTier | undefined = undefined,
): number {
  if (gate === 'prd_audit' || gate === 'architecture_review_as_built') {
    return resolveRemediationLapAllowance(gate, config, tier).limit;
  }
  return genericCap;
}

/** Resolve the fallback limit an operator sees when a gate has no durable cap evidence. */
export function kickbackBudgetFallbackLimit(
  gate: string,
  config: HarnessConfig,
  tier: RemediationLapTier | undefined = undefined,
): number {
  return gate === 'build_review'
    ? MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW
    : remediationLapCapForGate(gate, config, MAX_KICKBACKS_PER_GATE, tier);
}

/**
 * Round budget for the validation-group join's `/remediate` dispatch. The
 * process-local round counter must never bind tighter than the durable
 * per-gate lap caps `planRemediation` enforces from the kickback ledger —
 * otherwise an operator `kickback-budget raise` is silently ignored and the
 * join falls through to a generic needs-human halt. It still never drops
 * below MAX_KICKBACKS_PER_GATE, which bounds routes with no durable lap.
 */
export async function validationJoinRemediationRoundCap(
  projectRoot: string,
  config: HarnessConfig,
  tier: RemediationLapTier | undefined = undefined,
): Promise<number> {
  const ledger = await readKickbackLedger(projectRoot).catch(() => undefined);
  let cap = MAX_KICKBACKS_PER_GATE;
  for (const gate of ['prd_audit', 'architecture_review_as_built'] as const) {
    const gateCap = ledger?.gates[gate]?.effectiveLapCap ?? remediationLapCapForGate(
      gate, config, MAX_KICKBACKS_PER_GATE, tier,
    );
    cap = Math.max(cap, gateCap);
  }
  return cap;
}

/** The prd-audit cap is both an absolute count and a fraction of authored plan work. */
export function prdAuditAppendCap(config: HarnessConfig, authoredTaskCount: number): number {
  const prdAudit = (config as HarnessConfig & {
    prd_audit?: { max_appended_tasks?: number; max_appended_ratio?: number };
  }).prd_audit;
  const maximum = prdAudit?.max_appended_tasks ?? 5;
  const ratio = prdAudit?.max_appended_ratio ?? 0.25;
  return Math.min(maximum, Math.floor(authoredTaskCount * ratio));
}

export interface PlanGrowthBudget {
  growth: PlanGrowth;
  cap: number;
  capSource: 'raised' | 'config-derived';
  authoredSource: 'plan' | 'ledger' | 'unresolved';
}

/** Resolve the one plan-growth allowance shared by every remediation consumer. */
export async function readPlanGrowthBudget(
  projectRoot: string,
  config: HarnessConfig,
  options: { persist: boolean },
): Promise<PlanGrowthBudget> {
  const ledger = await readKickbackLedger(projectRoot);
  const unbounded = await readGrowthAccounting(projectRoot, Number.MAX_SAFE_INTEGER, options);
  const capSource = ledger.effectiveGrowthCap === undefined ? 'config-derived' : 'raised';
  const cap = ledger.effectiveGrowthCap ?? prdAuditAppendCap(config, unbounded.growth.authored);
  const accounting = await readGrowthAccounting(projectRoot, cap, options);
  return { growth: accounting.growth, cap, capSource, authoredSource: accounting.authoredSource };
}

/** Build the durable allowance snapshots required to settle a pending BUILD repair. */
export async function pendingRepairSettlementBudgets(
  projectRoot: string,
  config: HarnessConfig,
  ledger: KickbackLedger,
  tier: RemediationLapTier | undefined = undefined,
): Promise<PendingRepairSettlementBudget[]> {
  const { cap: growthCap, growth, authoredSource } = await readPlanGrowthBudget(projectRoot, config, { persist: true });
  return (['prd_audit', 'architecture_review_as_built'] as const).map((gate) => ({
    gate,
    lapCap: ledger.gates[gate]?.effectiveLapCap ?? remediationLapCapForGate(
      gate, config, MAX_KICKBACKS_PER_GATE, tier,
    ),
    growthCap,
    growth,
    authoredSource,
  }));
}

export type RemediationLedgerGate = 'prd_audit' | 'architecture_review_as_built';

export interface RemediationGateAppendBudget {
  gate: RemediationLedgerGate;
  priorLaps: number;
  lapCap: number;
  /** Tasks authorized by this gate; any non-empty set consumes one lap. */
  taskCount: number;
  /** Tasks whose plan-growth attribution belongs to this gate. */
  growthTaskCount: number;
  growthCap: number;
  growth: PlanGrowth;
}

/** Read the shared append allowance for a remediation gate without choosing its halt wording. */
export async function readRemediationGateAppendBudget(
  projectRoot: string,
  config: HarnessConfig,
  gate: RemediationLedgerGate,
  lapCap: number,
  taskCount: number,
  growthTaskCount: number,
): Promise<RemediationGateAppendBudget> {
  const ledger = await readKickbackLedger(projectRoot);
  // A corrupt ledger must not be mistaken for fresh remediation allowance:
  // budget recovery is an explicit operator decision, not a best-effort
  // fallback. Scoped to THIS gate (adr-2026-08-31 decision 3) so a sibling
  // gate's malformed entry does not halt a healthy one.
  if (isUnreadableKickbackLedger(ledger)) {
    throw new Error('kickback ledger is unreadable');
  }
  if (isUnreadableKickbackGate(ledger, gate)) {
    // A malformed pending repair is deliberately scoped to its remediation
    // gates and growth accounting. Preserve its exhausted-budget projection;
    // only an unreadable ledger envelope blocks append before mutation.
    if (isUnreadableKickbackGrowth(ledger)) {
      const growthCap = ledger.effectiveGrowthCap ?? 0;
      return {
        gate,
        priorLaps: lapCap,
        lapCap,
        taskCount,
        growthTaskCount,
        growthCap,
        growth: { authored: 0, added: growthCap, byGate: {}, remaining: 0 },
      };
    }
    throw new Error(`kickback ledger gate '${gate}' is unreadable`);
  }
  const { cap: growthCap, growth } = await readPlanGrowthBudget(projectRoot, config, { persist: true });
  const priorLaps = (
    ledger.gates[gate] as (KickbackGateEntry & { laps?: number }) | undefined
  )?.laps ?? 0;
  const effectiveLapCap = ledger.gates[gate]?.effectiveLapCap ?? lapCap;
  return { gate, priorLaps, lapCap: effectiveLapCap, taskCount, growthTaskCount, growthCap, growth };
}

export function kickbackEscalationEnabled(config: HarnessConfig & { kickback_escalation?: { enabled?: boolean } }): boolean {
  return config.kickback_escalation?.enabled ?? true;
}
