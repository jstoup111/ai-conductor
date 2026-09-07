import { spawn } from 'node:child_process';
import type { TautologyScopedRunResult } from './build-review-test-quality-preflight.js';

export interface BuildReviewScopedReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

export interface BuildReviewScopedChild {
  readonly stdout: BuildReviewScopedReadable | null;
  readonly stderr: BuildReviewScopedReadable | null;
  once(event: 'error', listener: () => void): unknown;
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal: NodeJS.Signals): boolean;
}

export type BuildReviewScopedLauncher = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly stdio: readonly ['ignore', 'pipe', 'pipe'] },
) => BuildReviewScopedChild;

export const defaultBuildReviewScopedLauncher: BuildReviewScopedLauncher = (command, args, options) =>
  spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });

/** Bounded time to allow a terminated scoped command to close before SIGKILL. */
export const BUILD_REVIEW_SCOPED_KILL_GRACE_MS = 5_000;

export interface BuildReviewScopedEscalationScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const defaultBuildReviewScopedEscalationScheduler: BuildReviewScopedEscalationScheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
    return timer;
  },
  cancel(handle) {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

export interface BuildReviewScopedRunOptions {
  readonly template?: string | null;
  readonly selectors: readonly string[];
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly launcher?: BuildReviewScopedLauncher;
  readonly escalationScheduler?: BuildReviewScopedEscalationScheduler;
}

export function runBuildReviewScopedCommand({
  template,
  selectors,
  cwd,
  signal,
  launcher = defaultBuildReviewScopedLauncher,
  escalationScheduler = defaultBuildReviewScopedEscalationScheduler,
}: BuildReviewScopedRunOptions): Promise<TautologyScopedRunResult> {
  if (signal.aborted) return Promise.resolve({ kind: 'timeout', stdout: '', stderr: '' });
  if (!template || selectors.length === 0) return Promise.resolve({ kind: 'launch-error', stdout: '', stderr: '' });

  const command = template.replace('{selectors}', selectors.map((selector) => JSON.stringify(selector)).join(' '));
  return new Promise<TautologyScopedRunResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let escalationHandle: unknown;
    const child = launcher('sh', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (value: TautologyScopedRunResult) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', () => {
      if (!timedOut) finish({ kind: 'launch-error', stdout, stderr });
    });
    child.once('close', (code, receivedSignal) => {
      if (timedOut) {
        escalationScheduler.cancel(escalationHandle);
        finish({ kind: 'timeout', stdout, stderr });
      } else if (receivedSignal) finish({ kind: 'signal', signal: receivedSignal, stdout, stderr });
      else if (code === 0) finish({ exitCode: 0, stdout, stderr });
      else finish({ kind: 'nonzero-exit', exitCode: code ?? 1, stdout, stderr });
    });
    signal.addEventListener('abort', () => {
      if (settled) return;
      timedOut = true;
      escalationHandle = escalationScheduler.schedule(() => {
        if (settled) return;
        child.kill('SIGKILL');
        finish({ kind: 'timeout', stdout, stderr });
      }, BUILD_REVIEW_SCOPED_KILL_GRACE_MS);
      child.kill('SIGTERM');
    }, { once: true });
  });
}
