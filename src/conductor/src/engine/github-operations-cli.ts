import { readFile } from 'node:fs/promises';

import {
  decodeGithubOperationRequest,
  executeGithubOperation,
  type GithubOperationEventEmitter,
  type GithubOperationResult,
  type GithubOperationRunner,
  type GithubOperationTarget,
} from './github-operations.js';
import {
  requestExplicitGithubOperationApproval,
  type InteractiveGithubOperationConfirmation,
} from './github-operation-approval.js';
import { executeSharedGithubOperation } from './github-shared-operations.js';
import { createGithubIntakeAuthorization } from './engineer/intake/github-issues.js';
import { executeRemoteGit, resolveFeatureRemoteMutation, type RemoteGitCommandRunner } from './remote-git-operations.js';
import { makeProductionGit, type GitRunner } from './pr-labels.js';
import type { OwnerResolution } from './owner-gate/identity.js';
import {
  createGuardedGithubOperationRunner,
  makeProductionGh,
  runTrackerRead,
  type GithubMutationExecutionContext,
} from './tracker-client.js';

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
  /** Guarded remote transport and Git discovery are injectable for CLI composition tests. */
  readonly git?: GitRunner;
  readonly remoteGit?: typeof executeRemoteGit;
  /** Test seam for the same fresh owner lookup used by production provenance. */
  readonly resolveMachineOwner?: () => Promise<OwnerResolution>;
  /** Test seam; production always builds the canonical guarded runner below. */
  readonly runner?: GithubOperationRunner;
  /** Only an interactive callback can mint approval for one exact shared request. */
  readonly confirmation?: InteractiveGithubOperationConfirmation;
  /** Existing event spine when this command runs inside a conductor process. */
  readonly events?: GithubOperationEventEmitter;
  readonly write?: (line: string) => void;
}

async function featureMutationForRequest(
  request: import('./github-operations.js').GithubOperationRequest,
  input: GithubOperationCliInput,
  gh: ReturnType<typeof makeProductionGh>,
  git: GitRunner,
): Promise<GithubMutationExecutionContext | undefined> {
  if (request.access === 'read' || request.access === 'intake-write' || request.access === 'shared-write') return undefined;
  const { stdout } = await git(['branch', '--show-current'], { cwd: input.cwd });
  const branch = stdout.trim();
  if (!branch) return undefined;
  const resolved = await resolveFeatureRemoteMutation({
    cwd: input.cwd,
    slug: request.context.feature ?? branch.replace(/^spec\//, ''),
    branch,
    git: async (args) => git(args, { cwd: input.cwd }),
    gh,
  });
  if (!resolved) return undefined;
  if (request.target.kind === 'pull-request') {
    try {
      const stdout = await runTrackerRead(
        gh,
        input.cwd,
        'pull-request.read',
        resolved.provenance.repository,
        { kind: 'pull-request', number: request.target.number },
        ['pr', 'view', branch, '-R', resolved.provenance.repository, '--json', 'number'],
      );
      if ((JSON.parse(stdout) as { number?: unknown }).number !== request.target.number) return undefined;
    } catch {
      return undefined;
    }
  }
  return {
    // The resolved feature branch is the only remote-ref capability this CLI
    // composition can supply.  The mutation policy compares it to the
    // requested destination before the remote transport is invoked.
    provenance: request.target.kind === 'pull-request'
      // The branch-to-PR lookup above independently resolved this exact PR.
      // Preserve that binding for the policy instead of letting a ref grant
      // repository-wide PR authority.
      ? { ...resolved.provenance, target: request.target }
      : resolved.provenance,
    dependencies: {
      ...resolved.dependencies,
      ...(input.resolveMachineOwner === undefined ? {} : { resolveMachineOwner: input.resolveMachineOwner }),
    },
  };
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

  const gh = input.gh ?? makeProductionGh();
  const git = input.git ?? makeProductionGit();
  if (decoded.request.access === 'remote-ref-write') {
    const mutation = await featureMutationForRequest(decoded.request, input, gh, git);
    const approval = mutation === undefined && decoded.request.operation === 'remote-ref.push'
      ? await requestExplicitGithubOperationApproval(decoded.request, input.confirmation)
      : undefined;
    if (approval?.kind === 'refused') {
      const output: GithubOperationCliResult = {
        kind: 'refused',
        operation: decoded.request.operation,
        target: decoded.request.target,
        reason: approval.reason,
      };
      write(`${JSON.stringify(output)}\n`);
      return 1;
    }
    const result = await (input.remoteGit ?? executeRemoteGit)(
      decoded.request.operation === 'remote-ref.push'
        ? ['push', 'origin', `HEAD:${decoded.request.target.kind === 'remote-ref' ? decoded.request.target.ref : ''}`]
        : ['push', 'origin', '--delete', decoded.request.target.kind === 'remote-ref' ? decoded.request.target.ref.replace(/^refs\/heads\//, '') : ''],
      {
        cwd: input.cwd,
        config: (args) => git(args, { cwd: input.cwd }),
        runRemoteGit: git as RemoteGitCommandRunner,
        mutation,
        ...(approval?.kind === 'approved'
          ? { explicitApproval: { capability: approval.capability, request: decoded.request } }
          : {}),
        events: input.events,
      },
    );
    const output: GithubOperationCliResult = result.kind === 'executed'
      ? { kind: 'executed', operation: decoded.request.operation, target: decoded.request.target }
      : result.kind === 'refused'
        ? { kind: 'refused', operation: decoded.request.operation, target: decoded.request.target, reason: result.reason }
        : { kind: 'failed', operation: decoded.request.operation, target: decoded.request.target, error: result.kind === 'failed' ? result.error : 'not a remote write' };
    write(`${JSON.stringify(output)}\n`);
    return result.kind === 'executed' ? 0 : 1;
  }

  const runner = input.runner ?? createGuardedGithubOperationRunner(gh, {
    cwd: input.cwd,
    mutation: await featureMutationForRequest(decoded.request, input, gh, git),
    intake: createGithubIntakeAuthorization({ gh, cwd: input.cwd, confirmation: input.confirmation }),
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
