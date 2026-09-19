import { execa } from 'execa';
import { join } from 'node:path';
import { resolveHarnessRoot } from './install-freshness.js';

export interface UpdateCommand {
  args: string[];
}

/** Detect the explicit update subcommand before normal CLI bootstrapping. */
export function detectUpdateCommand(argv: string[]): UpdateCommand | null {
  return argv[2] === 'update' ? { args: argv.slice(3) } : null;
}

/** Runs the updater at `path` with `args`, resolving to its process exit code. */
export interface UpdateRunner {
  (path: string, args: string[]): Promise<number>;
}

export const realUpdateRunner: UpdateRunner = async (path, args) => {
  const result = await execa(path, args, { stdio: 'inherit', reject: false });
  return result.exitCode ?? 1;
};

export interface DispatchUpdateCommandOptions {
  /** Override harness-root discovery (tests). Defaults to resolveHarnessRoot. */
  harnessRoot?: string | null;
  /** Override the subprocess runner (tests). Defaults to a real `execa` spawn. */
  runner?: UpdateRunner;
}

/** Dispatch an explicit update command to the harness checkout's updater. */
export async function dispatchUpdateCommand(
  command: UpdateCommand,
  opts: DispatchUpdateCommandOptions = {},
): Promise<number> {
  const harnessRoot =
    opts.harnessRoot !== undefined ? opts.harnessRoot : await resolveHarnessRoot();
  const runner = opts.runner ?? realUpdateRunner;
  return runner(join(harnessRoot as string, 'bin', 'update'), command.args);
}
