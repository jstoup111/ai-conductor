import type { HarnessConfig } from '../types/config.js';
import {
  isUnreadableKickbackGate,
  isUnreadableKickbackGrowth,
  isUnreadableKickbackLedger,
  readGrowth,
  readGrowthAccounting,
  readKickbackLedger,
  type KickbackGateEntry,
  type PlanGrowth,
} from './kickback-ledger.js';

// Anti-ping-pong: a single gate may be re-opened by kickback at most this many
// times per feature before the loop HALTs for a human.
export const MAX_KICKBACKS_PER_GATE = 2;

/** PRD-audit and as-built review own configured remediation allowances; other gates share the generic cap. */
export function remediationLapCapForGate(
  gate: string,
  config: HarnessConfig,
  genericCap = MAX_KICKBACKS_PER_GATE,
): number {
  const remediationConfig = config as HarnessConfig & {
    prd_audit?: { max_remediation_laps?: number };
    architecture_review_as_built?: { max_remediation_laps?: number };
  };
  if (gate === 'prd_audit') {
    return remediationConfig.prd_audit?.max_remediation_laps ?? 1;
  }
  if (gate === 'architecture_review_as_built') {
    return remediationConfig.architecture_review_as_built?.max_remediation_laps ?? 1;
  }
  return genericCap;
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
): Promise<number> {
  const ledger = await readKickbackLedger(projectRoot).catch(() => undefined);
  let cap = MAX_KICKBACKS_PER_GATE;
  for (const gate of ['prd_audit', 'architecture_review_as_built'] as const) {
    const gateCap = ledger?.gates[gate]?.effectiveLapCap ?? remediationLapCapForGate(gate, config);
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
  authoredTaskCount: number,
): Promise<RemediationGateAppendBudget> {
  const ledger = await readKickbackLedger(projectRoot);
  const growthCap = ledger.effectiveGrowthCap ?? prdAuditAppendCap(config, authoredTaskCount);
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
  const growth = await readGrowth(projectRoot, growthCap);
  const priorLaps = (
    ledger.gates[gate] as (KickbackGateEntry & { laps?: number }) | undefined
  )?.laps ?? 0;
  const effectiveLapCap = ledger.gates[gate]?.effectiveLapCap ?? lapCap;
  return { gate, priorLaps, lapCap: effectiveLapCap, taskCount, growthTaskCount, growthCap, growth };
}

export function kickbackEscalationEnabled(config: HarnessConfig & { kickback_escalation?: { enabled?: boolean } }): boolean {
  return config.kickback_escalation?.enabled ?? true;
}
