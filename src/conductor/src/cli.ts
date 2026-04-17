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
    .option('--tail-lines <n>', 'Max lines to show in post-step tail pane (0 disables)', '20');
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
  };

  const hasStateFlag =
    result.resume ||
    result.status ||
    result.cleanup ||
    result.reset ||
    !!result.step ||
    !!result.from;
  if (!result.featureDesc && !hasStateFlag) {
    throw new Error('Feature description is required when no state flags are provided');
  }

  return result;
}
