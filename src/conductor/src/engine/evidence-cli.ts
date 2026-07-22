// `conduct evidence` — CLI surface for the (retired) semantic attribution
// evidence gate.
//
// The `evidence judge <slug>` GATING command was removed in feature #773
// Task 12: per-task commit-stamping is demoted from a gate to telemetry, and
// the citation-judge lane (dispatch verifier -> validate citations -> stamp
// evidence -> advance the build gate) no longer exists. Citation-quality
// sampling now lives exclusively in the separate, non-blocking spot-audit
// path (attribution-audit.ts's `runSpotAudit`). This module is kept as a
// thin, guide-only stub so `conduct evidence` still resolves to a clear
// message instead of an unrecognized-command error.

export type EvidenceDispatch = { kind: 'guide' };

/**
 * Parse argv for the `evidence` subcommand.
 *   conduct evidence [anything] → {kind:'guide'} (judge command removed)
 *   (any other sub)             → null
 */
export function detectEvidenceCommand(argv: string[]): EvidenceDispatch | null {
  const sub = argv[2];
  if (sub !== 'evidence') return null;
  return { kind: 'guide' };
}

export interface EvidenceDispatchDeps {
  print?: (msg: string) => void;
  cwd?: string;
}

/**
 * Dispatch the `evidence` subcommand. Always prints the retirement notice.
 *
 * Exit codes:
 *   2 = usage/guide (only outcome now that `judge` is removed)
 */
export async function dispatchEvidence(
  _cmd: EvidenceDispatch,
  deps: EvidenceDispatchDeps = {},
): Promise<number> {
  const { print = console.log } = deps;

  print(
    'conduct evidence: the `judge` command has been removed.\n' +
      '  Semantic attribution citation-judge GATING was demoted to telemetry\n' +
      '  (feature #773, Task 12). Citation-quality sampling now runs as a\n' +
      '  non-blocking spot-audit; it is not a CLI-invokable gate.\n',
  );
  return 2;
}
