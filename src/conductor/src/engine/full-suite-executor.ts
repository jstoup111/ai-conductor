import { execa } from 'execa';
import { constants as osConstants } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestSuiteConfig } from '../types/config.js';

export const DEFAULT_FULL_SUITE_TIMEOUT_MS = 30 * 60 * 1_000;
const FULL_SUITE_TERMINATION_GRACE_MS = 100;

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

export type FullSuiteWindowsTaskkill = (args: string[]) => Promise<void>;

export interface FullSuiteProcessTreeCleanupDependencies {
  platform?: NodeJS.Platform;
  runWindowsTaskkill?: FullSuiteWindowsTaskkill;
  wait?: (milliseconds: number) => Promise<void>;
  isProcessAlive?: (pid: number) => boolean;
}

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
      reason: 'timeout';
      exitCode: null;
      signal: null;
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
  /** Test seam for deterministic platform dispatch without a Windows runner. */
  processTreeCleanup?: FullSuiteProcessTreeCleanupDependencies;
}

async function runFullSuiteCommand(
  command: string,
  options: FullSuiteCommandRunnerOptions,
  cleanup: FullSuiteProcessTreeCleanupDependencies = {},
): Promise<FullSuiteCommandSuccess> {
  const platform = cleanup.platform ?? process.platform;
  const subprocess = execa(command, {
    cwd: options.cwd,
    env: options.env,
    extendEnv: false,
    shell: options.shell,
    detached: platform !== 'win32',
  });
  let timedOut = false;
  let cleanupPromise: Promise<void> | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    cleanupPromise = terminateProcessTree(
      subprocess.pid,
      (signal) => subprocess.kill(signal),
      cleanup,
    );
    void cleanupPromise.catch(() => undefined);
  }, options.timeoutMs);
  try {
    const result = await subprocess;
    if (timedOut) {
      await cleanupPromise;
      throw Object.assign(new Error('Full-suite command exceeded its timeout'), {
        timedOut: true,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    await cleanupPromise;
    if (timedOut && typeof error === 'object' && error !== null) {
      Object.assign(error, { timedOut: true });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

function signalPosixProcessTree(
  pid: number | undefined,
  killDirectProcess: (signal: NodeJS.Signals) => boolean,
  signal: NodeJS.Signals,
): void {
  try {
    if (pid !== undefined) {
      process.kill(-pid, signal);
    } else {
      killDirectProcess(signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function runWindowsTaskkill(args: string[]): Promise<void> {
  await execa('taskkill', args);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    throw error;
  }
}

function cleanupFailureMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'unknown taskkill failure';
}

function killDirectProcessSafely(
  killDirectProcess: (signal: NodeJS.Signals) => boolean,
): void {
  try {
    killDirectProcess('SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function terminateWindowsProcessTree(
  pid: number | undefined,
  killDirectProcess: (signal: NodeJS.Signals) => boolean,
  dependencies: FullSuiteProcessTreeCleanupDependencies,
): Promise<void> {
  if (pid === undefined) {
    killDirectProcessSafely(killDirectProcess);
    throw new Error('Windows process-tree cleanup failed: process ID unavailable');
  }
  const taskkill = dependencies.runWindowsTaskkill ?? runWindowsTaskkill;
  const wait = dependencies.wait ?? delay;
  const processAlive = dependencies.isProcessAlive ?? isProcessAlive;
  let forceRequired = false;
  try {
    await taskkill(['/PID', String(pid), '/T']);
  } catch {
    forceRequired = true;
  }
  if (!forceRequired) {
    await wait(FULL_SUITE_TERMINATION_GRACE_MS);
    forceRequired = processAlive(pid);
  }
  if (!forceRequired) return;
  try {
    await taskkill(['/PID', String(pid), '/T', '/F']);
  } catch (error) {
    killDirectProcessSafely(killDirectProcess);
    throw new Error(
      `Windows process-tree cleanup failed: ${cleanupFailureMessage(error)}`,
    );
  }
}

async function terminateProcessTree(
  pid: number | undefined,
  killDirectProcess: (signal: NodeJS.Signals) => boolean,
  dependencies: FullSuiteProcessTreeCleanupDependencies,
): Promise<void> {
  if ((dependencies.platform ?? process.platform) === 'win32') {
    return terminateWindowsProcessTree(pid, killDirectProcess, dependencies);
  }
  signalPosixProcessTree(pid, killDirectProcess, 'SIGTERM');
  await (dependencies.wait ?? delay)(FULL_SUITE_TERMINATION_GRACE_MS);
  signalPosixProcessTree(pid, killDirectProcess, 'SIGKILL');
}

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
  if (error.timedOut === true) {
    return { reason: 'timeout', exitCode: null, signal: null };
  }
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
    runner: configuredRunner,
    clock = () => new Date(),
    processTreeCleanup,
  } = options;
  const runner = configuredRunner ?? (
    (command, runnerOptions) => runFullSuiteCommand(
      command,
      runnerOptions,
      processTreeCleanup,
    )
  );
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
