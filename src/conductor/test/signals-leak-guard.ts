import { readFile } from 'fs/promises';
import { join } from 'path';

const SIGNALS_LOG = 'signals.jsonl';

/**
 * Snapshot of the engineer signals store (signals.jsonl) at a given moment,
 * scoped to counting lines whose `project` field is `test-project` — the
 * marker used by test-process runs so real signal writes are distinguishable
 * from test pollution.
 */
export interface EngineerSignalsSnapshot {
  exists: boolean;
  testProjectLineCount: number;
}

/**
 * Result of comparing two engineer-signals snapshots.
 */
export interface EngineerSignalsDiff {
  addedTestProjectLines: number;
}

/**
 * Read the engineer dir's signals.jsonl and count lines whose `project` field
 * is `test-project`. Missing file → { exists: false, testProjectLineCount: 0 }.
 * Malformed/unparseable lines are skipped (do not count, do not throw) — same
 * resilient line-parse convention used by `parseSignalsFile` in
 * src/engine/engineer-store.ts.
 *
 * @param engineerDir Engineer signals directory to scan for signals.jsonl
 * @returns Snapshot of the store's test-project line count
 */
export async function snapshotEngineerSignals(engineerDir: string): Promise<EngineerSignalsSnapshot> {
  let raw: string;
  try {
    raw = await readFile(join(engineerDir, SIGNALS_LOG), 'utf-8');
  } catch {
    // Missing or unreadable file → treat as not existing.
    return { exists: false, testProjectLineCount: 0 };
  }

  let testProjectLineCount = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Malformed line — skip, don't count, don't throw.
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    if ((parsed as { project?: unknown }).project === 'test-project') {
      testProjectLineCount++;
    }
  }

  return { exists: true, testProjectLineCount };
}

/**
 * Compare two engineer-signals snapshots and report the delta in
 * test-project-tagged lines added between them.
 *
 * @param before Snapshot from before the test
 * @param after Snapshot from after the test
 * @returns Diff showing added test-project lines
 */
export function diffEngineerSignals(
  before: EngineerSignalsSnapshot,
  after: EngineerSignalsSnapshot,
): EngineerSignalsDiff {
  return { addedTestProjectLines: after.testProjectLineCount - before.testProjectLineCount };
}
