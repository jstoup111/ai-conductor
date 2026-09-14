import { readFile } from 'node:fs/promises';

import { executeGithubOperation } from './github-operations.js';
import { createGuardedGithubOperationRunner, makeProductionGh } from './tracker-client.js';

export interface GithubOperationCliCommand {
  readonly requestFile: string;
}

export function detectGithubOperationCommand(argv: readonly string[]): GithubOperationCliCommand | null {
  if (argv[2] !== 'github-operation') return null;
  const flag = argv.indexOf('--request-file');
  const requestFile = flag >= 0 ? argv[flag + 1] : undefined;
  return typeof requestFile === 'string' && requestFile.length > 0 ? { requestFile } : null;
}

/** Execute the closed request schema. Raw gh/git argv are deliberately never accepted. */
export async function dispatchGithubOperationCommand(
  command: GithubOperationCliCommand,
  input: { cwd: string; readRequest?: typeof readFile; gh?: ReturnType<typeof makeProductionGh> } = { cwd: process.cwd() },
): Promise<number> {
  let request: unknown;
  try {
    request = JSON.parse(await (input.readRequest ?? readFile)(command.requestFile, 'utf8'));
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ kind: 'failed', error: `invalid request file: ${error instanceof Error ? error.message : String(error)}` })}\n`);
    return 1;
  }
  const result = await executeGithubOperation(
    request,
    createGuardedGithubOperationRunner(input.gh ?? makeProductionGh(), { cwd: input.cwd }),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.kind === 'executed' ? 0 : 1;
}
