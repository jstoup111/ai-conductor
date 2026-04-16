import { Command } from 'commander';

export interface CLIOptions {
  featureDesc?: string;
  resume: boolean;
  auto: boolean;
  status: boolean;
  from?: string;
  cleanup: boolean;
  step?: string;
  reset: boolean;
  output: boolean;
  cooldown: number;
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('conduct')
    .description('Orchestrate SDLC pipeline')
    .argument('[feature]', 'Feature description')
    .option('--resume', 'Resume from last state')
    .option('--auto', 'Auto mode (skip checkpoints)')
    .option('--status', 'Show dashboard only')
    .option('--from <step>', 'Start from specific step')
    .option('--cleanup', 'Clean up worktrees')
    .option('--step <step>', 'Run single step')
    .option('--reset', 'Clear state')
    .option('--output', 'Raw output mode')
    .option('--cooldown <seconds>', 'Cooldown between steps in seconds', '10');
  return program;
}

export function parseArgs(argv: string[]): CLIOptions {
  const program = createProgram();
  program.exitOverride();
  program.parse(argv);

  const opts = program.opts();
  const featureDesc = program.args[0];

  const result: CLIOptions = {
    featureDesc,
    resume: opts.resume ?? false,
    auto: opts.auto ?? false,
    status: opts.status ?? false,
    from: opts.from,
    cleanup: opts.cleanup ?? false,
    step: opts.step,
    reset: opts.reset ?? false,
    output: opts.output ?? false,
    cooldown: parseInt(opts.cooldown ?? '10', 10),
  };

  const hasStateFlag = result.resume || result.status || result.cleanup || result.reset || !!result.step;
  if (!result.featureDesc && !hasStateFlag) {
    throw new Error('Feature description is required when no state flags are provided');
  }

  return result;
}
