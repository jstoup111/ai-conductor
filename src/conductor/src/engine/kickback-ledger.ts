import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Durable state for a gate's cross-dispatch kickback budget. */
export interface KickbackGateEntry {
  count: number;
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

export const KICKBACK_LEDGER_PATH = '.pipeline/kickback-ledger.json';

function emptyLedger(): KickbackLedger {
  return { version: 1, gates: {} };
}

function isKickbackGateEntry(value: unknown): value is KickbackGateEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.count === 'number' &&
    (typeof entry.treeHash === 'string' || entry.treeHash === null) &&
    typeof entry.lastReason === 'string' &&
    typeof entry.priorVerdict === 'boolean' &&
    typeof entry.resolvedBefore === 'number'
  );
}

function isKickbackLedger(value: unknown): value is KickbackLedger {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const ledger = value as Record<string, unknown>;
  if (ledger.version !== 1 || typeof ledger.gates !== 'object' || ledger.gates === null || Array.isArray(ledger.gates)) {
    return false;
  }

  return Object.values(ledger.gates).every(isKickbackGateEntry);
}

/**
 * Read the durable kickback state. Missing, malformed, and incompatible
 * ledgers deliberately fail open to an empty budget and never interrupt a run.
 */
export async function readKickbackLedger(projectRoot: string): Promise<KickbackLedger> {
  const ledgerPath = join(projectRoot, KICKBACK_LEDGER_PATH);

  try {
    const parsed: unknown = JSON.parse(await readFile(ledgerPath, 'utf-8'));
    if (isKickbackLedger(parsed)) return parsed;

    if (typeof parsed === 'object' && parsed !== null && (parsed as { version?: unknown }).version !== 1) {
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
