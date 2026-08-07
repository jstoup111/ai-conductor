import { execa } from 'execa';
import { loadConfig, type ConfigResult } from './config.js';
import {
  runScopedCommand,
  type ScopedRunRunner,
} from './scoped-run.js';

export interface ScopedRunDispatch {
  kind: 'run';
  selectors: string[];
}

export function detectScopedRunCommand(argv: string[]): ScopedRunDispatch | null {
  if (argv[2] !== 'scoped-run') return null;
  return { kind: 'run', selectors: argv.slice(3) };
}

export interface ScopedRunDispatchDependencies {
  projectRoot?: string;
  template?: string;
  runner?: ScopedRunRunner;
  loadProjectConfig?: (projectRoot: string) => Promise<ConfigResult>;
  print?: (message: string) => void;
}

function makeProductionRunner(projectRoot: string): ScopedRunRunner {
  return async (command, { signal }) => {
    const result = await execa(command, {
      cwd: projectRoot,
      shell: true,
      reject: false,
      cancelSignal: signal,
    });
    return result.exitCode ?? 1;
  };
}

export async function dispatchScopedRunCommand(
  command: ScopedRunDispatch,
  dependencies: ScopedRunDispatchDependencies = {},
): Promise<number> {
  const projectRoot = dependencies.projectRoot ?? process.cwd();
  const print = dependencies.print ?? console.error;
  let template = dependencies.template;

  if (template === undefined) {
    const config = await (dependencies.loadProjectConfig ?? loadConfig)(projectRoot);
    if (!config.ok) {
      print(`scoped-run: ${config.error.message}`);
      return 1;
    }
    template = config.config.test_suite?.scoped_command;
  }

  if (template === undefined) {
    print('scoped-run: unavailable; configure test_suite.scoped_command.');
    return 1;
  }

  const result = await runScopedCommand({
    template,
    selectors: command.selectors,
    runner: dependencies.runner ?? makeProductionRunner(projectRoot),
  });
  print(result.message);
  return result.exitCode;
}
