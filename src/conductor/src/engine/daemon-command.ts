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

// ─────────────────────────────────────────────────────────────────────────────
// DaemonSupervisorCommand — management verbs dispatched to the Supervisor port.
// ─────────────────────────────────────────────────────────────────────────────

/** Management verb dispatched to the Supervisor port (not a daemon run). */
export interface DaemonSupervisorCommand {
  verb: 'start' | 'stop' | 'restart' | 'connect' | 'debug' | 'pause' | 'resume';
  /**
   * `start` only: when true (`-D` / `--detach`), start the daemon and return
   * immediately instead of auto-attaching to its tmux session. Ignored for the
   * other verbs.
   */
  detach?: boolean;
}

const MANAGEMENT_VERBS = new Set([
  'start',
  'stop',
  'restart',
  'connect',
  'debug',
  'pause',
  'resume',
]);

/**
 * Parse `process.argv` into a DaemonSupervisorCommand descriptor, or return
 * null when argv[2] is not `daemon` or argv[3] is not a management verb.
 *
 * `-D` / `--detach` (anywhere after the verb) sets `detach` so `start` skips the
 * auto-attach. The flag is harmless on the other verbs.
 *
 * argv is process.argv: [node, entry, sub, verb, ...rest].
 */
export function detectDaemonSupervisorCommand(argv: string[]): DaemonSupervisorCommand | null {
  if (argv[2] !== 'daemon') return null;
  const verb = argv[3];
  if (!verb || !MANAGEMENT_VERBS.has(verb)) return null;
  const detach = argv.slice(4).some((a) => a === '-D' || a === '--detach');
  // Only attach the flag when set, so callers/tests comparing the bare
  // `{ verb }` shape stay unaffected for the no-flag case.
  return { verb: verb as DaemonSupervisorCommand['verb'], ...(detach ? { detach: true } : {}) };
}

/**
 * Every recognized `daemon` sub-verb: the read-only observability verbs plus the
 * tmux management verbs. A bare `daemon` (no sub-verb) RUNS the daemon; these are
 * the only non-flag tokens that legitimately follow `daemon`.
 */
const DAEMON_SUBVERBS = new Set(['status', 'logs', ...MANAGEMENT_VERBS]);

/**
 * Detect a typo'd / unknown `daemon` sub-verb so the CLI can surface help instead
 * of silently LAUNCHING a daemon run. Returns the offending token when argv is
 * `daemon <token>` and `<token>` is a non-flag word that is not a known sub-verb;
 * otherwise null (a bare `daemon`, `daemon --flags`, or a known sub-verb — all of
 * which are handled by their own dispatchers).
 *
 * argv is process.argv: [node, entry, 'daemon', token, ...rest].
 */
export function detectUnknownDaemonSubcommand(argv: string[]): string | null {
  if (argv[2] !== 'daemon') return null;
  const token = argv[3];
  if (!token || token.startsWith('-')) return null; // bare run or a flag
  return DAEMON_SUBVERBS.has(token) ? null : token;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADR-014 / FR-13 — serial pool enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clamp the requested concurrency to 1 (serial). Real multi-feature concurrency
 * (tmux multi-pane) is out of scope for the current run-loop (ADR-014 / FR-13).
 * Emits a diagnostic via `log` ONCE when the requested value is > 1; silent when
 * requested is 1 or undefined (already serial — nothing to report).
 */
export function clampDaemonConcurrency(
  requested: number | undefined,
  log: (m: string) => void,
): number {
  if (requested === undefined || requested <= 1) return 1;
  log(
    `concurrency clamped to 1 (serial — real concurrency is out of scope; ` +
      `see .docs/plans/2026-06-29-daemon-tmux-supervisor.md)`,
  );
  return 1;
}

/**
 * Parse `process.argv` into a DaemonCommandOptions descriptor, or return null
 * when argv[2] is not `daemon` (so the caller falls through to the normal CLI).
 *
 * argv is process.argv: [node, entry, sub, ...rest].
 */
export function detectDaemonCommand(argv: string[]): DaemonCommandOptions | null {
  if (argv[2] !== 'daemon') return null;
  // `daemon status` / `daemon logs` are read-only observability sub-subcommands
  // (detectDaemonObserveCommand in daemon-observe-cli.ts), NOT a daemon run.
  // `daemon start|stop|restart|connect|debug` are management verbs dispatched to
  // the Supervisor port (detectDaemonSupervisorCommand above), NOT a daemon run.
  // Yield so none of these are ever dispatched as a launch.
  if (argv[3] === 'status' || argv[3] === 'logs') return null;
  if (MANAGEMENT_VERBS.has(argv[3])) return null;

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
