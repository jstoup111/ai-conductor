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
}

// Daemon mode (Phase 6) is its own subcommand (`conduct daemon …`), parsed by
// detectDaemonCommand in engine/daemon-command.ts and dispatched from index.ts
// before the interactive pipeline boots — NOT a flag on the base program. See
// DaemonCommandOptions there for the daemon's own options.

// Base program: the bare-positional pipeline invocation (`conduct [feature]`)
// plus all its flags. parseArgs uses THIS so a bare feature description is never
// mistaken for an unknown subcommand. createProgram() layers the registry
// subcommands on top for the discoverable CLI surface / --help.
function createBaseProgram(): Command {
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
    .option('--report', 'Print run summary from .pipeline/events.jsonl (step durations, retry hotspots, token spend) and exit');
  return program;
}

export function createProgram(): Command {
  const program = createBaseProgram();

  // Registry subcommands (Phase 9.2). These are NON-INTERACTIVE: they run to
  // completion and exit, rather than entering the interactive pipeline. The
  // actual dispatch happens in index.ts (detectRegistryCommand) before the
  // pipeline boots; these declarations exist so `--help` lists them and so the
  // CLI surface is discoverable via createProgram().commands.
  program
    .command('register [path]')
    .description('Register an existing git repository in the project registry (~/.ai-conductor/registry.json)');
  program
    .command('create <name>')
    .description('Scaffold a new project (git init + skeleton CLAUDE.md + .gitignore) and register it')
    .option('--remote <url>', 'Add an origin remote (add-only, no push)');

  // Engineer subcommand (Phase 9.3). NON-INTERACTIVE: dispatched by index.ts
  // (detectEngineerCommand) before the pipeline boots. Loop body wired in task-33/34.
  program
    .command('engineer')
    .description('Start the supervisor engineer: route ideas to projects, author spec branches, and surface flywheel lessons');

  // Daemon subcommand (Phase 6; promoted from the `--daemon` flag). NON-INTERACTIVE:
  // dispatched by index.ts (detectDaemonCommand) before the pipeline boots. Declared
  // here only so `--help` lists it and its options alongside the other subcommands.
  program
    .command('daemon')
    .description('Daemon mode: drain the backlog of features with existing stories+plan, each in its own worktree, opening a PR on finish')
    .option('--concurrency <n>', 'Parallel workers in daemon mode', '1')
    .option('--max-items <n>', 'Stop daemon after this many features (default: drain backlog once)')
    .option('--continuous', 'Keep idle-polling for new features instead of draining once and exiting (honors --max-* ceilings)')
    .option('--max-cost <tokens>', 'Ceiling: stop starting features after this many total output tokens')
    .option('--max-runtime <seconds>', 'Ceiling: stop starting features after this much wall-clock time')
    .option('--idle-poll <seconds>', 'Continuous mode: seconds to wait between polls when the backlog is empty', '5')
    .option('--max-idle-polls <n>', 'Continuous mode: stop after this many consecutive empty polls');

  return program;
}

export function parseArgs(argv: string[]): CLIOptions {
  const program = createBaseProgram();
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
