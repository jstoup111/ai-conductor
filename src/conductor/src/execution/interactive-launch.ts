import { spawn } from 'node:child_process';

import {
  CLAUDE_PROVIDER,
  CODEX_PROVIDER,
  resolveProviderExecutable,
} from './provider-catalog.js';

export interface InteractiveLaunchRequest {
  readonly provider: string;
  readonly openingPrompt: string;
  readonly cwd: string;
}

export interface InteractiveLaunchOptions {
  readonly cwd: string;
  readonly stdio: 'inherit' | ['pipe', 'inherit', 'inherit'];
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

interface InteractiveInvocation {
  readonly executable: string;
  readonly args: string[];
  readonly stdio: InteractiveLaunchOptions['stdio'];
  readonly stdin?: string;
}

export interface LaunchInteractiveSessionOptions {
  readonly spawn?: InteractiveLaunchProcess;
  readonly report?: (message: string) => void;
  readonly isInteractiveTerminal?: () => boolean;
  /** The guided monitor alone needs an attached Codex TUI for operator approvals. */
  readonly mode?: 'guided-monitor';
}

const interactiveInvocations: Record<
  string,
  (prompt: string, mode?: LaunchInteractiveSessionOptions['mode']) => InteractiveInvocation
> = {
  [CLAUDE_PROVIDER]: (prompt: string) => ({
    executable: resolveProviderExecutable(CLAUDE_PROVIDER),
    args: ['--permission-mode', 'default', prompt],
    stdio: 'inherit',
  }),
  [CODEX_PROVIDER]: (prompt: string, mode?: LaunchInteractiveSessionOptions['mode']) => (
    mode === 'guided-monitor'
      ? {
          executable: resolveProviderExecutable(CODEX_PROVIDER),
          args: [prompt],
          stdio: 'inherit',
        }
      : {
          executable: resolveProviderExecutable(CODEX_PROVIDER),
          args: ['exec'],
          stdio: ['pipe', 'inherit', 'inherit'],
          stdin: prompt,
        }
  ),
} as const;

const defaultSpawn = (
  executable: string,
  args: string[],
  options: InteractiveLaunchOptions,
  stdin?: string,
) => new Promise<InteractiveLaunchResult>((resolve, reject) => {
  const child = spawn(executable, args, options);
  child.once('error', reject);
  child.once('exit', (code) => resolve({ exitCode: code ?? 0 }));
  if (stdin !== undefined) {
    child.stdin?.write(stdin);
    child.stdin?.end();
  }
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
  const invocation = interactiveInvocations[
    request.provider as keyof typeof interactiveInvocations
  ];
  const report = options.report ?? ((message: string) => process.stderr.write(`${message}\n`));
  const isInteractiveTerminal = options.isInteractiveTerminal
    ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));

  if (!isInteractiveTerminal()) {
    report('Interactive launch unavailable: no attached interactive terminal.');
    return { kind: 'unavailable', provider: request.provider };
  }

  if (!invocation) {
    report(`Interactive launch unavailable: unregistered provider ${request.provider}.`);
    return { kind: 'unavailable', provider: request.provider };
  }

  try {
    const launch = invocation(request.openingPrompt, options.mode);
    const spawnProcess = options.spawn ?? ((executable, args, spawnOptions) => defaultSpawn(
      executable,
      args,
      spawnOptions,
      launch.stdin,
    ));
    const result = await spawnProcess(
      launch.executable,
      launch.args,
      { cwd: request.cwd, stdio: launch.stdio },
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
