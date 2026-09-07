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
  spawn(command, args, options);

export interface BuildReviewScopedRunOptions {
  readonly template?: string | null;
  readonly selectors: readonly string[];
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly launcher?: BuildReviewScopedLauncher;
}

export function runBuildReviewScopedCommand({
  template,
  selectors,
  cwd,
  signal,
  launcher = defaultBuildReviewScopedLauncher,
}: BuildReviewScopedRunOptions): Promise<TautologyScopedRunResult> {
  if (signal.aborted) return Promise.resolve({ kind: 'timeout', stdout: '', stderr: '' });
  if (!template || selectors.length === 0) return Promise.resolve({ kind: 'launch-error', stdout: '', stderr: '' });

  const command = template.replace('{selectors}', selectors.map((selector) => JSON.stringify(selector)).join(' '));
  return new Promise<TautologyScopedRunResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = launcher('sh', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (value: TautologyScopedRunResult) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', () => finish({ kind: 'launch-error', stdout, stderr }));
    child.once('close', (code, receivedSignal) => {
      if (receivedSignal) finish({ kind: 'signal', signal: receivedSignal, stdout, stderr });
      else if (code === 0) finish({ exitCode: 0, stdout, stderr });
      else finish({ kind: 'nonzero-exit', exitCode: code ?? 1, stdout, stderr });
    });
    signal.addEventListener('abort', () => {
      child.kill('SIGTERM');
      finish({ kind: 'timeout', stdout, stderr });
    }, { once: true });
  });
}
