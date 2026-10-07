import { spawn } from 'node:child_process';

import {
  findBuiltInProviderDescriptor,
  resolveProviderExecutable,
} from './provider-catalog.js';
import type { EffortLevel } from '../types/config.js';

export interface InteractiveLaunchRequest {
  readonly provider: string;
  readonly openingPrompt: string;
  readonly cwd: string;
  readonly model?: string;
  readonly effort?: EffortLevel;
}

export interface InteractiveLaunchOptions {
  readonly cwd: string;
  readonly stdio: 'inherit';
}

export interface InteractiveLaunchResult {
  readonly exitCode: number;
}

/** The process boundary is async so callers can mock it without spawning a provider. */
export type InteractiveLaunchProcess = (
  executable: string,
  args: string[],
  options: InteractiveLaunchOptions,
) => Promise<InteractiveLaunchResult>;

export type InteractiveLaunchOutcome =
  | { readonly kind: 'exited'; readonly exitCode: number }
  | { readonly kind: 'unavailable'; readonly provider: string };

export interface LaunchInteractiveSessionOptions {
  readonly spawn?: InteractiveLaunchProcess;
  readonly report?: (message: string) => void;
  readonly isInteractiveTerminal?: () => boolean;
}

const defaultSpawn = (
  executable: string,
  args: string[],
  options: InteractiveLaunchOptions,
) => new Promise<InteractiveLaunchResult>((resolve, reject) => {
  const child = spawn(executable, args, options);
  child.once('error', reject);
  child.once('exit', (code) => resolve({ exitCode: code ?? 0 }));
});

/**
 * Starts a fresh, operator-owned provider session with the halt context as its
 * opening prompt. This intentionally bypasses provider adapters: adapter
 * launches carry the daemon-session marker and cannot perform recovery work.
 */
export async function launchInteractiveSession(
  request: InteractiveLaunchRequest,
  options: LaunchInteractiveSessionOptions = {},
): Promise<InteractiveLaunchOutcome> {
  const descriptor = findBuiltInProviderDescriptor(request.provider);
  const report = options.report ?? ((message: string) => process.stderr.write(`${message}\n`));
  const isInteractiveTerminal = options.isInteractiveTerminal
    ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));

  if (!isInteractiveTerminal()) {
    report('Interactive launch unavailable: no attached interactive terminal.');
    return { kind: 'unavailable', provider: request.provider };
  }

  if (!descriptor) {
    report(`Interactive launch unavailable: unregistered provider ${request.provider}.`);
    return { kind: 'unavailable', provider: request.provider };
  }
  if (!('interactiveLaunch' in descriptor) || !descriptor.interactiveLaunch) {
    report(`Interactive launch unavailable: provider ${request.provider} lacks capability interactiveLaunch (#1007).`);
    return { kind: 'unavailable', provider: request.provider };
  }

  try {
    const spawnProcess = options.spawn ?? defaultSpawn;
    const result = await spawnProcess(
      resolveProviderExecutable(descriptor.id),
      descriptor.interactiveLaunch.argv({
        prompt: request.openingPrompt,
        permissionMode: 'default',
        model: request.model,
        effort: request.effort,
      }),
      { cwd: request.cwd, stdio: 'inherit' },
    );
    return { kind: 'exited', exitCode: result.exitCode };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      report(`Interactive launch unavailable for ${request.provider}: ENOENT.`);
      return { kind: 'unavailable', provider: request.provider };
    }
    throw error;
  }
}
