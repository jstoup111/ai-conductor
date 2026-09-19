import { readFile } from 'node:fs/promises';

import {
  decodeGithubOperationRequest,
  executeGithubOperation,
  type GithubOperationEventEmitter,
  type GithubOperationResult,
  type GithubOperationRunner,
  type GithubOperationTarget,
} from './github-operations.js';
import type { InteractiveGithubOperationConfirmation } from './github-operation-approval.js';
import { executeSharedGithubOperation } from './github-shared-operations.js';
import { createGuardedGithubOperationRunner, makeProductionGh } from './tracker-client.js';

export interface GithubOperationCliCommand {
  readonly requestFile: string;
}

export function detectGithubOperationCommand(argv: readonly string[]): GithubOperationCliCommand | null {
  if (argv.length !== 5 || argv[2] !== 'github-operation' || argv[3] !== '--request-file') return null;
  const requestFile = argv[4];
  return typeof requestFile === 'string' && requestFile.length > 0 ? { requestFile } : null;
}

export type GithubOperationCliResult =
  | { readonly kind: 'executed'; readonly operation: string; readonly target: GithubOperationTarget }
  | { readonly kind: 'refused'; readonly operation?: string; readonly target?: GithubOperationTarget; readonly reason: string }
  | { readonly kind: 'failed'; readonly operation?: string; readonly target?: GithubOperationTarget; readonly error: string }
  | {
    readonly kind: 'partial';
    readonly operation: string;
    readonly target: GithubOperationTarget;
    readonly created: GithubOperationTarget;
    readonly metadataFailures: readonly { readonly operation: string; readonly error: string }[];
  };

export interface GithubOperationCliInput {
  readonly cwd: string;
  readonly readRequest?: (path: string) => Promise<string>;
  readonly gh?: ReturnType<typeof makeProductionGh>;
  /** Test seam; production always builds the canonical guarded runner below. */
  readonly runner?: GithubOperationRunner;
  /** Only an interactive callback can mint approval for one exact shared request. */
  readonly confirmation?: InteractiveGithubOperationConfirmation;
  /** Existing event spine when this command runs inside a conductor process. */
  readonly events?: GithubOperationEventEmitter;
  readonly write?: (line: string) => void;
}

function canonicalCliResult(result: GithubOperationResult, target: GithubOperationTarget): GithubOperationCliResult {
  switch (result.kind) {
    case 'executed': return result;
    case 'refused': return { ...result, target };
    case 'failed': return { ...result, target };
    case 'partial': return { ...result, target: result.created };
  }
}

/** Execute the closed request schema. Raw gh/git argv are deliberately never accepted. */
export async function dispatchGithubOperationCommand(
  command: GithubOperationCliCommand,
  input: GithubOperationCliInput = { cwd: process.cwd() },
): Promise<number> {
  const write = input.write ?? ((line: string) => process.stdout.write(line));
  let request: unknown;
  try {
    request = JSON.parse(await (input.readRequest ?? (async (path) => readFile(path, 'utf8')))(command.requestFile));
  } catch (error) {
    write(`${JSON.stringify({ kind: 'failed', error: `invalid request file: ${error instanceof Error ? error.message : String(error)}` })}\n`);
    return 1;
  }

  const decoded = decodeGithubOperationRequest(request);
  if (decoded.kind === 'refused') {
    write(`${JSON.stringify(decoded)}\n`);
    return 1;
  }

  if (decoded.request.access === 'shared-write') {
    const result = await executeSharedGithubOperation(
      request,
      input.gh ?? makeProductionGh(),
      { cwd: input.cwd, confirmation: input.confirmation, events: input.events },
    );
    const output = canonicalCliResult(result as GithubOperationResult, decoded.request.target);
    write(`${JSON.stringify(output)}\n`);
    return result.kind === 'executed' ? 0 : 1;
  }

  const runner = input.runner ?? createGuardedGithubOperationRunner(input.gh ?? makeProductionGh(), {
    cwd: input.cwd,
    events: input.events,
  });
  const result = await executeGithubOperation(
    request,
    runner,
    { events: input.events },
  );
  const output = canonicalCliResult(result as GithubOperationResult, decoded.request.target);
  write(`${JSON.stringify(output)}\n`);
  return result.kind === 'executed' ? 0 : 1;
}
