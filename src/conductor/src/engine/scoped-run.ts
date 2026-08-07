export interface ScopedRunRunnerOptions {
  signal: AbortSignal;
}

export type ScopedRunRunner = (
  command: string,
  options: ScopedRunRunnerOptions,
) => Promise<number>;

export type ScopedRunReason = 'passed' | 'test_failure' | 'launch_failure' | 'timeout';

export interface ScopedRunResult {
  exitCode: number;
  reason: ScopedRunReason;
  message: string;
}

export type ScopedRunTimeoutScheduler = (
  callback: () => void,
  timeoutMs: number,
) => () => void;

export interface ScopedRunCommandOptions {
  template: string;
  selectors: string[];
  runner: ScopedRunRunner;
  timeoutMs?: number;
  scheduleTimeout?: ScopedRunTimeoutScheduler;
}

export async function runScopedCommand({
  template,
  selectors,
  runner,
  timeoutMs,
  scheduleTimeout = (callback, milliseconds) => {
    const timeout = setTimeout(callback, milliseconds);
    return () => clearTimeout(timeout);
  },
}: ScopedRunCommandOptions): Promise<ScopedRunResult> {
  const command = template.replace('{selectors}', selectors.join(' '));
  const controller = new AbortController();
  const run = runner(command, { signal: controller.signal });
  let cancelTimeout: (() => void) | undefined;
  let timedOut = false;

  try {
    const exitCode = timeoutMs === undefined
      ? await run
      : await Promise.race([
        run,
        new Promise<never>((_resolve, reject) => {
          cancelTimeout = scheduleTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error('Scoped test run timed out'));
          }, timeoutMs);
        }),
      ]);
    if (timedOut) {
      return {
        exitCode: 1,
        reason: 'timeout',
        message: `Scoped test run timed out after ${timeoutMs}ms.`,
      };
    }
    if (exitCode === 0) {
      return { exitCode, reason: 'passed', message: 'Selected tests passed.' };
    }
    return {
      exitCode,
      reason: 'test_failure',
      message: `Selected test run failed with exit code ${exitCode}.`,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      await run.catch(() => undefined);
      return {
        exitCode: 1,
        reason: 'timeout',
        message: `Scoped test run timed out after ${timeoutMs}ms.`,
      };
    }
    const code = typeof error === 'object' && error !== null
      ? (error as NodeJS.ErrnoException).code
      : undefined;
    if (code === 'EACCES' || code === 'ENOENT' || code === 'ENOEXEC' || code === 'ENOTDIR' || code === 'EPERM') {
      return {
        exitCode: 1,
        reason: 'launch_failure',
        message: `Unable to launch scoped test command: ${command}`,
      };
    }
    return {
      exitCode: 1,
      reason: 'launch_failure',
      message: `Scoped test command failed before completion: ${command}`,
    };
  } finally {
    cancelTimeout?.();
  }
}
