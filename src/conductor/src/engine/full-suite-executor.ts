import { execa } from 'execa';
import { resolve } from 'node:path';
import type { TestSuiteConfig } from '../types/config.js';

export const DEFAULT_FULL_SUITE_TIMEOUT_MS = 30 * 60 * 1_000;

export interface FullSuiteCommandRunnerOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: true;
  timeoutMs: number;
}

export interface FullSuiteCommandSuccess {
  exitCode: 0;
  stdout: string;
  stderr: string;
}

export type FullSuiteCommandRunner = (
  command: string,
  options: FullSuiteCommandRunnerOptions,
) => Promise<FullSuiteCommandSuccess>;

export interface FullSuiteExecutionSuccess extends FullSuiteCommandSuccess {
  ok: true;
  command: string;
  cwd: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface ExecuteFullSuiteOptions {
  projectRoot: string;
  testSuite: TestSuiteConfig;
  environment?: NodeJS.ProcessEnv;
  runner?: FullSuiteCommandRunner;
  clock?: () => Date;
}

async function runFullSuiteCommand(
  command: string,
  options: FullSuiteCommandRunnerOptions,
): Promise<FullSuiteCommandSuccess> {
  const result = await execa(command, {
    cwd: options.cwd,
    env: options.env,
    extendEnv: false,
    shell: options.shell,
    timeout: options.timeoutMs,
  });
  return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
}

export async function executeFullSuite(
  options: ExecuteFullSuiteOptions,
): Promise<FullSuiteExecutionSuccess> {
  const {
    projectRoot,
    testSuite,
    environment = process.env,
    runner = runFullSuiteCommand,
    clock = () => new Date(),
  } = options;
  const cwd = resolve(projectRoot, testSuite.working_directory ?? '.');
  const timeoutMs = testSuite.timeout_seconds === undefined
    ? DEFAULT_FULL_SUITE_TIMEOUT_MS
    : testSuite.timeout_seconds * 1_000;
  const started = clock();
  const result = await runner(testSuite.command, {
    cwd,
    env: environment,
    shell: true,
    timeoutMs,
  });
  const ended = clock();

  return {
    ok: true,
    command: testSuite.command,
    cwd,
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
    durationMs: ended.getTime() - started.getTime(),
    ...result,
  };
}
