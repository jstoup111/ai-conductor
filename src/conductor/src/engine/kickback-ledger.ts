import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import type { BuildReviewRubricId } from '../types/config.js';
import type { ConductorEvent } from '../types/events.js';
import {
  parseBuildReviewInfrastructureFailure,
  type BuildReviewInfrastructureFailureReason,
} from './build-review-domain.js';
import { boundedHeadTailExcerpt } from './build-review-test-quality-preflight.js';

/** The latest infrastructure failure charged to a build-review rubric lap. */
export interface KickbackLastMechanicalFault {
  rubric: BuildReviewRubricId;
  reason: BuildReviewInfrastructureFailureReason;
  detail: string;
  lapId: string;
}

/** Durable state for a gate's cross-dispatch kickback budget. */
export interface KickbackGateEntry {
  count: number;
  cumulative: number;
  /** Remediation rounds authorized for this gate, independent of plan growth. */
  laps?: number;
  /** Stable build-review work-order effects that already consumed this gate. */
  chargedEffectIds?: string[];
  mechanicalFaults?: number;
  lastMechanicalFault?: KickbackLastMechanicalFault;
  treeHash: string | null;
  lastReason: string;
  priorVerdict: boolean;
  resolvedBefore: number;
}

/** Durable accounting for plan tasks added after the original plan was authored. */
export interface PlanGrowthRecord {
  authored: number;
  added: number;
  byGate: Record<string, number>;
}

/** Growth accounting with the caller's current task-addition cap applied. */
export interface PlanGrowth extends PlanGrowthRecord {
  remaining: number;
}

/** Durable pending state for a remediable as-built finding appended to the plan. */
export interface PendingAsBuiltRemediationFinding {
  gate: 'architecture_review_as_built';
  finding: string;
  class: 'REMEDIABLE';
  governingClause: string;
  summary: string;
  outcome: 'remediated';
}

export interface PlanGrowthEventSink {
  emit(event: Extract<ConductorEvent, { type: 'plan_growth' }>): void | Promise<void>;
}

/** Durable, per-feature kickback state stored outside the feature branch. */
export interface KickbackLedger {
  version: 1;
  gates: Record<string, KickbackGateEntry>;
  growth?: PlanGrowthRecord;
  pendingAsBuiltRemediationFindings?: PendingAsBuiltRemediationFinding[];
}

type PersistedKickbackGateEntry = Omit<KickbackGateEntry, 'cumulative' | 'mechanicalFaults'> & {
  cumulative?: number;
  mechanicalFaults?: number;
};

interface PersistedKickbackLedger {
  version: 1;
  gates: Record<string, PersistedKickbackGateEntry>;
  growth?: PlanGrowthRecord;
  pendingAsBuiltRemediationFindings?: PendingAsBuiltRemediationFinding[];
}

export const KICKBACK_LEDGER_PATH = '.pipeline/kickback-ledger.json';

/** A gate may be kicked back to BUILD this many times for one progress state. */
export const MAX_KICKBACKS_PER_GATE = 2;

/** Cumulative build-review failures allowed before human intervention is required. */
export const MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW = 5;

/** Mechanical build-review faults allowed before human intervention is required. */
export const MAX_MECHANICAL_FAULTS_BUILD_REVIEW = 3;

/** Matches the raw rubric diagnostic cap before its detail reaches durable state. */
const RUBRIC_FAILURE_DETAIL_CAP_BYTES = 2_048;

export interface BumpKickbackGateInput {
  treeHash: string | null;
  resolvedCount: number;
  reason: string;
}

export interface BumpKickbackGateResult {
  entry: KickbackGateEntry;
  /** True only after the cumulative build-review convergence cap is exceeded. */
  cumulativeExhausted: boolean;
  exhausted: boolean;
}

/** Result of applying a stable build-review effect to the kickback budget. */
export type ChargeBuildReviewEffectResult =
  | ({ status: 'charged' } & BumpKickbackGateResult)
  | { status: 'already-charged'; entry: KickbackGateEntry }
  | { status: 'unreadable'; reason: string };

/** Typed read boundary for callers that must never spend from corrupt state. */
export type KickbackLedgerReadResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ok'; readonly ledger: KickbackLedger }
  | { readonly kind: 'unreadable'; readonly reason: string };

/** Typed mechanical-fault write for enforcement boundaries that fail closed. */
export type BumpMechanicalFaultsInLedgerResult =
  | { readonly kind: 'ok'; readonly entry: KickbackGateEntry }
  | { readonly kind: 'unreadable'; readonly reason: string };

const NON_LAP_COUNTING_GATE_ENTRY_FIELDS = new Set(['count', 'resolvedBefore']);

function isLapCountingValue(value: unknown): value is number | Record<string, number> {
  return (
    typeof value === 'number' ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.values(value).every((item) => typeof item === 'number'))
  );
}

/**
 * Credit every convergence counter carried by an entry without disturbing its
 * per-tree budget or the state used to determine that budget.
 */
export function creditKickbackGateLaps<Entry extends KickbackGateEntry>(entry: Entry): Entry {
  const { lastMechanicalFault: _lastMechanicalFault, ...lapCreditEntry } = entry;
  return Object.fromEntries(
    Object.entries(lapCreditEntry).map(([field, value]) => [
      field,
      !NON_LAP_COUNTING_GATE_ENTRY_FIELDS.has(field) && isLapCountingValue(value)
        ? (typeof value === 'number' ? 0 : {})
        : value,
    ]),
  ) as Entry;
}

function emptyLedger(): KickbackLedger {
  return { version: 1, gates: {} };
}

function isLastMechanicalFault(value: unknown): value is KickbackLastMechanicalFault {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const fault = value as Record<string, unknown>;
  const infrastructureFailure = parseBuildReviewInfrastructureFailure({
    kind: 'infrastructure-failure',
    rubric: fault.rubric,
    reason: fault.reason,
    detail: fault.detail,
  });
  return infrastructureFailure !== undefined &&
    typeof fault.lapId === 'string' && fault.lapId.trim().length > 0;
}

function isKickbackGateEntry(value: unknown): value is PersistedKickbackGateEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.count === 'number' &&
    (entry.cumulative === undefined || typeof entry.cumulative === 'number') &&
    (entry.laps === undefined || isNonNegativeInteger(entry.laps)) &&
    (entry.chargedEffectIds === undefined || isChargedEffectIds(entry.chargedEffectIds)) &&
    (entry.mechanicalFaults === undefined || (
      typeof entry.mechanicalFaults === 'number' &&
      Number.isInteger(entry.mechanicalFaults) &&
      entry.mechanicalFaults >= 0
    )) &&
    (entry.lastMechanicalFault === undefined || isLastMechanicalFault(entry.lastMechanicalFault)) &&
    (typeof entry.treeHash === 'string' || entry.treeHash === null) &&
    typeof entry.lastReason === 'string' &&
    typeof entry.priorVerdict === 'boolean' &&
    typeof entry.resolvedBefore === 'number'
  );
}

function isChargedEffectIds(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((effectId) => typeof effectId === 'string' && effectId.trim().length > 0) &&
    new Set(value).size === value.length;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPlanGrowthRecord(value: unknown): value is PlanGrowthRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const growth = value as Record<string, unknown>;
  return isNonNegativeInteger(growth.authored) &&
    isNonNegativeInteger(growth.added) &&
    typeof growth.byGate === 'object' &&
    growth.byGate !== null &&
    !Array.isArray(growth.byGate) &&
    Object.entries(growth.byGate).every(([gate, count]) =>
      gate.trim().length > 0 && isNonNegativeInteger(count),
    );
}

function isPendingAsBuiltRemediationFinding(
  value: unknown,
): value is PendingAsBuiltRemediationFinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const finding = value as Record<string, unknown>;
  return (
    finding.gate === 'architecture_review_as_built' &&
    typeof finding.finding === 'string' && finding.finding.trim().length > 0 &&
    finding.class === 'REMEDIABLE' &&
    typeof finding.governingClause === 'string' && finding.governingClause.trim().length > 0 &&
    typeof finding.summary === 'string' && finding.summary.trim().length > 0 &&
    finding.outcome === 'remediated'
  );
}

function isPendingAsBuiltRemediationFindings(
  value: unknown,
): value is PendingAsBuiltRemediationFinding[] {
  return Array.isArray(value) &&
    value.every(isPendingAsBuiltRemediationFinding) &&
    new Set(value.map((finding) => finding.finding)).size === value.length;
}

function isKickbackLedger(value: unknown): value is PersistedKickbackLedger {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const ledger = value as Record<string, unknown>;
  if (ledger.version !== 1 || typeof ledger.gates !== 'object' || ledger.gates === null || Array.isArray(ledger.gates)) {
    return false;
  }

  return Object.values(ledger.gates).every(isKickbackGateEntry) &&
    (ledger.growth === undefined || isPlanGrowthRecord(ledger.growth)) &&
    (
      ledger.pendingAsBuiltRemediationFindings === undefined ||
      isPendingAsBuiltRemediationFindings(ledger.pendingAsBuiltRemediationFindings)
    );
}

function normalizeKickbackLedger(ledger: PersistedKickbackLedger): KickbackLedger {
  return {
    ...ledger,
    gates: Object.fromEntries(
      Object.entries(ledger.gates).map(([gate, entry]) => [
        gate,
        {
          ...entry,
          cumulative: entry.cumulative ?? 0,
          mechanicalFaults: entry.mechanicalFaults ?? 0,
          ...(gate === 'build_review' ? { chargedEffectIds: entry.chargedEffectIds ?? [] } : {}),
        },
      ]),
    ),
  };
}

/**
 * Read the durable kickback state. Missing, malformed, and incompatible
 * ledgers deliberately fail open to an empty budget and never interrupt a run.
 */
export async function readKickbackLedgerResult(projectRoot: string): Promise<KickbackLedgerReadResult> {
  const ledgerPath = join(projectRoot, KICKBACK_LEDGER_PATH);

  try {
    const parsed: unknown = JSON.parse(await readFile(ledgerPath, 'utf-8'));
    if (isKickbackLedger(parsed)) return { kind: 'ok', ledger: normalizeKickbackLedger(parsed) };

    if (typeof parsed === 'object' && parsed !== null && (parsed as { version?: unknown }).version !== 1) {
      return { kind: 'unreadable', reason: 'kickback ledger has an unsupported version' };
    }
    return { kind: 'unreadable', reason: 'kickback ledger is corrupt' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'unreadable', reason: `kickback ledger is unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Legacy callers intentionally retain the historic fail-open behavior. New
 * enforcement boundaries consume readKickbackLedgerResult instead.
 */
export async function readKickbackLedger(projectRoot: string): Promise<KickbackLedger> {
  const ledgerPath = join(projectRoot, KICKBACK_LEDGER_PATH);
  const result = await readKickbackLedgerResult(projectRoot);
  if (result.kind === 'ok') return result.ledger;
  if (result.kind === 'unreadable') {
    if (result.reason === 'kickback ledger has an unsupported version') {
      console.warn(`[kickback-ledger] unsupported ledger version at ${ledgerPath}; using empty ledger`);
    } else if (result.reason === 'kickback ledger is corrupt') {
      console.warn(`[kickback-ledger] corrupt ledger at ${ledgerPath}; using empty ledger`);
    } else {
      console.warn(`[kickback-ledger] unable to read ledger at ${ledgerPath}; using empty ledger: ${result.reason.slice('kickback ledger is unreadable: '.length)}`);
    }
  }
  return emptyLedger();
}

/** Write the ledger atomically, so readers never observe a partially written file. */
export async function writeKickbackLedger(
  projectRoot: string,
  ledger: KickbackLedger,
): Promise<void> {
  const ledgerPath = join(projectRoot, KICKBACK_LEDGER_PATH);
  const ledgerDir = dirname(ledgerPath);
  const tempPath = join(
    ledgerDir,
    `.kickback-ledger.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  await mkdir(ledgerDir, { recursive: true });
  try {
    await writeFile(tempPath, JSON.stringify(ledger, null, 2));
    await rename(tempPath, ledgerPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

/** Remove the ledger when a genuinely fresh feature session begins. */
export async function clearKickbackLedger(projectRoot: string): Promise<void> {
  await rm(join(projectRoot, KICKBACK_LEDGER_PATH), { force: true });
}

function withRemaining(growth: PlanGrowthRecord, cap: number): PlanGrowth {
  return {
    ...growth,
    byGate: { ...growth.byGate },
    remaining: Math.max(0, cap - growth.added),
  };
}

function growthTotalsAgree(growth: PlanGrowthRecord): boolean {
  return Object.values(growth.byGate).reduce((total, count) => total + count, 0) === growth.added;
}

async function deriveGrowthFromActivePlan(
  projectRoot: string,
): Promise<{ growth: PlanGrowthRecord; resolved: boolean }> {
  let activePlanPath: string | undefined;
  try {
    const state = JSON.parse(
      await readFile(join(projectRoot, '.pipeline', 'engine-state.json'), 'utf-8'),
    ) as { activePlanPath?: unknown };
    if (typeof state.activePlanPath === 'string' && state.activePlanPath.trim()) {
      activePlanPath = state.activePlanPath;
    }
  } catch {
    // The absent legacy state has no authoritative plan path; do not guess.
  }

  if (!activePlanPath) {
    return { growth: { authored: 0, added: 0, byGate: {} }, resolved: false };
  }

  try {
    const plan = await readFile(
      isAbsolute(activePlanPath) ? activePlanPath : join(projectRoot, activePlanPath),
      'utf-8',
    );
    const authored = [...plan.matchAll(/^#{1,6}\s+Task\s+[A-Za-z0-9._-]+(?::|\s[—–]|\s*$)/gim)].length;
    return { growth: { authored, added: 0, byGate: {} }, resolved: true };
  } catch (error) {
    console.warn(
      `[kickback-ledger] unable to derive growth from active plan ${activePlanPath}: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
    return { growth: { authored: 0, added: 0, byGate: {} }, resolved: false };
  }
}

/**
 * Read growth accounting, deriving its initial authored denominator only from
 * the engine-recorded active plan. Existing rem-* headers are intentionally
 * included in that denominator: they predate this feature's growth record.
 */
export async function readGrowth(projectRoot: string, cap: number): Promise<PlanGrowth> {
  const ledger = await readKickbackLedger(projectRoot);
  const derived = await deriveGrowthFromActivePlan(projectRoot);
  const stored = ledger.growth;

  if (!stored) return withRemaining(derived.growth, cap);

  const matchesPlan = !derived.resolved || stored.authored + stored.added === derived.growth.authored;
  if (growthTotalsAgree(stored) && matchesPlan) return withRemaining(stored, cap);

  // A plan can contain an old unrecorded foreign append from before append
  // authorization was centralized. Preserve every recorded addition rather
  // than reclassifying it as authored and refunding its allowance.
  if (growthTotalsAgree(stored) && derived.resolved) {
    const reconciled = {
      authored: Math.max(0, derived.growth.authored - stored.added),
      added: stored.added,
      byGate: { ...stored.byGate },
    };
    console.warn('[kickback-ledger] plan count diverged; preserving recorded growth allowance');
    await writeKickbackLedger(projectRoot, { ...ledger, growth: reconciled });
    return withRemaining(reconciled, cap);
  }

  console.warn('[kickback-ledger] impossible growth record; recomputing from the active plan');
  await writeKickbackLedger(projectRoot, { ...ledger, growth: derived.growth });
  return withRemaining(derived.growth, cap);
}

/** Persist a growth update and publish the resulting cap state on the event spine. */
export async function recordGrowth(
  projectRoot: string,
  growth: PlanGrowthRecord,
  options: { cap?: number; events?: PlanGrowthEventSink } = {},
): Promise<PlanGrowth> {
  if (!isPlanGrowthRecord(growth) || !growthTotalsAgree(growth)) {
    throw new Error('plan growth must have non-negative counts whose gate total equals added');
  }

  const ledger = await readKickbackLedger(projectRoot);
  const cap = options.cap ?? growth.added;
  const recorded = withRemaining(growth, cap);
  await writeKickbackLedger(projectRoot, {
    ...ledger,
    growth: { authored: growth.authored, added: growth.added, byGate: { ...growth.byGate } },
  });
  await options.events?.emit({ type: 'plan_growth', ...recorded });
  return recorded;
}

/**
 * Consume a gate's kickback budget, resetting it only when observable progress
 * occurred. Failure text is diagnostic data, never part of the budget key.
 */
export function bumpKickbackGate(
  entry: KickbackGateEntry | undefined,
  input: BumpKickbackGateInput,
): BumpKickbackGateResult {
  const previous: KickbackGateEntry = entry ?? {
    count: 0,
    cumulative: 0,
    treeHash: null,
    lastReason: '',
    // `true` is the consumed/no-pending-baseline state. The conductor writes
    // `false` only while a D2 kickback-to-build baseline is waiting to be
    // checked, then clears it back to true after that single use.
    priorVerdict: true,
    resolvedBefore: input.resolvedCount,
  };
  const madeProgress =
    previous.treeHash !== input.treeHash || input.resolvedCount > previous.resolvedBefore;
  const nextCount = madeProgress ? 1 : Math.min(previous.count + 1, MAX_KICKBACKS_PER_GATE);

  const nextEntry: KickbackGateEntry = {
    ...previous,
    count: nextCount,
    cumulative: previous.cumulative + 1,
    treeHash: input.treeHash,
    lastReason: input.reason,
    resolvedBefore: input.resolvedCount,
  };

  return {
    entry: nextEntry,
    cumulativeExhausted: nextEntry.cumulative > MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
    exhausted: !madeProgress && previous.count >= MAX_KICKBACKS_PER_GATE,
  };
}

/**
 * Charge one stable build-review effect. Replaying an already charged id is a
 * no-op, so an interrupted work-order route cannot spend the same lap twice.
 */
export function chargeBuildReviewEffect(
  entry: KickbackGateEntry | undefined,
  effectId: string,
  input: BumpKickbackGateInput,
): ChargeBuildReviewEffectResult {
  const chargedEffectIds = entry?.chargedEffectIds ?? [];
  if (chargedEffectIds.includes(effectId)) {
    return { status: 'already-charged', entry: entry! };
  }

  const result = bumpKickbackGate(entry, input);
  return {
    status: 'charged',
    ...result,
    entry: { ...result.entry, chargedEffectIds: [...chargedEffectIds, effectId] },
  };
}

/** Load, update, and atomically persist one gate's durable kickback budget. */
export async function bumpKickbackGateInLedger(
  projectRoot: string,
  gate: string,
  input: BumpKickbackGateInput,
): Promise<BumpKickbackGateResult> {
  const ledger = await readKickbackLedger(projectRoot);
  const result = bumpKickbackGate(ledger.gates[gate], input);

  await writeKickbackLedger(projectRoot, {
    ...ledger,
    gates: { ...ledger.gates, [gate]: result.entry },
  });

  return result;
}

/** Load, idempotently charge, and atomically persist one build-review effect. */
export async function chargeBuildReviewEffectInLedger(
  projectRoot: string,
  effectId: string,
  input: BumpKickbackGateInput,
): Promise<ChargeBuildReviewEffectResult> {
  const read = await readKickbackLedgerResult(projectRoot);
  if (read.kind === 'unreadable') return { status: 'unreadable', reason: read.reason };
  const ledger = read.kind === 'ok' ? read.ledger : emptyLedger();
  const result = chargeBuildReviewEffect(ledger.gates.build_review, effectId, input);

  if (result.status === 'charged') {
    await writeKickbackLedger(projectRoot, {
      ...ledger,
      gates: { ...ledger.gates, build_review: result.entry },
    });
  }

  return result;
}
/** Purely consume one build-review mechanical-fault allowance. */
export function bumpMechanicalFaults(
  entry: KickbackGateEntry,
  fault?: KickbackLastMechanicalFault,
): KickbackGateEntry {
  return {
    ...entry,
    mechanicalFaults: Math.min(
      (entry.mechanicalFaults ?? 0) + 1,
      MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
    ),
    ...(fault === undefined ? {} : {
      lastMechanicalFault: {
        ...fault,
        detail: boundedHeadTailExcerpt(fault.detail, RUBRIC_FAILURE_DETAIL_CAP_BYTES),
      },
    }),
  };
}

function emptyKickbackGateEntry(gate: string): KickbackGateEntry {
  return {
    count: 0,
    cumulative: 0,
    ...(gate === 'build_review' ? { chargedEffectIds: [] } : {}),
    mechanicalFaults: 0,
    treeHash: null,
    lastReason: '',
    priorVerdict: true,
    resolvedBefore: 0,
  };
}

async function bumpMechanicalFaultsInLedgerFromLedger(
  projectRoot: string,
  ledger: KickbackLedger,
  gate: string,
  fault?: KickbackLastMechanicalFault,
): Promise<KickbackGateEntry> {
  const entry = ledger.gates[gate] ?? emptyKickbackGateEntry(gate);

  const nextEntry = bumpMechanicalFaults(entry, fault);
  await writeKickbackLedger(projectRoot, {
    ...ledger,
    gates: { ...ledger.gates, [gate]: nextEntry },
  });

  return nextEntry;
}

/**
 * Load, update, and atomically persist one mechanical-fault allowance without
 * ever treating unreadable enforcement state as an empty budget.
 */
export async function bumpMechanicalFaultsInLedgerResult(
  projectRoot: string,
  gate: string,
  fault?: KickbackLastMechanicalFault,
): Promise<BumpMechanicalFaultsInLedgerResult> {
  const result = await readKickbackLedgerResult(projectRoot);
  if (result.kind === 'unreadable') return result;
  const ledger = result.kind === 'ok' ? result.ledger : emptyLedger();
  return { kind: 'ok', entry: await bumpMechanicalFaultsInLedgerFromLedger(projectRoot, ledger, gate, fault) };
}

/**
 * Legacy callers intentionally retain the historical fail-open behavior.
 * New enforcement boundaries use bumpMechanicalFaultsInLedgerResult instead.
 */
export async function bumpMechanicalFaultsInLedger(
  projectRoot: string,
  gate: string,
  fault?: KickbackLastMechanicalFault,
): Promise<KickbackGateEntry> {
  const result = await bumpMechanicalFaultsInLedgerResult(projectRoot, gate, fault);
  if (result.kind === 'ok') return result.entry;
  return bumpMechanicalFaultsInLedgerFromLedger(projectRoot, await readKickbackLedger(projectRoot), gate, fault);
}
