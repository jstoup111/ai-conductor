import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
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
  workingDirectory?: string;
  runner?: ScopedRunRunner;
  loadProjectConfig?: (projectRoot: string) => Promise<ConfigResult>;
  fileExists?: (path: string) => boolean;
  print?: (message: string) => void;
}

function makeProductionRunner(fallbackCwd: string): ScopedRunRunner {
  return async (command, { signal, cwd }) => {
    const result = await execa(command, {
      cwd: cwd ?? fallbackCwd,
      shell: true,
      reject: false,
      cancelSignal: signal,
    });
    return result.exitCode ?? 1;
  };
}

/**
 * The scoped command runs in `test_suite.working_directory`, but callers name
 * selectors the way the repository does — relative to the project root. Rebase
 * a selector onto the working directory when it only resolves from the root, so
 * a monorepo runner receives a path it can actually open. Anything else (flags,
 * name patterns, paths that already resolve from the working directory) passes
 * through untouched.
 */
function rebaseSelector(
  selector: string,
  projectRoot: string,
  cwd: string,
  fileExists: (path: string) => boolean,
): string {
  if (selector.startsWith('-') || isAbsolute(selector)) return selector;
  if (fileExists(resolve(cwd, selector))) return selector;
  const fromRoot = resolve(projectRoot, selector);
  if (!fileExists(fromRoot)) return selector;
  const rebased = relative(cwd, fromRoot);
  return rebased === '' ? selector : rebased;
}

export async function dispatchScopedRunCommand(
  command: ScopedRunDispatch,
  dependencies: ScopedRunDispatchDependencies = {},
): Promise<number> {
  const projectRoot = dependencies.projectRoot ?? process.cwd();
  const print = dependencies.print ?? console.error;
  const fileExists = dependencies.fileExists ?? existsSync;
  let template = dependencies.template;
  let workingDirectory = dependencies.workingDirectory;

  if (template === undefined) {
    const config = await (dependencies.loadProjectConfig ?? loadConfig)(projectRoot);
    if (!config.ok) {
      print(`scoped-run: ${config.error.message}`);
      return 1;
    }
    template = template ?? config.config.test_suite?.scoped_command;
    workingDirectory = workingDirectory ?? config.config.test_suite?.working_directory;
  }

  if (template === undefined) {
    print('scoped-run: unavailable; configure test_suite.scoped_command.');
    return 1;
  }

  const cwd = resolve(projectRoot, workingDirectory ?? '.');

  const result = await runScopedCommand({
    template,
    selectors: command.selectors.map(
      (selector) => rebaseSelector(selector, projectRoot, cwd, fileExists),
    ),
    cwd,
    runner: dependencies.runner ?? makeProductionRunner(cwd),
  });
  print(result.message);
  return result.exitCode;
}
