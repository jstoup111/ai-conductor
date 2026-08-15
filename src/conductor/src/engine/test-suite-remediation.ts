import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { boundedHeadTailExcerpt } from './build-review-tautology-preflight.js';

export const BUILD_REVIEW_REPAIR_LEDGER = '.pipeline/build-review-rebase-repairs.json';

/**
 * Byte cap for one record's persisted diagnostic. Repair records ride into
 * the tautology, scope, and rootCause rubric prompts and accumulate across
 * rebases, so each diagnostic is bounded by construction at creation time —
 * pure byte-position head+tail truncation, no runner-output parsing.
 */
export const REMEDIATION_DIAGNOSTIC_CAP_BYTES = 2_048;

export interface TestSuiteRemediationFailure {
  reason: string;
  message: string;
  observedAt: number;
}

export interface TestSuiteRemediationRecord {
  id: string;
  gate?: string;
  reason: string;
  diagnostic: string;
  rebaseInvalidatedAt: number;
}

export interface BaseAdvance {
  paths: string[];
  ts: string;
}

export function diagnosticOverlapsBaseAdvance(advance: BaseAdvance, diagnostic: string): boolean {
  return advance.paths.some((path) => {
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A diagnostic may render the repo-relative path bare, as `./path`, or as
    // an absolute worktree path (`/…/path`). A bare relative prefix
    // (`src/agents/planner.md` for advance path `agents/planner.md`) names a
    // DIFFERENT repo path and must not match, so the absolute form requires a
    // leading `/` at a token boundary.
    const prefix = String.raw`(?:(?:^|[^\w./-])(?:\./)?|(?:^|[^\w.-])/(?:[\w.@+-]+/)*)`;
    return new RegExp(`${prefix}${escapedPath}(?=$|[^\\w./-])`).test(diagnostic);
  });
}

export function failureMatchesBaseAdvance(
  advance: BaseAdvance,
  failure: { diagnostic: string; observedAt: string | number },
): boolean {
  const observedAt = typeof failure.observedAt === 'number'
    ? failure.observedAt > Date.parse(advance.ts)
    : failure.observedAt > advance.ts;
  return observedAt
    && diagnosticOverlapsBaseAdvance(advance, failure.diagnostic);
}

export function resolveBaseAdvanceForFailure(
  advances: readonly BaseAdvance[],
  failure: { diagnostic: string; observedAt: string | number },
): BaseAdvance | undefined {
  return advances.find((advance) => failureMatchesBaseAdvance(advance, failure));
}

/**
 * Read the complete path deltas from every recorded base advance. The JSONL
 * sequence is append-only, so preserving its scan order preserves chronology.
 */
export async function readBaseAdvanceHistory(projectRoot: string): Promise<BaseAdvance[]> {
  const eventsPath = join(projectRoot, '.pipeline', 'events.jsonl');
  let content: string;
  try {
    content = await readFile(eventsPath, 'utf8');
  } catch {
    return [];
  }
  const advances: BaseAdvance[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type !== 'rebase_changed' || typeof event.ts !== 'string') continue;
    const paths = Array.isArray(event.allChangedPaths)
      ? event.allChangedPaths
      : event.changedPaths;
    if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) continue;
    advances.push({ paths, ts: event.ts });
  }

  return advances;
}

interface RepairLedger {
  repairs: TestSuiteRemediationRecord[];
}

function remediationIdentity(advance: BaseAdvance, failure: TestSuiteRemediationFailure): string {
  return createHash('sha256')
    .update(`${advance.ts}\0${failure.reason}\0${failure.message}`)
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
    if (Array.isArray((parsed as { consumedInvalidations?: unknown }).consumedInvalidations)) {
      return [];
    }
    if (!Array.isArray(parsed.repairs)) return [];
    return parsed.repairs.filter(
      (repair): repair is TestSuiteRemediationRecord =>
        !!repair &&
        typeof repair === 'object' &&
        typeof (repair as TestSuiteRemediationRecord).id === 'string' &&
        typeof (repair as TestSuiteRemediationRecord).gate === 'string' &&
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
      repairs: await readTestSuiteRemediations(projectRoot),
    };
  } catch {
    return { repairs: [] };
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
  gate: unknown,
  failure: unknown,
): Promise<TestSuiteRemediationRecord | undefined> {
  if (typeof gate !== 'string' || !isObservedFailure(failure)) return undefined;
  const advance = resolveBaseAdvanceForFailure(await readBaseAdvanceHistory(projectRoot), {
    diagnostic: failure.message,
    observedAt: failure.observedAt,
  });
  if (!advance) return undefined;
  const invalidatedAt = Date.parse(advance.ts);
  const release = await acquireLedgerLock(projectRoot);
  try {
    const ledger = await readLedger(projectRoot);

    const record: TestSuiteRemediationRecord = {
      // Identity is derived from the FULL failure message (remediationIdentity
      // above), before the diagnostic is bounded — truncation never changes
      // dedup semantics for records that differ only past the cap.
      id: `repair-${remediationIdentity(advance, failure)}`,
      gate,
      reason: failure.reason,
      diagnostic: boundedHeadTailExcerpt(
        failure.message.replace(/\s+/g, ' ').trim(),
        REMEDIATION_DIAGNOSTIC_CAP_BYTES,
      ),
      rebaseInvalidatedAt: invalidatedAt,
    };
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

export const recordGateRepair = recordTestSuiteRemediation;

function isObservedFailure(value: unknown): value is TestSuiteRemediationFailure {
  return !!value
    && typeof value === 'object'
    && typeof (value as TestSuiteRemediationFailure).reason === 'string'
    && typeof (value as TestSuiteRemediationFailure).message === 'string'
    && typeof (value as TestSuiteRemediationFailure).observedAt === 'number';
}
