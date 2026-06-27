// daemon-command.ts — lightweight parser for the `conduct daemon …` subcommand.
//
// The daemon used to be a flag (`conduct --daemon`); it is now a verb-first
// subcommand (`conduct daemon`), matching `engineer` / `register` / `create`.
// This module mirrors the engineer-cli detection pattern: a PURE argv parser
// with no heavy imports, so index.ts can decide whether to dispatch the daemon
// without eagerly loading the daemon runtime (execa, the provider layer, …).
// The actual `runDaemonMode` is imported lazily by index.ts only on a match.

/**
 * Options carried from `conduct daemon …` into `runDaemonMode`. A subset of
 * DaemonModeOptions (projectRoot/baseBranch are supplied by the dispatcher).
 */
export interface DaemonCommandOptions {
  /** Parallel workers (>= 1). Default 1. */
  concurrency: number;
  /** Stop after this many features (default: drain the backlog once). */
  maxItems?: number;
  /** Continuous: idle-poll for new features instead of draining once. */
  continuous: boolean;
  /** Global output-token ceiling across all features. */
  maxCostTokens?: number;
  /** Wall-clock ceiling in seconds. */
  maxRuntimeSeconds?: number;
  /** Idle poll interval in seconds (continuous mode). Default 5. */
  idlePollSeconds?: number;
  /** Stop after this many consecutive empty polls (continuous mode). */
  maxIdlePolls?: number;
}

/** Parse the value of a named flag (e.g. `--max-items 5`) from an argv array. */
function flagValue(argv: string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx >= argv.length - 1) return null;
  const val = argv[idx + 1];
  if (!val || val.startsWith('--')) return null;
  return val;
}

/** Parse an integer flag, or return `fallback` when the flag is absent/blank. */
function intFlag(argv: string[], flag: string, fallback?: number): number | undefined {
  const raw = flagValue(argv, flag);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Parse `process.argv` into a DaemonCommandOptions descriptor, or return null
 * when argv[2] is not `daemon` (so the caller falls through to the normal CLI).
 *
 * argv is process.argv: [node, entry, sub, ...rest].
 */
export function detectDaemonCommand(argv: string[]): DaemonCommandOptions | null {
  if (argv[2] !== 'daemon') return null;

  return {
    concurrency: intFlag(argv, '--concurrency', 1) ?? 1,
    maxItems: intFlag(argv, '--max-items'),
    continuous: argv.includes('--continuous'),
    maxCostTokens: intFlag(argv, '--max-cost'),
    maxRuntimeSeconds: intFlag(argv, '--max-runtime'),
    // Mirrors the former flag's default of 5 (commander applied it eagerly).
    idlePollSeconds: intFlag(argv, '--idle-poll', 5),
    maxIdlePolls: intFlag(argv, '--max-idle-polls'),
  };
}
