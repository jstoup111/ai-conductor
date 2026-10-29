import { execFile } from 'node:child_process';
import { scrubTmuxEnvironment } from '../../execution/child-environment.js';
import type { CredentialResult } from './credential-resolver.js';
import type { CredentialReference } from './credential-reference.js';

const COMMAND_TIMEOUT_MS = 10_000;

export interface CommandRunnerOptions {
  readonly shell: false;
  readonly timeout: number;
  readonly env: NodeJS.ProcessEnv;
}

export type CommandRunner = (
  program: string,
  args: readonly string[],
  options: CommandRunnerOptions,
) => Promise<{ readonly stdout: string }>;

function expandHomeArgument(argument: string, home: string | undefined): string {
  return home !== undefined && argument.startsWith('~/')
    ? `${home}${argument.slice(1)}`
    : argument;
}

const productionCommandRunner: CommandRunner = (program, args, options) => new Promise((resolve, reject) => {
  execFile(program, [...args], options, (error, stdout) => {
    if (error) {
      reject(error);
      return;
    }
    resolve({ stdout: String(stdout) });
  });
});

export async function resolveCommandCredential(
  reference: Extract<CredentialReference, { readonly kind: 'command' }>,
  runner: CommandRunner = productionCommandRunner,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CredentialResult> {
  const [program, ...arguments_] = reference.argv;
  try {
    const { stdout } = await runner(
      program,
      arguments_.map((argument) => expandHomeArgument(argument, environment.HOME)),
      {
        shell: false,
        timeout: COMMAND_TIMEOUT_MS,
        env: scrubTmuxEnvironment({ ...environment }),
      },
    );
    const value = stdout.trim();
    return value === ''
      ? { kind: 'unavailable', reason: `Command credential source ${reference.argv.join(' ')} is unavailable.` }
      : { kind: 'value', value: `${reference.prefix ?? ''}${value}` };
  } catch {
    return { kind: 'unavailable', reason: `Command credential source ${reference.argv.join(' ')} is unavailable.` };
  }
}
