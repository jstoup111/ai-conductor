// quarantine.ts — core logic for `bin/quarantine-engineer-signals` (T5,
// jstoup111/ai-conductor#861).
//
// One-shot, operator-invoked maintenance: partitions the real engineer
// signals.jsonl store into `kept` (real + malformed lines, preserved
// byte-for-byte, original order) and `quarantined` (lines that parse as JSON
// with `project === 'test-project'`). Never mutates production schema or
// resolveEngineerDir — out of scope per the plan.

import { readFile, writeFile, appendFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const SIGNALS_LOG = 'signals.jsonl';
const QUARANTINE_LOG = 'signals.jsonl.test-quarantine';
const TEST_PROJECT_MARKER = 'test-project';

export interface QuarantinePartition {
  /** Lines to keep in the live signals.jsonl, original order, original bytes. */
  kept: string[];
  /** Lines to move into signals.jsonl.test-quarantine, original order, original bytes. */
  quarantined: string[];
}

/**
 * Partition raw signals.jsonl content into kept vs quarantined lines.
 * Malformed/unparseable lines are always kept (resilient convention shared
 * with engineer-store.ts / signals-leak-guard.ts). Blank trailing content
 * from a trailing newline is dropped, not treated as a line.
 */
export function partitionSignalsContent(raw: string): QuarantinePartition {
  const lines = raw.split('\n');
  // A trailing newline produces one trailing empty element — drop it so we
  // don't fabricate a phantom blank line on rewrite.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const kept: string[] = [];
  const quarantined: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      kept.push(line);
      continue;
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).project === TEST_PROJECT_MARKER
    ) {
      quarantined.push(line);
    } else {
      kept.push(line);
    }
  }

  return { kept, quarantined };
}

export interface QuarantineResult {
  /** Whether signals.jsonl existed at all. */
  existed: boolean;
  kept: number;
  quarantined: number;
  total: number;
  /** Path to the backup file written (absent on dry-run or missing store). */
  backupPath?: string;
  dryRun: boolean;
}

export interface QuarantineOpts {
  engineerDir: string;
  dryRun?: boolean;
  /** Injectable for deterministic backup filenames in tests. */
  now?: () => Date;
}

function backupTimestamp(now: Date): string {
  // ISO timestamp with colons/dots stripped so it's filesystem-safe.
  return now.toISOString().replace(/[:.]/g, '-');
}

/**
 * Read, partition, and (unless dryRun) rewrite the engineer signals store,
 * quarantining `test-project`-tagged lines. Real and malformed lines are
 * preserved byte-for-byte and in original order. Idempotent: a second run
 * after a real (non-dry-run) run quarantines 0 additional lines, since the
 * test-project lines were already removed from the live file.
 */
export async function quarantineEngineerSignals(opts: QuarantineOpts): Promise<QuarantineResult> {
  const { engineerDir, dryRun = false, now = () => new Date() } = opts;
  const signalsPath = join(engineerDir, SIGNALS_LOG);

  let raw: string;
  try {
    raw = await readFile(signalsPath, 'utf-8');
  } catch {
    return { existed: false, kept: 0, quarantined: 0, total: 0, dryRun };
  }

  const { kept, quarantined } = partitionSignalsContent(raw);

  const result: QuarantineResult = {
    existed: true,
    kept: kept.length,
    quarantined: quarantined.length,
    total: kept.length + quarantined.length,
    dryRun,
  };

  if (dryRun) {
    return result;
  }

  // Backup first — byte-for-byte copy of the original file, before any
  // mutation, so a failure mid-run never loses data.
  const backupPath = join(signalsPath.replace(/signals\.jsonl$/, ''), `signals.jsonl.bak-${backupTimestamp(now())}`);
  await copyFile(signalsPath, backupPath);
  result.backupPath = backupPath;

  const keptContent = kept.length > 0 ? kept.join('\n') + '\n' : '';
  await writeFile(signalsPath, keptContent, 'utf-8');

  if (quarantined.length > 0) {
    const quarantinePath = join(engineerDir, QUARANTINE_LOG);
    await appendFile(quarantinePath, quarantined.join('\n') + '\n', 'utf-8');
  }

  return result;
}
