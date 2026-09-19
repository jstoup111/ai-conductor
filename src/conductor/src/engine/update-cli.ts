import { execa } from 'execa';
import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessRootProbeCandidates, resolveHarnessRoot } from './install-freshness.js';

const pathExists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (metadata) => metadata.isDirectory(),
    () => false,
  );
}

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
  /** Diagnostic sink (defaults to stderr). */
  log?: (message: string) => void;
}

/** Dispatch an explicit update command to the harness checkout's updater. */
export async function dispatchUpdateCommand(
  command: UpdateCommand,
  opts: DispatchUpdateCommandOptions = {},
): Promise<number> {
  const harnessRoot =
    opts.harnessRoot !== undefined ? opts.harnessRoot : await resolveHarnessRoot();
  const log = opts.log ?? ((message: string) => console.error(message));

  if (!harnessRoot) {
    log(
      `update: could not locate the harness root; probed: ${harnessRootProbeCandidates.join(', ')}`,
    );
    return 1;
  }

  const updaterPath = join(harnessRoot, 'bin', 'update');
  if (!(await pathExists(updaterPath))) {
    log(`update: updater does not exist: ${updaterPath}`);
    return 1;
  }

  if (!(await isDirectory(join(harnessRoot, '.git')))) {
    log(`update: ${harnessRoot} is not a git checkout.`);
    return 1;
  }

  const runner = opts.runner ?? realUpdateRunner;
  return runner(updaterPath, command.args);
}
