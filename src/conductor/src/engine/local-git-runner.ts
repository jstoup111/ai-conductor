import { execa } from 'execa';

/** Minimal local-object Git boundary for durable stores. */
export interface LocalGitRunner {
  (args: string[], opts?: { readonly input?: string }): Promise<LocalGitResult>;
}

export interface LocalGitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run local Git plumbing without importing a higher-level engine workflow. */
export function makeLocalGitRunner(cwd: string): LocalGitRunner {
  return async (args, options) => {
    try {
      const result = await execa('git', args, {
        cwd,
        reject: false,
        ...(options?.input === undefined ? {} : { input: options.input }),
      });
      return {
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : 1,
        stdout: typeof result.stdout === 'string' ? result.stdout : '',
        stderr: typeof result.stderr === 'string' ? result.stderr : '',
      };
    } catch {
      return { exitCode: 1, stdout: '', stderr: '' };
    }
  };
}
