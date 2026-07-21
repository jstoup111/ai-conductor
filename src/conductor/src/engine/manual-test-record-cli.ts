// `conduct manual-test-record --skip --reason <r> --pipeline-dir <dir>`
// `conduct manual-test-record --results <path> --pipeline-dir <dir>`
// — argv detection for the manual-test-record subcommand (flag parser
// mirrors finish-record-cli.ts's `detectFinishRecordCommand`).

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
