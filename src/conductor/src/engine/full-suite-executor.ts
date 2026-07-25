import { execa } from 'execa';
import { constants as osConstants } from 'node:os';
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

interface FullSuiteExecutionFailureBase {
  ok: false;
  command: string;
  cwd: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
}

type FullSuiteExecutionFailureDetails =
  | {
      reason: 'unlaunchable';
      exitCode: 126 | 127 | null;
      signal: null;
    }
  | {
      reason: 'signal';
      exitCode: null;
      signal: NodeJS.Signals;
    }
  | {
      reason: 'nonzero_exit';
      exitCode: number;
      signal: null;
    }
  | {
      reason: 'internal_error';
      exitCode: null;
      signal: null;
    };

export type FullSuiteExecutionFailure =
  FullSuiteExecutionFailureBase & FullSuiteExecutionFailureDetails;

export type FullSuiteExecutionResult =
  | FullSuiteExecutionSuccess
  | FullSuiteExecutionFailure;

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

const UNLAUNCHABLE_CODES = new Set([
  'EACCES',
  'ENOENT',
  'ENOEXEC',
  'ENOTDIR',
  'EPERM',
]);
const SIGNAL_BY_SHELL_EXIT_CODE = new Map<number, NodeJS.Signals>(
  Object.entries(osConstants.signals).map(([signal, number]) => [
    128 + number,
    signal as NodeJS.Signals,
  ]),
);

function errorRecord(error: unknown): Record<string, unknown> {
  return typeof error === 'object' && error !== null
    ? error as Record<string, unknown>
    : {};
}

function errorOutput(
  error: Record<string, unknown>,
  stream: 'stdout' | 'stderr',
  includeErrorMessage = false,
): string {
  const output = error[stream];
  if (typeof output === 'string' && output.length > 0) return output;
  if (stream !== 'stderr') return '';
  if (typeof error.shortMessage === 'string') return error.shortMessage;
  return includeErrorMessage && typeof error.message === 'string' ? error.message : '';
}

function classifyFailure(
  error: Record<string, unknown>,
): FullSuiteExecutionFailureDetails {
  const signal = typeof error.signal === 'string'
    ? error.signal as NodeJS.Signals
    : null;
  if (signal !== null) return { reason: 'signal', exitCode: null, signal };

  const exitCode = Number.isInteger(error.exitCode) ? error.exitCode as number : null;
  if (typeof error.code === 'string' && UNLAUNCHABLE_CODES.has(error.code)) {
    return {
      reason: 'unlaunchable',
      exitCode: exitCode === 126 || exitCode === 127 ? exitCode : null,
      signal: null,
    };
  }
  if (exitCode === 126 || exitCode === 127) {
    return { reason: 'unlaunchable', exitCode, signal: null };
  }
  const shellSignal = exitCode === null
    ? undefined
    : SIGNAL_BY_SHELL_EXIT_CODE.get(exitCode);
  if (shellSignal !== undefined) {
    return { reason: 'signal', exitCode: null, signal: shellSignal };
  }
  if (exitCode !== null && exitCode !== 0) {
    return { reason: 'nonzero_exit', exitCode, signal: null };
  }
  return { reason: 'internal_error', exitCode: null, signal: null };
}

export async function executeFullSuite(
  options: ExecuteFullSuiteOptions,
): Promise<FullSuiteExecutionResult> {
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
  let result: FullSuiteCommandSuccess;
  try {
    result = await runner(testSuite.command, {
      cwd,
      env: environment,
      shell: true,
      timeoutMs,
    });
  } catch (error) {
    const failure = errorRecord(error);
    if (failure.timedOut === true) throw error;
    const classification = classifyFailure(failure);
    const ended = clock();
    return {
      ok: false,
      ...classification,
      command: testSuite.command,
      cwd,
      startedAt: started.toISOString(),
      endedAt: ended.toISOString(),
      durationMs: ended.getTime() - started.getTime(),
      stdout: errorOutput(failure, 'stdout'),
      stderr: errorOutput(
        failure,
        'stderr',
        classification.reason === 'internal_error',
      ),
    };
  }
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
