import { execFile } from 'node:child_process';
import { scrubTmuxEnvironment } from '../../execution/child-environment.js';
import type { CredentialResult } from './credential-resolver.js';
import type { CredentialReference } from './credential-reference.js';

const COMMAND_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_SECONDS = COMMAND_TIMEOUT_MS / 1_000;
const NO_REAL_EXEC_FAILURE = Symbol('no-real-exec-command-credential');

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

type CommandFailure = NodeJS.ErrnoException & {
  readonly killed?: boolean;
  readonly [NO_REAL_EXEC_FAILURE]?: true;
};

function expandHomeArgument(argument: string, home: string | undefined): string {
  return home !== undefined && argument.startsWith('~/')
    ? `${home}${argument.slice(1)}`
    : argument;
}

const productionCommandRunner: CommandRunner = (program, args, options) => new Promise((resolve, reject) => {
  if (options.env.AI_CONDUCTOR_NO_REAL_EXEC === '1') {
    reject({ [NO_REAL_EXEC_FAILURE]: true });
    return;
  }
  execFile(program, [...args], options, (error, stdout) => {
    if (error) {
      reject(error);
      return;
    }
    resolve({ stdout: String(stdout) });
  });
});

function commandSourceName(argv: readonly string[]): string {
  return `Command credential source ${argv.join(' ')}`;
}

function commandFailureReason(argv: readonly string[], error: unknown): string {
  const source = commandSourceName(argv);
  const failure = error as CommandFailure | undefined;
  if (failure?.[NO_REAL_EXEC_FAILURE] === true) {
    return `${source} is unavailable: AI_CONDUCTOR_NO_REAL_EXEC=1 prevents command execution.`;
  }
  if (failure?.code === 'ENOENT') {
    return `${source} is unavailable: program was not found (ENOENT).`;
  }
  if (failure?.code === 'ETIMEDOUT' || failure?.killed === true) {
    return `${source} is unavailable: command timed out after ${COMMAND_TIMEOUT_SECONDS} seconds.`;
  }
  if (typeof failure?.code === 'number') {
    return `${source} is unavailable: command exited with exit code ${failure.code}.`;
  }
  return `${source} is unavailable.`;
}

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
    const value = stdout.trimEnd();
    return value === ''
      ? { kind: 'unavailable', reason: `${commandSourceName(reference.argv)} is unavailable: command produced empty output.` }
      : { kind: 'value', value: `${reference.prefix ?? ''}${value}` };
  } catch (error) {
    return { kind: 'unavailable', reason: commandFailureReason(reference.argv, error) };
  }
}
