import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GateVerdict } from './gate-verdicts.js';

export const BUILD_REVIEW_REPAIR_LEDGER = '.pipeline/build-review-rebase-repairs.json';

export interface TestSuiteRemediationFailure {
  reason: string;
  message: string;
}

export interface TestSuiteRemediationRecord {
  id: string;
  reason: string;
  diagnostic: string;
  rebaseInvalidatedAt: number;
}

export interface BaseAdvance {
  paths: string[];
  ts: string;
}

/**
 * Read the complete path deltas from every recorded base advance. The JSONL
 * sequence is append-only, so preserving its scan order preserves chronology.
 */
export async function readBaseAdvanceHistory(projectRoot: string): Promise<BaseAdvance[]> {
  const eventsPath = join(projectRoot, '.pipeline', 'events.jsonl');
  const content = await readFile(eventsPath, 'utf8');
  const advances: BaseAdvance[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type !== 'rebase_changed' || typeof event.ts !== 'string') continue;
    const paths = Array.isArray(event.allChangedPaths)
      ? event.allChangedPaths
      : event.changedPaths;
    if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) continue;
    advances.push({ paths, ts: event.ts });
  }

  return advances;
}

export function wasInvalidatedByRebase(
  verdict: { kickback?: { from?: string } } | null | undefined,
): boolean {
  return verdict?.kickback?.from === 'rebase';
}

interface RepairLedger {
  consumedInvalidations: number[];
  repairs: TestSuiteRemediationRecord[];
}

function remediationIdentity(failure: TestSuiteRemediationFailure): string {
  return createHash('sha256')
    .update(`${failure.reason}\0${failure.message}`)
    .digest('hex')
    .slice(0, 12);
}

export async function readTestSuiteRemediations(
  projectRoot: string,
): Promise<TestSuiteRemediationRecord[]> {
  try {
    const parsed = JSON.parse(
      await readFile(join(projectRoot, BUILD_REVIEW_REPAIR_LEDGER), 'utf8'),
    ) as Partial<RepairLedger>;
    if (!Array.isArray(parsed.repairs)) return [];
    return parsed.repairs.filter(
      (repair): repair is TestSuiteRemediationRecord =>
        !!repair &&
        typeof repair === 'object' &&
        typeof (repair as TestSuiteRemediationRecord).id === 'string' &&
        typeof (repair as TestSuiteRemediationRecord).reason === 'string' &&
        typeof (repair as TestSuiteRemediationRecord).diagnostic === 'string' &&
        typeof (repair as TestSuiteRemediationRecord).rebaseInvalidatedAt === 'number',
    );
  } catch {
    return [];
  }
}

async function readLedger(projectRoot: string): Promise<RepairLedger> {
  try {
    const parsed = JSON.parse(
      await readFile(join(projectRoot, BUILD_REVIEW_REPAIR_LEDGER), 'utf8'),
    ) as Partial<RepairLedger>;
    return {
      consumedInvalidations: Array.isArray(parsed.consumedInvalidations)
        ? parsed.consumedInvalidations.filter((value): value is number => typeof value === 'number')
        : [],
      repairs: await readTestSuiteRemediations(projectRoot),
    };
  } catch {
    return { consumedInvalidations: [], repairs: [] };
  }
}

async function acquireLedgerLock(projectRoot: string): Promise<() => Promise<void>> {
  const lockPath = join(projectRoot, `${BUILD_REVIEW_REPAIR_LEDGER}.lock`);
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }) + '\n');
      return async () => {
        await handle.close();
        await unlink(lockPath).catch(() => {});
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: unknown };
        if (typeof owner.pid === 'number') {
          try {
            process.kill(owner.pid, 0);
          } catch (probeError) {
            if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') {
              await unlink(lockPath);
              continue;
            }
          }
        } else if (Date.now() - (await stat(lockPath)).mtimeMs > 30_000) {
          await unlink(lockPath);
          continue;
        }
      } catch {
        // A concurrently released/replaced lock is retried normally.
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error('timed out acquiring build-review rebase-repair ledger lock');
}

/**
 * Accumulate aggregate-gate repair context outside Git history. Stable content
 * identities survive any number of rebases without treating commit trailers
 * as authority. build_review remains responsible for judging whether a diff
 * hunk actually implements a recorded repair.
 */
export async function recordTestSuiteRemediation(
  projectRoot: string,
  failure: TestSuiteRemediationFailure,
  rebaseVerdict: GateVerdict | null | undefined,
): Promise<TestSuiteRemediationRecord | undefined> {
  if (!wasInvalidatedByRebase(rebaseVerdict)) return undefined;
  const invalidatedAt = rebaseVerdict!.checkedAt;
  const release = await acquireLedgerLock(projectRoot);
  try {
    const ledger = await readLedger(projectRoot);
    if (ledger.consumedInvalidations.includes(invalidatedAt)) return undefined;

    const record: TestSuiteRemediationRecord = {
      id: `repair-${remediationIdentity(failure)}`,
      reason: failure.reason,
      diagnostic: failure.message.replace(/\s+/g, ' ').trim(),
      rebaseInvalidatedAt: invalidatedAt,
    };
    ledger.consumedInvalidations.push(invalidatedAt);
    if (!ledger.repairs.some((candidate) => candidate.id === record.id)) {
      ledger.repairs.push(record);
    }
    const ledgerPath = join(projectRoot, BUILD_REVIEW_REPAIR_LEDGER);
    const tempPath = `${ledgerPath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
    await rename(tempPath, ledgerPath);
    return record;
  } finally {
    await release();
  }
}
