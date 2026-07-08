// `conduct finish-record --choice <pr|keep|discard> [--pr-url <url>] --pipeline-dir <dir>`
// — argv detection for the finish-record subcommand (flag parser copied from
// shipped-record-cli.ts's `flag` helper).

export type FinishRecordDispatch =
  | { kind: 'record'; choice: string; prUrl?: string; pipelineDir: string }
  | { kind: 'guide' };

// The only choices `dispatchFinishRecord` knows how to record. `discard` and
// any other value are recognized-but-unsupported here — they must guide, not
// silently fall through to the pipeline launcher (the render-diagrams lesson,
// bug #178).
const VALID_CHOICES = new Set(['pr', 'keep']);

export const FINISH_RECORD_USAGE =
  'conduct finish-record --choice <pr|keep> [--pr-url <url>] --pipeline-dir <dir>\n' +
  '  --choice pr      requires --pr-url <url>; writes pr_url into conduct-state.json\n' +
  '                   then the finish-choice marker.\n' +
  '  --choice keep    must NOT be paired with --pr-url; writes the finish-choice\n' +
  '                   marker only.\n' +
  '  --pipeline-dir   absolute path to the pipeline directory (required).';

/**
 * Parse argv for the `finish-record` subcommand.
 *   conduct finish-record --choice <pr|keep> [--pr-url <url>] --pipeline-dir <dir>
 *     → {kind:'record', choice, prUrl, pipelineDir}
 *   conduct finish-record [anything malformed]  → {kind:'guide'}
 *   (any other sub)                             → null
 *
 * Malformed args return `guide` (never null): a recognized-but-misused
 * subcommand must never fall through to the pipeline launcher.
 */
export function detectFinishRecordCommand(argv: string[]): FinishRecordDispatch | null {
  if (argv[2] !== 'finish-record') return null;
  const rest = argv.slice(3);
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    if (i === -1) return undefined;
    const v = rest[i + 1];
    return v && !v.startsWith('--') ? v : undefined;
  };
  const choice = flag('--choice');
  const prUrl = flag('--pr-url');
  const pipelineDir = flag('--pipeline-dir');
  if (!choice || !pipelineDir) return { kind: 'guide' };
  if (!VALID_CHOICES.has(choice)) return { kind: 'guide' };
  if (choice === 'pr' && !prUrl) return { kind: 'guide' };
  if (choice === 'keep' && prUrl) return { kind: 'guide' };
  return { kind: 'record', choice, prUrl, pipelineDir };
}

/**
 * Guide-only dispatch for this task's scope: prints usage and exits 1 for
 * `{kind:'guide'}`. The `{kind:'record'}` verification/write path is built out
 * in later tasks of the finish-record plan.
 */
export function dispatchFinishRecordGuide(cmd: FinishRecordDispatch): number {
  if (cmd.kind !== 'guide') return 0;
  console.error(FINISH_RECORD_USAGE);
  return 1;
}
