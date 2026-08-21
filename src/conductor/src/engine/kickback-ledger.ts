import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Durable state for a gate's cross-dispatch kickback budget. */
export interface KickbackGateEntry {
  count: number;
  cumulative: number;
  mechanicalFaults?: number;
  treeHash: string | null;
  lastReason: string;
  priorVerdict: boolean;
  resolvedBefore: number;
}

/** Durable, per-feature kickback state stored outside the feature branch. */
export interface KickbackLedger {
  version: 1;
  gates: Record<string, KickbackGateEntry>;
}

type PersistedKickbackGateEntry = Omit<KickbackGateEntry, 'cumulative' | 'mechanicalFaults'> & {
  cumulative?: number;
  mechanicalFaults?: number;
};

interface PersistedKickbackLedger {
  version: 1;
  gates: Record<string, PersistedKickbackGateEntry>;
}

export const KICKBACK_LEDGER_PATH = '.pipeline/kickback-ledger.json';

/** A gate may be kicked back to BUILD this many times for one progress state. */
export const MAX_KICKBACKS_PER_GATE = 2;

/** Cumulative build-review failures allowed before human intervention is required. */
export const MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW = 5;

/** Mechanical build-review faults allowed before human intervention is required. */
export const MAX_MECHANICAL_FAULTS_BUILD_REVIEW = 3;

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
  return Object.fromEntries(
    Object.entries(entry).map(([field, value]) => [
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

function isKickbackGateEntry(value: unknown): value is PersistedKickbackGateEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.count === 'number' &&
    (entry.cumulative === undefined || typeof entry.cumulative === 'number') &&
    (entry.mechanicalFaults === undefined || (
      typeof entry.mechanicalFaults === 'number' &&
      Number.isInteger(entry.mechanicalFaults) &&
      entry.mechanicalFaults >= 0
    )) &&
    (typeof entry.treeHash === 'string' || entry.treeHash === null) &&
    typeof entry.lastReason === 'string' &&
    typeof entry.priorVerdict === 'boolean' &&
    typeof entry.resolvedBefore === 'number'
  );
}

function isKickbackLedger(value: unknown): value is PersistedKickbackLedger {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const ledger = value as Record<string, unknown>;
  if (ledger.version !== 1 || typeof ledger.gates !== 'object' || ledger.gates === null || Array.isArray(ledger.gates)) {
    return false;
  }

  return Object.values(ledger.gates).every(isKickbackGateEntry);
}

function normalizeKickbackLedger(ledger: PersistedKickbackLedger): KickbackLedger {
  return {
    ...ledger,
    gates: Object.fromEntries(
      Object.entries(ledger.gates).map(([gate, entry]) => [
        gate,
        { ...entry, cumulative: entry.cumulative ?? 0, mechanicalFaults: entry.mechanicalFaults ?? 0 },
      ]),
    ),
  };
}

/**
 * Read the durable kickback state. Missing, malformed, and incompatible
 * ledgers deliberately fail open to an empty budget and never interrupt a run.
 */
export async function readKickbackLedger(projectRoot: string): Promise<KickbackLedger> {
  const ledgerPath = join(projectRoot, KICKBACK_LEDGER_PATH);

  try {
    const parsed: unknown = JSON.parse(await readFile(ledgerPath, 'utf-8'));
    if (isKickbackLedger(parsed)) return normalizeKickbackLedger(parsed);

    if (typeof parsed === 'object' && parsed !== null && (parsed as { version?: unknown }).version !== 1) {
      console.warn(`[kickback-ledger] unsupported ledger version at ${ledgerPath}; using empty ledger`);
      return emptyLedger();
    }

    console.warn(`[kickback-ledger] corrupt ledger at ${ledgerPath}; using empty ledger`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        `[kickback-ledger] unable to read ledger at ${ledgerPath}; using empty ledger: ${error instanceof Error ? error.message : String(error)}`,
      );
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
/** Purely consume one build-review mechanical-fault allowance. */
export function bumpMechanicalFaults(entry: KickbackGateEntry): KickbackGateEntry {
  return {
    ...entry,
    mechanicalFaults: Math.min(
      (entry.mechanicalFaults ?? 0) + 1,
      MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
    ),
  };
}

/** Load, update, and atomically persist one gate's mechanical-fault allowance. */
export async function bumpMechanicalFaultsInLedger(
  projectRoot: string,
  gate: string,
): Promise<KickbackGateEntry> {
  const ledger = await readKickbackLedger(projectRoot);
  const entry = ledger.gates[gate] ?? {
    count: 0,
    cumulative: 0,
    mechanicalFaults: 0,
    treeHash: null,
    lastReason: '',
    priorVerdict: true,
    resolvedBefore: 0,
  };

  const nextEntry = bumpMechanicalFaults(entry);
  await writeKickbackLedger(projectRoot, {
    ...ledger,
    gates: { ...ledger.gates, [gate]: nextEntry },
  });

  return nextEntry;
}
