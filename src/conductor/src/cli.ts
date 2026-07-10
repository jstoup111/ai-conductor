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

// The inline-pipeline option surface. Shared by the base program (used by
// parseArgs) and the `inline` subcommand declaration (used for --help) so the two
// never drift. A bare `[feature]` positional plus all pipeline flags.
function applyPipelineOptions(cmd: Command): Command {
  return cmd
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
}

// Base program: parses the inline-pipeline args AFTER the `inline` subcommand
// token has been stripped (see detectInline). It carries the flags but no
// subcommands, so a feature description is never mistaken for an unknown command.
function createBaseProgram(): Command {
  const program = new Command();
  program.name('conduct').description('Orchestrate SDLC pipeline');
  return applyPipelineOptions(program);
}

/**
 * The inline pipeline now runs under an explicit `inline` subcommand
 * (`conduct inline "<feature>"`), not as a bare positional. detectInline strips
 * that token so parseArgs sees just the feature + flags.
 *
 * @returns isInline=true and the argv with `inline` removed when argv[2] is
 *   `inline`; otherwise isInline=false and argv unchanged.
 */
export function detectInline(argv: string[]): { isInline: boolean; rest: string[] } {
  if (argv[2] === 'inline') {
    return { isInline: true, rest: [argv[0], argv[1], ...argv.slice(3)] };
  }
  return { isInline: false, rest: argv };
}

export function createProgram(): Command {
  const program = createBaseProgram();

  // Inline pipeline subcommand. This is the DEFAULT mode — running the SDLC
  // pipeline in the foreground (`conduct inline "<feature>"`), the counterpart to
  // the background `daemon`. Dispatched in index.ts (detectInline) before the
  // pipeline boots; declared here with the full pipeline option surface so
  // `--help` and `conduct inline --help` list it.
  applyPipelineOptions(
    program
      .command('inline')
      .description('Run the SDLC pipeline inline, in the foreground (the default mode)'),
  );

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

  // Engineer subcommands (Phase 9.3). NON-INTERACTIVE: dispatched by index.ts
  // (detectEngineerCommand) before the pipeline boots. Bare `engineer` launches the
  // interactive idea→spec loop; the rest are the deterministic primitives the
  // /engineer skill calls. Declared with their options so the full --help reference
  // documents them.
  const engineer = program
    .command('engineer')
    .description('Supervisor engineer: launch the interactive idea→spec loop (run bare), or call a primitive below');
  engineer
    .command('projects')
    .description('List registered projects as JSON (name, path, description, tags)');
  engineer
    .command('land')
    .description('Commit the already-authored .docs spec artifacts onto a spec/<slug> branch')
    .option('--project <name>', 'Target project name (resolved from the registry)')
    .option('--idea <idea>', 'The idea/spec being landed (slug + commit message)');
  engineer
    .command('handoff')
    .description('Open the spec PR (local-commit fallback when no remote) and nudge the target daemon')
    .option('--project <name>', 'Target project name (resolved from the registry)')
    .option('--branch <branch>', 'The spec/<slug> branch produced by `engineer land`');

  // Task subcommand (Task 7). NON-INTERACTIVE: dispatched by index.ts
  // (detectTaskCommand) before the pipeline boots. Routes to task start/done
  // operations. Declared here so `--help` lists it.
  program
    .command('task <command> <id>')
    .description('Manage task execution: task start <id> | task done <id>')
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  conduct task start 7               Start task 7 (flip status to in_progress)\n' +
        '  conduct task done 7                Mark task 7 done (clear stamp file)\n' +
        '  conduct task start rem-fr10-1      Start task with alphanumeric id\n',
    );

  // Evidence subcommand (Task 19). NON-INTERACTIVE: dispatched by index.ts
  // (detectEvidenceCommand) before the pipeline boots. Routes to evidence judge
  // command. Declared here so `--help` lists it.
  const evidence = program
    .command('evidence')
    .description('Semantic attribution evidence gate: resolve features to worktrees and judge completeness');
  evidence
    .command('judge <slug>')
    .description('Resolve feature slug to worktree and run semantic attribution verification');

  // Halt-issues subcommand (halt-monitor filed issues sweep). NON-INTERACTIVE:
  // dispatched by index.ts before the pipeline boots. Orchestrates the sweep
  // pipeline for processing filed halt-monitor issues. Declared here so `--help`
  // lists it and its options alongside the other subcommands.
  program
    .command('halt-issues')
    .description('Orchestrate halt-monitor filed issues processing')
    .command('sweep')
    .description('Parse, stamp, resolve, and close halt-monitor filed issues')
    .option('--dry-run', 'Run without writing to ledger')
    .option('--repo-dir <dir>', 'Repository directory (target for file searches)')
    .option('--monitor-log <path>', 'Path to monitor.log file')
    .option('--ledger <path>', 'Path to ledger.json file')
    .option('--gh-repo <repo>', 'GitHub repository (owner/name)');

  // Daemon subcommand (Phase 6; promoted from the `--daemon` flag). NON-INTERACTIVE:
  // dispatched by index.ts before the pipeline boots. The bare `daemon` RUNS the
  // daemon (detectDaemonCommand); `daemon status` / `daemon logs` are read-only
  // observability sub-subcommands (detectDaemonObserveCommand). Declared here so
  // `--help` lists them and their options alongside the other subcommands.
  const daemon = program
    .command('daemon')
    .description('Daemon mode: drain the backlog of features with existing stories+plan, each in its own worktree, opening a PR on finish')
    .option('--concurrency <n>', 'Parallel workers in daemon mode', '1')
    .option('--max-items <n>', 'Stop daemon after this many features (default: drain backlog once)')
    .option('--continuous', 'Keep idle-polling for new features instead of draining once and exiting (honors --max-* ceilings)')
    .option('--max-cost <tokens>', 'Ceiling: stop starting features after this many total output tokens')
    .option('--max-runtime <seconds>', 'Ceiling: stop starting features after this much wall-clock time')
    .option('--idle-poll <seconds>', 'Continuous mode: seconds to wait between polls when the backlog is empty', '5')
    .option('--max-idle-polls <n>', 'Continuous mode: stop after this many consecutive empty polls');
  // Read-only observability sub-subcommands.
  daemon
    .command('status')
    .description('Show each registered repo\'s daemon liveness (running/stale/stopped) and last activity');
  daemon
    .command('logs')
    .description('Print or follow a repo\'s .daemon/daemon.log')
    .option('--repo <path>', 'Target repo (default: current directory)')
    .option('--follow', 'Stream new log lines (tail -f); single repo only')
    .option('--all', 'Show logs for every registered repo');
  // Filesystem-direct, pre-boot park/unpark verbs (detectDaemonParkCommand) —
  // no daemon/supervisor startup required. Declared here ONLY so `--help`
  // documents them; commander never actually dispatches them (index.ts checks
  // detectDaemonParkCommand before the pipeline boots).
  daemon
    .command('park <slug>')
    .description('Halt this feature: it will not be dispatched or re-kicked until unparked');
  daemon
    .command('unpark <slug>')
    .description('Resume dispatch and re-kick for this feature');
  // Management verbs — route to the tmux Supervisor port (detectDaemonSupervisorCommand),
  // dispatched in index.ts before the pipeline boots. Declared here ONLY so `--help`
  // documents them; commander never actually dispatches them.
  daemon
    .command('start')
    .description('Start the tmux-supervised daemon for this repo; auto-attaches read-only unless -D')
    .option('-D, --detach', 'Start detached: do not auto-attach to the tmux session (default attaches when interactive)');
  daemon
    .command('stop')
    .description('Stop this repo\'s tmux-supervised daemon');
  daemon
    .command('restart')
    .description('Restart this repo\'s tmux-supervised daemon');
  daemon
    .command('connect')
    .description('Attach READ-ONLY to this repo\'s daemon tmux session (Ctrl-b d to detach)');
  daemon
    .command('debug')
    .description('Attach READ-WRITE to this repo\'s daemon tmux session (Ctrl-b d to detach)');

  return program;
}

/**
 * Render a SINGLE, root-level help document that recurses through every command
 * and sub-subcommand — so `conduct --help` is a complete reference (each command's
 * options + nested subcommands), not just a top-level name list. Commander only
 * renders one level per `helpInformation()`; this walks the tree depth-first and
 * appends a titled section per command (skipping the auto-generated `help`).
 */
export function renderFullHelp(program: Command = createProgram()): string {
  const sections: string[] = [program.helpInformation().trimEnd()];
  const rule = '─'.repeat(72);

  const walk = (cmd: Command, path: string[]): void => {
    for (const sub of cmd.commands) {
      if (sub.name() === 'help') continue; // commander's auto `help [command]`
      const fullPath = ['conduct', ...path, sub.name()].join(' ');
      sections.push(`${rule}\n${fullPath}\n${rule}\n${sub.helpInformation().trimEnd()}`);
      walk(sub, [...path, sub.name()]);
    }
  };
  walk(program, []);

  return sections.join('\n\n') + '\n';
}

/**
 * Render help for the `daemon` command subtree only — the run flags plus every
 * sub-verb (status/logs + the tmux management verbs). Used by index.ts to answer
 * `conduct daemon --help` WITHOUT falling through to detectDaemonCommand (which
 * would treat `--help` as an unknown flag and LAUNCH a daemon run).
 */
export function renderDaemonHelp(program: Command = createProgram()): string {
  const daemon = program.commands.find((c) => c.name() === 'daemon');
  if (!daemon) return '';
  const rule = '─'.repeat(72);
  const sections = [daemon.helpInformation().trimEnd()];
  for (const sub of daemon.commands) {
    if (sub.name() === 'help') continue; // commander's auto `help [command]`
    sections.push(
      `${rule}\nconduct daemon ${sub.name()}\n${rule}\n${sub.helpInformation().trimEnd()}`,
    );
  }
  return sections.join('\n\n') + '\n';
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
