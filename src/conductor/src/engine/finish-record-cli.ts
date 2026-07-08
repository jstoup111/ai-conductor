// `conduct finish-record --choice <pr|keep|discard> [--pr-url <url>] --pipeline-dir <dir>`
// — argv detection for the finish-record subcommand (flag parser copied from
// shipped-record-cli.ts's `flag` helper).

export type FinishRecordDispatch =
  | { kind: 'record'; choice: string; prUrl?: string; pipelineDir: string }
  | { kind: 'guide' };

/**
 * Parse argv for the `finish-record` subcommand.
 *   conduct finish-record --choice <choice> [--pr-url <url>] --pipeline-dir <dir>
 *     → {kind:'record', choice, prUrl, pipelineDir}
 *   conduct finish-record [anything malformed]  → {kind:'guide'}
 *   (any other sub)                             → null
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
  return { kind: 'record', choice, prUrl, pipelineDir };
}
