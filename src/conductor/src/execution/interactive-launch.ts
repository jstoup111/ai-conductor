import { spawn } from 'node:child_process';

export interface InteractiveLaunchRequest {
  readonly provider: string;
  readonly openingPrompt: string;
  readonly cwd: string;
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
}

const interactiveInvocations = {
  claude: (prompt: string) => ({
    executable: 'claude',
    args: ['--permission-mode', 'default', prompt],
  }),
  codex: (prompt: string) => ({
    executable: 'codex',
    args: [prompt],
  }),
} as const;

const defaultSpawn: InteractiveLaunchProcess = (executable, args, options) => new Promise((resolve, reject) => {
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
  const invocation = interactiveInvocations[
    request.provider as keyof typeof interactiveInvocations
  ];
  const report = options.report ?? ((message: string) => process.stderr.write(`${message}\n`));

  if (!invocation) {
    report(`Interactive launch unavailable: unregistered provider ${request.provider}.`);
    return { kind: 'unavailable', provider: request.provider };
  }

  try {
    const result = await (options.spawn ?? defaultSpawn)(
      invocation(request.openingPrompt).executable,
      invocation(request.openingPrompt).args,
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
