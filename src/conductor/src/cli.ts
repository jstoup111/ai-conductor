import { Command } from 'commander';
import type { ViewMode } from './ui/types.js';

export interface CLIOptions {
  featureDesc?: string;
  resume: boolean;
  fresh: boolean;
  auto: boolean;
  status: boolean;
  from?: string;
  cleanup: boolean;
  step?: string;
  reset: boolean;
  output: boolean;
  cooldown: number;
  /**
   * Claude model override applied to every step. Overrides config and defaults.
   * Useful for testing ("--model haiku") or forcing a specific model across the board.
   */
  model?: string;
  /** Dashboard layout: full (default), focus (current step + tail), log (tail only). */
  view: ViewMode;
  /** Max lines of last-step stdout to display. 0 disables the tail pane. */
  tailLines: number;
  /** Run every step in interactive Claude REPL mode (no -p flag). */
  interactive: boolean;
  /**
   * Non-mutating diagnostic. Loads state for the named (or auto-detected)
   * feature, re-verifies the SHIP-phase completion predicates, and prints
   * any inconsistencies. Exits 0 when state is consistent, 1 when state
   * is marked complete but evidence is missing. Never modifies anything.
   */
  diagnose: boolean;
  /**
   * Print run summary from .pipeline/events.jsonl and exit.
   * Renders step durations, retry hotspots, and token spend tables.
   * Read-only — does NOT start a Claude session.
   */
  report: boolean;
  /**
   * Daemon mode (Phase 6): drain the backlog of features with existing
   * stories+plan, running each in its own worktree via the gate loop and
   * opening a PR on finish. Runs unattended.
   */
  daemon: boolean;
  /** Parallel worker count in daemon mode (default 1). */
  concurrency: number;
  /** Stop daemon after this many features (default: drain the backlog once). */
  maxItems?: number;
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('conduct')
    .description('Orchestrate SDLC pipeline')
    .argument('[feature]', 'Feature description')
    .option('--resume', 'Resume from last state')
    .option('--fresh', 'Start a new feature; skip auto-resume even if a worktree for this feature description already exists')
    .option('--auto', 'Auto mode (skip checkpoints)')
    .option('--status', 'Show dashboard only')
    .option('--from <step>', 'Start from specific step')
    .option('--cleanup', 'Clean up worktrees')
    .option('--step <step>', 'Run single step')
    .option('--reset', 'Clear state')
    .option('--output', 'Raw output mode')
    .option('--cooldown <seconds>', 'Cooldown between steps in seconds', '10')
    .option('--model <name>', 'Override Claude model for every step (e.g. haiku, sonnet, opus, or full model ID)')
    .option('--view <mode>', 'Dashboard layout: full | focus | log', 'full')
    .option('--tail-lines <n>', 'Max lines to show in post-step tail pane (0 disables)', '20')
    .option('--interactive', 'Run every step in interactive Claude REPL mode (no -p flag)')
    .option('--diagnose', 'Diagnose conductor state (non-mutating); reports SHIP-phase evidence gaps and exits non-zero if state is marked complete but evidence is missing')
    .option('--report', 'Print run summary from .pipeline/events.jsonl (step durations, retry hotspots, token spend) and exit')
    .option('--daemon', 'Daemon mode: drain the backlog of features with existing stories+plan, each in its own worktree, opening a PR on finish')
    .option('--concurrency <n>', 'Parallel workers in daemon mode', '1')
    .option('--max-items <n>', 'Stop daemon after this many features (default: drain backlog once)');
  return program;
}

export function parseArgs(argv: string[]): CLIOptions {
  const program = createProgram();
  program.exitOverride();
  program.parse(argv);

  const opts = program.opts();
  const featureDesc = program.args[0];

  const view: ViewMode =
    opts.view === 'focus' || opts.view === 'log' ? opts.view : 'full';

  const result: CLIOptions = {
    featureDesc,
    resume: opts.resume ?? false,
    fresh: opts.fresh ?? false,
    auto: opts.auto ?? false,
    status: opts.status ?? false,
    from: opts.from,
    cleanup: opts.cleanup ?? false,
    step: opts.step,
    reset: opts.reset ?? false,
    output: opts.output ?? false,
    cooldown: parseInt(opts.cooldown ?? '10', 10),
    model: opts.model,
    view,
    tailLines: parseInt(opts.tailLines ?? '20', 10),
    interactive: opts.interactive ?? false,
    diagnose: opts.diagnose ?? false,
    report: opts.report ?? false,
    daemon: opts.daemon ?? false,
    concurrency: parseInt(opts.concurrency ?? '1', 10),
    maxItems: opts.maxItems != null ? parseInt(opts.maxItems, 10) : undefined,
  };

  const hasStateFlag =
    result.resume ||
    result.status ||
    result.cleanup ||
    result.reset ||
    result.diagnose ||
    result.report ||
    !!result.step ||
    !!result.from;
  if (!result.featureDesc && !hasStateFlag) {
    throw new Error('Feature description is required when no state flags are provided');
  }

  return result;
}
