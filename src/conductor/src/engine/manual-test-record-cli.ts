// `conduct manual-test-record --skip --reason <r> --pipeline-dir <dir>`
// `conduct manual-test-record --results <path> --pipeline-dir <dir>`
// — argv detection for the manual-test-record subcommand (flag parser
// mirrors finish-record-cli.ts's `detectFinishRecordCommand`).

import { join } from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { MANUAL_TEST_SKIP_SENTINEL } from './artifacts.js';

export type ManualTestRecordDispatch =
  | { kind: 'skip'; reason: string; pipelineDir: string }
  | { kind: 'results'; resultsPath: string; pipelineDir: string }
  | { kind: 'guide' };

export const MANUAL_TEST_RECORD_USAGE =
  'conduct manual-test-record --skip --reason <r> --pipeline-dir <dir>\n' +
  '  --skip           requires --reason <r>; must NOT be paired with --results.\n' +
  'conduct manual-test-record --results <path> --pipeline-dir <dir>\n' +
  '  --results        requires <path>; must NOT be paired with --skip.\n' +
  '  --pipeline-dir   absolute path to the pipeline directory (required).';

/**
 * Parse argv for the `manual-test-record` subcommand.
 *   conduct manual-test-record --skip --reason <r> --pipeline-dir <dir>
 *     → {kind:'skip', reason, pipelineDir}
 *   conduct manual-test-record --results <path> --pipeline-dir <dir>
 *     → {kind:'results', resultsPath, pipelineDir}
 *   conduct manual-test-record [anything malformed]  → {kind:'guide'}
 *   (any other sub)                                  → null
 *
 * Malformed args return `guide` (never null): a recognized-but-misused
 * subcommand must never fall through to the pipeline launcher.
 */
export function detectManualTestRecordCommand(argv: string[]): ManualTestRecordDispatch | null {
  if (argv[2] !== 'manual-test-record') return null;
  const rest = argv.slice(3);
  const has = (name: string): boolean => rest.includes(name);
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    if (i === -1) return undefined;
    const v = rest[i + 1];
    return v && !v.startsWith('--') ? v : undefined;
  };

  const skip = has('--skip');
  const reason = flag('--reason');
  const resultsPath = flag('--results');
  const pipelineDir = flag('--pipeline-dir');

  if (skip && resultsPath !== undefined) return { kind: 'guide' };
  if (!pipelineDir) return { kind: 'guide' };

  if (skip) {
    if (!reason) return { kind: 'guide' };
    return { kind: 'skip', reason, pipelineDir };
  }

  if (resultsPath !== undefined) {
    return { kind: 'results', resultsPath, pipelineDir };
  }

  return { kind: 'guide' };
}

export const MANUAL_TEST_RESULTS_FILENAME = 'manual-test-results.md';

/** Injectable filesystem seam so tests can assert atomic-write behavior
 * without touching real fs. Mirrors FinishRecordRunners' injectable-seam
 * pattern (finish-record-cli.ts). */
export interface ManualTestRecordRunners {
  readFile: (path: string) => Promise<string>;
  mkdir: (path: string) => Promise<unknown>;
  writeFile: (path: string, contents: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  rm: (path: string) => Promise<void>;
}

/** Production runners: real fs/promises. */
export function makeProductionManualTestRecordRunners(): ManualTestRecordRunners {
  return {
    readFile: (path: string) => readFile(path, 'utf-8'),
    mkdir: (path: string) => mkdir(path, { recursive: true }),
    writeFile: (path: string, contents: string) => writeFile(path, contents, 'utf-8'),
    rename: (from: string, to: string) => rename(from, to),
    rm: (path: string) => rm(path, { force: true }).then(() => undefined),
  };
}

/**
 * The next attempt number for a manual-test-results.md file, derived from
 * the highest `## Attempt N` heading present (0 if the file is missing/empty
 * or has no attempt headings).
 */
function nextAttemptNumber(content: string): number {
  const matches = [...content.matchAll(/^##\s+Attempt\s+(\d+)\b/gim)];
  if (matches.length === 0) return 1;
  const max = Math.max(...matches.map((m) => parseInt(m[1], 10)));
  return max + 1;
}

/**
 * Dispatches a `manual-test-record` command.
 *
 * Only `{kind:'skip'}` is implemented here: it appends a new `## Attempt N`
 * section containing MANUAL_TEST_SKIP_SENTINEL and a human-readable
 * `**Result:** SKIPPED — <reason>` line to
 * `<pipelineDir>/manual-test-results.md`, creating the file (and pipeline
 * dir) if absent. The write is atomic — temp file in the same directory,
 * then rename(2) over the target — and fail-closed: any read/write error
 * refuses (non-zero exit) rather than risk a torn/partial results file.
 *
 * `{kind:'results'}` is not yet handled (a later task); `{kind:'guide'}`
 * prints usage and exits 1, matching detectManualTestRecordCommand's
 * contract that a recognized-but-misused subcommand never falls through to
 * the pipeline launcher.
 */
export async function dispatchManualTestRecord(
  cmd: ManualTestRecordDispatch,
  _cwd: string,
  runners: ManualTestRecordRunners = makeProductionManualTestRecordRunners(),
): Promise<number> {
  if (cmd.kind === 'guide') {
    console.error(MANUAL_TEST_RECORD_USAGE);
    return 1;
  }

  if (cmd.kind === 'results') {
    console.error(
      'manual-test-record: --results is not yet implemented — use --skip, or record results manually',
    );
    return 1;
  }

  // cmd.kind === 'skip'
  const resultsPath = join(cmd.pipelineDir, MANUAL_TEST_RESULTS_FILENAME);

  let existing = '';
  try {
    existing = await runners.readFile(resultsPath);
  } catch {
    // Missing/unreadable file: treat as empty — attempt 1.
    existing = '';
  }

  const attemptNumber = nextAttemptNumber(existing);
  const section =
    `## Attempt ${attemptNumber}\n\n` +
    `${MANUAL_TEST_SKIP_SENTINEL}\n` +
    `**Result:** SKIPPED — ${cmd.reason}\n`;
  const separator = existing.trim().length > 0 ? '\n\n' : '';
  const newContent = `${existing}${separator}${section}`;

  try {
    await runners.mkdir(cmd.pipelineDir);
  } catch (err) {
    console.error(
      `manual-test-record: failed to create pipeline dir "${cmd.pipelineDir}" (${err instanceof Error ? err.message : String(err)}) — refusing to record`,
    );
    return 1;
  }

  const tempPath = join(
    cmd.pipelineDir,
    `.${MANUAL_TEST_RESULTS_FILENAME}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await runners.writeFile(tempPath, newContent);
    await runners.rename(tempPath, resultsPath);
  } catch (err) {
    await runners.rm(tempPath).catch(() => {});
    console.error(
      `manual-test-record: failed to write "${resultsPath}" (${err instanceof Error ? err.message : String(err)}) — refusing to record`,
    );
    return 1;
  }

  return 0;
}
